import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CalendarCheck,
  ListChecks,
  Fingerprint,
  Plane,
  Banknote,
  CircleUserRound,
  ChevronRight,
  Search,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { db, type LeaveRequest, type PayrollRecord, type ProjectTask } from '../db/database';
import { newestFirst } from '../utils/sort';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateTask } from '../services/taskService';
import { addLeaveRequest } from '../services/leaveService';
import { adjustmentsFor } from '../services/payrollAdjustmentService';
import { calculateLeaveDays } from './Leave';
import { formatTime12h, formatDuration, isDueOn, isTaskDone, isCheckedIn } from '../utils/attendanceTimes';
import { computeMonthPay, formatRate } from '../utils/salary';

/** Each employee page is its own screen: overview (dashboard), today's tasks, all tasks, leave, salary. */
export type WorkspaceView = 'overview' | 'today' | 'tasks' | 'leave' | 'salary';
/** @deprecated kept for older imports; use WorkspaceView */
export type WorkspaceTab = WorkspaceView;

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned / Paid Leave', 'Unpaid Leave', 'Work From Home'];

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const prettyDate = (d?: string) => {
  const iso = /^\d{4}-\d{2}-\d{2}/.test(d || '') ? (d as string).slice(0, 10) : '';
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : d || '—';
};
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
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
const priorityBadge = (p?: string) => (p === 'High' || p === 'Urgent' ? 'badge-red' : p === 'Medium' || !p ? 'badge-amber' : 'badge-gray');

const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;

