import type { AttendanceRecord, LeaveRequest } from '../db/database';
import {
  WORK_START,
  WORK_END,
  LUNCH_MAX_MINUTES,
  minutesOf,
  lunchMinutes,
  workedMinutes,
  toLocalDate,
} from './attendanceTimes';

/**
 * Salary rules
 * - Monthly salary is fixed. It is split over the company's working days (Settings → Company profile).
 * - A working day is 9 paid hours (9 AM – 6 PM, the 1-hour lunch is paid), so
 *     daily = salary ÷ working days, hourly = daily ÷ 9, per minute = hourly ÷ 60.
 * - Deducted: absent days and unpaid leave at the daily rate (half day = half), plus "short time"
 *   (late arrival, early leave, lunch beyond 1 hour) at the per-minute rate.
 * - Overtime, bonus and incentives are never automatic: they stay 0 unless an admin adds them.
 */
export const PAID_DAY_MINUTES = minutesOf(WORK_END) - minutesOf(WORK_START);
export const DEFAULT_WORKING_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface SalaryRates {
  daily: number;
  hourly: number;
  perMinute: number;
}

export interface ShortTime {
  late: number;
  early: number;
  extraLunch: number;
  total: number;
}

export interface DayPay {
  date: string;
  isWorkingDay: boolean;
  record?: AttendanceRecord;
  /** What the day counts as for pay */
  kind: 'Present' | 'Half Day' | 'Paid Leave' | 'Unpaid Leave' | 'Absent' | 'Upcoming' | 'Off';
  shortTime: ShortTime;
  workedMinutes: number | null;
  deduction: number;
  /** Salary earned for the day (daily rate minus that day's deductions) */
  earned: number;
}

export interface MonthPay {
  month: string;
  salary: number;
  workingDays: number;
  rates: SalaryRates;
  /** Last date counted (today for the current month, month end for past months) */
  countedUntil: string;
  hasAttendanceData: boolean;
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  extraLunchMinutes: number;
  shortMinutes: number;
  workedMinutes: number;
  absentDeduction: number;
  unpaidLeaveDeduction: number;
  shortTimeDeduction: number;
  /** Salary earned for the days counted so far */
  earnedToDate: number;
  days: DayPay[];
}

const ZERO_SHORT: ShortTime = { late: 0, early: 0, extraLunch: 0, total: 0 };
const round2 = (n: number) => Math.round(n * 100) / 100;

export function datesInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(date + 'T00:00:00').getDay()];
}

export function workingDatesInMonth(month: string, workingWeekdays: string[] = DEFAULT_WORKING_WEEKDAYS): string[] {
  const days = workingWeekdays.length ? workingWeekdays : DEFAULT_WORKING_WEEKDAYS;
  return datesInMonth(month).filter((d) => days.includes(weekdayOf(d)));
}

export function salaryRates(monthlySalary: number, workingDays: number): SalaryRates {
  const daily = workingDays > 0 ? (Number(monthlySalary) || 0) / workingDays : 0;
  const hourly = daily / (PAID_DAY_MINUTES / 60);
  return { daily, hourly, perMinute: hourly / 60 };
}

/** Late arrival, early leave and lunch beyond the allowed hour, in minutes, for a full working day. */
export function shortTimeFor(rec: AttendanceRecord): ShortTime {
  if (!rec.checkIn || (rec.status !== 'Present' && rec.status !== 'Late')) return ZERO_SHORT;
  const late = Math.max(0, minutesOf(rec.checkIn) - minutesOf(WORK_START));
  const early = rec.checkOut ? Math.max(0, minutesOf(WORK_END) - minutesOf(rec.checkOut)) : 0;
  const extraLunch = Math.max(0, (lunchMinutes(rec) || 0) - LUNCH_MAX_MINUTES);
  return { late, early, extraLunch, total: late + early + extraLunch };
}

function leaveOn(date: string, leaves: LeaveRequest[]): LeaveRequest | undefined {
  return leaves.find((l) => l.status === 'Approved' && l.fromDate <= date && l.toDate >= date);
}

/**
 * Pay breakdown for one employee and month, day by day.
 * Days after `today` are "Upcoming" and not deducted. If the month has no attendance at all,
 * unrecorded days are not treated as absent (attendance simply wasn't tracked).
 */
