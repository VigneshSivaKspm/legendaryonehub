import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2, Pause, Play, Pencil, CalendarClock, X } from 'lucide-react';
import { db, type Project, type WorkSchedule } from '../db/database';
import { useToast } from '../context/ToastContext';
import { assignOngoingWork, saveSchedules, ensureScheduledTasks, describeSchedule, time12, type WorkLine } from '../services/ongoingWorkService';
import { itemTypesFor, SUB_SERVICES, SCHEDULE_WORK_TYPES } from '../utils/serviceCatalog';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 } as const;
const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CUSTOM = '__custom';

function useActiveEmployees() {
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  return useMemo(() => employees.filter((e) => e.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name)), [employees]);
}

// ---------------------------------------------------------------------------
// Assign work: each line = one employee task + a billing entry with its own price
// ---------------------------------------------------------------------------

interface LineForm {
  type: string;
  customType: string;
  details: string;
  qty: string;
  rate: string;
  employeeId: string;
  dueDate: string;
  priority: 'Low' | 'Medium' | 'High';
}

export function AssignWorkModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { showToast } = useToast();
  const employees = useActiveEmployees();
  const types = itemTypesFor(project);
  const blank = (type = types[0] || 'Item', employeeId = ''): LineForm => ({
    type,
    customType: '',
    details: '',
    qty: '1',
    rate: project.itemRates?.[type] ? String(project.itemRates[type]) : '',
    employeeId,
    dueDate: todayIso(),
    priority: 'Medium',
  });
  const [lines, setLines] = useState<LineForm[]>([blank()]);
  const [busy, setBusy] = useState(false);
  // Marketing projects mostly need regular posts, so they open on Daily Posts
  const [mode, setMode] = useState<'once' | 'daily'>(
    project.serviceName === 'Organic Marketing' || project.serviceName === 'Digital Marketing' || (project.schedules || []).length ? 'daily' : 'once'
  );

  const setLine = (i: number, patch: Partial<LineForm>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const typeOf = (l: LineForm) => (l.type === CUSTOM ? l.customType.trim() : l.type);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);

  const save = async () => {
    for (const [i, l] of lines.entries()) {
      if (!typeOf(l)) return showToast(`Item ${i + 1}: choose what to make.`, 'error');
      if (!(Number(l.qty) > 0)) return showToast(`Item ${i + 1}: enter a count.`, 'error');
      if (!l.employeeId) return showToast(`Item ${i + 1}: assign it to an employee.`, 'error');
      if (!l.dueDate) return showToast(`Item ${i + 1}: set a due date.`, 'error');
    }
    const work: WorkLine[] = lines.map((l) => {
      const emp = employees.find((e) => String(e.id) === l.employeeId)!;
      return {
        type: typeOf(l),
        details: l.details.trim(),
        qty: Number(l.qty),
        rate: Number(l.rate) || 0,
        employeeId: emp.id!,
        employeeName: emp.name,
        dueDate: l.dueDate,
        priority: l.priority,
      };
    });
    setBusy(true);
    try {
      const n = await assignOngoingWork(project, work);
      showToast(`${n} work item${n > 1 ? 's' : ''} assigned. Employees will see them in their tasks.`, 'success');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Could not assign the work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-box" style={{ width: 720, maxWidth: '100%', padding: 26, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
          <div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>Assign Work</div>
            <div style={{ fontSize: 12.5, color: '#697586' }}>
              {project.name} · {project.clientName}
            </div>
          </div>
          <button className="m-icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={20} />
          </button>
        </div>
        <div className="assign-mode" role="tablist">
          <button role="tab" aria-selected={mode === 'once'} className={mode === 'once' ? 'active' : ''} onClick={() => setMode('once')}>
            One-time work
            <span>Videos, posters, PDFs…</span>
          </button>
          <button role="tab" aria-selected={mode === 'daily'} className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'inherit', color: 'inherit', fontWeight: 'inherit' }}>
              <CalendarClock size={15} /> Daily posts (repeat)
            </span>
            <span>Morning & evening posts</span>
          </button>
        </div>

        {mode === 'daily' ? (
          <SchedulePanel project={project} />
        ) : (
        <>
        <div style={{ fontSize: 12, color: '#697586', margin: '0 0 14px' }}>
          Each item goes to the employee's tasks with the brief and count only (no prices). It's billed to the client when they mark it completed.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lines.map((l, i) => (
            <div key={i} className="assign-line">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#3B5BDB' }}>ITEM {i + 1}</span>
                {lines.length > 1 && (
                  <button className="btn-secondary" style={{ fontSize: 11.5, padding: '3px 8px', color: '#EF4444', borderColor: '#FCA5A5', minHeight: 0 }} onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
              <div className="assign-grid">
                <div>
                  <label style={labelStyle}>What to make *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={l.type}
                    onChange={(e) => {
                      const type = e.target.value;
                      setLine(i, { type, rate: type !== CUSTOM && project.itemRates?.[type] ? String(project.itemRates[type]) : l.rate });
                    }}
                  >
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value={CUSTOM}>Other…</option>
                  </select>
                  {l.type === CUSTOM && (
                    <input className="input-base" style={{ marginTop: 6 }} placeholder="e.g. Brochure, Logo, Reel" value={l.customType} onChange={(e) => setLine(i, { customType: e.target.value })} />
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Count *</label>
                  <input className="input-base" type="number" min="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Price each (₹)</label>
                  <input className="input-base" type="number" min="0" placeholder="0 = in retainer" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Brief / details for the employee</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="e.g. Diwali offer poster in Tamil & English, 1080×1080, use the new logo"
                    value={l.details}
                    onChange={(e) => setLine(i, { details: e.target.value })}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Assign to *</label>
                  <select className="select-base" style={{ width: '100%' }} value={l.employeeId} onChange={(e) => setLine(i, { employeeId: e.target.value })}>
                    <option value="">Select employee</option>
                    {employees.map((e) => (
                      <option key={e.id} value={String(e.id)}>
                        {e.name} · {e.role}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Due date *</label>
                  <input className="input-base" type="date" value={l.dueDate} onChange={(e) => setLine(i, { dueDate: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Priority</label>
                  <select className="select-base" style={{ width: '100%' }} value={l.priority} onChange={(e) => setLine(i, { priority: e.target.value as LineForm['priority'] })}>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12.5, color: '#475569', marginTop: 8 }}>
                Amount <strong style={{ color: '#1A1F36' }}>{inr((Number(l.qty) || 0) * (Number(l.rate) || 0))}</strong>
              </div>
            </div>
          ))}
        </div>

        <button
          className="btn-secondary"
          style={{ marginTop: 12, width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}
          onClick={() => setLines((p) => [...p, blank(types[0], p[p.length - 1]?.employeeId || '')])}
        >
          <Plus size={15} /> Add another item
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF0F5' }}>
          <div style={{ fontSize: 13, color: '#475569' }}>
            Total <strong style={{ fontSize: 17, color: '#1A1F36' }}>{inr(total)}</strong>
            <span style={{ fontSize: 11.5, color: '#697586' }}> · billed when completed</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Assigning…' : `Assign ${lines.length} item${lines.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Posting schedules: recurring daily work that becomes tasks automatically
// ---------------------------------------------------------------------------

interface ScheduleForm {
  id?: string;
  employeeId: string;
  workType: string;
  channels: string[];
  times: string[];
  newTime: string;
  days: string[];
  startDate: string;
  endDate: string;
  instructions: string;
  rate: string;
}

/** Posting schedules for a project: list + add/edit form. Used inside Assign Work and the Schedule dialog. */
export function SchedulePanel({ project }: { project: Project }) {
  const { showToast } = useToast();
  const employees = useActiveEmployees();
  const [list, setList] = useState<WorkSchedule[]>(project.schedules || []);
  const [busy, setBusy] = useState(false);

  const channelOptions =
    project.serviceName === 'Organic Marketing' && project.subServices?.length
      ? project.subServices
      : [...SUB_SERVICES['Organic Marketing'].options, 'YouTube', 'LinkedIn'];

  const newForm = (): ScheduleForm => ({
    employeeId: '',
    workType: 'Reel',
    channels: project.serviceName === 'Organic Marketing' ? [...(project.subServices || [])] : [],
    times: ['09:00', '18:00'],
    newTime: '',
    days: [...ALL_DAYS],
    startDate: todayIso(),
    endDate: '',
    instructions: '',
    rate: '',
  });
  const [form, setForm] = useState<ScheduleForm | null>(() => ((project.schedules || []).length ? null : newForm()));

  const persist = async (next: WorkSchedule[], message: string) => {
    setBusy(true);
    try {
      await saveSchedules(project, next);
      setList(next);
      const created = await ensureScheduledTasks();
      showToast(created ? `${message} ${created} task(s) created for today.` : message, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not save the schedule.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveForm = async () => {
    if (!form) return;
    const emp = employees.find((e) => String(e.id) === form.employeeId);
    if (!emp) return showToast('Choose the employee who will post.', 'error');
    if (!form.workType.trim()) return showToast('Choose what to post.', 'error');
    if (form.times.length === 0) return showToast('Add at least one time.', 'error');
    if (form.days.length === 0) return showToast('Pick at least one day.', 'error');
    const schedule: WorkSchedule = {
      id: form.id || `s${Date.now().toString(36)}`,
      employeeId: emp.id!,
      employeeName: emp.name,
      workType: form.workType.trim(),
      channels: form.channels,
      times: [...form.times].sort(),
      days: ALL_DAYS.filter((d) => form.days.includes(d)),
      startDate: form.startDate || todayIso(),
      ...(form.endDate ? { endDate: form.endDate } : {}),
      instructions: form.instructions.trim(),
      rate: Number(form.rate) || 0,
      active: true,
      createdAt: list.find((s) => s.id === form.id)?.createdAt || new Date().toISOString(),
    };
    const next = form.id ? list.map((s) => (s.id === form.id ? schedule : s)) : [...list, schedule];
    await persist(next, form.id ? 'Schedule updated.' : `Schedule added for ${emp.name}.`);
    setForm(null);
  };

  const toggleDay = (d: string) => form && setForm({ ...form, days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] });
  const toggleChannel = (c: string) =>
    form && setForm({ ...form, channels: form.channels.includes(c) ? form.channels.filter((x) => x !== c) : [...form.channels, c] });
  const addTime = () => {
    if (!form || !/^\d{2}:\d{2}$/.test(form.newTime) || form.times.includes(form.newTime)) return;
    setForm({ ...form, times: [...form.times, form.newTime].sort(), newTime: '' });
  };

  return (
    <div>
        <div style={{ fontSize: 12, color: '#697586', margin: '0 0 14px' }}>
          Regular posts, e.g. a reel every day at 9 AM and 6 PM. The employee automatically gets a task for every day and time, and marks each one
          completed.
        </div>

        {!form && (
          <>
            {list.length === 0 ? (
              <div className="ws-empty" style={{ marginBottom: 12 }}>
                <CalendarClock size={28} color="#98A2B3" />
                <div>No schedules yet.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                {list.map((s) => (
                  <div key={s.id} className="assign-line" style={{ opacity: s.active ? 1 : 0.6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
                          {s.employeeName} · {s.workType}
                          {!s.active && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Paused</span>}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>{describeSchedule(s)}</div>
                        <div style={{ fontSize: 12, color: '#697586', marginTop: 2 }}>
                          {s.channels.length ? s.channels.join(', ') : 'Any channel'}
                          {s.rate ? ` · ${inr(s.rate)} per post` : ' · in retainer'}
                          {s.endDate ? ` · until ${s.endDate}` : ''}
                        </div>
                        {s.instructions && <div style={{ fontSize: 12, color: '#697586', marginTop: 4, fontStyle: 'italic' }}>{s.instructions}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', minHeight: 0 }}
                          disabled={busy}
                          onClick={() => persist(list.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)), s.active ? 'Schedule paused.' : 'Schedule resumed.')}
                        >
                          {s.active ? <Pause size={12} /> : <Play size={12} />} {s.active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', minHeight: 0 }}
                          disabled={busy}
                          onClick={() =>
                            setForm({
                              id: s.id,
                              employeeId: String(s.employeeId),
                              workType: s.workType,
                              channels: s.channels,
                              times: s.times,
                              newTime: '',
                              days: s.days,
                              startDate: s.startDate,
                              endDate: s.endDate || '',
                              instructions: s.instructions || '',
                              rate: s.rate ? String(s.rate) : '',
                            })
                          }
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', minHeight: 0, color: '#EF4444', borderColor: '#FCA5A5' }}
                          disabled={busy}
                          onClick={() => persist(list.filter((x) => x.id !== s.id), 'Schedule removed. Tasks already created are kept.')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setForm(newForm())} disabled={busy}>
              <Plus size={15} /> Add posting schedule
            </button>
          </>
        )}

        {form && (
          <div className="assign-line">
            <div className="assign-grid">
              <div>
                <label style={labelStyle}>Employee *</label>
                <select className="select-base" style={{ width: '100%' }} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">Select employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={String(e.id)}>
                      {e.name} · {e.role}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>What to post *</label>
                <select className="select-base" style={{ width: '100%' }} value={form.workType} onChange={(e) => setForm({ ...form, workType: e.target.value })}>
                  {SCHEDULE_WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Price per post (₹)</label>
                <input className="input-base" type="number" min="0" placeholder="0 = in retainer" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Channels</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {channelOptions.map((c) => (
                    <button key={c} type="button" className={`ws-chip${form.channels.includes(c) ? ' active' : ''}`} onClick={() => toggleChannel(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Times every scheduled day *</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {form.times.map((t) => (
                    <span key={t} className="ws-chip active" style={{ cursor: 'default' }}>
                      {time12(t)}
                      <button
                        type="button"
                        aria-label={`Remove ${time12(t)}`}
                        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}
                        onClick={() => setForm({ ...form, times: form.times.filter((x) => x !== t) })}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                  <input className="input-base" type="time" style={{ width: 130 }} value={form.newTime} onChange={(e) => setForm({ ...form, newTime: e.target.value })} />
                  <button type="button" className="btn-secondary" style={{ minHeight: 0, padding: '7px 12px' }} onClick={addTime}>
                    <Plus size={13} /> Add time
                  </button>
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Days *</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ALL_DAYS.map((d) => (
                    <button key={d} type="button" className={`ws-chip${form.days.includes(d) ? ' active' : ''}`} onClick={() => toggleDay(d)}>
                      {d.slice(0, 3)}
                    </button>
                  ))}
                  <button type="button" className="ws-link" onClick={() => setForm({ ...form, days: [...ALL_DAYS] })}>
                    Every day
                  </button>
                  <button type="button" className="ws-link" onClick={() => setForm({ ...form, days: ALL_DAYS.slice(0, 6) })}>
                    Mon–Sat
                  </button>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Starts</label>
                <input className="input-base" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Ends (optional)</label>
                <input className="input-base" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Instructions for the employee</label>
                <textarea
                  className="input-base"
                  rows={2}
                  placeholder="e.g. Use the brand template, add today's offer, reply to comments within an hour"
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              {list.length > 0 && (
                <button className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>
                  Cancel
                </button>
              )}
              <button className="btn-primary" onClick={saveForm} disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Save Schedule' : 'Start Daily Posts'}
              </button>
            </div>
          </div>
        )}
    </div>
  );
}

/** Stand-alone dialog for a project's posting schedules (Ongoing Works → Schedule). */
export function ScheduleModal({ project, onClose }: { project: Project; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 640, maxWidth: '100%', padding: 26, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarClock size={18} color="#3B5BDB" /> Daily Posts
            </div>
            <div style={{ fontSize: 12.5, color: '#697586' }}>
              {project.name} · {project.clientName}
            </div>
          </div>
          <button className="m-icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <SchedulePanel project={project} />
      </div>
    </div>
  );
}
