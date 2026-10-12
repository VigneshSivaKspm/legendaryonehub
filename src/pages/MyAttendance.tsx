import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AttendanceApproval, type AttendanceRecord } from '../db/database';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addAttendance, updateAttendance } from '../services/attendanceService';
import { useAttendancePolicy, assertOnOfficeNetwork, getTrustedNow } from '../services/attendancePolicyService';
import AttendanceRequestBadges from '../components/AttendanceRequestBadges';
import {
  WORK_START,
  WORK_END,
  LUNCH_MAX_MINUTES,
  REQUEST_KINDS,
  REQUEST_LABELS,
  formatTime12h,
  formatLunch,
  formatDuration,
  lunchMinutes,
  workedMinutes,
  minutesOf,
  addMinutes,
  toHHMM,
  toLocalDate,
  overtimeFor,
  isCheckedIn,
  checkOutBlockers,
  isDueOn,
  isTaskDone,
  statusHasTimes,
  type RequestKind,
} from '../utils/attendanceTimes';

const statusBadge: Record<string, string> = {
  Present: 'badge-green',
  Absent: 'badge-red',
  'On Leave': 'badge-purple',
  Late: 'badge-amber',
  'Half Day': 'badge-cyan',
};
const requestColor = { Pending: '#B54708', Approved: '#12B76A', Rejected: '#EF4444' } as const;
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(date + 'T00:00:00').toLocaleDateString('en-IN', opts);

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="stat-card" style={{ flex: '1 1 150px' }}>
      <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#697586', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** One request (late check-in / long lunch / check-out) with everything the employee and admin wrote. */
