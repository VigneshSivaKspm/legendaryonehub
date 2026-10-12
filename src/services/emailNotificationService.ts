import { doc, getDoc } from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import {
  db,
  safeOpenDatabase,
  type EmailJsConfig,
  type LeaveRequest,
  type NotificationSettings,
  type PayrollRecord,
  type ProjectTask,
} from '../db/database';
import { isOwnerOrAdminRole } from './authService';
import { getLocalCachedCompanyProfile } from './companyService';

/**
 * Browser-only email via EmailJS (https://www.emailjs.com). EmailJS relays mail through
 * your own Gmail account, so no server / Cloud Functions are needed.
 *
 * One-time setup:
 *  1. EmailJS → Email Services → Add "Gmail" (connect the company Gmail), or "Personal SMTP"
 *     with host smtp.gmail.com, port 465, your Gmail address and a Google App Password.
 *  2. Email Templates → Create template:
 *       To Email: {{to_email}}      Subject: {{subject}}      From Name: {{from_name}}
 *       Content (switch the editor to code/HTML): {{{message_html}}}
 *  3. Account → General → copy the Public Key.
 *  4. In the app: Settings → Notifications → Email → paste Service ID, Template ID and Public Key.
 */

export interface SendTestEmailResult {
  success: boolean;
  message: string;
  recipient?: string;
  isConfigured?: boolean;
}

async function getSettings(): Promise<NotificationSettings | undefined> {
  try {
    await safeOpenDatabase();
    const cached = await db.notificationSettings.get('default');
    if (cached) return cached;
  } catch {
    /* fall through to Firestore */
  }
  try {
    const snap = await getDoc(doc(dbFirestore, 'notificationSettings', 'default'));
    return snap.exists() ? (snap.data() as NotificationSettings) : undefined;
  } catch {
    return undefined;
  }
}

export function isEmailJsConfigured(cfg?: EmailJsConfig): cfg is EmailJsConfig {
  return !!cfg?.serviceId?.trim() && !!cfg?.templateId?.trim() && !!cfg?.publicKey?.trim();
}

