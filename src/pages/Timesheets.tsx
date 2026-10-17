import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee, type TimesheetEntry, type AttendanceRecord } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  getAllTimesheets,
  addTimesheet,
  updateTimesheet,
  deleteTimesheet,
} from '../services/timesheetService';
import { getAllAttendance } from '../services/attendanceService';
import { getAllLeaveRequests } from '../services/leaveService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Clock,
  Calendar,
  CalendarDays,
  CalendarRange,
  IndianRupee,
  Users,
  Timer,
  Plus,
  Download,
  Edit3,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Info,
} from 'lucide-react';
import {
  WORK_START,
  WORK_END,
  STANDARD_DAY_HOURS,
  LUNCH_MAX_MINUTES,
  minutesOf,
  workedMinutes,
  lunchMinutes,
  formatDuration,
  formatTime12h,
  statusHasTimes,
  toHHMM,
  toLocalDate,
} from '../utils/attendanceTimes';
import { computeMonthPay, datesInMonth, PAID_DAY_MINUTES, type DayPay, type MonthPay } from '../utils/salary';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

type PeriodMode = 'daily' | 'weekly' | 'monthly';

type DayStatus =
  | 'Working'
  | 'Present'
  | 'Late'
  | 'Half Day'
  | 'On Leave'
  | 'Absent'
  | 'Logged'
  | 'Off'
  | 'Not In'
  | 'Upcoming'
  | 'No Record';

/** One employee on one date: what they worked and what they earned. */
interface DayCell {
  date: string;
  status: DayStatus;
  minutes: number;
  earned: number;
  checkIn?: string;
  checkOut?: string;
  breakMins?: number;
  missingCheckout?: boolean;
}

interface EmployeeRow {
  emp: Employee;
  key: string;
  cells: DayCell[];
  minutes: number;
  earned: number;
  daysWorked: number;
  salary: number;
  dailyRate: number;
}

interface FormState {
  employeeId: string | number;
  projectId: string | number;
  date: string;
  taskDescription: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes: string | number;
  isBillable: boolean;
  notes: string;
}

/** A full working day is 9 hours with a 1-hour lunch, so 8 hours of actual work. */
const TARGET_DAY_MINUTES = STANDARD_DAY_HOURS * 60 - LUNCH_MAX_MINUTES;

const STATUS_STYLE: Record<DayStatus, { badge: string; label: string; short: string }> = {
  Working: { badge: 'badge-blue', label: '● Working now', short: 'Working' },
  Present: { badge: 'badge-green', label: 'Present', short: '—' },
  Late: { badge: 'badge-amber', label: 'Late', short: '—' },
  'Half Day': { badge: 'badge-cyan', label: 'Half day', short: 'Half day' },
  'On Leave': { badge: 'badge-purple', label: 'On leave', short: 'Leave' },
  Absent: { badge: 'badge-red', label: 'Absent', short: 'Absent' },
  Logged: { badge: 'badge-teal', label: 'Logged manually', short: '—' },
  Off: { badge: 'badge-gray', label: 'Week off', short: 'Off' },
  'Not In': { badge: 'badge-gray', label: 'Not checked in', short: '—' },
  Upcoming: { badge: 'badge-gray', label: 'Upcoming', short: '' },
  'No Record': { badge: 'badge-gray', label: 'No record', short: '—' },
};

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const hrs = (mins: number) => (mins > 0 ? formatDuration(mins) : '0h');
const parseDate = (d: string) => new Date(d + 'T00:00:00');
const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => parseDate(d).toLocaleDateString('en-IN', opts);
const addDays = (d: string, n: number) => {
  const x = parseDate(d);
  x.setDate(x.getDate() + n);
  return toLocalDate(x);
};
const startOfWeek = (d: string) => addDays(d, -((parseDate(d).getDay() + 6) % 7));
const normDate = (raw: string) => {
  const d = (raw || '').trim();
  return /^\d{2}\/\d{2}\/\d{4}$/.test(d) ? d.split('/').reverse().join('-') : d.slice(0, 10);
};
const initialsOf = (name: string) =>
  (name || '')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'EM';
const empKey = (e: Employee) => String(e.id ?? e.employeeId);

/** Hours colour scale: full day green, at least half a day blue, short day amber. */
function hoursTone(mins: number) {
  if (mins >= TARGET_DAY_MINUTES) return { bg: '#DCFCE7', fg: '#166534', bar: '#16A34A' };
  if (mins >= TARGET_DAY_MINUTES / 2) return { bg: '#EEF2FF', fg: '#3B5BDB', bar: '#3B5BDB' };
  return { bg: '#FEF3C7', fg: '#92400E', bar: '#F59E0B' };
}

/** Monday-to-Sunday weeks of a month, clipped to the month's first and last day. */
function weeksOfMonth(month: string) {
  const weeks: { start: string; end: string; dates: string[] }[] = [];
  for (const d of datesInMonth(month)) {
    const last = weeks[weeks.length - 1];
    if (!last || parseDate(d).getDay() === 1) weeks.push({ start: d, end: d, dates: [d] });
    else {
      last.end = d;
      last.dates.push(d);
    }
  }
  return weeks;
}

/**
 * Calculates net worked hours from start time, end time, and break duration in minutes.
 * Supports HH:mm and hh:mm AM/PM formats.
 */
export function calculateDurationHours(
  startStr: string,
  endStr: string,
  breakMins: number = 0
): number {
  if (!startStr || !endStr) return 0;

  const parseToMinutes = (timeStr: string): number | null => {
    const clean = timeStr.trim().toUpperCase();
    if (!clean) return null;

    const match12 = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (match12) {
      let hrs = parseInt(match12[1], 10);
      const mins = parseInt(match12[2], 10);
      const period = match12[3];
      if (hrs === 12) hrs = 0;
      if (period === 'PM') hrs += 12;
      return hrs * 60 + mins;
    }

    const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      const hrs = parseInt(match24[1], 10);
      const mins = parseInt(match24[2], 10);
      return hrs * 60 + mins;
    }

    return null;
  };

  const startMins = parseToMinutes(startStr);
  const endMins = parseToMinutes(endStr);

  if (startMins === null || endMins === null) return 0;
  if (endMins <= startMins) return 0;

  const totalMins = endMins - startMins - (Number(breakMins) || 0);
  if (totalMins <= 0) return 0;

  return Math.round((totalMins / 60) * 10) / 10;
}