function RequestDetail({ kind, r }: { kind: RequestKind; r: AttendanceApproval }) {
  return (
    <div style={{ border: '1px solid #E5E9F2', borderLeft: `3px solid ${requestColor[r.status]}`, borderRadius: 8, padding: '8px 12px', background: '#fff' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1F36' }}>
        {REQUEST_LABELS[kind]} · <span style={{ color: requestColor[r.status] }}>{r.status === 'Pending' ? 'Waiting for approval' : r.status}</span>
        <span style={{ fontWeight: 500, color: '#697586' }}> · {formatTime12h(r.time)}</span>
      </div>
      {r.reasons.map((x) => (
        <div key={x} style={{ fontSize: 12, color: '#475569' }}>
          • {x}
        </div>
      ))}
      {r.note && <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>Your reason: {r.note}</div>}
      {r.status !== 'Pending' && (
        <div style={{ fontSize: 12, color: '#697586', marginTop: 2 }}>
          {r.decidedBy ? `By ${r.decidedBy}` : ''}
          {r.adminRemarks ? ` · "${r.adminRemarks}"` : ''}
        </div>
      )}
    </div>
  );
}

/** Employee's own attendance: today's check-in / lunch / check-out with the office rules, plus the full monthly log. */
export default function MyAttendance({ onOpenTodayTasks }: { onOpenTodayTasks?: () => void }) {
  const { user, myEmployee } = useAuth();
  const { showToast } = useToast();
  const { policy } = useAttendancePolicy();
  const [month, setMonth] = useState(toLocalDate(new Date()).slice(0, 7));
  const [busy, setBusy] = useState(false);
  // A self-service action that broke an attendance rule and needs a reason before going to the admin
  const [request, setRequest] = useState<{ kind: RequestKind; date: string; time: string; reasons: string[] } | null>(null);
  const [requestNote, setRequestNote] = useState('');
  // Tasks due today that still need a "completed" or progress update before check-out
  const [tasksToUpdate, setTasksToUpdate] = useState<string[]>([]);
  // Re-render every 30s so "worked today" stays live
  const [clock, setClock] = useState(toHHMM(new Date()));
  useEffect(() => {
    const t = setInterval(() => setClock(toHHMM(new Date())), 30000);
    return () => clearInterval(t);
  }, []);

  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const attendance = useLiveQuery(() => db.attendance.toArray(), []) || [];

  const empId = myEmployee?.id !== undefined ? String(myEmployee.id) : '';
  const empName = myEmployee?.name || '';
  const myTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.assignedToId !== undefined && String(t.assignedToId) === empId) ||
          (!!empName && (t.assignedTo === empName || t.assignee === empName))
      ),
    [tasks, empId, empName]
  );
  const myAttendance = useMemo(
    () => attendance.filter((a) => String(a.employeeId) === empId).sort((a, b) => b.date.localeCompare(a.date)),
    [attendance, empId]
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
            Ask your administrator to add you in <strong>Employees</strong> with the email <strong>{user?.email}</strong>.
          </div>
        </div>
      </div>
    );
  }

  const today = toLocalDate(new Date());
  const todayRecord = myAttendance.find((a) => a.date === today);
  const checkedIn = isCheckedIn(todayRecord);
  const canAct = checkedIn && !todayRecord?.checkOut;
  const onLunch = canAct && !!todayRecord?.lunchOut && !todayRecord?.lunchIn;
  const checkOutPending = todayRecord?.checkOutRequest?.status === 'Pending';
  const workedToday = todayRecord && checkedIn ? workedMinutes(todayRecord, canAct ? clock : undefined) : null;

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
      const dueToday = myTasks.filter((t) => isDueOn(t, at.date));
      const notUpdated = dueToday.filter((t) => !isTaskDone(t) && t.progressUpdatedOn !== at.date);
      setTasksToUpdate(notUpdated.map((t) => t.title || t.task || 'Untitled task'));
      if (notUpdated.length > 0) {
        showToast("Before checking out, update today's tasks (mark completed, or give % done and a reason).", 'error');
        return;
      }
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

  // ---------- month summary ----------
  const monthRecords = myAttendance.filter((a) => a.date.startsWith(month));
  const count = (s: AttendanceRecord['status']) => monthRecords.filter((a) => a.status === s).length;
  const daysPresent = count('Present') + count('Late') + count('Half Day') * 0.5;
  const worked = monthRecords.map((a) => (isCheckedIn(a) && a.checkOut ? workedMinutes(a) : null)).filter((m): m is number => m != null);
  const totalWorked = worked.reduce((s, m) => s + m, 0);
  const overtime = monthRecords.reduce((s, a) => s + (Number(a.overtimeHours) || 0), 0);
  const checkIns = monthRecords.filter((a) => isCheckedIn(a)).map((a) => minutesOf(a.checkIn));
  const avgCheckIn = checkIns.length ? addMinutes('00:00', Math.round(checkIns.reduce((s, m) => s + m, 0) / checkIns.length)) : '';
  const longLunches = monthRecords.filter((a) => (lunchMinutes(a) || 0) > LUNCH_MAX_MINUTES).length;
  const pendingCount = monthRecords.reduce((n, a) => n + REQUEST_KINDS.filter((k) => a[k]?.status === 'Pending').length, 0);

  // ---------- today timeline ----------
  const steps: { label: string; time?: string; hint?: string }[] = [
    { label: 'Check In', time: todayRecord?.checkIn, hint: `by ${formatTime12h(WORK_START)}` },
    { label: 'Lunch Out', time: todayRecord?.lunchOut },
    {
      label: 'Lunch In',
      time: todayRecord?.lunchIn,
      hint: todayRecord?.lunchOut && !todayRecord.lunchIn ? `back by ${formatTime12h(addMinutes(todayRecord.lunchOut, LUNCH_MAX_MINUTES))}` : `within ${LUNCH_MAX_MINUTES} min`,
    },
    { label: 'Check Out', time: todayRecord?.checkOut, hint: `from ${formatTime12h(WORK_END)}` },
  ];
  const nextStep = steps.findIndex((s) => !s.time);
  const todayRequests = todayRecord ? REQUEST_KINDS.filter((k) => todayRecord[k]) : [];

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div className="page-title">My Attendance</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            {myEmployee.name} · {myEmployee.employeeId} · Working hours {formatTime12h(WORK_START)} – {formatTime12h(WORK_END)}
          </div>
        </div>
        {policy.requireOfficeNetwork && policy.networks.length > 0 && (
          <span className="badge badge-blue" style={{ fontSize: 12 }}>
            📶 Office WiFi required for check-in, lunch and check-out
          </span>
        )}
      </div>

      {/* Today */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36', display: 'flex', alignItems: 'center', gap: 8 }}>
              {dayLabel(today, { weekday: 'long', day: 'numeric', month: 'long' })}
              {todayRecord ? (
                <span className={`badge ${statusBadge[todayRecord.status] || 'badge-gray'}`}>{todayRecord.status}</span>
              ) : (
                <span className="badge badge-gray">Not checked in</span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Worked today</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 22, color: '#3B5BDB' }}>{formatDuration(workedToday)}</div>
            {todayRecord?.overtimeHours ? <div style={{ fontSize: 12, color: '#697586' }}>{todayRecord.overtimeHours}h overtime</div> : null}
          </div>
        </div>

        {/* Timeline */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
          {steps.map((s, i) => {
            const done = !!s.time;
            const current = i === nextStep && canAct;
            return (
              <div
                key={s.label}
                style={{
                  border: `1px solid ${done ? '#ABEFC6' : current ? '#B2CCFF' : '#E5E9F2'}`,
                  background: done ? '#ECFDF3' : current ? '#EEF4FF' : '#F8F9FC',
                  borderRadius: 10,
                  padding: '10px 14px',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                  {done ? '✓ ' : ''}
                  {s.label}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: done ? '#027A48' : '#94A3B8', fontFamily: 'Plus Jakarta Sans' }}>
                  {done ? formatTime12h(s.time) : '—'}
                </div>
                {s.hint && !done && <div style={{ fontSize: 11.5, color: '#697586' }}>{s.hint}</div>}
                {s.label === 'Lunch In' && done && todayRecord && (
                  <div style={{ fontSize: 11.5, color: (lunchMinutes(todayRecord) || 0) > LUNCH_MAX_MINUTES ? '#EF4444' : '#697586' }}>
                    {lunchMinutes(todayRecord)} min break
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!todayRecord && (
            <button className="btn-primary" disabled={busy} onClick={handleCheckIn}>
              {busy ? 'Checking…' : 'Check In'}
            </button>
          )}
          {canAct && !checkOutPending && !todayRecord?.lunchOut && (
            <button className="btn-secondary" disabled={busy} onClick={handleLunchOut}>
              Lunch Out
            </button>
          )}
          {onLunch && (
            <button className="btn-primary" disabled={busy} onClick={handleLunchIn}>
              Lunch In
            </button>
          )}
          {canAct && !onLunch && !checkOutPending && (
            <button className="btn-secondary" disabled={busy} onClick={handleCheckOut}>
              Check Out
            </button>
          )}
          {todayRecord?.checkInRequest?.status === 'Pending' && (
            <span style={{ fontSize: 12.5, color: '#B54708' }}>⏳ You'll be checked in once an admin approves your late check-in.</span>
          )}
          {checkOutPending && <span style={{ fontSize: 12.5, color: '#B54708' }}>⏳ Your check-out request is waiting for admin approval.</span>}
          {todayRecord?.checkOut && <span style={{ fontSize: 12.5, color: '#12B76A', fontWeight: 600 }}>Done for the day. See you tomorrow!</span>}
          {todayRecord && !statusHasTimes(todayRecord.status) && (
            <span style={{ fontSize: 12.5, color: '#697586' }}>Marked {todayRecord.status} for today by the admin.</span>
          )}
        </div>

        {tasksToUpdate.length > 0 && canAct && (
          <div style={{ marginTop: 14, background: '#FFFAEB', border: '1px solid #FEDF89', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, color: '#B54708' }}>
              Update these tasks before checking out: <strong>{tasksToUpdate.join(', ')}</strong>
            </div>
            {onOpenTodayTasks && (
              <button className="btn-primary" style={{ fontSize: 12 }} onClick={onOpenTodayTasks}>
                Open Today's Tasks
              </button>
            )}
          </div>
        )}

        {todayRequests.length > 0 && todayRecord && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            {todayRequests.map((k) => (
              <RequestDetail key={k} kind={k} r={todayRecord[k]!} />
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 12, color: '#697586', lineHeight: 1.6 }}>
          Check in by {formatTime12h(WORK_START)}; a later check-in needs admin approval. Lunch break is up to {LUNCH_MAX_MINUTES} minutes.
          Check out from {formatTime12h(WORK_END)} once today's tasks are completed, otherwise send a check-out request. Time after{' '}
          {formatTime12h(WORK_END)} is recorded as overtime.
        </div>
      </div>

      {/* Month summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>{monthLabel(month)}</div>
        <input className="input-base" type="month" style={{ width: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <Stat label="Days Present" value={String(daysPresent)} color="#12B76A" sub={`${monthRecords.length} day(s) recorded`} />
        <Stat label="Late" value={String(count('Late'))} color="#F59E0B" />
        <Stat label="Half Day" value={String(count('Half Day'))} color="#0EA5E9" />
        <Stat label="On Leave" value={String(count('On Leave'))} color="#8B5CF6" />
        <Stat label="Absent" value={String(count('Absent'))} color="#EF4444" />
        <Stat label="Hours Worked" value={formatDuration(totalWorked)} color="#3B5BDB" sub={worked.length ? `avg ${formatDuration(totalWorked / worked.length)}/day` : undefined} />
        <Stat label="Overtime" value={`${overtime}h`} color="#3B5BDB" />
        <Stat label="Avg Check-In" value={avgCheckIn ? formatTime12h(avgCheckIn) : '—'} sub={longLunches ? `${longLunches} long lunch(es)` : undefined} />
        {pendingCount > 0 && <Stat label="Awaiting Approval" value={String(pendingCount)} color="#B54708" />}
      </div>

      {/* Daily log */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table-base">
          <thead>
            <tr>
              <th>DATE</th>
              <th>STATUS</th>
              <th>CHECK-IN</th>
              <th>LUNCH</th>
              <th>CHECK-OUT</th>
              <th>WORKED</th>
              <th>OVERTIME</th>
              <th>APPROVALS & NOTES</th>
            </tr>
          </thead>
          <tbody>
            {monthRecords.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                  No attendance recorded for {monthLabel(month)}.
                </td>
              </tr>
            ) : (
              monthRecords.map((a) => {
                const kinds = REQUEST_KINDS.filter((k) => a[k]);
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{dayLabel(a.date)}</td>
                    <td>
                      <span className={`badge ${statusBadge[a.status] || 'badge-gray'}`}>{a.status}</span>
                      <AttendanceRequestBadges rec={a} />
                    </td>
                    <td style={{ color: a.checkInRequest ? '#B54708' : undefined }}>{formatTime12h(a.checkIn)}</td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap', color: (lunchMinutes(a) || 0) > LUNCH_MAX_MINUTES ? '#EF4444' : undefined }}>
                      {formatLunch(a)}
                    </td>
                    <td>{formatTime12h(a.checkOut)}</td>
                    <td style={{ fontWeight: 600 }}>{formatDuration(isCheckedIn(a) && a.checkOut ? workedMinutes(a) : null)}</td>
                    <td>{a.overtimeHours ? `${a.overtimeHours}h` : '—'}</td>
                    <td style={{ fontSize: 12, color: '#475569', maxWidth: 340 }}>
                      {kinds.map((k) => {
                        const r = a[k]!;
                        return (
                          <div key={k} style={{ marginBottom: 3 }}>
                            <strong>{REQUEST_LABELS[k]}</strong>: <span style={{ color: requestColor[r.status] }}>{r.status}</span>
                            {r.note ? ` · You: ${r.note}` : ''}
                            {r.adminRemarks ? ` · Admin: ${r.adminRemarks}` : ''}
                          </div>
                        );
                      })}
                      {a.notes && <div style={{ color: '#697586' }}>{a.notes}</div>}
                      {kinds.length === 0 && !a.notes && '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Approval request modal */}
      {request && (
        <div className="modal-overlay" onClick={() => !busy && setRequest(null)}>
          <div className="modal-box" style={{ width: 480, maxWidth: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36', marginBottom: 4 }}>
              {REQUEST_LABELS[request.kind]} needs approval
            </div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 14 }}>
              {request.kind === 'checkInRequest'
                ? 'You will be checked in once an admin approves.'
                : request.kind === 'lunchRequest'
                ? 'Your return is recorded; an admin will review the extra time.'
                : 'You will be checked out once an admin approves.'}
            </div>
            <div style={{ background: '#FFFAEB', border: '1px solid #FEDF89', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
              {request.reasons.map((r) => (
                <div key={r} style={{ fontSize: 12.5, color: '#B54708', padding: '2px 0' }}>
                  • {r}
                </div>
              ))}
            </div>
            <form onSubmit={handleSubmitRequest}>
              <label style={labelStyle}>Reason for the admin *</label>
              <textarea
                className="input-base"
                rows={3}
                autoFocus
                style={{ width: '100%' }}
                placeholder="e.g. Stuck in traffic / Client call ran long / Will finish the task tomorrow morning"
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setRequest(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Sending...' : 'Send for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
