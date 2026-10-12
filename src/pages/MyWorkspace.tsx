import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LeaveRequest, type PayrollRecord, type ProjectTask } from '../db/database';
import { newestFirst } from '../utils/sort';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateTask } from '../services/taskService';
import { addLeaveRequest } from '../services/leaveService';
import { adjustmentsFor } from '../services/payrollAdjustmentService';
import { calculateLeaveDays } from './Leave';
import { formatTime12h, formatLunch, formatDuration, isDueOn, isTaskDone } from '../utils/attendanceTimes';
import { computeMonthPay, formatRate } from '../utils/salary';

export type WorkspaceTab = 'overview' | 'today' | 'tasks' | 'leave' | 'salary';

const TABS: { key: WorkspaceTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'today', label: "Today's Tasks" },
  { key: 'tasks', label: 'All My Tasks' },
  { key: 'leave', label: 'My Leave' },
  { key: 'salary', label: 'My Salary' },
];

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned / Paid Leave', 'Unpaid Leave', 'Work From Home'];

const inr = (n: number) => '₹' + (Math.round(Number(n) || 0)).toLocaleString('en-IN');
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

const statusBadge: Record<string, string> = {
  Present: 'badge-green',
  Absent: 'badge-red',
  'On Leave': 'badge-purple',
  Late: 'badge-amber',
  'Half Day': 'badge-cyan',
  Pending: 'badge-amber',
  Approved: 'badge-green',
  Rejected: 'badge-red',
  Paid: 'badge-green',
};

const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="stat-card" style={{ flex: '1 1 170px' }}>
      <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#697586', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Personal dashboard for a signed-in employee: only their own tasks, attendance, leave and salary. */