function Avatar({ name }: { name: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: '#EEF2FF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        color: '#3B5BDB',
        flexShrink: 0,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

function EmployeeCell({ emp }: { emp: Employee }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 170 }}>
      <Avatar name={emp.name} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1E293B', whiteSpace: 'nowrap' }}>{emp.name}</div>
        <div style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>
          {emp.role || 'Employee'}
          {emp.employeeId ? ` · ${emp.employeeId}` : ''}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: ReactNode; label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="stat-card">
      <div
        style={{
          fontSize: 11.5,
          color: '#697586',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {icon} {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || '#1A1F36', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.15 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: '#697586', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/** Hours worked with a bar filled against the 8-hour working day. */
function HoursBar({ minutes }: { minutes: number }) {
  if (minutes <= 0) return <span style={{ color: '#94A3B8', fontSize: 13 }}>—</span>;
  const tone = hoursTone(minutes);
  const pct = Math.min(100, (minutes / TARGET_DAY_MINUTES) * 100);
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: '#1A1F36' }}>{hrs(minutes)}</span>
        <span style={{ fontSize: 11, color: tone.fg, fontWeight: 600 }}>
          {minutes >= TARGET_DAY_MINUTES ? 'Full day' : `${Math.round(pct)}% of ${hrs(TARGET_DAY_MINUTES)}`}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: '#EEF2F7', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: tone.bar }} />
      </div>
    </div>
  );
}

function Legend({ hint }: { hint?: string }) {
  const items = [
    { label: `${hrs(TARGET_DAY_MINUTES)}+ full day`, tone: hoursTone(TARGET_DAY_MINUTES) },
    { label: `${hrs(TARGET_DAY_MINUTES / 2)} – ${hrs(TARGET_DAY_MINUTES)}`, tone: hoursTone(TARGET_DAY_MINUTES / 2) },
    { label: `under ${hrs(TARGET_DAY_MINUTES / 2)}`, tone: hoursTone(1) },
  ];
  return (
    <div
      style={{
        padding: '10px 16px',
        borderTop: '1px solid #E5E9F2',
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        fontSize: 12,
        color: '#64748B',
      }}
    >
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {items.map((i) => (
          <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: i.tone.bg, border: `1px solid ${i.tone.bar}` }} />
            {i.label}
          </span>
        ))}
      </div>
      {hint && <span>{hint}</span>}
    </div>
  );
}

const stickyCol = { position: 'sticky', left: 0, background: '#FFFFFF', zIndex: 1 } as const;
const stickyHead = { ...stickyCol, background: '#F8F9FC', zIndex: 2 } as const;
const footCell = { background: '#F8F9FC', fontWeight: 700, borderTop: '1px solid #E5E9F2' } as const;

