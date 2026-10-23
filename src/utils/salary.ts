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
  overtimeMinutes?: number;
  deduction: number;
  /** Salary earned for the day (daily rate minus that day's deductions, or worked hours * hourly rate) */
  earned: number;
}

export interface MonthPay {
  month: string;
  salary: number;
  dailySalary: number;
  workingHours: number;
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
  overtimeMinutes: number;
  workedMinutes: number;
  absentDeduction: number;
  unpaidLeaveDeduction: number;
  shortTimeDeduction: number;
  overtimePay: number;
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

export function salaryRates(
  monthlySalary: number,
  workingDays: number,
  dailySalary?: number,
  workingHours?: number
): SalaryRates {
  const daily = Number(dailySalary) > 0
    ? Number(dailySalary)
    : workingDays > 0
    ? (Number(monthlySalary) || 0) / workingDays
    : 0;
  const hours = Number(workingHours) > 0 ? Number(workingHours) : 8;
  const hourly = hours > 0 ? daily / hours : 0;
  return { daily, hourly, perMinute: hourly / 60 };
}

/** Late arrival, early leave and lunch beyond the allowed hour, in minutes, for a full working day. */
export function shortTimeFor(rec: AttendanceRecord, scheduledWorkingHours = 8): ShortTime {
  if (!rec.checkIn || (rec.status !== 'Present' && rec.status !== 'Late')) return ZERO_SHORT;
  const late = Math.max(0, minutesOf(rec.checkIn) - minutesOf(WORK_START));
  const extraLunch = Math.max(0, (lunchMinutes(rec) || 0) - LUNCH_MAX_MINUTES);
  const worked = workedMinutes(rec);
  const scheduledMinutes = scheduledWorkingHours * 60;
  const total = worked != null ? Math.max(0, scheduledMinutes - worked) : late + extraLunch;
  const early = Math.max(0, total - late - extraLunch);
  return { late, early, extraLunch, total };
}

function leaveOn(date: string, leaves: LeaveRequest[]): LeaveRequest | undefined {
  return leaves.find((l) => l.status === 'Approved' && l.fromDate <= date && l.toDate >= date);
}

/**
 * Pay breakdown for one employee and month, day by day.
 * Divides daily salary by scheduled working hours to calculate hourly rate.
 * Only calculates for actual working hours less break and lunch.
 * Days after `today` are "Upcoming" and not deducted. If the month has no attendance at all,
 * unrecorded days are not treated as absent (attendance simply wasn't tracked).
 */
export function computeMonthPay(params: {
  month: string;
  salary: number;
  dailySalary?: number;
  workingHours?: number;
  workingWeekdays?: string[];
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  today?: string;
  now?: string;
}): MonthPay {
  const { month, attendance, leaves } = params;
  const today = params.today || toLocalDate(new Date());
  const workingDates = new Set(workingDatesInMonth(month, params.workingWeekdays));
  const workingDaysCount = workingDates.size;
  const workingHours = Number(params.workingHours) > 0 ? Number(params.workingHours) : 8;
  const scheduledMinutes = workingHours * 60;

  const rawDaily = Number(params.dailySalary) > 0
    ? Number(params.dailySalary)
    : workingDaysCount > 0
    ? (Number(params.salary) || 0) / workingDaysCount
    : 0;
  const rawSalary = Number(params.salary) > 0
    ? Number(params.salary)
    : rawDaily * workingDaysCount;

  const rates = salaryRates(rawSalary, workingDaysCount, rawDaily, workingHours);
  const byDate = new Map(attendance.filter((a) => a.date.startsWith(month)).map((a) => [a.date, a]));
  const hasAttendanceData = byDate.size > 0;
  const monthEnd = datesInMonth(month).slice(-1)[0];
  const countedUntil = today < monthEnd ? today : monthEnd;

  const totals = {
    presentDays: 0,
    halfDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    extraLunchMinutes: 0,
    shortMinutes: 0,
    overtimeMinutes: 0,
    workedMinutes: 0,
    earnedToDate: 0,
  };
  const days: DayPay[] = [];

  for (const date of datesInMonth(month)) {
    const isWorkingDay = workingDates.has(date);
    const record = byDate.get(date);
    const leave = leaveOn(date, leaves);
    const isOngoingToday = date === today && !!record && !record.checkOut;
    const worked = record
      ? workedMinutes(record, isOngoingToday ? (params.now || toHHMM(new Date())) : undefined)
      : null;
    if (worked) totals.workedMinutes += worked;

    let kind: DayPay['kind'];
    let dayFraction = 0; // share of the daily rate deducted
    let shortTime = ZERO_SHORT;
    let overtimeMinutes = 0;
    let deduction = 0;
    let earned = 0;

    if (!isWorkingDay) {
      kind = 'Off';
    } else if (date > countedUntil || (date === today && !record)) {
      kind = 'Upcoming'; // future days, and today before checking in
    } else if (record?.status === 'Present' || record?.status === 'Late') {
      kind = 'Present';
      if (record.checkIn && record.checkOut) {
        // Day complete with punch in and punch out:
        // Calculate strictly by working hours less break and lunch
        const actualMins = worked || 0;
        if (actualMins < scheduledMinutes) {
          const shortMin = scheduledMinutes - actualMins;
          shortTime = {
            late: Math.max(0, minutesOf(record.checkIn) - minutesOf(WORK_START)),
            extraLunch: Math.max(0, (lunchMinutes(record) || 0) - LUNCH_MAX_MINUTES),
            early: Math.max(0, shortMin - Math.max(0, minutesOf(record.checkIn) - minutesOf(WORK_START)) - Math.max(0, (lunchMinutes(record) || 0) - LUNCH_MAX_MINUTES)),
            total: shortMin,
          };
          deduction = shortMin * rates.perMinute;
          earned = Math.max(0, rates.daily - deduction);
        } else {
          overtimeMinutes = actualMins - scheduledMinutes;
          const otPay = overtimeMinutes * rates.perMinute;
          deduction = 0;
          earned = rates.daily + otPay;
          shortTime = ZERO_SHORT;
        }
      } else if (isOngoingToday && worked != null) {
        // Today, checked in and on shift
        earned = Math.round((worked / 60) * rates.hourly * 100) / 100;
        deduction = 0;
      } else {
        // Manual entry / marked present with no punches
        earned = rates.daily;
        deduction = 0;
      }
    } else if (record?.status === 'Half Day') {
      kind = 'Half Day';
      const halfScheduled = scheduledMinutes / 2;
      if (record.checkIn && record.checkOut && worked != null) {
        if (worked < halfScheduled) {
          const shortMin = halfScheduled - worked;
          deduction = rates.daily * 0.5 + shortMin * rates.perMinute;
          earned = Math.max(0, rates.daily - deduction);
          shortTime = { late: 0, early: 0, extraLunch: 0, total: shortMin };
        } else {
          earned = (worked / 60) * rates.hourly;
          deduction = Math.max(0, rates.daily - earned);
        }
      } else {
        dayFraction = 0.5;
        deduction = rates.daily * 0.5;
        earned = rates.daily * 0.5;
      }
    } else if (record?.status === 'On Leave' || (!record && leave)) {
      const unpaid = leave?.leaveType === 'Unpaid Leave';
      kind = unpaid ? 'Unpaid Leave' : 'Paid Leave';
      if (unpaid) {
        dayFraction = leave?.isHalfDay ? 0.5 : 1;
        deduction = rates.daily * dayFraction;
        earned = 0;
      } else {
        deduction = 0;
        earned = rates.daily;
      }
    } else if (record?.status === 'Absent' || hasAttendanceData) {
      kind = 'Absent';
      dayFraction = 1;
      deduction = rates.daily;
      earned = 0;
    } else {
      kind = 'Present'; // attendance not tracked this month
      earned = rates.daily;
      deduction = 0;
    }

    if (kind === 'Present') totals.presentDays += 1;
    if (kind === 'Half Day') { totals.halfDays += 1; totals.absentDays += 0.5; }
    if (kind === 'Paid Leave') totals.paidLeaveDays += 1;
    if (kind === 'Unpaid Leave') totals.unpaidLeaveDays += dayFraction;
    if (kind === 'Absent') totals.absentDays += 1;
    totals.lateMinutes += shortTime.late;
    totals.earlyLeaveMinutes += shortTime.early;
    totals.extraLunchMinutes += shortTime.extraLunch;
    totals.shortMinutes += shortTime.total;
    totals.overtimeMinutes += overtimeMinutes;
    totals.earnedToDate += earned;

    days.push({
      date,
      isWorkingDay,
      record,
      kind,
      shortTime,
      workedMinutes: worked,
      overtimeMinutes,
      deduction,
      earned,
    });
  }

  const shortMinutes = totals.shortMinutes;
  const absentDeduction = Math.round(rates.daily * totals.absentDays);
  const unpaidLeaveDeduction = Math.round(rates.daily * totals.unpaidLeaveDays);
  const shortTimeDeduction = Math.round(rates.perMinute * shortMinutes);
  const overtimePay = Math.round(rates.perMinute * totals.overtimeMinutes);

  return {
    month,
    salary: rawSalary,
    dailySalary: rawDaily,
    workingHours,
    workingDays: workingDaysCount,
    rates,
    countedUntil,
    hasAttendanceData,
    ...totals,
    absentDeduction,
    unpaidLeaveDeduction,
    shortTimeDeduction,
    overtimePay,
    earnedToDate: Math.round(totals.earnedToDate),
    days,
  };
}

/** ₹ with paise for small per-hour / per-minute rates, whole rupees otherwise. */
export function formatRate(n: number): string {
  const digits = n < 100 ? 2 : 0;
  return '₹' + round2(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
