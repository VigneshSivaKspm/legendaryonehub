"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onPayrollPaid = exports.onLeaveDecided = exports.onLeaveRequested = exports.onTaskCreated = exports.sendEmail = exports.sendTestEmail = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
admin.initializeApp();
/**
 * Gmail credentials, stored as Cloud Functions secrets:
 *   firebase functions:secrets:set GMAIL_USER          (e.g. yourcompany@gmail.com)
 *   firebase functions:secrets:set GMAIL_APP_PASSWORD  (16-character Google App Password)
 * App Passwords need 2-Step Verification on the Google account:
 *   Google Account → Security → 2-Step Verification → App passwords.
 */
const GMAIL_USER = (0, params_1.defineSecret)('GMAIL_USER');
const GMAIL_APP_PASSWORD = (0, params_1.defineSecret)('GMAIL_APP_PASSWORD');
const EMAIL_SECRETS = [GMAIL_USER, GMAIL_APP_PASSWORD];
const ADMIN_ROLES = ['Owner', 'Super Admin', 'Owner / Super Admin', 'Admin'];
function getTransport() {
    const user = GMAIL_USER.value().trim();
    // Google shows app passwords in groups of four; spaces are not part of the password
    const pass = GMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
    if (!user || !pass) {
        throw new https_1.HttpsError('failed-precondition', 'Gmail is not configured. Run: firebase functions:secrets:set GMAIL_USER and firebase functions:secrets:set GMAIL_APP_PASSWORD, then redeploy functions.');
    }
    return { user, transporter: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }) };
}
async function getCompanyName() {
    try {
        const snap = await admin.firestore().collection('companyProfile').limit(1).get();
        return snap.docs[0]?.data()?.companyName || 'Legendary One';
    }
    catch {
        return 'Legendary One';
    }
}
function wrapHtml(company, title, bodyHtml) {
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
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function sendMail(to, subject, title, bodyHtml) {
    const recipients = (Array.isArray(to) ? to : [to]).map((e) => e.trim()).filter(Boolean);
    if (recipients.length === 0)
        return null;
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
async function isEmailEnabledFor(eventId) {
    try {
        const snap = await admin.firestore().doc('notificationSettings/default').get();
        if (!snap.exists)
            return true; // not configured yet → default on
        const data = snap.data() || {};
        if (data.channels && data.channels.email === false)
            return false;
        const ev = (data.events || []).find((e) => e.eventId === eventId);
        if (!ev)
            return true;
        return ev.enabled !== false && ev.channels?.email !== false;
    }
    catch (err) {
        logger.warn('[Email] settings read failed, sending anyway', err);
        return true;
    }
}
async function employeeEmail(employeeId) {
    if (employeeId === undefined || employeeId === null || employeeId === '')
        return null;
    const snap = await admin.firestore().doc(`employees/${String(employeeId)}`).get();
    return snap.data()?.email || null;
}
async function adminEmails() {
    const snap = await admin.firestore().collection('users').where('role', 'in', ADMIN_ROLES).get();
    return snap.docs
        .map((d) => d.data())
        .filter((u) => (u.status || 'Active') === 'Active' && u.email)
        .map((u) => u.email);
}
async function assertWorkspaceMember(uid) {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    if (!snap.exists)
        throw new https_1.HttpsError('permission-denied', 'Only workspace users can send email.');
}
// ---------------------------------------------------------------------------
// Callable: test email (Settings → Notifications → Test Email)
// ---------------------------------------------------------------------------
exports.sendTestEmail = (0, https_1.onCall)({ secrets: EMAIL_SECRETS }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required to send test email.');
    await assertWorkspaceMember(request.auth.uid);
    const toEmail = String(request.data?.toEmail || request.auth.token.email || '').trim();
    if (!toEmail)
        throw new https_1.HttpsError('invalid-argument', 'A recipient email address is required.');
    try {
        await sendMail(toEmail, '✅ Test email: Gmail notifications are working', 'Email channel verified', `Your Gmail sender (<strong>${esc(GMAIL_USER.value())}</strong>) is connected through Nodemailer.
       Notifications for tasks, leave and payroll will be delivered from this address.`);
        return { success: true, recipient: toEmail, message: `Test email sent to ${toEmail}.` };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        logger.error('[Email] test send failed', error);
        const hint = error?.code === 'EAUTH'
            ? ' Gmail rejected the login: check GMAIL_USER and that GMAIL_APP_PASSWORD is a valid App Password (not your normal password).'
            : '';
        throw new https_1.HttpsError('internal', `Email delivery failed: ${error?.message || error}.${hint}`);
    }
});
// ---------------------------------------------------------------------------
// Callable: generic email for app features
// ---------------------------------------------------------------------------
exports.sendEmail = (0, https_1.onCall)({ secrets: EMAIL_SECRETS }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required.');
    await assertWorkspaceMember(request.auth.uid);
    const { to, subject, html, eventId } = (request.data || {});
    const recipients = (Array.isArray(to) ? to : [to || '']).filter(Boolean);
    if (recipients.length === 0 || recipients.length > 20) {
        throw new https_1.HttpsError('invalid-argument', 'Provide between 1 and 20 recipients.');
    }
    if (!subject || !html)
        throw new https_1.HttpsError('invalid-argument', 'Subject and html body are required.');
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
exports.onTaskCreated = (0, firestore_1.onDocumentCreated)({ document: 'tasks/{taskId}', secrets: EMAIL_SECRETS }, async (event) => {
    const task = event.data?.data();
    if (!task || !(await isEmailEnabledFor('task_assigned')))
        return;
    const to = await employeeEmail(task.assignedToId);
    if (!to)
        return;
    try {
        await sendMail(to, `New task assigned: ${task.title || task.task}`, 'You have a new task', `<p><strong>${esc(task.title || task.task)}</strong></p>
       ${task.description ? `<p>${esc(task.description)}</p>` : ''}
       <p>Project: ${esc(task.projectName || task.project || 'General')}<br/>
       Priority: ${esc(task.priority || 'Medium')}<br/>
       Due: ${esc(task.dueDate || task.deadline || '—')}</p>`);
    }
    catch (err) {
        logger.error('[Email] task notification failed', err);
    }
});
/** New leave request → email owners/admins. */
exports.onLeaveRequested = (0, firestore_1.onDocumentCreated)({ document: 'leaveRequests/{leaveId}', secrets: EMAIL_SECRETS }, async (event) => {
    const leave = event.data?.data();
    if (!leave || !(await isEmailEnabledFor('leave_request')))
        return;
    try {
        await sendMail(await adminEmails(), `Leave request: ${leave.employeeName} (${leave.days} day${Number(leave.days) === 1 ? '' : 's'})`, 'New leave request awaiting approval', `<p><strong>${esc(leave.employeeName)}</strong> requested <strong>${esc(leave.leaveType)}</strong>.</p>
       <p>Dates: ${esc(leave.fromDate)} → ${esc(leave.toDate)} (${esc(leave.days)} day(s))<br/>
       Reason: ${esc(leave.reason)}</p>`);
    }
    catch (err) {
        logger.error('[Email] leave request notification failed', err);
    }
});
/** Leave approved / rejected → email the employee. */
exports.onLeaveDecided = (0, firestore_1.onDocumentUpdated)({ document: 'leaveRequests/{leaveId}', secrets: EMAIL_SECRETS }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status)
        return;
    if (after.status !== 'Approved' && after.status !== 'Rejected')
        return;
    if (!(await isEmailEnabledFor('leave_approved_rejected')))
        return;
    const to = await employeeEmail(after.employeeId);
    if (!to)
        return;
    try {
        await sendMail(to, `Your leave request was ${String(after.status).toLowerCase()}`, `Leave ${after.status}`, `<p>${esc(after.leaveType)}: ${esc(after.fromDate)} → ${esc(after.toDate)} (${esc(after.days)} day(s))</p>
       ${after.adminRemarks ? `<p>Remarks: ${esc(after.adminRemarks)}</p>` : ''}`);
    }
    catch (err) {
        logger.error('[Email] leave decision notification failed', err);
    }
});
/** Payroll marked paid → email the employee a salary summary. */
exports.onPayrollPaid = (0, firestore_1.onDocumentUpdated)({ document: 'payroll/{payrollId}', secrets: EMAIL_SECRETS }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === 'Paid' || after.status !== 'Paid')
        return;
    if (!(await isEmailEnabledFor('payroll_marked_paid')))
        return;
    const to = await employeeEmail(after.employeeId);
    if (!to)
        return;
    const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
    try {
        await sendMail(to, `Salary credited for ${after.month}`, 'Your salary has been paid', `<p>Gross: ${inr(after.grossSalary)}<br/>Deductions: ${inr(after.totalDeductions)}<br/>
       <strong>Net pay: ${inr(after.netSalary)}</strong></p>
       <p>Paid on ${esc(after.paymentDate || '')}${after.paymentReference ? ` · Ref ${esc(after.paymentReference)}` : ''}.
       Sign in to view your payslip under My Salary.</p>`);
    }
    catch (err) {
        logger.error('[Email] payroll notification failed', err);
    }
});
//# sourceMappingURL=index.js.map