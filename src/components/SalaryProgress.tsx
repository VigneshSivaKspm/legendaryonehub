import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee, type ProjectTask } from '../db/database';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addPayrollAdjustment, adjustmentsFor, sumAdjustments } from '../services/payrollAdjustmentService';
import { computeMonthPay, formatRate, PAID_DAY_MINUTES, type DayPay } from '../utils/salary';
import {
  formatTime12h,
  formatLunch,
  formatDuration,
  workedMinutes,
  isCheckedIn,
  isDueOn,
  isTaskDone,
  toHHMM,
  toLocalDate,
} from '../utils/attendanceTimes';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const kindBadge: Record<DayPay['kind'], string> = {
  Present: 'badge-green',
  'Half Day': 'badge-cyan',
  'Paid Leave': 'badge-purple',
  'Unpaid Leave': 'badge-amber',
  Absent: 'badge-red',
  Upcoming: 'badge-gray',
  Off: 'badge-gray',
};
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;
const ADDITIONS = ['Incentive', 'Performance Bonus', 'Overtime', 'Festival Bonus', 'Travel Allowance', 'Food Allowance', 'Other'];
const DEDUCTIONS = ['Salary Advance', 'Loan Repayment', 'Late Penalty', 'Other'];

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="stat-card" style={{ flex: '1 1 150px' }}>
      <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#697586', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const isMine = (t: ProjectTask, emp: Employee) =>
  (t.assignedToId !== undefined && String(t.assignedToId) === String(emp.id)) ||
  (!!emp.name && (t.assignedTo === emp.name || t.assignee === emp.name));

/**
 * Admin view of every employee's pay: rates (day / hour / minute), deductions so far, incentives,
 * and a day-by-day log of attendance, short time, earnings and task progress.
 */
