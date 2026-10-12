import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

admin.initializeApp();

/**
 * Gmail credentials, stored as Cloud Functions secrets:
 *   firebase functions:secrets:set GMAIL_USER          (e.g. yourcompany@gmail.com)
 *   firebase functions:secrets:set GMAIL_APP_PASSWORD  (16-character Google App Password)
 * App Passwords need 2-Step Verification on the Google account:
 *   Google Account → Security → 2-Step Verification → App passwords.
 */
const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const EMAIL_SECRETS = [GMAIL_USER, GMAIL_APP_PASSWORD];

const ADMIN_ROLES = ['Owner', 'Super Admin', 'Owner / Super Admin', 'Admin'];

function getTransport() {
  const user = GMAIL_USER.value().trim();
  // Google shows app passwords in groups of four; spaces are not part of the password
  const pass = GMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  if (!user || !pass) {
    throw new HttpsError(
      'failed-precondition',
      'Gmail is not configured. Run: firebase functions:secrets:set GMAIL_USER and firebase functions:secrets:set GMAIL_APP_PASSWORD, then redeploy functions.'
    );
  }
  return { user, transporter: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }) };
}

async function getCompanyName(): Promise<string> {
  try {
    const snap = await admin.firestore().collection('companyProfile').limit(1).get();
    return (snap.docs[0]?.data()?.companyName as string) || 'Legendary One';
  } catch {
    return 'Legendary One';
  }
}