export function computeMonthPay(params: {
  month: string;
  salary: number;
  workingWeekdays?: string[];
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  today?: string;
}): MonthPay {
  const { month, salary, attendance, leaves } = params;
  const today = params.today || toLocalDate(new Date());
  const workingDates = new Set(workingDatesInMonth(month, params.workingWeekdays));
  const rates = salaryRates(salary, workingDates.size);
  const byDate = new Map(attendance.filter((a) => a.date.startsWith(month)).map((a) => [a.date, a]));
  const hasAttendanceData = byDate.size > 0;
  const monthEnd = datesInMonth(month).slice(-1)[0];
  const countedUntil = today < monthEnd ? today : monthEnd;

  const totals = {
    presentDays: 0, halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0,
    lateMinutes: 0, earlyLeaveMinutes: 0, extraLunchMinutes: 0, workedMinutes: 0, earnedToDate: 0,
  };
  const days: DayPay[] = [];

  for (const date of datesInMonth(month)) {
    const isWorkingDay = workingDates.has(date);
    const record = byDate.get(date);
    const leave = leaveOn(date, leaves);
    const worked = record && record.checkOut ? workedMinutes(record) : null;
    if (worked) totals.workedMinutes += worked;

    let kind: DayPay['kind'];
    let dayFraction = 0; // share of the daily rate deducted
    let shortTime = ZERO_SHORT;

    if (!isWorkingDay) {
      kind = 'Off';
    } else if (date > countedUntil || (date === today && !record)) {
      kind = 'Upcoming'; // future days, and today before checking in
    } else if (record?.status === 'Present' || record?.status === 'Late') {
      kind = 'Present';
      shortTime = shortTimeFor(record);
    } else if (record?.status === 'Half Day') {
      kind = 'Half Day';
      dayFraction = 0.5;
    } else if (record?.status === 'On Leave' || (!record && leave)) {
      const unpaid = leave?.leaveType === 'Unpaid Leave';
      kind = unpaid ? 'Unpaid Leave' : 'Paid Leave';
      if (unpaid) dayFraction = leave?.isHalfDay ? 0.5 : 1;
    } else if (record?.status === 'Absent' || hasAttendanceData) {
      kind = 'Absent';
      dayFraction = 1;
    } else {
      kind = 'Present'; // attendance not tracked this month
    }

    const deduction = isWorkingDay && kind !== 'Upcoming' ? rates.daily * dayFraction + rates.perMinute * shortTime.total : 0;
    const earned = isWorkingDay && kind !== 'Upcoming' ? Math.max(0, rates.daily - deduction) : 0;

    if (kind === 'Present') totals.presentDays += 1;
    if (kind === 'Half Day') { totals.halfDays += 1; totals.absentDays += 0.5; }
    if (kind === 'Paid Leave') totals.paidLeaveDays += 1;
    if (kind === 'Unpaid Leave') totals.unpaidLeaveDays += dayFraction;
    if (kind === 'Absent') totals.absentDays += 1;
    totals.lateMinutes += shortTime.late;
    totals.earlyLeaveMinutes += shortTime.early;
    totals.extraLunchMinutes += shortTime.extraLunch;
    totals.earnedToDate += earned;

    days.push({ date, isWorkingDay, record, kind, shortTime, workedMinutes: worked, deduction, earned });
  }

  const shortMinutes = totals.lateMinutes + totals.earlyLeaveMinutes + totals.extraLunchMinutes;
  return {
    month,
    salary: Number(salary) || 0,
    workingDays: workingDates.size,
    rates,
    countedUntil,
    hasAttendanceData,
    ...totals,
    shortMinutes,
    absentDeduction: Math.round(rates.daily * totals.absentDays),
    unpaidLeaveDeduction: Math.round(rates.daily * totals.unpaidLeaveDays),
    shortTimeDeduction: Math.round(rates.perMinute * shortMinutes),
    earnedToDate: Math.round(totals.earnedToDate),
    days,
  };
}

/** ₹ with paise for small per-hour / per-minute rates, whole rupees otherwise. */
export function formatRate(n: number): string {
  const digits = n < 100 ? 2 : 0;
  return '₹' + round2(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