export default function SalaryProgress({ selectedMonth }: { selectedMonth: string }) {
  const { companyProfile, user } = useAuth();
  const { showToast } = useToast();
  const workingWeekdays = companyProfile?.workingDays;
  const today = toLocalDate(new Date());
  const now = toHHMM(new Date());

  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const attendance = useLiveQuery(() => db.attendance.toArray(), []) || [];
  const leaves = useLiveQuery(() => db.leaveRequests.toArray(), []) || [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const payroll = useLiveQuery(() => db.payroll.toArray(), []) || [];
  const adjustments = useLiveQuery(() => db.payrollAdjustments.toArray(), []) || [];

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );
  const [selectedId, setSelectedId] = useState('');
  const emp = activeEmployees.find((e) => String(e.id) === selectedId) || activeEmployees[0];

  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addForm, setAddForm] = useState({ type: 'Allowance' as 'Allowance' | 'Deduction', component: 'Incentive', amount: '', notes: '' });

  const payFor = (e: Employee, month: string) =>
    computeMonthPay({
      month,
      salary: Number(e.salary) || 0,
      workingWeekdays,
      attendance: attendance.filter((a) => String(a.employeeId) === String(e.id)),
      leaves: leaves.filter((l) => String(l.employeeId) === String(e.id)),
      today,
    });

  // Today across the team
  const teamToday = useMemo(
    () =>
      activeEmployees.map((e) => {
        const pay = payFor(e, today.slice(0, 7));
        const day = pay.days.find((d) => d.date === today);
        const rec = attendance.find((a) => String(a.employeeId) === String(e.id) && a.date === today);
        const due = tasks.filter((t) => isMine(t, e) && isDueOn(t, today));
        return {
          emp: e,
          rec,
          day,
          rates: pay.rates,
          worked: rec && isCheckedIn(rec) ? workedMinutes(rec, rec.checkOut ? undefined : now) : null,
          tasksDone: due.filter(isTaskDone).length,
          tasksTotal: due.length,
          avgProgress: due.length ? Math.round(due.reduce((s, t) => s + (isTaskDone(t) ? 100 : Number(t.progress) || 0), 0) / due.length) : null,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeEmployees, attendance, leaves, tasks, today, now, workingWeekdays]
  );

  if (activeEmployees.length === 0 || !emp) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: '#697586' }}>
        Add employees with a monthly salary to see salary details and daily progress.
      </div>
    );
  }

  const pay = payFor(emp, selectedMonth);
  const empTasks = tasks.filter((t) => isMine(t, emp));
  const empAdjustments = adjustmentsFor(adjustments, emp.id!, selectedMonth);
  const adjTotals = sumAdjustments(empAdjustments);
  const payrollRec = payroll.find((p) => String(p.employeeId) === String(emp.id) && p.month === selectedMonth);
  const bonus = Number(payrollRec?.bonus) || 0;
  const overtime = Number(payrollRec?.overtime) || 0;
  const attendanceDeductions = pay.absentDeduction + pay.unpaidLeaveDeduction + pay.shortTimeDeduction;
  const projectedNet = Math.max(0, pay.salary + adjTotals.allowances + bonus + overtime - attendanceDeductions - adjTotals.deductions);
  const shownDays = pay.days.filter((d) => d.kind !== 'Upcoming' && (d.isWorkingDay || d.record)).reverse();
  const todayTasks = empTasks.filter((t) => isDueOn(t, today));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(addForm.amount);
    if (!amount || amount <= 0) {
      showToast('Enter an amount greater than 0.', 'error');
      return;
    }
    setBusy(true);
    try {
      await addPayrollAdjustment({
        employeeId: emp.id!,
        employeeName: emp.name,
        type: addForm.type,
        component: addForm.component,
        amount,
        month: selectedMonth,
        recurring: false,
        notes: [addForm.notes.trim(), `Added by ${user?.name || user?.email || 'admin'}`].filter(Boolean).join(' · '),
      });
      showToast(`${addForm.component} of ${inr(amount)} ${addForm.type === 'Allowance' ? 'added for' : 'deducted from'} ${emp.name}. Regenerate payroll to apply it.`, 'success');
      setShowAdd(false);
      setAddForm({ type: 'Allowance', component: 'Incentive', amount: '', notes: '' });
    } catch (err: any) {
      showToast(err?.message || 'Could not save.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* Team today */}
      <div className="card" style={{ marginBottom: 20, overflowX: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
          Today's progress · {dayLabel(today)}
          <span style={{ fontWeight: 500, fontSize: 12, color: '#697586' }}> · click an employee for full salary details</span>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>EMPLOYEE</th>
              <th>STATUS</th>
              <th>CHECK-IN</th>
              <th>LUNCH</th>
              <th>CHECK-OUT</th>
              <th>WORKED</th>
              <th>SHORT TIME</th>
              <th style={{ textAlign: 'right' }}>EARNED TODAY</th>
              <th>TASKS DUE TODAY</th>
            </tr>
          </thead>
          <tbody>
            {teamToday.map((r) => {
              const live = r.day?.kind === 'Present' && r.rec && !r.rec.checkOut;
              // While still at work, earnings so far = minutes worked × per-minute rate (capped at a full day)
              const earned = live && r.worked != null ? Math.min(r.worked, PAID_DAY_MINUTES) * r.rates.perMinute : r.day?.earned || 0;
              return (
                <tr
                  key={r.emp.id}
                  style={{ cursor: 'pointer', background: String(r.emp.id) === String(emp.id) ? '#EEF4FF' : undefined }}
                  onClick={() => setSelectedId(String(r.emp.id))}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.emp.name}</div>
                    <div style={{ fontSize: 11.5, color: '#697586' }}>{r.emp.role}</div>
                  </td>
                  <td>
                    {r.rec ? (
                      <span className={`badge ${r.rec.status === 'Absent' ? 'badge-red' : r.rec.status === 'Late' ? 'badge-amber' : 'badge-green'}`}>{r.rec.status}</span>
                    ) : r.day?.kind === 'Off' ? (
                      <span className="badge badge-gray">Weekly off</span>
                    ) : (
                      <span className="badge badge-gray">Not checked in</span>
                    )}
                  </td>
                  <td>{formatTime12h(r.rec?.checkIn)}</td>
                  <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.rec ? formatLunch(r.rec) : '—'}</td>
                  <td>{formatTime12h(r.rec?.checkOut)}</td>
                  <td style={{ fontWeight: 600 }}>{formatDuration(r.worked)}</td>
                  <td style={{ color: r.day?.shortTime.total ? '#EF4444' : '#697586' }}>{r.day?.shortTime.total ? `${r.day.shortTime.total} min` : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A' }}>
                    {r.day?.isWorkingDay ? inr(earned) : '—'}
                    {live && <div style={{ fontSize: 10.5, color: '#697586', fontWeight: 500 }}>so far</div>}
                  </td>
                  <td style={{ minWidth: 140 }}>
                    {r.tasksTotal === 0 ? (
                      <span style={{ color: '#94A3B8', fontSize: 12 }}>None due</span>
                    ) : (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          {r.tasksDone}/{r.tasksTotal} done · {r.avgProgress}%
                        </div>
                        <div style={{ height: 5, background: '#E5E9F2', borderRadius: 3, marginTop: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${r.avgProgress}%`, height: '100%', background: r.tasksDone === r.tasksTotal ? '#12B76A' : '#3B5BDB' }} />
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Employee salary details */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select className="select-base" value={String(emp.id)} onChange={(e) => setSelectedId(e.target.value)} style={{ fontSize: 13, minWidth: 220 }}>
            {activeEmployees.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name} ({e.employeeId})
              </option>
            ))}
          </select>
          <span style={{ fontSize: 13, color: '#697586' }}>
            {emp.role} · {monthLabel(selectedMonth)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => { setAddForm({ type: 'Allowance', component: 'Incentive', amount: '', notes: '' }); setShowAdd(true); }}>
            + Add Incentive / Bonus
          </button>
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => { setAddForm({ type: 'Deduction', component: 'Salary Advance', amount: '', notes: '' }); setShowAdd(true); }}>
            + Add Deduction
          </button>
        </div>
      </div>

      {/* Rates */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Card label="Monthly Salary" value={inr(pay.salary)} sub="Fixed" />
        <Card label="Working Days" value={String(pay.workingDays)} sub={(workingWeekdays?.length ? workingWeekdays : ['Mon–Fri']).map((d) => d.slice(0, 3)).join(', ')} />
        <Card label="Per Day" value={formatRate(pay.rates.daily)} sub="9 paid hours (lunch paid)" color="#3B5BDB" />
        <Card label="Per Hour" value={formatRate(pay.rates.hourly)} color="#3B5BDB" />
        <Card label="Per Minute" value={formatRate(pay.rates.perMinute)} color="#3B5BDB" />
      </div>

      {/* Month so far */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10, color: '#1A1F36' }}>Attendance this month</div>
          {[
            ['Present days', `${pay.presentDays}${pay.halfDays ? ` + ${pay.halfDays} half` : ''}`],
            ['Paid leave', `${pay.paidLeaveDays} d`],
            ['Unpaid leave', `${pay.unpaidLeaveDays} d`],
            ['Absent', `${pay.absentDays} d`],
            ['Late arrival', `${pay.lateMinutes} min`],
            ['Early leave', `${pay.earlyLeaveMinutes} min`],
            ['Lunch over 1 hour', `${pay.extraLunchMinutes} min`],
            ['Hours worked', formatDuration(pay.workedMinutes)],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px dashed #E5E9F2' }}>
              <span style={{ color: '#475569' }}>{k}</span>
              <span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: '#697586', marginTop: 8 }}>Counted up to {dayLabel(pay.countedUntil)}.</div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10, color: '#1A1F36' }}>Salary breakdown</div>
          {(
            [
              ['Monthly salary', pay.salary, '#1A1F36'],
              ...empAdjustments.filter((a) => a.type === 'Allowance').map((a) => [`+ ${a.component}`, a.amount, '#12B76A']),
              ...(bonus ? [['+ Bonus / Incentive', bonus, '#12B76A']] : []),
              ...(overtime ? [['+ Overtime', overtime, '#12B76A']] : []),
              [`− Absent (${pay.absentDays} d)`, -pay.absentDeduction, '#EF4444'],
              [`− Unpaid leave (${pay.unpaidLeaveDays} d)`, -pay.unpaidLeaveDeduction, '#EF4444'],
              [`− Short time (${pay.shortMinutes} min × ${formatRate(pay.rates.perMinute)})`, -pay.shortTimeDeduction, '#EF4444'],
              ...empAdjustments.filter((a) => a.type === 'Deduction').map((a) => [`− ${a.component}`, -a.amount, '#EF4444']),
            ] as [string, number, string][]
          ).map(([k, v, c]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px dashed #E5E9F2' }}>
              <span style={{ color: '#475569' }}>{k}</span>
              <span style={{ fontWeight: 600, color: c }}>{v < 0 ? `−${inr(-v)}` : inr(v)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, background: '#ECFDF5', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ fontWeight: 700, color: '#065F46' }}>Net payable so far</span>
            <span style={{ fontWeight: 800, color: '#059669' }}>{inr(projectedNet)}</span>
          </div>
          <div style={{ fontSize: 11, color: '#697586', marginTop: 6 }}>
            {payrollRec ? `Payroll record: ${payrollRec.status}, net ${inr(payrollRec.netSalary)}. ` : 'Payroll not generated yet for this month. '}
            Generate payroll in the Payroll Register to lock these numbers.
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10, color: '#1A1F36' }}>Today's tasks</div>
          {todayTasks.length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#697586' }}>No tasks due today.</div>
          ) : (
            todayTasks.map((t) => {
              const pct = isTaskDone(t) ? 100 : Number(t.progress) || 0;
              return (
                <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px dashed #E5E9F2' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600 }}>{t.title || t.task}</span>
                    <span style={{ fontWeight: 700, color: isTaskDone(t) ? '#12B76A' : '#3B5BDB' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 5, background: '#E5E9F2', borderRadius: 3, margin: '4px 0', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: isTaskDone(t) ? '#12B76A' : '#3B5BDB' }} />
                  </div>
                  {!isTaskDone(t) && t.delayReason && <div style={{ fontSize: 11.5, color: '#B45309' }}>{t.delayReason}</div>}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Daily log */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
          Daily progress · {emp.name} · {monthLabel(selectedMonth)}
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>DATE</th>
              <th>DAY COUNTS AS</th>
              <th>CHECK-IN</th>
              <th>LUNCH</th>
              <th>CHECK-OUT</th>
              <th>WORKED</th>
              <th>LATE</th>
              <th>EARLY</th>
              <th>EXTRA LUNCH</th>
              <th style={{ textAlign: 'right' }}>DEDUCTED</th>
              <th style={{ textAlign: 'right' }}>EARNED</th>
              <th>TASKS DUE</th>
            </tr>
          </thead>
          <tbody>
            {shownDays.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                  No days to show for {monthLabel(selectedMonth)} yet.
                </td>
              </tr>
            ) : (
              shownDays.map((d) => {
                const due = empTasks.filter((t) => isDueOn(t, d.date));
                const done = due.filter(isTaskDone).length;
                const avg = due.length ? Math.round(due.reduce((s, t) => s + (isTaskDone(t) ? 100 : Number(t.progress) || 0), 0) / due.length) : 0;
                const mins = (n: number) => (n ? <span style={{ color: '#EF4444', fontWeight: 600 }}>{n}m</span> : '—');
                return (
                  <tr key={d.date} style={{ opacity: d.isWorkingDay ? 1 : 0.6 }}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{dayLabel(d.date)}</td>
                    <td>
                      <span className={`badge ${kindBadge[d.kind]}`}>{d.kind === 'Off' ? 'Weekly off' : d.kind}</span>
                    </td>
                    <td>{formatTime12h(d.record?.checkIn)}</td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{d.record ? formatLunch(d.record) : '—'}</td>
                    <td>{formatTime12h(d.record?.checkOut)}</td>
                    <td style={{ fontWeight: 600 }}>{formatDuration(d.workedMinutes)}</td>
                    <td>{mins(d.shortTime.late)}</td>
                    <td>{mins(d.shortTime.early)}</td>
                    <td>{mins(d.shortTime.extraLunch)}</td>
                    <td style={{ textAlign: 'right', color: d.deduction ? '#EF4444' : '#697586', fontWeight: d.deduction ? 600 : 400 }}>
                      {d.deduction ? `−${formatRate(d.deduction)}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A' }}>{d.isWorkingDay ? formatRate(d.earned) : '—'}</td>
                    <td style={{ fontSize: 12 }}>{due.length ? `${done}/${due.length} done · ${avg}%` : '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add incentive / deduction */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => !busy && setShowAdd(false)}>
          <div className="modal-box" style={{ width: 440, maxWidth: '100%', padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36', marginBottom: 2 }}>
              {addForm.type === 'Allowance' ? 'Add Incentive / Bonus' : 'Add Deduction'}
            </div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 16 }}>
              {emp.name} · {monthLabel(selectedMonth)}
            </div>
            <form onSubmit={handleAdd}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={addForm.type}
                    onChange={(e) => {
                      const type = e.target.value as 'Allowance' | 'Deduction';
                      setAddForm({ ...addForm, type, component: type === 'Allowance' ? ADDITIONS[0] : DEDUCTIONS[0] });
                    }}
                  >
                    <option value="Allowance">Addition (+)</option>
                    <option value="Deduction">Deduction (−)</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>For</label>
                  <select className="select-base" style={{ width: '100%' }} value={addForm.component} onChange={(e) => setAddForm({ ...addForm, component: e.target.value })}>
                    {(addForm.type === 'Allowance' ? ADDITIONS : DEDUCTIONS).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Amount (₹) *</label>
                  <input className="input-base" type="number" min="1" style={{ width: '100%' }} value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} autoFocus />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Note</label>
                  <input className="input-base" style={{ width: '100%' }} placeholder="e.g. Delivered the client project early" value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} />
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 10 }}>
                Applies to {monthLabel(selectedMonth)} only. Recurring items can be set up in the Incentives, Allowances &amp; Deductions tab.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