export default function MyWorkspace({
  initialTab = 'overview',
  onOpenAttendance,
}: {
  initialTab?: WorkspaceTab;
  onOpenAttendance?: () => void;
}) {
  const { user, myEmployee, companyProfile } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [payslip, setPayslip] = useState<PayrollRecord | null>(null);
  // Progress update for an unfinished task: % done + why it's running late
  const [progressTask, setProgressTask] = useState<ProjectTask | null>(null);
  const [progressForm, setProgressForm] = useState({ progress: 0, reason: '' });
  const [leaveForm, setLeaveForm] = useState({
    leaveType: 'Casual Leave',
    fromDate: localDate(),
    toDate: localDate(),
    isHalfDay: false,
    halfDaySession: 'Morning' as 'Morning' | 'Afternoon',
    reason: '',
  });

  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const attendance = useLiveQuery(() => db.attendance.toArray(), []) || [];
  const leaves = useLiveQuery(() => db.leaveRequests.toArray(), []) || [];
  const payroll = useLiveQuery(() => db.payroll.toArray(), []) || [];
  const adjustments = useLiveQuery(() => db.payrollAdjustments.toArray(), []) || [];

  const empId = myEmployee?.id !== undefined ? String(myEmployee.id) : '';
  const empName = myEmployee?.name || '';

  const myTasks = useMemo(
    () =>
      newestFirst(
        tasks.filter(
          (t) =>
            (t.assignedToId !== undefined && String(t.assignedToId) === empId) ||
            (!!empName && (t.assignedTo === empName || t.assignee === empName))
        ),
        (t) => t.start || t.dueDate || t.deadline
      ),
    [tasks, empId, empName]
  );
  const myAttendance = useMemo(
    () => attendance.filter((a) => String(a.employeeId) === empId).sort((a, b) => b.date.localeCompare(a.date)),
    [attendance, empId]
  );
  const myLeaves = useMemo(
    () => leaves.filter((l) => String(l.employeeId) === empId).sort((a, b) => b.fromDate.localeCompare(a.fromDate)),
    [leaves, empId]
  );
  const myPayroll = useMemo(
    () => payroll.filter((p) => String(p.employeeId) === empId).sort((a, b) => b.month.localeCompare(a.month)),
    [payroll, empId]
  );

  if (!myEmployee) {
    return (
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 40, textAlign: 'center', maxWidth: 560, margin: '40px auto' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🪪</div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36', marginBottom: 6 }}>
            Your login isn't linked to an employee record yet
          </div>
          <div style={{ fontSize: 13.5, color: '#697586', lineHeight: 1.6 }}>
            Ask your administrator to add you in <strong>Employees</strong> with the email <strong>{user?.email}</strong>. Your tasks,
            attendance, leave and salary will appear here once linked.
          </div>
        </div>
      </div>
    );
  }

  const today = localDate();
  const todayRecord = myAttendance.find((a) => a.date === today);
  const openTasks = myTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Done');
  const todayTasks = myTasks.filter((t) => isDueOn(t, today));
  const todayNeedsUpdate = todayTasks.filter((t) => !isTaskDone(t) && t.progressUpdatedOn !== today).length;
  const month = today.slice(0, 7);
  const monthAttendance = myAttendance.filter((a) => a.date.startsWith(month));
  const counts = monthAttendance.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      acc.overtime += Number(a.overtimeHours) || 0;
      return acc;
    },
    { overtime: 0 } as Record<string, number>
  );
  const year = today.slice(0, 4);
  const leaveDaysThisYear = myLeaves
    .filter((l) => l.status === 'Approved' && l.fromDate.startsWith(year))
    .reduce((s, l) => s + (Number(l.days) || 0), 0);
  const pendingLeaves = myLeaves.filter((l) => l.status === 'Pending').length;
  const lastPay = myPayroll[0];
  // Salary earned this month under the attendance rules (same maths as the admin payroll)
  const monthPay = computeMonthPay({
    month,
    salary: Number(myEmployee.salary) || 0,
    workingWeekdays: companyProfile?.workingDays,
    attendance: myAttendance,
    leaves: myLeaves,
    today,
  });

  // ---------- actions ----------
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      showToast(err?.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleTaskStatus = async (t: ProjectTask, status: ProjectTask['status']) => {
    if (!t.id) return;
    try {
      await updateTask(t.id, status === 'Completed' ? { status, progress: 100 } : { status });
      showToast(`Task marked ${status}.`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not update task.', 'error');
    }
  };

  const openProgress = (t: ProjectTask) => {
    setProgressTask(t);
    setProgressForm({ progress: Math.min(Number(t.progress) || 0, 90), reason: t.delayReason || '' });
  };

  const handleSaveProgress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!progressTask?.id) return;
    if (!progressForm.reason.trim()) {
      showToast('Please explain why this task is still pending.', 'error');
      return;
    }
    run(async () => {
      await updateTask(progressTask.id!, {
        status: progressForm.progress > 0 ? 'In Progress' : 'Pending',
        progress: progressForm.progress,
        delayReason: progressForm.reason.trim(),
        progressUpdatedOn: today,
        progressUpdatedAt: new Date().toISOString(),
      });
      showToast('Progress updated.', 'success');
      setProgressTask(null);
    });
  };

  const leaveDays = calculateLeaveDays(leaveForm.fromDate, leaveForm.toDate, leaveForm.isHalfDay);

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (leaveDays <= 0) {
      showToast('End date must be on or after the start date.', 'error');
      return;
    }
    if (!leaveForm.reason.trim()) {
      showToast('Please enter a reason for the leave.', 'error');
      return;
    }
    const overlaps = myLeaves.some(
      (l) => l.status !== 'Rejected' && l.fromDate <= leaveForm.toDate && l.toDate >= leaveForm.fromDate
    );
    if (overlaps) {
      showToast('You already have a leave request covering these dates.', 'error');
      return;
    }
    setBusy(true);
    try {
      const req: Omit<LeaveRequest, 'id'> = {
        employeeId: myEmployee.id!,
        employeeName: myEmployee.name,
        employeeCode: myEmployee.employeeId,
        department: myEmployee.dept,
        leaveType: leaveForm.leaveType,
        fromDate: leaveForm.fromDate,
        toDate: leaveForm.toDate,
        days: leaveDays,
        isHalfDay: leaveForm.isHalfDay,
        halfDaySession: leaveForm.isHalfDay ? leaveForm.halfDaySession : 'Full Day',
        reason: leaveForm.reason.trim(),
        contactNotes: '',
        status: 'Pending',
      };
      await addLeaveRequest(req);
      showToast('Leave request sent for approval.', 'success');
      setShowLeaveForm(false);
      setLeaveForm({ ...leaveForm, reason: '' });
    } catch (err: any) {
      showToast(err?.message || 'Could not submit leave request.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // ---------- render helpers ----------
  const taskTable = (list: ProjectTask[], compact = false) => (
    <table className="table-base">
      <thead>
        <tr>
          <th>TASK</th>
          <th>PROJECT</th>
          <th>PRIORITY</th>
          <th>DUE</th>
          <th>STATUS</th>
        </tr>
      </thead>
      <tbody>
        {list.length === 0 ? (
          <tr>
            <td colSpan={5} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
              {compact ? 'No open tasks. Nice work!' : 'No tasks assigned to you yet.'}
            </td>
          </tr>
        ) : (
          list.map((t) => {
            const due = t.dueDate || t.deadline || '';
            const overdue = !!due && due < today && t.status !== 'Completed' && t.status !== 'Done';
            const normalized = t.status === 'Done' ? 'Completed' : t.status === 'To Do' || t.status === 'Review' ? 'In Progress' : t.status;
            return (
              <tr key={t.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.title || t.task}</div>
                  {t.description && <div style={{ fontSize: 11.5, color: '#697586', maxWidth: 320 }}>{t.description}</div>}
                </td>
                <td style={{ color: '#697586' }}>{t.projectName || t.project || 'General'}</td>
                <td>
                  <span className={`badge ${t.priority === 'High' || t.priority === 'Urgent' ? 'badge-red' : t.priority === 'Medium' ? 'badge-amber' : 'badge-gray'}`}>
                    {t.priority || 'Medium'}
                  </span>
                </td>
                <td style={{ color: overdue ? '#EF4444' : '#697586', fontWeight: overdue ? 600 : 400 }}>
                  {due || '—'}
                  {overdue && ' · overdue'}
                </td>
                <td>
                  <select
                    className="select-base"
                    style={{ fontSize: 12.5, padding: '4px 8px' }}
                    value={normalized || 'Pending'}
                    onChange={(e) => handleTaskStatus(t, e.target.value as ProjectTask['status'])}
                  >
                    <option value="Pending">Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed</option>
                  </select>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  const progressBar = (pct: number, color: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#E5E9F2', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#1A1F36', width: 34 }}>{pct}%</span>
    </div>
  );

  const todayTasksPanel = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
          Today's tasks · {todayTasks.filter(isTaskDone).length}/{todayTasks.length} completed
        </div>
        {todayNeedsUpdate > 0 && (
          <span className="badge badge-amber">
            {todayNeedsUpdate} task{todayNeedsUpdate > 1 ? 's' : ''} need{todayNeedsUpdate > 1 ? '' : 's'} an update before check-out
          </span>
        )}
      </div>
      <table className="table-base">
        <thead>
          <tr>
            <th>TASK</th>
            <th>PROJECT</th>
            <th>PRIORITY</th>
            <th style={{ width: 180 }}>PROGRESS</th>
            <th>REASON IF PENDING</th>
            <th style={{ textAlign: 'right' }}>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {todayTasks.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                No tasks are due today.
              </td>
            </tr>
          ) : (
            todayTasks.map((t) => {
              const done = isTaskDone(t);
              const updatedToday = t.progressUpdatedOn === today;
              return (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.title || t.task}</div>
                    {t.description && <div style={{ fontSize: 11.5, color: '#697586', maxWidth: 300 }}>{t.description}</div>}
                  </td>
                  <td style={{ color: '#697586' }}>{t.projectName || t.project || 'General'}</td>
                  <td>
                    <span className={`badge ${t.priority === 'High' || t.priority === 'Urgent' ? 'badge-red' : t.priority === 'Medium' ? 'badge-amber' : 'badge-gray'}`}>
                      {t.priority || 'Medium'}
                    </span>
                  </td>
                  <td>{progressBar(done ? 100 : Number(t.progress) || 0, done ? '#12B76A' : '#3B5BDB')}</td>
                  <td style={{ fontSize: 12.5, color: '#475569', maxWidth: 260 }}>
                    {done ? (
                      <span className="badge badge-green">Completed</span>
                    ) : updatedToday ? (
                      t.delayReason
                    ) : (
                      <span style={{ color: '#B54708' }}>Update needed</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!done && (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button
                          className="btn-primary"
                          style={{ fontSize: 11.5, padding: '4px 10px' }}
                          onClick={() => handleTaskStatus(t, 'Completed')}
                        >
                          ✓ Mark Completed
                        </button>
                        <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => openProgress(t)}>
                          {updatedToday ? 'Edit Progress' : 'Still Pending'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  const payslipRows = (p: PayrollRecord) => {
    const adj = adjustmentsFor(adjustments, p.employeeId, p.month);
    const allowanceItems = adj.filter((a) => a.type === 'Allowance');
    const deductionItems = adj.filter((a) => a.type === 'Deduction');
    const earnings: [string, number][] = [
      ['Basic Salary', p.baseSalary],
      ...(allowanceItems.length ? allowanceItems.map((a) => [a.component, a.amount] as [string, number]) : [['Allowances', p.allowances] as [string, number]]),
      ['Bonus', p.bonus],
      ['Overtime', p.overtime],
    ];
    const deductions: [string, number][] = [
      ['Unpaid Leave', p.unpaidLeaveDeduction],
      ...(deductionItems.length ? deductionItems.map((a) => [a.component, a.amount] as [string, number]) : [['Other Deductions', p.otherDeductions] as [string, number]]),
    ];
    return { earnings: earnings.filter(([, v]) => Number(v) > 0 || v === p.baseSalary), deductions: deductions.filter(([, v]) => Number(v) > 0) };
  };

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div className="page-title">Hi, {myEmployee.name.split(' ')[0]} 👋</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            {myEmployee.role} · {myEmployee.employeeId}
          </div>
        </div>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', maxWidth: '100%' }}>
          <div>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>
              {todayRecord ? (
                <>
                  <span className={`badge ${statusBadge[todayRecord.status] || 'badge-gray'}`}>{todayRecord.status}</span>{' '}
                  {todayRecord.checkIn && `In ${formatTime12h(todayRecord.checkIn)}`}
                  {todayRecord.lunchOut && ` · Lunch ${formatLunch(todayRecord)}`}
                  {todayRecord.checkOut && ` · Out ${formatTime12h(todayRecord.checkOut)}`}
                </>
              ) : (
                'Not checked in'
              )}
            </div>
          </div>
          {onOpenAttendance && (
            <button className={todayRecord ? 'btn-secondary' : 'btn-primary'} onClick={onOpenAttendance}>
              {todayRecord ? 'My Attendance →' : 'Check In →'}
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <Stat label="Open Tasks" value={String(openTasks.length)} color="#3B5BDB" sub={`${myTasks.length} total assigned`} />
        <Stat
          label={`Present · ${monthLabel(month).split(' ')[0]}`}
          value={String((counts.Present || 0) + (counts.Late || 0) + (counts['Half Day'] || 0) * 0.5)}
          color="#12B76A"
          sub={counts.overtime ? `${counts.overtime}h overtime` : undefined}
        />
        <Stat label={`Leave Taken ${year}`} value={`${leaveDaysThisYear} d`} color="#8B5CF6" sub={pendingLeaves ? `${pendingLeaves} pending` : undefined} />
        <Stat
          label="Last Salary"
          value={lastPay ? inr(lastPay.netSalary) : '—'}
          color="#1A1F36"
          sub={lastPay ? `${monthLabel(lastPay.month)} · ${lastPay.status}` : 'No payroll yet'}
        />
      </div>

      {/* Tabs */}
      <div className="card">
        <div style={{ padding: '0 12px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map((t) => (
            <button key={t.key} className={`tab-btn${tab === t.key ? ' active' : ''}`} style={{ padding: '10px 14px' }} onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === 'today' && todayNeedsUpdate > 0 && (
                <span style={{ marginLeft: 6, background: '#F79009', color: '#fff', borderRadius: 10, fontSize: 10.5, fontWeight: 700, padding: '1px 6px' }}>
                  {todayNeedsUpdate}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {tab === 'today' && todayTasksPanel()}

          {tab === 'overview' && todayTasks.length > 0 && <div style={{ marginBottom: 20 }}>{todayTasksPanel()}</div>}

          {tab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 10 }}>Open tasks</div>
                {taskTable(openTasks.slice(0, 6), true)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: '#F8F9FC', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 8 }}>Recent leave</div>
                  {myLeaves.slice(0, 3).map((l) => (
                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid #E5E9F2' }}>
                      <span>
                        {l.leaveType} · {l.fromDate}
                        {l.toDate !== l.fromDate ? ` → ${l.toDate}` : ''}
                      </span>
                      <span className={`badge ${statusBadge[l.status]}`}>{l.status}</span>
                    </div>
                  ))}
                  {myLeaves.length === 0 && <div style={{ fontSize: 12.5, color: '#697586' }}>No leave requests yet.</div>}
                  <button className="btn-secondary" style={{ fontSize: 12, marginTop: 10 }} onClick={() => { setTab('leave'); setShowLeaveForm(true); }}>
                    + Apply for Leave
                  </button>
                </div>
                <div style={{ background: '#F8F9FC', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 8 }}>Working hours</div>
                  <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
                    9:00 AM – 6:00 PM. Check in by 9:00 AM; a later check-in needs admin approval. Lunch break is up to 1 hour.
                    Check out from 6:00 PM once today's tasks are completed, otherwise send a check-out request. Time after 6:00 PM
                    is recorded as overtime.
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'tasks' && taskTable(myTasks)}

          {tab === 'leave' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>My leave requests</div>
                <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => setShowLeaveForm(true)}>
                  + Apply for Leave
                </button>
              </div>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>TYPE</th>
                    <th>DATES</th>
                    <th>DAYS</th>
                    <th>REASON</th>
                    <th>STATUS</th>
                    <th>REMARKS</th>
                  </tr>
                </thead>
                <tbody>
                  {myLeaves.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                        No leave requests yet.
                      </td>
                    </tr>
                  ) : (
                    myLeaves.map((l) => (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 600 }}>
                          {l.leaveType}
                          {l.isHalfDay && <span style={{ fontSize: 11, color: '#697586' }}> ({l.halfDaySession})</span>}
                        </td>
                        <td>
                          {l.fromDate}
                          {l.toDate !== l.fromDate ? ` → ${l.toDate}` : ''}
                        </td>
                        <td>{l.days}</td>
                        <td style={{ maxWidth: 240, fontSize: 12.5, color: '#475569' }}>{l.reason}</td>
                        <td>
                          <span className={`badge ${statusBadge[l.status]}`}>{l.status}</span>
                        </td>
                        <td style={{ fontSize: 12.5, color: '#697586' }}>{l.adminRemarks || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'salary' && (
            <>
            <div style={{ background: '#F8F9FC', border: '1px solid #E5E9F2', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 10 }}>{monthLabel(month)} so far</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Stat label="Per Day" value={formatRate(monthPay.rates.daily)} sub={`${monthPay.workingDays} working days`} />
                <Stat label="Per Hour" value={formatRate(monthPay.rates.hourly)} />
                <Stat label="Per Minute" value={formatRate(monthPay.rates.perMinute)} />
                <Stat label="Earned So Far" value={inr(monthPay.earnedToDate)} color="#12B76A" sub={`${formatDuration(monthPay.workedMinutes)} worked`} />
                <Stat
                  label="Deducted So Far"
                  value={inr(monthPay.absentDeduction + monthPay.unpaidLeaveDeduction + monthPay.shortTimeDeduction)}
                  color="#EF4444"
                  sub={`${monthPay.absentDays} absent · ${monthPay.shortMinutes} min short`}
                />
              </div>
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 8 }}>
                Late arrival, early leave and lunch beyond 1 hour are deducted per minute. Absent days and unpaid leave are deducted per day.
                Incentives and bonuses added by the admin appear on your payslip.
              </div>
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>MONTH</th>
                  <th style={{ textAlign: 'right' }}>GROSS</th>
                  <th style={{ textAlign: 'right' }}>DEDUCTIONS</th>
                  <th style={{ textAlign: 'right' }}>NET PAY</th>
                  <th>STATUS</th>
                  <th>PAID ON</th>
                  <th style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {myPayroll.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                      No salary records yet. They appear here once payroll is generated.
                    </td>
                  </tr>
                ) : (
                  myPayroll.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{monthLabel(p.month)}</td>
                      <td style={{ textAlign: 'right' }}>{inr(p.grossSalary)}</td>
                      <td style={{ textAlign: 'right', color: '#EF4444' }}>{inr(p.totalDeductions)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A' }}>{inr(p.netSalary)}</td>
                      <td>
                        <span className={`badge ${statusBadge[p.status] || 'badge-amber'}`}>{p.status}</span>
                      </td>
                      <td style={{ color: '#697586' }}>{p.paymentDate || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => setPayslip(p)}>
                          View Payslip
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </>
          )}
        </div>
      </div>

      {/* Apply leave modal */}
      {showLeaveForm && (
        <div className="modal-overlay" onClick={() => setShowLeaveForm(false)}>
          <div className="modal-box" style={{ width: 500, maxWidth: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36', marginBottom: 16 }}>Apply for Leave</div>
            <form onSubmit={handleApplyLeave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Leave Type *</label>
                  <select className="select-base" style={{ width: '100%' }} value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}>
                    {LEAVE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>From *</label>
                  <input
                    className="input-base"
                    type="date"
                    value={leaveForm.fromDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, fromDate: e.target.value, toDate: e.target.value > leaveForm.toDate ? e.target.value : leaveForm.toDate })}
                  />
                </div>
                <div>
                  <label style={labelStyle}>To *</label>
                  <input className="input-base" type="date" min={leaveForm.fromDate} value={leaveForm.toDate} onChange={(e) => setLeaveForm({ ...leaveForm, toDate: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#1A1F36', cursor: 'pointer' }}>
                    <input type="checkbox" checked={leaveForm.isHalfDay} onChange={(e) => setLeaveForm({ ...leaveForm, isHalfDay: e.target.checked })} />
                    Half day
                  </label>
                  {leaveForm.isHalfDay && (
                    <select
                      className="select-base"
                      value={leaveForm.halfDaySession}
                      onChange={(e) => setLeaveForm({ ...leaveForm, halfDaySession: e.target.value as 'Morning' | 'Afternoon' })}
                    >
                      <option value="Morning">Morning</option>
                      <option value="Afternoon">Afternoon</option>
                    </select>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#3B5BDB', fontWeight: 600 }}>{leaveDays} day(s)</span>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Reason *</label>
                  <textarea className="input-base" rows={3} value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowLeaveForm(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task progress modal */}
      {progressTask && (
        <div className="modal-overlay" onClick={() => !busy && setProgressTask(null)}>
          <div className="modal-box" style={{ width: 460, maxWidth: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36', marginBottom: 4 }}>Task still pending</div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 16 }}>{progressTask.title || progressTask.task}</div>
            <form onSubmit={handleSaveProgress}>
              <label style={labelStyle}>How much is completed? *</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={progressForm.progress === p ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: 12, padding: '5px 10px', minWidth: 48 }}
                    onClick={() => setProgressForm({ ...progressForm, progress: p })}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <label style={labelStyle}>Why is it late / still pending? *</label>
              <textarea
                className="input-base"
                rows={3}
                style={{ width: '100%' }}
                placeholder="e.g. Waiting for content from the client / Bug took longer than expected"
                value={progressForm.reason}
                onChange={(e) => setProgressForm({ ...progressForm, reason: e.target.value })}
              />
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 6 }}>
                If the task is done, close this and use "Mark Completed" instead.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setProgressTask(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving...' : 'Save Progress'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payslip modal */}
      {payslip && (
        <div className="modal-overlay" onClick={() => setPayslip(null)}>
          <div className="modal-box" style={{ width: 560, maxWidth: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>Payslip · {monthLabel(payslip.month)}</div>
                <div style={{ fontSize: 12.5, color: '#697586' }}>
                  {payslip.employeeName} · {payslip.employeeCode} · {payslip.role}
                </div>
              </div>
              <span className={`badge ${statusBadge[payslip.status] || 'badge-amber'}`}>{payslip.status}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
              {(['earnings', 'deductions'] as const).map((side) => (
                <div key={side} style={{ background: '#F8F9FC', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: side === 'earnings' ? '#12B76A' : '#EF4444' }}>
                    {side === 'earnings' ? 'Earnings' : 'Deductions'}
                  </div>
                  {payslipRows(payslip)[side].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0' }}>
                      <span style={{ color: '#475569' }}>{label}</span>
                      <span style={{ fontWeight: 600 }}>{inr(val)}</span>
                    </div>
                  ))}
                  {payslipRows(payslip)[side].length === 0 && <div style={{ fontSize: 12.5, color: '#697586' }}>None</div>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 10 }}>
              Working days {payslip.workingDays} · Present {payslip.presentDays} · Paid leave {payslip.paidLeaveDays} · Unpaid leave {payslip.unpaidLeaveDays}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ECFDF5', borderRadius: 10, padding: '12px 16px' }}>
              <span style={{ fontWeight: 700, color: '#065F46' }}>Net Pay</span>
              <span style={{ fontWeight: 800, fontSize: 20, color: '#059669' }}>{inr(payslip.netSalary)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => window.print()}>
                Print
              </button>
              <button className="btn-primary" onClick={() => setPayslip(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
