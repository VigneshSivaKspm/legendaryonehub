import type { AttendanceApproval, AttendanceRecord, ProjectTask } from '../db/database';

type Status = AttendanceRecord['status'];

/** Standard working hours: 9 AM – 6 PM. A half day is worked 2 PM – 6 PM. */
export const WORK_START = '09:00';
export const WORK_END = '18:00';
export const HALF_DAY_START = '14:00';
export const STANDARD_DAY_HOURS = 9;
/** Longest lunch break allowed without admin approval */
export const LUNCH_MAX_MINUTES = 60;

export const REQUEST_KINDS = ['checkInRequest', 'lunchRequest', 'checkOutRequest'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_LABELS: Record<RequestKind, string> = {
  checkInRequest: 'Late Check-In',
  lunchRequest: 'Long Lunch Break',
  checkOutRequest: 'Check-Out',
};

export function minutesOf(hhmm?: string): number {
  const [h, m] = (hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Time after the 6 PM end of day counts as overtime, in half-hour steps. */
export function overtimeFor(checkOut: string): number {
  const extraMin = Math.max(0, minutesOf(checkOut) - minutesOf(WORK_END));
  return Math.floor(extraMin / 30) / 2;
}

export function lunchMinutes(rec: Pick<AttendanceRecord, 'lunchOut' | 'lunchIn'>): number | null {
  if (!rec.lunchOut || !rec.lunchIn) return null;
  return Math.max(0, minutesOf(rec.lunchIn) - minutesOf(rec.lunchOut));
}

/** "1:00 PM – 1:45 PM (45m)", or "1:00 PM – on break" while still out. */
export function formatLunch(rec: Pick<AttendanceRecord, 'lunchOut' | 'lunchIn'>): string {
  if (!rec.lunchOut) return '—';
  if (!rec.lunchIn) return `${formatTime12h(rec.lunchOut)} – on break`;
  return `${formatTime12h(rec.lunchOut)} – ${formatTime12h(rec.lunchIn)} (${lunchMinutes(rec)}m)`;
}

/** "HH:mm" plus some minutes, e.g. the latest time to be back from lunch. */
export function addMinutes(hhmm: string, mins: number): string {
  const total = (minutesOf(hhmm) + mins) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function pendingRequests(rec: AttendanceRecord): { kind: RequestKind; request: AttendanceApproval }[] {
  return REQUEST_KINDS.filter((k) => rec[k]?.status === 'Pending').map((k) => ({ kind: k, request: rec[k]! }));
}

/** Checked in for the day: has a check-in time that isn't still waiting on (or refused) approval. */
export function isCheckedIn(rec?: AttendanceRecord): boolean {
  if (!rec || !rec.checkIn || !statusHasTimes(rec.status)) return false;
  return !rec.checkInRequest || rec.checkInRequest.status === 'Approved';
}

export function isTaskDone(t: ProjectTask): boolean {
  return t.status === 'Completed' || t.status === 'Done';
}

/**
 * Rules for leaving without approval: it's 6 PM or later, the employee checked in by 9 AM,
 * and every task due today is completed. Returns the rules that are broken (empty = free to go).
 */
export function checkOutBlockers(rec: AttendanceRecord, now: string, tasksDueToday: ProjectTask[]): string[] {
  const reasons: string[] = [];
  if (minutesOf(now) < minutesOf(WORK_END)) reasons.push(`Checking out before ${formatTime12h(WORK_END)}`);
  if (rec.checkInRequest) reasons.push(`Checked in after ${formatTime12h(WORK_START)} (${formatTime12h(rec.checkIn)})`);
  const open = tasksDueToday.filter((t) => !isTaskDone(t));
  if (open.length > 0) {
    const names = open.map((t) => t.title || t.task || 'Untitled task').slice(0, 3).join(', ');
    reasons.push(`${open.length} task${open.length > 1 ? 's' : ''} due today not completed: ${names}${open.length > 3 ? '…' : ''}`);
  }
  return reasons;
}

/** Absent and On Leave days have no check-in / check-out time. */
export function statusHasTimes(status: Status): boolean {
  return status !== 'Absent' && status !== 'On Leave';
}

export function defaultTimesFor(status: Status): { checkIn: string; checkOut: string } {
  if (!statusHasTimes(status)) return { checkIn: '', checkOut: '' };
  if (status === 'Half Day') return { checkIn: HALF_DAY_START, checkOut: WORK_END };
  return { checkIn: WORK_START, checkOut: WORK_END };
}

/** Converts "HH:mm" to "h:mm AM/PM" for display; leaves anything else untouched. */
export function formatTime12h(value?: string): string {
  if (!value) return '—';
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return value;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** Normalises legacy free-text times ("09:30 AM") into the "HH:mm" a time input expects. */
export function toTimeInputValue(value?: string): string {
  if (!value) return '';
  const v = value.trim();
  if (/^\d{2}:\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(v);
  if (!m) return '';
  let h = Number(m[1]);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