export default function Timesheets() {
  const { showToast } = useToast();
  const { companyProfile } = useAuth();
  const workingWeekdays = companyProfile?.workingDays;

  // Ticks every minute so hours and earnings of people still at work stay current
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const todayStr = toLocalDate(now);
  const nowHHMM = toHHMM(now);

  const [periodMode, setPeriodMode] = useState<PeriodMode>('daily');
  const [anchor, setAnchor] = useState<string>(() => toLocalDate(new Date()));
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [showLogs, setShowLogs] = useState(false);

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimesheetEntry | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<TimesheetEntry | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form state
  const [form, setForm] = useState<FormState>({
    employeeId: '',
    projectId: '',
    date: todayStr,
    taskDescription: '',
    startTime: '09:00',
    endTime: '17:30',
    breakDurationMinutes: 30,
    isBillable: true,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Synchronize from Firestore on mount: manual timesheets, attendance and leave (leave affects pay)
  useEffect(() => {
    getAllTimesheets().catch((err) => console.warn('Initial timesheets fetch error:', err));
    getAllAttendance().catch((err) => console.warn('Initial attendance fetch error:', err));
    getAllLeaveRequests().catch((err) => console.warn('Initial leave fetch error:', err));
  }, []);

  // Live queries from Dexie cache
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const attendanceRecords = useLiveQuery(() => db.attendance.toArray(), []) || [];
  const leaves = useLiveQuery(() => db.leaveRequests.toArray(), []) || [];
  const timesheetRecords = useLiveQuery(async () => newestFirst(await db.timesheets.toArray(), (t) => t.date), []) || [];

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  const visibleEmployees = useMemo(
    () => (employeeFilter === 'All' ? activeEmployees : activeEmployees.filter((e) => empKey(e) === employeeFilter)),
    [activeEmployees, employeeFilter]
  );

  // The dates shown for the chosen day / week / month, with a friendly label
  const period = useMemo(() => {
    if (periodMode === 'daily') {
      const title =
        anchor === todayStr ? 'Today' : anchor === addDays(todayStr, -1) ? 'Yesterday' : fmt(anchor, { weekday: 'long' });
      return { dates: [anchor], title, sub: fmt(anchor, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }), noun: 'day' };
    }
    if (periodMode === 'weekly') {
      const mon = startOfWeek(anchor);
      const dates = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
      const thisMon = startOfWeek(todayStr);
      const title =
        mon === thisMon ? 'This week' : mon === addDays(thisMon, -7) ? 'Last week' : `Week of ${fmt(mon, { day: 'numeric', month: 'short' })}`;
      const sub = `${fmt(dates[0], { day: 'numeric', month: 'short' })} – ${fmt(dates[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
      return { dates, title, sub, noun: 'week' };
    }
    const month = anchor.slice(0, 7);
    const thisMonth = todayStr.slice(0, 7);
    const lastMonth = toLocalDate(new Date(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 2, 1)).slice(0, 7);
    const full = fmt(`${month}-01`, { month: 'long', year: 'numeric' });
    const title = month === thisMonth ? 'This month' : month === lastMonth ? 'Last month' : full;
    return { dates: datesInMonth(month), title, sub: title === full ? '' : full, noun: 'month' };
  }, [periodMode, anchor, todayStr]);

  const periodHasToday = period.dates.includes(todayStr);

  const shiftPeriod = (dir: 1 | -1) => {
    if (periodMode === 'daily') setAnchor(addDays(anchor, dir));
    else if (periodMode === 'weekly') setAnchor(addDays(anchor, 7 * dir));
    else {
      const [y, m] = anchor.slice(0, 7).split('-').map(Number);
      setAnchor(toLocalDate(new Date(y, m - 1 + dir, 1)));
    }
  };

  // Attendance grouped by employee (matched by id, then employee code, then name) with normalised dates
  const attendanceByEmp = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    for (const att of attendanceRecords) {
      const date = normDate(att.date);
      if (!date) continue;
      const emp =
        (att.employeeId != null && att.employeeId !== '' && activeEmployees.find((e) => String(e.id) === String(att.employeeId))) ||
        (att.employeeCode && activeEmployees.find((e) => e.employeeId === att.employeeCode)) ||
        (att.employeeName && activeEmployees.find((e) => e.name.toLowerCase() === att.employeeName.toLowerCase())) ||
        undefined;
      if (!emp) continue;
      const key = empKey(emp);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ ...att, date });
    }
    return map;
  }, [attendanceRecords, activeEmployees]);

  // Manually logged timesheets grouped by employee, then by date
  const timesheetsByEmp = useMemo(() => {
    const map = new Map<string, Map<string, TimesheetEntry[]>>();
    for (const t of timesheetRecords) {
      const emp = activeEmployees.find(
        (e) =>
          String(e.id) === String(t.employeeId) ||
          String(e.employeeId) === String(t.employeeId) ||
          (!!t.employeeName && e.name.toLowerCase() === t.employeeName.toLowerCase())
      );
      if (!emp) continue;
      const key = empKey(emp);
      const date = normDate(t.date);
      if (!map.has(key)) map.set(key, new Map());
      const byDate = map.get(key)!;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(t);
    }
    return map;
  }, [timesheetRecords, activeEmployees]);

  // Per employee: hours worked and salary earned for every date in the period
  const rows: EmployeeRow[] = useMemo(() => {
    return visibleEmployees.map((emp) => {
      const key = empKey(emp);
      const atts = attendanceByEmp.get(key) || [];
      const attByDate = new Map(atts.map((a) => [a.date, a]));
      const logsByDate = timesheetsByEmp.get(key);
      const empLeaves = leaves.filter((l) => String(l.employeeId) === String(emp.id));
      const salary = Number(emp.salary) || 0;

      // Pay uses the same rules as Payroll, computed once per month touched by the period
      const payCache = new Map<string, { pay: MonthPay; byDate: Map<string, DayPay> }>();
      const payFor = (month: string) => {
        let hit = payCache.get(month);
        if (!hit) {
          const pay = computeMonthPay({ month, salary, workingWeekdays, attendance: atts, leaves: empLeaves, today: todayStr });
          hit = { pay, byDate: new Map(pay.days.map((d) => [d.date, d])) };
          payCache.set(month, hit);
        }
        return hit;
      };

      const cells: DayCell[] = period.dates.map((date) => {
        const { pay, byDate } = payFor(date.slice(0, 7));
        const day = byDate.get(date);
        const att = attByDate.get(date);
        const logs = logsByDate?.get(date) || [];
        const hasTimes = !!att && statusHasTimes(att.status) && !!att.checkIn;
        const inProgress = hasTimes && !att!.checkOut && date === todayStr;

        let minutes = 0;
        let missingCheckout = false;
        if (logs.length > 0) {
          // A manual timesheet replaces the attendance clock for that day
          minutes = Math.round(logs.reduce((s, t) => s + (Number(t.totalHours) || 0), 0) * 60);
        } else if (hasTimes) {
          if (att!.checkOut || inProgress) {
            minutes = workedMinutes(att!, inProgress ? nowHHMM : undefined) || 0;
          } else {
            missingCheckout = true;
            minutes = workedMinutes(att!, WORK_END) || 0;
          }
        }

        let earned = day?.earned || 0;
        if (inProgress) {
          // Still at work: count pay only up to now
          const elapsed = Math.min(
            PAID_DAY_MINUTES,
            Math.max(0, minutesOf(nowHHMM) - Math.max(minutesOf(att!.checkIn), minutesOf(WORK_START)))
          );
          earned = Math.min(earned, pay.rates.perMinute * elapsed);
        }

        let status: DayStatus;
        if (date > todayStr) status = 'Upcoming';
        else if (inProgress) status = 'Working';
        else if (att) status = att.status;
        else if (logs.length > 0) status = 'Logged';
        else if (day?.kind === 'Off') status = 'Off';
        else if (day?.kind === 'Paid Leave' || day?.kind === 'Unpaid Leave') status = 'On Leave';
        else if (day?.kind === 'Absent') status = 'Absent';
        else if (day?.kind === 'Upcoming') status = 'Not In';
        else status = 'No Record';

        return {
          date,
          status,
          minutes,
          earned,
          checkIn: logs.length ? logs[logs.length - 1].startTime : att?.checkIn,
          checkOut: logs.length ? logs[0].endTime : att?.checkOut,
          breakMins: logs.length
            ? logs.reduce((s, t) => s + (Number(t.breakDurationMinutes) || 0), 0)
            : att
              ? lunchMinutes(att) ?? undefined
              : undefined,
          missingCheckout,
        };
      });

      return {
        emp,
        key,
        cells,
        minutes: cells.reduce((s, c) => s + c.minutes, 0),
        earned: cells.reduce((s, c) => s + c.earned, 0),
        daysWorked: cells.filter((c) => c.minutes > 0 || ['Present', 'Late', 'Half Day', 'Working', 'Logged'].includes(c.status)).length,
        salary,
        dailyRate: payFor(period.dates[0].slice(0, 7)).pay.rates.daily,
      };
    });
  }, [visibleEmployees, attendanceByEmp, timesheetsByEmp, leaves, workingWeekdays, period, todayStr, nowHHMM]);

  // Team totals for the cards and table footers
  const totals = useMemo(() => {
    const byDate = new Map<string, { minutes: number; earned: number }>();
    let personDays = 0;
    for (const r of rows) {
      for (const c of r.cells) {
        const t = byDate.get(c.date) || { minutes: 0, earned: 0 };
        t.minutes += c.minutes;
        t.earned += c.earned;
        byDate.set(c.date, t);
        if (c.minutes > 0) personDays += 1;
      }
    }
    const minutes = rows.reduce((s, r) => s + r.minutes, 0);
    return {
      minutes,
      earned: rows.reduce((s, r) => s + r.earned, 0),
      people: rows.filter((r) => r.daysWorked > 0).length,
      avgDay: personDays > 0 ? minutes / personDays : 0,
      byDate,
    };
  }, [rows]);

  const noSalaryCount = rows.filter((r) => r.salary <= 0).length;
  const monthWeeks = useMemo(() => (periodMode === 'monthly' ? weeksOfMonth(anchor.slice(0, 7)) : []), [periodMode, anchor]);

  // Manually logged entries in the period, for editing and deleting
  const periodLogs = useMemo(() => {
    const keys = new Set(visibleEmployees.map(empKey));
    const first = period.dates[0];
    const last = period.dates[period.dates.length - 1];
    const list: TimesheetEntry[] = [];
    for (const [key, byDate] of timesheetsByEmp) {
      if (!keys.has(key)) continue;
      for (const [date, logs] of byDate) if (date >= first && date <= last) list.push(...logs);
    }
    return newestFirst(list, (t) => t.date);
  }, [timesheetsByEmp, visibleEmployees, period]);

  const openDay = (date: string) => {
    setPeriodMode('daily');
    setAnchor(date);
  };
  const openWeek = (date: string) => {
    setPeriodMode('weekly');
    setAnchor(date);
  };

  // Export CSV: one row per employee per day of the period
  const handleExportCSV = () => {
    const lines = rows.flatMap((r) =>
      r.cells
        .filter((c) => c.status !== 'Upcoming')
        .map((c) => [
          r.emp.name,
          r.emp.employeeId || '',
          c.date,
          fmt(c.date, { weekday: 'short' }),
          STATUS_STYLE[c.status].label.replace('● ', ''),
          c.checkIn || '',
          c.checkOut || '',
          c.breakMins ?? '',
          (c.minutes / 60).toFixed(2),
          Math.round(c.earned),
        ])
    );
    if (lines.length === 0) {
      showToast('Nothing to export for this period.', 'info');
      return;
    }
    const header = ['Employee', 'Employee ID', 'Date', 'Day', 'Status', 'Check-in', 'Check-out', 'Break (mins)', 'Hours Worked', 'Earned (INR)'];
    const csv = [header, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `timesheets_${periodMode}_${period.dates[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${lines.length} rows.`, 'success');
  };

  // Modal handlers
  const handleOpenAddModal = () => {
    if (activeEmployees.length === 0) {
      showToast('Please add active employees in the Employees module first.', 'info');
      return;
    }
    if (projects.length === 0) {
      showToast('Please add projects in the Projects module first.', 'info');
      return;
    }

    setEditingEntry(null);
    setForm({
      employeeId: employeeFilter !== 'All' ? employeeFilter : activeEmployees[0]?.id || activeEmployees[0]?.employeeId || '',
      projectId: projects[0]?.id || '',
      date: periodMode === 'daily' ? anchor : todayStr,
      taskDescription: '',
      startTime: '09:00',
      endTime: '17:30',
      breakDurationMinutes: 30,
      isBillable: true,
      notes: '',
    });
    setErrors({});
    setShowModal(true);
  };

  const handleOpenEditModal = (entry: TimesheetEntry) => {
    setEditingEntry(entry);
    setForm({
      employeeId: entry.employeeId || '',
      projectId: entry.projectId || '',
      date: entry.date || todayStr,
      taskDescription: entry.taskDescription || '',
      startTime: entry.startTime || '09:00',
      endTime: entry.endTime || '17:30',
      breakDurationMinutes: entry.breakDurationMinutes ?? 0,
      isBillable: entry.isBillable ?? true,
      notes: entry.notes || '',
    });
    setErrors({});
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEntry(null);
    setErrors({});
  };

  const computedFormHours = calculateDurationHours(form.startTime, form.endTime, Number(form.breakDurationMinutes) || 0);

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.employeeId) errs.employeeId = 'Employee selection is required.';
    if (!form.projectId) errs.projectId = 'Project selection is required.';
    if (!form.date) errs.date = 'Date is required.';
    if (!form.taskDescription.trim()) errs.taskDescription = 'Work description is required.';
    if (!form.startTime.trim()) errs.startTime = 'Start time is required.';
    if (!form.endTime.trim()) errs.endTime = 'End time is required.';
    if (computedFormHours <= 0) {
      errs.endTime = 'End time must be after Start time and result in worked hours > 0.';
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateForm();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      showToast('Please resolve validation errors before saving.', 'error');
      return;
    }

    const emp = activeEmployees.find((e) => String(e.id) === String(form.employeeId) || String(e.employeeId) === String(form.employeeId));
    const proj = projects.find((p) => String(p.id) === String(form.projectId));

    if (!emp) {
      showToast('Selected employee not found.', 'error');
      return;
    }
    if (!proj) {
      showToast('Selected project not found.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Omit<TimesheetEntry, 'id'> = {
        employeeId: emp.id || emp.employeeId,
        employeeName: emp.name,
        projectId: proj.id || '',
        projectName: proj.name,
        date: form.date,
        taskDescription: form.taskDescription.trim(),
        startTime: form.startTime.trim(),
        endTime: form.endTime.trim(),
        breakDurationMinutes: Number(form.breakDurationMinutes) || 0,
        totalHours: computedFormHours,
        isBillable: form.isBillable,
        notes: form.notes.trim(),
      };

      if (editingEntry && editingEntry.id) {
        await updateTimesheet(editingEntry.id, payload);
        showToast('Timesheet entry updated successfully!', 'success');
      } else {
        await addTimesheet(payload);
        showToast('Timesheet entry created successfully!', 'success');
      }

      handleCloseModal();
    } catch (err: any) {
      console.error('Failed to save timesheet:', err);
      showToast(err?.message || 'Failed to save timesheet entry.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!entryToDelete || !entryToDelete.id) return;
    setIsDeleting(true);
    try {
      await deleteTimesheet(entryToDelete.id);
      showToast('Timesheet entry deleted successfully', 'info');
      setEntryToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete timesheet:', err);
      showToast(err?.message || 'Failed to delete timesheet entry', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const tabs: { mode: PeriodMode; label: string; icon: ReactNode }[] = [
    { mode: 'daily', label: 'Day', icon: <Calendar size={14} /> },
    { mode: 'weekly', label: 'Week', icon: <CalendarRange size={14} /> },
    { mode: 'monthly', label: 'Month', icon: <CalendarDays size={14} /> },
  ];

  const periodWord = periodMode === 'daily' ? (anchor === todayStr ? 'today' : 'this day') : `this ${period.noun}`;

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Clock size={22} style={{ color: '#3B5BDB' }} />
            Timesheets
          </div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            How long each person worked and how much salary they earned — by day, week or month
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleExportCSV}
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleOpenAddModal}
          >
            <Plus size={15} /> Log Hours
          </button>
        </div>
      </div>

      {/* Period controls */}
      <div
        className="card"
        style={{
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 3, borderRadius: 8 }}>
          {tabs.map((t) => {
            const active = periodMode === t.mode;
            return (
              <button
                key={t.mode}
                type="button"
                style={{
                  border: 'none',
                  padding: '7px 16px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? '#FFFFFF' : 'transparent',
                  color: active ? '#3B5BDB' : '#697586',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onClick={() => setPeriodMode(t.mode)}
              >
                {t.icon} {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '6px 8px' }}
            onClick={() => shiftPeriod(-1)}
            title={`Previous ${period.noun}`}
          >
            <ChevronLeft size={16} />
          </button>
          <div style={{ minWidth: 150, textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: '#1A1F36' }}>{period.title}</div>
            {period.sub && <div style={{ fontSize: 12, color: '#64748B' }}>{period.sub}</div>}
          </div>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '6px 8px' }}
            onClick={() => shiftPeriod(1)}
            title={`Next ${period.noun}`}
          >
            <ChevronRight size={16} />
          </button>
          {!periodHasToday && (
            <button type="button" className="btn-secondary" style={{ padding: '6px 10px', fontSize: 12.5 }} onClick={() => setAnchor(todayStr)}>
              Back to {periodMode === 'daily' ? 'today' : `this ${period.noun}`}
            </button>
          )}
          {periodMode === 'monthly' ? (
            <input
              type="month"
              className="input-base"
              style={{ fontSize: 13, width: 150 }}
              value={anchor.slice(0, 7)}
              onChange={(e) => e.target.value && setAnchor(`${e.target.value}-01`)}
              aria-label="Pick a month"
            />
          ) : (
            <input
              type="date"
              className="input-base"
              style={{ fontSize: 13, width: 150 }}
              value={anchor}
              onChange={(e) => e.target.value && setAnchor(e.target.value)}
              aria-label={periodMode === 'weekly' ? 'Pick any day in the week' : 'Pick a day'}
            />
          )}
          <select
            className="select-base"
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            style={{ fontSize: 13 }}
            aria-label="Filter by employee"
          >
            <option value="All">All employees</option>
            {activeEmployees.map((e) => (
              <option key={empKey(e)} value={empKey(e)}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 10 }}>
        <StatCard
          icon={<Clock size={14} style={{ color: '#3B5BDB' }} />}
          label="Hours worked"
          value={hrs(totals.minutes)}
          sub={`by ${totals.people} ${totals.people === 1 ? 'person' : 'people'} ${periodWord}`}
        />
        <StatCard
          icon={<IndianRupee size={14} style={{ color: '#12B76A' }} />}
          label="Salary earned"
          value={inr(totals.earned)}
          sub={periodHasToday ? `earned so far ${periodWord}` : `earned ${periodWord}`}
          color="#12B76A"
        />
        <StatCard
          icon={<Users size={14} style={{ color: '#7C3AED' }} />}
          label={periodMode === 'daily' ? 'At work' : 'People who worked'}
          value={`${totals.people} / ${rows.length}`}
          sub={periodMode === 'daily' ? 'employees checked in' : `worked at least one day ${periodWord}`}
        />
        <StatCard
          icon={<Timer size={14} style={{ color: '#F59E0B' }} />}
          label="Average workday"
          value={hrs(Math.round(totals.avgDay))}
          sub={`per person, target ${hrs(TARGET_DAY_MINUTES)}`}
          color={totals.avgDay >= TARGET_DAY_MINUTES ? '#16A34A' : '#F59E0B'}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#64748B', marginBottom: 16 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Earnings follow the Payroll rules: monthly salary ÷ working days, minus absent days and late / early / long-lunch time.
          {noSalaryCount > 0 &&
            ` ${noSalaryCount} ${noSalaryCount === 1 ? 'employee has' : 'employees have'} no monthly salary set, so they show ₹0 — add it in Employees.`}
        </span>
      </div>

      {activeEmployees.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: '#697586' }}>
          <AlertCircle size={28} style={{ color: '#94A3B8', marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: '#1A1F36', fontSize: 15 }}>No active employees</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add employees in the Employees module to see their hours and earnings here.</div>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {/* DAY VIEW: one row per employee */}
          {periodMode === 'daily' && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>EMPLOYEE</th>
                      <th>STATUS</th>
                      <th>IN → OUT</th>
                      <th>BREAK</th>
                      <th>HOURS WORKED</th>
                      <th style={{ textAlign: 'right' }}>EARNED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const c = r.cells[0];
                      const s = STATUS_STYLE[c.status];
                      const hasTimes = !!c.checkIn;
                      return (
                        <tr key={r.key}>
                          <td>
                            <EmployeeCell emp={r.emp} />
                          </td>
                          <td>
                            <span className={`badge ${s.badge}`}>{s.label}</span>
                            {c.missingCheckout && (
                              <div style={{ fontSize: 11, color: '#B45309', marginTop: 3 }} title={`Counted until ${formatTime12h(WORK_END)}`}>
                                No check-out recorded
                              </div>
                            )}
                          </td>
                          <td style={{ fontSize: 13, color: hasTimes ? '#1A1F36' : '#94A3B8', whiteSpace: 'nowrap' }}>
                            {hasTimes ? (
                              <>
                                {formatTime12h(c.checkIn)} → {c.checkOut ? formatTime12h(c.checkOut) : c.status === 'Working' ? 'now' : '—'}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={{ fontSize: 13, color: '#64748B' }}>{c.breakMins ? formatDuration(c.breakMins) : '—'}</td>
                          <td>
                            <HoursBar minutes={c.minutes} />
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, fontSize: 14.5, color: c.earned > 0 ? '#12B76A' : '#94A3B8' }}>{inr(c.earned)}</div>
                            <div style={{ fontSize: 11, color: '#64748B' }}>
                              {r.salary > 0 ? `of ${inr(r.dailyRate)} / day` : 'No salary set'}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={footCell}>Team total</td>
                      <td style={footCell}>
                        <span style={{ fontWeight: 600, fontSize: 12.5, color: '#475569' }}>
                          {totals.people} of {rows.length} worked
                        </span>
                      </td>
                      <td style={footCell} />
                      <td style={footCell} />
                      <td style={{ ...footCell, fontSize: 14.5 }}>{hrs(totals.minutes)}</td>
                      <td style={{ ...footCell, textAlign: 'right', fontSize: 15, color: '#12B76A' }}>{inr(totals.earned)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Legend />
            </>
          )}

          {/* WEEK VIEW: Mon–Sun grid, each cell shows hours and earnings for that day */}
          {periodMode === 'weekly' && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th style={stickyHead}>EMPLOYEE</th>
                      {period.dates.map((d) => {
                        const isToday = d === todayStr;
                        return (
                          <th key={d} style={{ textAlign: 'center', minWidth: 84, background: isToday ? '#EEF2FF' : undefined }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: isToday ? '#3B5BDB' : '#475569' }}>
                              {fmt(d, { weekday: 'short' }).toUpperCase()}
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: isToday ? '#3B5BDB' : '#64748B' }}>
                              {fmt(d, { day: 'numeric', month: 'short' })}
                            </div>
                          </th>
                        );
                      })}
                      <th style={{ textAlign: 'right', minWidth: 100 }}>WEEK HOURS</th>
                      <th style={{ textAlign: 'right', minWidth: 100 }}>WEEK EARNED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td style={stickyCol}>
                          <EmployeeCell emp={r.emp} />
                        </td>
                        {r.cells.map((c) => {
                          const isToday = c.date === todayStr;
                          const tone = hoursTone(c.minutes);
                          const s = STATUS_STYLE[c.status];
                          return (
                            <td key={c.date} style={{ textAlign: 'center', padding: '8px 6px', background: isToday ? '#F8FAFF' : undefined }}>
                              <button
                                type="button"
                                onClick={() => openDay(c.date)}
                                title={`${fmt(c.date, { weekday: 'long', day: 'numeric', month: 'short' })} · ${s.label.replace('● ', '')} — click for details`}
                                style={{
                                  width: '100%',
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  padding: 0,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                {c.minutes > 0 ? (
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '3px 8px',
                                      borderRadius: 6,
                                      background: tone.bg,
                                      color: tone.fg,
                                      fontSize: 12.5,
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {hrs(c.minutes)}
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      color: c.status === 'Absent' ? '#DC2626' : c.status === 'On Leave' ? '#7C3AED' : '#94A3B8',
                                    }}
                                  >
                                    {s.short}
                                  </span>
                                )}
                                {c.earned > 0 && <span style={{ fontSize: 11, color: '#12B76A', fontWeight: 600 }}>{inr(c.earned)}</span>}
                              </button>
                            </td>
                          );
                        })}
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 800, fontSize: 14.5, color: '#1A1F36' }}>{hrs(r.minutes)}</div>
                          <div style={{ fontSize: 11, color: '#64748B' }}>
                            {r.daysWorked} day{r.daysWorked === 1 ? '' : 's'} worked
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 800, fontSize: 14.5, color: r.earned > 0 ? '#12B76A' : '#94A3B8' }}>{inr(r.earned)}</div>
                          {r.salary <= 0 && <div style={{ fontSize: 11, color: '#64748B' }}>No salary set</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ ...footCell, ...stickyCol, background: '#F8F9FC' }}>Team total</td>
                      {period.dates.map((d) => {
                        const t = totals.byDate.get(d);
                        return (
                          <td key={d} style={{ ...footCell, textAlign: 'center', padding: '8px 6px' }}>
                            <div style={{ fontSize: 12.5 }}>{t && t.minutes > 0 ? hrs(t.minutes) : '—'}</div>
                            {t && t.earned > 0 && <div style={{ fontSize: 11, color: '#12B76A' }}>{inr(t.earned)}</div>}
                          </td>
                        );
                      })}
                      <td style={{ ...footCell, textAlign: 'right', fontSize: 14.5 }}>{hrs(totals.minutes)}</td>
                      <td style={{ ...footCell, textAlign: 'right', fontSize: 15, color: '#12B76A' }}>{inr(totals.earned)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Legend hint="Click any day to see check-in / check-out details" />
            </>
          )}

          {/* MONTH VIEW: week-by-week hours and earnings, plus month totals */}
          {periodMode === 'monthly' && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th style={stickyHead}>EMPLOYEE</th>
                      {monthWeeks.map((w, i) => (
                        <th key={w.start} style={{ textAlign: 'center', minWidth: 96 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569' }}>WEEK {i + 1}</div>
                          <div style={{ fontSize: 11, fontWeight: 500, color: '#64748B' }}>
                            {fmt(w.start, { day: 'numeric' })}
                            {w.end !== w.start ? `–${fmt(w.end, { day: 'numeric' })}` : ''} {fmt(w.start, { month: 'short' })}
                          </div>
                        </th>
                      ))}
                      <th style={{ textAlign: 'right', minWidth: 110 }}>MONTH HOURS</th>
                      <th style={{ textAlign: 'right', minWidth: 110 }}>EARNED</th>
                      <th style={{ minWidth: 170 }}>OF MONTHLY SALARY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const byDate = new Map(r.cells.map((c) => [c.date, c]));
                      const pct = r.salary > 0 ? Math.min(100, (r.earned / r.salary) * 100) : 0;
                      return (
                        <tr key={r.key}>
                          <td style={stickyCol}>
                            <EmployeeCell emp={r.emp} />
                          </td>
                          {monthWeeks.map((w) => {
                            const wc = w.dates.map((d) => byDate.get(d)).filter((c): c is DayCell => !!c);
                            const mins = wc.reduce((s, c) => s + c.minutes, 0);
                            const earned = wc.reduce((s, c) => s + c.earned, 0);
                            const future = w.start > todayStr;
                            return (
                              <td key={w.start} style={{ textAlign: 'center', padding: '8px 6px' }}>
                                <button
                                  type="button"
                                  onClick={() => openWeek(w.start)}
                                  title="Open this week day by day"
                                  style={{
                                    width: '100%',
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    padding: 0,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: 2,
                                  }}
                                >
                                  <span style={{ fontSize: 13, fontWeight: 700, color: mins > 0 ? '#1A1F36' : '#94A3B8' }}>
                                    {mins > 0 ? hrs(mins) : future ? '' : '—'}
                                  </span>
                                  {earned > 0 && <span style={{ fontSize: 11, color: '#12B76A', fontWeight: 600 }}>{inr(earned)}</span>}
                                </button>
                              </td>
                            );
                          })}
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, fontSize: 14.5, color: '#1A1F36' }}>{hrs(r.minutes)}</div>
                            <div style={{ fontSize: 11, color: '#64748B' }}>
                              {r.daysWorked} day{r.daysWorked === 1 ? '' : 's'} worked
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, fontSize: 14.5, color: r.earned > 0 ? '#12B76A' : '#94A3B8' }}>{inr(r.earned)}</div>
                            {periodHasToday && r.earned > 0 && <div style={{ fontSize: 11, color: '#64748B' }}>so far</div>}
                          </td>
                          <td>
                            {r.salary > 0 ? (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
                                  <span style={{ fontWeight: 700, color: '#1A1F36' }}>{Math.round(pct)}%</span>
                                  <span style={{ color: '#64748B' }}>of {inr(r.salary)}</span>
                                </div>
                                <div style={{ height: 6, borderRadius: 99, background: '#EEF2F7', overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: '#12B76A' }} />
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: 12, color: '#94A3B8' }}>No salary set</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ ...footCell, ...stickyCol, background: '#F8F9FC' }}>Team total</td>
                      {monthWeeks.map((w) => {
                        const mins = w.dates.reduce((s, d) => s + (totals.byDate.get(d)?.minutes || 0), 0);
                        const earned = w.dates.reduce((s, d) => s + (totals.byDate.get(d)?.earned || 0), 0);
                        return (
                          <td key={w.start} style={{ ...footCell, textAlign: 'center', padding: '8px 6px' }}>
                            <div style={{ fontSize: 12.5 }}>{mins > 0 ? hrs(mins) : '—'}</div>
                            {earned > 0 && <div style={{ fontSize: 11, color: '#12B76A' }}>{inr(earned)}</div>}
                          </td>
                        );
                      })}
                      <td style={{ ...footCell, textAlign: 'right', fontSize: 14.5 }}>{hrs(totals.minutes)}</td>
                      <td style={{ ...footCell, textAlign: 'right', fontSize: 15, color: '#12B76A' }}>{inr(totals.earned)}</td>
                      <td style={footCell} />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div style={{ padding: '10px 16px', borderTop: '1px solid #E5E9F2', fontSize: 12, color: '#64748B', textAlign: 'right' }}>
                Click any week to see it day by day
              </div>
            </>
          )}
        </div>
      )}

      {/* Manually logged hours (collapsed): only needed to fix or remove an entry */}
      {periodLogs.length > 0 && (
        <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Edit3 size={14} style={{ color: '#3B5BDB' }} />
              Manually logged hours ({periodLogs.length})
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B' }}>
              {showLogs ? 'Hide' : 'Show to edit or delete'}
              <ChevronDown size={15} style={{ transform: showLogs ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </span>
          </button>
          {showLogs && (
            <div style={{ overflowX: 'auto', borderTop: '1px solid #E5E9F2' }}>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>EMPLOYEE</th>
                    <th>DATE</th>
                    <th>TIME</th>
                    <th>BREAK</th>
                    <th style={{ textAlign: 'right' }}>HOURS</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {periodLogs.map((t) => (
                    <tr key={String(t.id)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={t.employeeName} />
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.employeeName}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmt(normDate(t.date), { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                      <td style={{ fontSize: 13, color: '#475569', whiteSpace: 'nowrap' }}>
                        {formatTime12h(t.startTime)} → {formatTime12h(t.endTime)}
                      </td>
                      <td style={{ fontSize: 13, color: '#64748B' }}>{t.breakDurationMinutes ? formatDuration(t.breakDurationMinutes) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{hrs(Math.round((Number(t.totalHours) || 0) * 60))}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => handleOpenEditModal(t)}
                          >
                            <Edit3 size={12} /> Edit
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{
                              fontSize: 11.5,
                              padding: '4px 8px',
                              color: '#EF4444',
                              borderColor: '#FCA5A5',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            onClick={() => setEntryToDelete(t)}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Log / Edit Timesheet Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-box" style={{ width: 560, padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 16.5 }}>
                {editingEntry ? 'Edit Logged Hours' : 'Log Hours'}
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={handleCloseModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Employee Select */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Employee <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.employeeId ? '#EF4444' : undefined }}
                    value={form.employeeId}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, employeeId: e.target.value }));
                      if (errors.employeeId) setErrors((prev) => ({ ...prev, employeeId: '' }));
                    }}
                  >
                    {activeEmployees.map((emp) => (
                      <option key={empKey(emp)} value={emp.id || emp.employeeId}>
                        {emp.name}{emp.role ? ` (${emp.role})` : ''}
                      </option>
                    ))}
                  </select>
                  {errors.employeeId && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.employeeId}</div>
                  )}
                </div>

                {/* Project Select */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Project <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.projectId ? '#EF4444' : undefined }}
                    value={form.projectId}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, projectId: e.target.value }));
                      if (errors.projectId) setErrors((prev) => ({ ...prev, projectId: '' }));
                    }}
                  >
                    {projects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name} ({proj.clientName || 'Client'})
                      </option>
                    ))}
                  </select>
                  {errors.projectId && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.projectId}</div>
                  )}
                </div>

                {/* Date */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Date <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.date ? '#EF4444' : undefined }}
                    value={form.date}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, date: e.target.value }));
                      if (errors.date) setErrors((prev) => ({ ...prev, date: '' }));
                    }}
                  />
                  {errors.date && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.date}</div>
                  )}
                </div>

                {/* Billing Status */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Billing Type <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={form.isBillable ? 'Billable' : 'Non-Billable'}
                    onChange={(e) => setForm((prev) => ({ ...prev, isBillable: e.target.value === 'Billable' }))}
                  >
                    <option value="Billable">Billable</option>
                    <option value="Non-Billable">Non-Billable</option>
                  </select>
                </div>

                {/* Start Time */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Start Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.startTime ? '#EF4444' : undefined }}
                    value={form.startTime}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, startTime: e.target.value }));
                      if (errors.startTime) setErrors((prev) => ({ ...prev, startTime: '' }));
                    }}
                  />
                  {errors.startTime && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.startTime}</div>
                  )}
                </div>

                {/* End Time */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    End Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.endTime ? '#EF4444' : undefined }}
                    value={form.endTime}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, endTime: e.target.value }));
                      if (errors.endTime) setErrors((prev) => ({ ...prev, endTime: '' }));
                    }}
                  />
                  {errors.endTime && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.endTime}</div>
                  )}
                </div>

                {/* Break Duration */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Break Duration (mins)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    className="input-base"
                    style={{ width: '100%' }}
                    value={form.breakDurationMinutes}
                    onChange={(e) => setForm((prev) => ({ ...prev, breakDurationMinutes: e.target.value }))}
                  />
                </div>

                {/* Calculated Duration Display */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#697586' }}>
                    Calculated Net Duration
                  </label>
                  <div
                    style={{
                      padding: '8px 12px',
                      background: computedFormHours > 0 ? '#EEF2FF' : '#FEF2F2',
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 700,
                      color: computedFormHours > 0 ? '#3B5BDB' : '#EF4444',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Clock size={16} />
                    {computedFormHours > 0 ? `${computedFormHours} worked hrs` : 'Invalid time range'}
                  </div>
                </div>

                {/* Task Description (Full Width) */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Task / Work Description <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    placeholder="e.g. Implemented authentication API and frontend validation"
                    style={{ width: '100%', borderColor: errors.taskDescription ? '#EF4444' : undefined }}
                    value={form.taskDescription}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, taskDescription: e.target.value }));
                      if (errors.taskDescription) setErrors((prev) => ({ ...prev, taskDescription: '' }));
                    }}
                  />
                  {errors.taskDescription && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.taskDescription}</div>
                  )}
                </div>

                {/* Notes (Full Width) */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Additional Notes
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    placeholder="Optional notes or references"
                    style={{ width: '100%' }}
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={handleCloseModal} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : editingEntry ? 'Update Entry' : 'Save Hours'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shared Delete Confirmation Modal */}
      {entryToDelete && (
        <DeleteConfirmationModal
          isOpen={!!entryToDelete}
          title="Delete Logged Hours"
          itemName={`${entryToDelete.employeeName} - ${entryToDelete.date}`}
          description={
            <>
              Are you sure you want to delete the hours logged for <strong style={{ color: '#1A1F36' }}>{entryToDelete.employeeName}</strong> ({entryToDelete.totalHours} hrs on {entryToDelete.date})? This action will permanently remove the record from Firestore.
            </>
          }
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={() => setEntryToDelete(null)}
        />
      )}
    </div>
  );
}