function wrapHtml(company: string, title: string, bodyHtml: string): string {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #E5E9F2; border-radius: 12px; padding: 24px; background: #ffffff;">
    <div style="margin-bottom: 16px;">
      <div style="color: #1A1F36; font-size: 18px; font-weight: 800;">${company}</div>
      <div style="color: #64748B; font-size: 12px; margin-top: 2px;">Business OS notification</div>
    </div>
    <h2 style="color: #1A1F36; font-size: 16px; margin: 0 0 12px;">${title}</h2>
    <div style="color: #475569; font-size: 13.5px; line-height: 1.6;">${bodyHtml}</div>
    <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
    <div style="font-size: 11.5px; color: #94A3B8;">This is an automated message from ${company}.</div>
  </div>`;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

async function sendMail(to: string | string[], subject: string, title: string, bodyHtml: string) {
  const recipients = (Array.isArray(to) ? to : [to]).map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0) return null;
  const { user, transporter } = getTransport();
  const company = await getCompanyName();
  const info = await transporter.sendMail({
    from: `"${company}" <${user}>`,
    to: recipients.join(', '),
    subject,
    html: wrapHtml(company, title, bodyHtml),
  });
  logger.info('[Email] sent', { messageId: info.messageId, to: recipients, subject });
  return info;
}

/** Respects Settings → Notifications: email channel on, and the event enabled for email. */
async function isEmailEnabledFor(eventId: string): Promise<boolean> {
  try {
    const snap = await admin.firestore().doc('notificationSettings/default').get();
    if (!snap.exists) return true; // not configured yet → default on
    const data = snap.data() || {};
    if (data.channels && data.channels.email === false) return false;
    const ev = (data.events || []).find((e: any) => e.eventId === eventId);
    if (!ev) return true;
    return ev.enabled !== false && ev.channels?.email !== false;
  } catch (err) {
    logger.warn('[Email] settings read failed, sending anyway', err);
    return true;
  }
}

async function employeeEmail(employeeId: unknown): Promise<string | null> {
  if (employeeId === undefined || employeeId === null || employeeId === '') return null;
  const snap = await admin.firestore().doc(`employees/${String(employeeId)}`).get();
  return (snap.data()?.email as string) || null;
}

async function adminEmails(): Promise<string[]> {
  const snap = await admin.firestore().collection('users').where('role', 'in', ADMIN_ROLES).get();
  return snap.docs
    .map((d) => d.data())
    .filter((u) => (u.status || 'Active') === 'Active' && u.email)
    .map((u) => u.email as string);
}

async function assertWorkspaceMember(uid: string) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Only workspace users can send email.');
}

// ---------------------------------------------------------------------------
// Callable: test email (Settings → Notifications → Test Email)
// ---------------------------------------------------------------------------
export const sendTestEmail = onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required to send test email.');
  await assertWorkspaceMember(request.auth.uid);

  const toEmail = String(request.data?.toEmail || request.auth.token.email || '').trim();
  if (!toEmail) throw new HttpsError('invalid-argument', 'A recipient email address is required.');

  try {
    await sendMail(
      toEmail,
      '✅ Test email: Gmail notifications are working',
      'Email channel verified',
      `Your Gmail sender (<strong>${esc(GMAIL_USER.value())}</strong>) is connected through Nodemailer.
       Notifications for tasks, leave and payroll will be delivered from this address.`
    );
    return { success: true, recipient: toEmail, message: `Test email sent to ${toEmail}.` };
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    logger.error('[Email] test send failed', error);
    const hint =
      error?.code === 'EAUTH'
        ? ' Gmail rejected the login: check GMAIL_USER and that GMAIL_APP_PASSWORD is a valid App Password (not your normal password).'
        : '';
    throw new HttpsError('internal', `Email delivery failed: ${error?.message || error}.${hint}`);
  }
});

// ---------------------------------------------------------------------------
// Callable: generic email for app features
// ---------------------------------------------------------------------------
export const sendEmail = onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required.');
  await assertWorkspaceMember(request.auth.uid);

  const { to, subject, html, eventId } = (request.data || {}) as {
    to?: string | string[];
    subject?: string;
    html?: string;
    eventId?: string;
  };
  const recipients = (Array.isArray(to) ? to : [to || '']).filter(Boolean);
  if (recipients.length === 0 || recipients.length > 20) {
    throw new HttpsError('invalid-argument', 'Provide between 1 and 20 recipients.');
  }
  if (!subject || !html) throw new HttpsError('invalid-argument', 'Subject and html body are required.');
  if (eventId && !(await isEmailEnabledFor(eventId))) {
    return { success: false, skipped: true, message: 'Email is turned off for this event in Settings.' };
  }

  await sendMail(recipients, subject, subject, html);
  return { success: true, message: `Email sent to ${recipients.length} recipient(s).` };
});

// ---------------------------------------------------------------------------
// Automatic notifications
// ---------------------------------------------------------------------------

/** New task with an assignee → email the employee. */
export const onTaskCreated = onDocumentCreated({ document: 'tasks/{taskId}', secrets: EMAIL_SECRETS }, async (event) => {
  const task = event.data?.data();
  if (!task || !(await isEmailEnabledFor('task_assigned'))) return;
  const to = await employeeEmail(task.assignedToId);
  if (!to) return;
  try {
    await sendMail(
      to,
      `New task assigned: ${task.title || task.task}`,
      'You have a new task',
      `<p><strong>${esc(task.title || task.task)}</strong></p>
       ${task.description ? `<p>${esc(task.description)}</p>` : ''}
       <p>Project: ${esc(task.projectName || task.project || 'General')}<br/>
       Priority: ${esc(task.priority || 'Medium')}<br/>
       Due: ${esc(task.dueDate || task.deadline || '—')}</p>`
    );
  } catch (err) {
    logger.error('[Email] task notification failed', err);
  }
});

/** New leave request → email owners/admins. */
export const onLeaveRequested = onDocumentCreated({ document: 'leaveRequests/{leaveId}', secrets: EMAIL_SECRETS }, async (event) => {
  const leave = event.data?.data();
  if (!leave || !(await isEmailEnabledFor('leave_request'))) return;
  try {
    await sendMail(
      await adminEmails(),
      `Leave request: ${leave.employeeName} (${leave.days} day${Number(leave.days) === 1 ? '' : 's'})`,
      'New leave request awaiting approval',
      `<p><strong>${esc(leave.employeeName)}</strong> requested <strong>${esc(leave.leaveType)}</strong>.</p>
       <p>Dates: ${esc(leave.fromDate)} → ${esc(leave.toDate)} (${esc(leave.days)} day(s))<br/>
       Reason: ${esc(leave.reason)}</p>`
    );
  } catch (err) {
    logger.error('[Email] leave request notification failed', err);
  }
});

/** Leave approved / rejected → email the employee. */
export const onLeaveDecided = onDocumentUpdated({ document: 'leaveRequests/{leaveId}', secrets: EMAIL_SECRETS }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status) return;
  if (after.status !== 'Approved' && after.status !== 'Rejected') return;
  if (!(await isEmailEnabledFor('leave_approved_rejected'))) return;
  const to = await employeeEmail(after.employeeId);
  if (!to) return;
  try {
    await sendMail(
      to,
      `Your leave request was ${String(after.status).toLowerCase()}`,
      `Leave ${after.status}`,
      `<p>${esc(after.leaveType)}: ${esc(after.fromDate)} → ${esc(after.toDate)} (${esc(after.days)} day(s))</p>
       ${after.adminRemarks ? `<p>Remarks: ${esc(after.adminRemarks)}</p>` : ''}`
    );
  } catch (err) {
    logger.error('[Email] leave decision notification failed', err);
  }
});

/** Payroll marked paid → email the employee a salary summary. */
export const onPayrollPaid = onDocumentUpdated({ document: 'payroll/{payrollId}', secrets: EMAIL_SECRETS }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === 'Paid' || after.status !== 'Paid') return;
  if (!(await isEmailEnabledFor('payroll_marked_paid'))) return;
  const to = await employeeEmail(after.employeeId);
  if (!to) return;
  const inr = (n: unknown) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  try {
    await sendMail(
      to,
      `Salary credited for ${after.month}`,
      'Your salary has been paid',
      `<p>Gross: ${inr(after.grossSalary)}<br/>Deductions: ${inr(after.totalDeductions)}<br/>
       <strong>Net pay: ${inr(after.netSalary)}</strong></p>
       <p>Paid on ${esc(after.paymentDate || '')}${after.paymentReference ? ` · Ref ${esc(after.paymentReference)}` : ''}.
       Sign in to view your payslip under My Salary.</p>`
    );
  } catch (err) {
    logger.error('[Email] payroll notification failed', err);
  }
});