function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="ws-page-head">
      <div style={{ minWidth: 0 }}>
        <div className="page-title">{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="ws-tile">
      <div className="ws-tile-label">{label}</div>
      <div className="ws-tile-value" style={{ color }}>
        {value}
      </div>
      {sub && <div className="ws-tile-sub">{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct, done }: { pct: number; done?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="ws-bar">
        <div style={{ width: `${pct}%`, background: done ? '#12B76A' : 'linear-gradient(90deg, #3B5BDB, #6D4AE8)' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: done ? '#12B76A' : '#1A1F36', minWidth: 34, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="ws-empty">
      <Icon size={30} color="#98A2B3" />
      <div>{text}</div>
    </div>
  );
}

interface Props {
  view?: WorkspaceView;
  /** Navigate to another screen ('my-attendance', 'ws:today', 'profile', …) */
  onNav?: (screen: string) => void;
}

/** Personal pages for a signed-in employee: only their own tasks, attendance, leave and salary. */
export default function MyWorkspace({ view = 'overview', onNav }: Props) {
  const { user, myEmployee, companyProfile } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [payslip, setPayslip] = useState<PayrollRecord | null>(null);
  // Progress update for an unfinished task: % done + why it's running late
  const [progressTask, setProgressTask] = useState<ProjectTask | null>(null);
  const [progressForm, setProgressForm] = useState({ progress: 0, reason: '' });
  const [taskFilter, setTaskFilter] = useState<'open' | 'overdue' | 'completed' | 'all'>('open');
  const [taskSearch, setTaskSearch] = useState('');
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
  const dueOf = (t: ProjectTask) => String(t.dueDate || t.deadline || '').slice(0, 10);
  const isOverdue = (t: ProjectTask) => !!dueOf(t) && dueOf(t) < today && !isTaskDone(t);
  const openTasks = myTasks.filter((t) => !isTaskDone(t));
  const overdueTasks = myTasks.filter(isOverdue);
  const completedTasks = myTasks.filter(isTaskDone);
  // Scheduled posts carry a time (9 AM, 6 PM…): keep the day in that order
  const todayTasks = myTasks.filter((t) => isDueOn(t, today)).sort((a, b) => (a.dueTime || '99').localeCompare(b.dueTime || '99'));
  const todayDone = todayTasks.filter(isTaskDone).length;
  const todayNeedsUpdate = todayTasks.filter((t) => !isTaskDone(t) && t.progressUpdatedOn !== today).length;
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const approvedThisYear = myLeaves.filter((l) => l.status === 'Approved' && l.fromDate.startsWith(year));
  const leaveDaysThisYear = approvedThisYear.reduce((s, l) => s + (Number(l.days) || 0), 0);
  const pendingLeaves = myLeaves.filter((l) => l.status === 'Pending').length;
  const lastPay = myPayroll[0];
  // Salary earned this month under the attendance rules (same maths as the admin payroll)
  const monthPay = computeMonthPay({
    month,
    salary: Number(myEmployee.salary) || 0,
    dailySalary: Number(myEmployee.dailySalary) || 0,
    workingHours: Number(myEmployee.workingHours) || 8,
    workingWeekdays: companyProfile?.workingDays,
    attendance: myAttendance,
    leaves: myLeaves,
    today,
  });
  const go = (screen: string) => onNav?.(screen);

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
    const overlaps = myLeaves.some((l) => l.status !== 'Rejected' && l.fromDate <= leaveForm.toDate && l.toDate >= leaveForm.fromDate);
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

  const payslipRows = (p: PayrollRecord) => {
    const adj = adjustmentsFor(adjustments, p.employeeId, p.month);
    const allowanceItems = adj.filter((a) => a.type === 'Allowance');
    const deductionItems = adj.filter((a) => a.type === 'Deduction');
    const earnings: [string, number][] = [
      ['Basic Salary', p.baseSalary],
      ...(allowanceItems.length ? allowanceItems.map((a) => [a.component, a.amount] as [string, number]) : [['Allowances', p.allowances] as [string, number]]),
      ['Bonus / Incentive', p.bonus],
      ['Overtime', p.overtime],
    ];
    const deductions: [string, number][] = [
      [`Absent (${p.absentDays || 0} d)`, Number(p.absentDeduction) || 0],
      ['Unpaid Leave', p.unpaidLeaveDeduction],
      [`Short time (${p.shortMinutes || 0} min)`, Number(p.shortTimeDeduction) || 0],
      ...(deductionItems.length ? deductionItems.map((a) => [a.component, a.amount] as [string, number]) : [['Other Deductions', p.otherDeductions] as [string, number]]),
    ];
    return { earnings: earnings.filter(([, v]) => Number(v) > 0 || v === p.baseSalary), deductions: deductions.filter(([, v]) => Number(v) > 0) };
  };

  // ---------- shared pieces ----------
  const taskCard = (t: ProjectTask, mode: 'today' | 'list') => {
    const done = isTaskDone(t);
    const pct = done ? 100 : Number(t.progress) || 0;
    const updatedToday = t.progressUpdatedOn === today;
    const overdue = isOverdue(t);
    const normalized = t.status === 'Done' ? 'Completed' : t.status === 'To Do' || t.status === 'Review' ? 'In Progress' : t.status || 'Pending';
    return (
      <div key={t.id} className={`ws-card${done ? ' done' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="ws-card-title">{t.title || t.task}</div>
            <div className="ws-card-meta">
              {t.projectName || t.project || 'General'}
              {dueOf(t) && mode === 'list' && (
                <span style={{ color: overdue ? '#D92D20' : undefined, fontWeight: overdue ? 700 : 500 }}>
                  {' '}
                  · {overdue ? 'Overdue · ' : 'Due '}
                  {prettyDate(dueOf(t))}
                </span>
              )}
            </div>
          </div>
          <span className={`badge ${priorityBadge(t.priority)}`} style={{ flexShrink: 0 }}>
            {t.priority || 'Medium'}
          </span>
        </div>
        {(t.workType || t.dueTime || t.channels?.length) && (
          <div className="ws-work-chips">
            {t.workType && (
              <span className="ws-work-chip">
                {t.workType}
                {(t.quantity || 0) > 1 ? ` × ${t.quantity}` : ''}
              </span>
            )}
            {t.dueTime && (
              <span className="ws-work-chip time">
                <Clock size={12} /> {formatTime12h(t.dueTime)}
                {mode === 'list' && dueOf(t) ? ` · ${prettyDate(dueOf(t))}` : ''}
              </span>
            )}
            {(t.channels || []).map((c) => (
              <span key={c} className="ws-work-chip channel">
                {c}
              </span>
            ))}
          </div>
        )}
        {t.description && <div className={`ws-card-desc${mode === 'today' ? ' full' : ''}`}>{t.description}</div>}
        <div style={{ marginTop: 10 }}>
          <ProgressBar pct={pct} done={done} />
        </div>
        {mode === 'today' && !done && (
          <div className={`ws-note${updatedToday ? '' : ' warn'}`}>
            {updatedToday ? (
              <>
                <Clock size={13} /> {t.delayReason}
              </>
            ) : (
              <>
                <AlertTriangle size={13} /> Update needed before you check out
              </>
            )}
          </div>
        )}
        {mode === 'list' && !done && t.delayReason && (
          <div className="ws-note">
            <Clock size={13} /> {t.delayReason}
          </div>
        )}
        <div className="ws-card-actions">
          {mode === 'today' ? (
            done ? (
              <span className="badge badge-green" style={{ padding: '5px 10px' }}>
                <CheckCircle2 size={13} /> Completed
              </span>
            ) : (
              <>
                <button className="btn-primary" onClick={() => handleTaskStatus(t, 'Completed')}>
                  <CheckCircle2 size={15} /> Mark Completed
                </button>
                <button className="btn-secondary" onClick={() => openProgress(t)}>
                  {updatedToday ? 'Edit Progress' : 'Still Pending'}
                </button>
              </>
            )
          ) : (
            <select
              className="select-base"
              style={{ minWidth: 150 }}
              value={normalized}
              onChange={(e) => handleTaskStatus(t, e.target.value as ProjectTask['status'])}
              aria-label="Task status"
            >
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          )}
        </div>
      </div>
    );
  };

  const attendanceLine = todayRecord?.checkOut
    ? `Checked out at ${formatTime12h(todayRecord.checkOut)}`
    : isCheckedIn(todayRecord)
    ? `Checked in at ${formatTime12h(todayRecord?.checkIn)}`
    : todayRecord?.checkInRequest?.status === 'Pending'
    ? 'Late check-in awaiting approval'
    : todayRecord
    ? todayRecord.status
    : 'Not checked in yet';

  // ---------- pages ----------
  let page: React.ReactNode;

  if (view === 'overview') {
    const shortcuts: { key: string; label: string; sub: string; icon: LucideIcon; tone: string; badge?: number }[] = [
      {
        key: 'ws:today',
        label: "Today's Tasks",
        sub: todayTasks.length ? `${todayDone}/${todayTasks.length} done` : 'Nothing due today',
        icon: CalendarCheck,
        tone: 'blue',
        badge: todayNeedsUpdate,
      },
      { key: 'ws:tasks', label: 'All My Tasks', sub: `${openTasks.length} open${overdueTasks.length ? ` · ${overdueTasks.length} overdue` : ''}`, icon: ListChecks, tone: 'violet' },
      { key: 'my-attendance', label: 'My Attendance', sub: attendanceLine, icon: Fingerprint, tone: 'green' },
      { key: 'ws:leave', label: 'My Leave', sub: pendingLeaves ? `${pendingLeaves} pending` : `${leaveDaysThisYear} d taken in ${year}`, icon: Plane, tone: 'amber' },
      { key: 'ws:salary', label: 'My Salary', sub: `${inr(monthPay.earnedToDate)} earned this month`, icon: Banknote, tone: 'teal' },
      { key: 'profile', label: 'My Profile', sub: myEmployee.employeeId || 'Details & account', icon: CircleUserRound, tone: 'slate' },
    ];
    page = (
      <>
        <div className="ws-hero">
          <div className="ws-hero-glow" />
          <div style={{ position: 'relative', minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', fontWeight: 600 }}>
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div className="ws-hero-title">
              {greeting()}, {myEmployee.name.split(' ')[0]} 👋
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
              {myEmployee.role} · {myEmployee.employeeId}
            </div>
          </div>
          <button className="ws-hero-status" onClick={() => go('my-attendance')}>
            <span className={`m-dot ${todayRecord?.checkOut ? 'done' : isCheckedIn(todayRecord) ? 'on' : 'off'}`} />
            <span style={{ flex: 1, textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 11, opacity: 0.7, fontWeight: 600 }}>TODAY</span>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{attendanceLine}</span>
            </span>
            <span className="ws-hero-cta">{!todayRecord ? 'Check In' : todayRecord.checkOut ? 'View' : 'Open'}</span>
          </button>
        </div>

        <div className="ws-tiles">
          <Tile label="Open Tasks" value={String(openTasks.length)} sub={`${myTasks.length} assigned`} color="#3B5BDB" />
          <Tile
            label={`Present · ${monthLabel(month).split(' ')[0]}`}
            value={String(monthPay.presentDays + monthPay.halfDays * 0.5)}
            sub={`${formatDuration(monthPay.workedMinutes)} worked`}
            color="#12B76A"
          />
          <Tile label={`Leave ${year}`} value={`${leaveDaysThisYear} d`} sub={pendingLeaves ? `${pendingLeaves} pending` : 'Approved'} color="#8B5CF6" />
          <Tile label="Last Salary" value={lastPay ? inr(lastPay.netSalary) : '—'} sub={lastPay ? `${monthLabel(lastPay.month)} · ${lastPay.status}` : 'No payroll yet'} color="#1A1F36" />
        </div>

        <div className="ws-section-title">Quick access</div>
        <div className="ws-shortcuts">
          {shortcuts.map((s) => (
            <button key={s.key} className="ws-shortcut" onClick={() => go(s.key)}>
              <span className={`ws-shortcut-icon tone-${s.tone}`}>
                <s.icon size={21} />
                {!!s.badge && <span className="m-badge">{s.badge}</span>}
              </span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span className="ws-shortcut-label">{s.label}</span>
                <span className="ws-shortcut-sub">{s.sub}</span>
              </span>
              <ChevronRight size={17} color="#98A2B3" />
            </button>
          ))}
        </div>

        <div className="ws-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Due today</span>
          {todayTasks.length > 0 && (
            <button className="ws-link" onClick={() => go('ws:today')}>
              See all <ChevronRight size={14} />
            </button>
          )}
        </div>
        {todayTasks.length === 0 ? (
          <Empty icon={CheckCircle2} text="No tasks are due today." />
        ) : (
          <div className="ws-list">{todayTasks.slice(0, 3).map((t) => taskCard(t, 'today'))}</div>
        )}

        <div className="ws-info">
          <Clock size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Working hours 9:00 AM – 6:00 PM. Check in by 9:00 AM; a later check-in needs admin approval. Lunch break is up to 1 hour. Check out
            from 6:00 PM once today's tasks are completed, otherwise send a check-out request.
          </span>
        </div>
      </>
    );
  } else if (view === 'today') {
    page = (
      <>
        <PageHeader
          title="Today's Tasks"
          subtitle={`${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · ${todayDone}/${todayTasks.length} completed`}
        />
        {todayTasks.length > 0 && (
          <div className="ws-progress-card">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today's progress</div>
              <div style={{ marginTop: 8 }}>
                <ProgressBar pct={Math.round((todayDone / todayTasks.length) * 100)} done={todayDone === todayTasks.length} />
              </div>
            </div>
          </div>
        )}
        {todayNeedsUpdate > 0 && (
          <div className="ws-alert">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>
              {todayNeedsUpdate} task{todayNeedsUpdate > 1 ? 's need' : ' needs'} an update before you can check out: mark completed, or give the % done
              and a reason.
            </span>
          </div>
        )}
        {todayTasks.length === 0 ? <Empty icon={CheckCircle2} text="No tasks are due today. Enjoy the calm!" /> : <div className="ws-list">{todayTasks.map((t) => taskCard(t, 'today'))}</div>}
      </>
    );
  } else if (view === 'tasks') {
    const lists = { open: openTasks, overdue: overdueTasks, completed: completedTasks, all: myTasks };
    const q = taskSearch.trim().toLowerCase();
    const shown = lists[taskFilter].filter(
      (t) => !q || [t.title, t.task, t.description, t.projectName, t.project].some((v) => (v || '').toLowerCase().includes(q))
    );
    page = (
      <>
        <PageHeader title="All My Tasks" subtitle={`${myTasks.length} assigned · ${openTasks.length} open`} />
        <div className="ws-search">
          <Search size={17} color="#98A2B3" />
          <input placeholder="Search tasks or projects" value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} />
        </div>
        <div className="ws-chips">
          {(
            [
              ['open', 'Open', openTasks.length],
              ['overdue', 'Overdue', overdueTasks.length],
              ['completed', 'Completed', completedTasks.length],
              ['all', 'All', myTasks.length],
            ] as const
          ).map(([key, label, count]) => (
            <button key={key} className={`ws-chip${taskFilter === key ? ' active' : ''}`} onClick={() => setTaskFilter(key)}>
              {label} <span className="ws-chip-count">{count}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <Empty icon={ListChecks} text={myTasks.length === 0 ? 'No tasks assigned to you yet.' : 'Nothing here.'} />
        ) : (
          <div className="ws-list">{shown.map((t) => taskCard(t, 'list'))}</div>
        )}
      </>
    );
  } else if (view === 'leave') {
    page = (
      <>
        <PageHeader
          title="My Leave"
          subtitle={`${leaveDaysThisYear} day(s) taken in ${year}`}
          action={
            <button className="btn-primary" onClick={() => setShowLeaveForm(true)}>
              <Plus size={16} /> Apply for Leave
            </button>
          }
        />
        <div className="ws-tiles">
          <Tile label={`Taken ${year}`} value={`${leaveDaysThisYear} d`} sub={`${approvedThisYear.length} request(s)`} color="#8B5CF6" />
          <Tile label="Pending" value={String(pendingLeaves)} sub="Awaiting approval" color="#F59E0B" />
          <Tile label="Approved" value={String(myLeaves.filter((l) => l.status === 'Approved').length)} color="#12B76A" />
          <Tile label="Rejected" value={String(myLeaves.filter((l) => l.status === 'Rejected').length)} color="#EF4444" />
        </div>
        {myLeaves.length === 0 ? (
          <Empty icon={Plane} text="No leave requests yet. Tap Apply for Leave to send one." />
        ) : (
          <div className="ws-list">
            {myLeaves.map((l) => (
              <div key={l.id} className="ws-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="ws-card-title">
                      {l.leaveType}
                      {l.isHalfDay && <span style={{ fontSize: 12, color: '#697586', fontWeight: 500 }}> · {l.halfDaySession}</span>}
                    </div>
                    <div className="ws-card-meta">
                      {prettyDate(l.fromDate)}
                      {l.toDate !== l.fromDate ? ` → ${prettyDate(l.toDate)}` : ''} · {l.days} day(s)
                    </div>
                  </div>
                  <span className={`badge ${statusBadge[l.status]}`} style={{ flexShrink: 0 }}>
                    {l.status}
                  </span>
                </div>
                {l.reason && <div className="ws-card-desc">{l.reason}</div>}
                {l.adminRemarks && (
                  <div className="ws-note">
                    <CircleUserRound size={13} /> Admin: {l.adminRemarks}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );
  } else {
    // salary
    const deducted = monthPay.absentDeduction + monthPay.unpaidLeaveDeduction + monthPay.shortTimeDeduction;
    page = (
      <>
        <PageHeader title="My Salary" subtitle={`Monthly salary ${inr(Number(myEmployee.salary) || 0)}`} />
        <div className="ws-salary-hero">
          <div className="ws-hero-glow" />
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {monthLabel(month)} · earned so far
            </div>
            <div className="ws-salary-amount">{inr(monthPay.earnedToDate)}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
              {formatDuration(monthPay.workedMinutes)} worked · {deducted ? `${inr(deducted)} deducted` : 'no deductions'}
            </div>
            <div className="ws-rates">
              {[
                ['Per day', formatRate(monthPay.rates.daily)],
                ['Per hour', formatRate(monthPay.rates.hourly)],
                ['Per minute', formatRate(monthPay.rates.perMinute)],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 600 }}>{k}</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {deducted > 0 && (
          <div className="ws-alert" style={{ background: '#FEF3F2', borderColor: '#FECDCA', color: '#B42318' }}>
            <Wallet size={16} style={{ flexShrink: 0 }} />
            <span>
              {monthPay.absentDays ? `${monthPay.absentDays} absent day(s)` : ''}
              {monthPay.absentDays && monthPay.shortMinutes ? ' · ' : ''}
              {monthPay.shortMinutes ? `${monthPay.shortMinutes} min late / early / long lunch` : ''}
              {monthPay.unpaidLeaveDays ? ` · ${monthPay.unpaidLeaveDays} unpaid leave day(s)` : ''}
            </span>
          </div>
        )}
        <div className="ws-section-title">Payslips</div>
        {myPayroll.length === 0 ? (
          <Empty icon={Banknote} text="No payslips yet. They appear here once payroll is generated." />
        ) : (
          <div className="ws-list">
            {myPayroll.map((p) => (
              <button key={p.id} className="ws-card ws-card-button" onClick={() => setPayslip(p)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'left' }}>
                    <div className="ws-card-title">{monthLabel(p.month)}</div>
                    <div className="ws-card-meta">
                      Gross {inr(p.grossSalary)} · Deductions {inr(p.totalDeductions)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#12B76A', fontFamily: 'Plus Jakarta Sans' }}>{inr(p.netSalary)}</div>
                    <span className={`badge ${statusBadge[p.status] || 'badge-amber'}`}>
                      {p.status}
                      {p.paymentDate ? ` · ${prettyDate(p.paymentDate)}` : ''}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="ws-info">
          <Wallet size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Late arrival, early leave and lunch beyond 1 hour are deducted per minute. Absent days and unpaid leave are deducted per day. Incentives and
            bonuses added by the admin appear on your payslip.
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="ws-page" style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {page}

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
                <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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
                    style={{ fontSize: 12, padding: '5px 10px', minWidth: 52 }}
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
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 6 }}>If the task is done, close this and use "Mark Completed" instead.</div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 10 }}>
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
                <div key={side} style={{ background: '#F8F9FC', borderRadius: 12, padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: side === 'earnings' ? '#12B76A' : '#EF4444' }}>
                    {side === 'earnings' ? 'Earnings' : 'Deductions'}
                  </div>
                  {payslipRows(payslip)[side].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', gap: 8 }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ECFDF5', borderRadius: 12, padding: '12px 16px' }}>
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
