import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AttendanceApproval, type LeaveRequest, type PayrollRecord, type ProjectTask } from '../db/database';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateTask } from '../services/taskService';
import { addLeaveRequest } from '../services/leaveService';
import { addAttendance, updateAttendance } from '../services/attendanceService';
import { adjustmentsFor } from '../services/payrollAdjustmentService';
import { calculateLeaveDays } from './Leave';
import {
  WORK_START,
  LUNCH_MAX_MINUTES,
  formatTime12h,
  formatLunch,
  lunchMinutes,
  minutesOf,
  addMinutes,
  toHHMM,
  toLocalDate,
  overtimeFor,
  isCheckedIn,
  checkOutBlockers,
  REQUEST_LABELS,
  type RequestKind,
} from '../utils/attendanceTimes';
import { useAttendancePolicy, assertOnOfficeNetwork, getTrustedNow } from '../services/attendancePolicyService';
import AttendanceRequestBadges from '../components/AttendanceRequestBadges';

export type WorkspaceTab = 'overview' | 'tasks' | 'attendance' | 'leave' | 'salary';

const TABS: { key: WorkspaceTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'My Tasks' },
  { key: 'attendance', label: 'My Attendance' },
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
export default function MyWorkspace({ initialTab = 'overview' }: { initialTab?: WorkspaceTab }) {
  const { user, myEmployee } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [payslip, setPayslip] = useState<PayrollRecord | null>(null);
  const { policy } = useAttendancePolicy();
  // A self-service action that broke an attendance rule and needs a reason before going to the admin
  const [request, setRequest] = useState<{ kind: RequestKind; date: string; time: string; reasons: string[] } | null>(null);
  const [requestNote, setRequestNote] = useState('');
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
      tasks
        .filter(
          (t) =>
            (t.assignedToId !== undefined && String(t.assignedToId) === empId) ||
            (!!empName && (t.assignedTo === empName || t.assignee === empName))
        )
        .sort((a, b) => String(a.dueDate || a.deadline || '').localeCompare(String(b.dueDate || b.deadline || ''))),
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

  // ---------- actions ----------
  const checkedIn = isCheckedIn(todayRecord);
  const canAct = checkedIn && !todayRecord?.checkOut;
  const onLunch = canAct && !!todayRecord?.lunchOut && !todayRecord?.lunchIn;
  const checkOutPending = todayRecord?.checkOutRequest?.status === 'Pending';

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

  /** Every self-service action must happen on the office WiFi; the time comes from the server clock. */
  const verifiedNow = async () => {
    await assertOnOfficeNetwork(policy);
    const now = await getTrustedNow();
    return { date: toLocalDate(now), time: toHHMM(now) };
  };

  const askApproval = (kind: RequestKind, at: { date: string; time: string }, reasons: string[]) => {
    setRequestNote('');
    setRequest({ kind, ...at, reasons });
  };

  const employeeFields = () => ({
    employeeId: myEmployee.id,
    employeeCode: myEmployee.employeeId || String(myEmployee.id),
    employeeName: myEmployee.name,
    dept: myEmployee.dept,
  });

  const handleCheckIn = () =>
    run(async () => {
      const at = await verifiedNow();
      if (myAttendance.some((a) => a.date === at.date)) {
        showToast('Your attendance for today is already recorded.', 'info');
        return;
      }
      if (minutesOf(at.time) > minutesOf(WORK_START)) {
        askApproval('checkInRequest', at, [`Checking in at ${formatTime12h(at.time)}, after ${formatTime12h(WORK_START)}`]);
        return;
      }
      await addAttendance({
        ...employeeFields(),
        date: at.date,
        status: 'Present',
        checkIn: at.time,
        checkOut: '',
        overtimeHours: 0,
        notes: 'Self check-in',
      });
      showToast('Checked in. Have a great day!', 'success');
    });

  const handleLunchOut = () =>
    run(async () => {
      if (!todayRecord?.id) return;
      const at = await verifiedNow();
      await updateAttendance(todayRecord.id, { lunchOut: at.time });
      showToast(`Lunch break started. Please be back by ${formatTime12h(addMinutes(at.time, LUNCH_MAX_MINUTES))}.`, 'success');
    });

  const handleLunchIn = () =>
    run(async () => {
      if (!todayRecord?.id || !todayRecord.lunchOut) return;
      const at = await verifiedNow();
      const mins = minutesOf(at.time) - minutesOf(todayRecord.lunchOut);
      if (mins > LUNCH_MAX_MINUTES) {
        askApproval('lunchRequest', at, [`Lunch break of ${mins} minutes (limit is ${LUNCH_MAX_MINUTES} minutes)`]);
        return;
      }
      await updateAttendance(todayRecord.id, { lunchIn: at.time });
      showToast('Welcome back!', 'success');
    });

  const handleCheckOut = () =>
    run(async () => {
      if (!todayRecord?.id) return;
      if (onLunch) {
        showToast('End your lunch break (Lunch In) before checking out.', 'error');
        return;
      }
      const at = await verifiedNow();
      const dueToday = myTasks.filter((t) => String(t.dueDate || t.deadline || '').slice(0, 10) === at.date);
      const reasons = checkOutBlockers(todayRecord, at.time, dueToday);
      if (reasons.length > 0) {
        askApproval('checkOutRequest', at, reasons);
        return;
      }
      const overtimeHours = overtimeFor(at.time);
      await updateAttendance(todayRecord.id, { checkOut: at.time, overtimeHours });
      showToast(`Checked out at ${formatTime12h(at.time)}${overtimeHours ? ` (${overtimeHours}h overtime)` : ''}.`, 'success');
    });

  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    if (!requestNote.trim()) {
      showToast('Please add a reason for the admin.', 'error');
      return;
    }
    run(async () => {
      const approval: AttendanceApproval = {
        status: 'Pending',
        time: request.time,
        reasons: request.reasons,
        note: requestNote.trim(),
        requestedAt: new Date().toISOString(),
      };
      if (request.kind === 'checkInRequest') {
        await addAttendance({
          ...employeeFields(),
          date: request.date,
          status: 'Late',
          checkIn: request.time,
          checkOut: '',
          overtimeHours: 0,
          notes: 'Self check-in (late)',
          checkInRequest: approval,
        });
      } else if (todayRecord?.id) {
        await updateAttendance(
          todayRecord.id,
          request.kind === 'lunchRequest' ? { lunchIn: request.time, lunchRequest: approval } : { checkOutRequest: approval }
        );
      }
      showToast('Sent to the admin for approval.', 'success');
      setRequest(null);
    });
  };

  const handleTaskStatus = async (t: ProjectTask, status: ProjectTask['status']) => {
    if (!t.id) return;
    try {
      await updateTask(t.id, { status });
      showToast(`Task marked ${status}.`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not update task.', 'error');
    }
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
            {myEmployee.role} · {myEmployee.dept} · {myEmployee.employeeId}
          </div>
        </div>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>
              {todayRecord ? (
                <>
                  <span className={`badge ${statusBadge[todayRecord.status] || 'badge-gray'}`}>{todayRecord.status}</span>{' '}
                  {todayRecord.checkIn && `In ${formatTime12h(todayRecord.checkIn)}`}
                  {todayRecord.checkOut && ` · Out ${formatTime12h(todayRecord.checkOut)}`}
                </>
              ) : (
                'Not checked in'
              )}
            </div>
          </div>
          {!todayRecord && (
            <button className="btn-primary" disabled={busy} onClick={handleCheckIn}>
              Check In
            </button>
          )}
          {todayRecord && todayRecord.checkIn && !todayRecord.checkOut && (todayRecord.status === 'Present' || todayRecord.status === 'Late' || todayRecord.status === 'Half Day') && (
            <button className="btn-secondary" disabled={busy} onClick={handleCheckOut}>
              Check Out
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
            </button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
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
                    9:00 AM – 6:00 PM · Half day 2:00 PM – 6:00 PM. Time after 6:00 PM at check-out is recorded as overtime.
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'tasks' && taskTable(myTasks)}

          {tab === 'attendance' && (
            <div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                <input className="input-base" type="month" style={{ width: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} />
                {['Present', 'Late', 'Half Day', 'On Leave', 'Absent'].map((s) => (
                  <span key={s} className={`badge ${statusBadge[s]}`}>
                    {s}: {counts[s] || 0}
                  </span>
                ))}
                <span className="badge badge-blue">Overtime: {counts.overtime || 0}h</span>
              </div>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>STATUS</th>
                    <th>CHECK-IN</th>
                    <th>CHECK-OUT</th>
                    <th>OVERTIME</th>
                    <th>NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  {monthAttendance.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                        No attendance recorded for {monthLabel(month)}.
                      </td>
                    </tr>
                  ) : (
                    monthAttendance.map((a) => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{new Date(a.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                        <td>
                          <span className={`badge ${statusBadge[a.status] || 'badge-gray'}`}>{a.status}</span>
                        </td>
                        <td>{formatTime12h(a.checkIn)}</td>
                        <td>{formatTime12h(a.checkOut)}</td>
                        <td>{a.overtimeHours ? `${a.overtimeHours}h` : '—'}</td>
                        <td style={{ color: '#697586', fontSize: 12.5 }}>{a.notes || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

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

      {/* Payslip modal */}
      {payslip && (
        <div className="modal-overlay" onClick={() => setPayslip(null)}>
          <div className="modal-box" style={{ width: 560, maxWidth: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>Payslip · {monthLabel(payslip.month)}</div>
                <div style={{ fontSize: 12.5, color: '#697586' }}>
                  {payslip.employeeName} · {payslip.employeeCode} · {payslip.department}
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