function isEventEmailEnabled(settings: NotificationSettings | undefined, eventId?: string): boolean {
  if (!settings) return false;
  if (!settings.channels?.email) return false;
  if (!eventId) return true;
  const ev = settings.events?.find((e) => e.eventId === eventId);
  return !ev || (ev.enabled !== false && ev.channels?.email !== false);
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function companyName(): string {
  return getLocalCachedCompanyProfile()?.companyName || 'Legendary One';
}

function wrapHtml(company: string, title: string, bodyHtml: string): string {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #E5E9F2; border-radius: 12px; padding: 24px; background: #ffffff;">
    <div style="color: #1A1F36; font-size: 18px; font-weight: 800;">${esc(company)}</div>
    <div style="color: #64748B; font-size: 12px; margin: 2px 0 16px;">Business OS notification</div>
    <h2 style="color: #1A1F36; font-size: 16px; margin: 0 0 12px;">${esc(title)}</h2>
    <div style="color: #475569; font-size: 13.5px; line-height: 1.6;">${bodyHtml}</div>
    <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
    <div style="font-size: 11.5px; color: #94A3B8;">This is an automated message from ${esc(company)}.</div>
  </div>`;
}

async function postEmailJs(cfg: EmailJsConfig, params: Record<string, string>): Promise<void> {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: cfg.serviceId.trim(),
      template_id: cfg.templateId.trim(),
      user_id: cfg.publicKey.trim(),
      template_params: params,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `EmailJS returned ${res.status}`);
  }
}

/**
 * Sends one email (recipients comma-joined). Returns false when email is off, not configured,
 * or the event is disabled in Settings → Notifications.
 */
export async function sendAppEmail(opts: {
  to: string | string[];
  subject: string;
  title: string;
  bodyHtml: string;
  eventId?: string;
}): Promise<boolean> {
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((e) => (e || '').trim()).filter(Boolean);
  if (recipients.length === 0) return false;

  const settings = await getSettings();
  const cfg = settings?.emailjs;
  if (!isEmailJsConfigured(cfg) || !isEventEmailEnabled(settings, opts.eventId)) return false;

  const company = cfg.fromName?.trim() || companyName();
  await postEmailJs(cfg, {
    to_email: Array.from(new Set(recipients)).join(','),
    subject: opts.subject,
    from_name: company,
    message_html: wrapHtml(company, opts.title, opts.bodyHtml),
  });
  return true;
}

/** Fire-and-forget wrapper so a mail failure never breaks the action that triggered it. */
function notify(promise: Promise<unknown>, label: string) {
  promise.catch((err) => console.warn(`[Email] ${label} notification not sent:`, err?.message || err));
}

/** Test email from Settings → Notifications (uses the config currently in the form). */
export async function dispatchTestEmail(toEmail?: string, cfg?: EmailJsConfig): Promise<SendTestEmailResult> {
  const config = cfg || (await getSettings())?.emailjs;
  if (!isEmailJsConfigured(config)) {
    return {
      success: false,
      isConfigured: false,
      message: 'Enter your EmailJS Service ID, Template ID and Public Key first.',
    };
  }
  if (!toEmail) return { success: false, isConfigured: true, message: 'No recipient email address available.' };
  try {
    const company = config.fromName?.trim() || companyName();
    await postEmailJs(config, {
      to_email: toEmail,
      subject: '✅ Test email: notifications are working',
      from_name: company,
      message_html: wrapHtml(
        company,
        'Email channel verified',
        'Your Gmail account is connected through EmailJS. Task, leave and payroll notifications will be sent from it.'
      ),
    });
    return { success: true, isConfigured: true, recipient: toEmail, message: `Test email sent to ${toEmail}.` };
  } catch (err: any) {
    return { success: false, isConfigured: true, message: `Email failed: ${err?.message || err}` };
  }
}

// ---------------------------------------------------------------------------
// Workspace event notifications (called from the services that perform the action)
// ---------------------------------------------------------------------------

async function employeeEmail(employeeId?: number | string, employeeName?: string): Promise<string> {
  await safeOpenDatabase();
  const employees = await db.employees.toArray();
  const emp =
    employees.find((e) => employeeId !== undefined && employeeId !== '' && String(e.id) === String(employeeId)) ||
    employees.find((e) => !!employeeName && e.name === employeeName);
  return emp?.email || '';
}

async function adminEmails(): Promise<string[]> {
  await safeOpenDatabase();
  const users = await db.users.toArray();
  return users.filter((u) => isOwnerOrAdminRole(u.role) && (u.status || 'Active') === 'Active' && u.email).map((u) => u.email);
}

export function notifyTaskAssigned(task: Partial<ProjectTask>) {
  const name = task.assignedTo || task.assignee;
  if (!name && task.assignedToId === undefined) return;
  notify(
    (async () => {
      const to = await employeeEmail(task.assignedToId, name);
      await sendAppEmail({
        to,
        eventId: 'task_assigned',
        subject: `New task assigned: ${task.title || task.task}`,
        title: 'You have a new task',
        bodyHtml: `<p><strong>${esc(task.title || task.task)}</strong></p>
          ${task.description ? `<p>${esc(task.description)}</p>` : ''}
          <p>Project: ${esc(task.projectName || task.project || 'General')}<br/>
          Priority: ${esc(task.priority || 'Medium')}<br/>Due: ${esc(task.dueDate || task.deadline || '—')}</p>`,
      });
    })(),
    'task'
  );
}

export function notifyLeaveRequested(leave: Partial<LeaveRequest>) {
  notify(
    (async () =>
      sendAppEmail({
        to: await adminEmails(),
        eventId: 'leave_request',
        subject: `Leave request: ${leave.employeeName} (${leave.days} day${Number(leave.days) === 1 ? '' : 's'})`,
        title: 'New leave request awaiting approval',
        bodyHtml: `<p><strong>${esc(leave.employeeName)}</strong> requested <strong>${esc(leave.leaveType)}</strong>.</p>
          <p>Dates: ${esc(leave.fromDate)} → ${esc(leave.toDate)} (${esc(leave.days)} day(s))<br/>Reason: ${esc(leave.reason)}</p>`,
      }))(),
    'leave request'
  );
}

export function notifyLeaveDecision(leave: Partial<LeaveRequest>) {
  if (leave.status !== 'Approved' && leave.status !== 'Rejected') return;
  notify(
    (async () =>
      sendAppEmail({
        to: await employeeEmail(leave.employeeId, leave.employeeName),
        eventId: 'leave_approved_rejected',
        subject: `Your leave request was ${String(leave.status).toLowerCase()}`,
        title: `Leave ${leave.status}`,
        bodyHtml: `<p>${esc(leave.leaveType)}: ${esc(leave.fromDate)} → ${esc(leave.toDate)} (${esc(leave.days)} day(s))</p>
          ${leave.adminRemarks ? `<p>Remarks: ${esc(leave.adminRemarks)}</p>` : ''}`,
      }))(),
    'leave decision'
  );
}

export function notifyPayrollPaid(rec: Partial<PayrollRecord>) {
  const inr = (n: unknown) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  notify(
    (async () =>
      sendAppEmail({
        to: await employeeEmail(rec.employeeId, rec.employeeName),
        eventId: 'payroll_marked_paid',
        subject: `Salary credited for ${rec.month}`,
        title: 'Your salary has been paid',
        bodyHtml: `<p>Gross: ${inr(rec.grossSalary)}<br/>Deductions: ${inr(rec.totalDeductions)}<br/>
          <strong>Net pay: ${inr(rec.netSalary)}</strong></p>
          <p>Paid on ${esc(rec.paymentDate || '')}${rec.paymentReference ? ` · Ref ${esc(rec.paymentReference)}` : ''}.
          Sign in to view your payslip under My Salary.</p>`,
      }))(),
    'payroll'
  );
}
