import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Trash2, Archive } from 'lucide-react';
import { db, type Deliverable, type Payment, type Project, type ProjectTask } from '../db/database';
import { useToast } from '../context/ToastContext';
import { addDeliverable, updateDeliverable } from '../services/deliverableService';
import { addPayment, updatePayment } from '../services/paymentService';
import { updateTask } from '../services/taskService';
import { updateProject, deleteProject, archiveProject } from '../services/projectService';
import { syncOngoingProjectValue } from '../services/serviceCatalogService';
import { validateProjectForm, type ProjectValidationErrors } from '../utils/validation';
import { maskDateDDMMYYYY, toDisplayDate } from '../utils/dateMask';
import { clientLabel } from '../utils/financials';
import { itemTypesFor, monthOf } from '../utils/serviceCatalog';
import EmployeeSelect, { canManageProjects } from './EmployeeSelect';
import ProjectServiceFields, { ServiceSelect } from './ProjectServiceFields';
import DeleteConfirmationModal from './DeleteConfirmationModal';

export const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** "15 Oct 2026" from ISO or DD/MM/YYYY */
export const prettyDate = (d?: string) => {
  const v = (d || '').trim();
  const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : /^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v.split('/').reverse().join('-') : '';
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : v || '—';
};
/** DD/MM/YYYY or ISO → ISO for date inputs */
const toIso = (d?: string) => {
  const v = (d || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v.split('/').reverse().join('-');
  return '';
};

export function billingLine(p: Project): string {
  const parts = [
    p.monthlyRetainer ? `${inr(p.monthlyRetainer)}/month` : '',
    ...Object.entries(p.itemRates || {})
      .filter(([, r]) => Number(r) > 0)
      .map(([t, r]) => `${t} ${inr(r)}`),
  ].filter(Boolean);
  return parts.join(' · ') || 'No rates set';
}

export const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;
const METHODS = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Card'];
const STATUSES: Project['status'][] = ['In Progress', 'On Hold', 'Waiting for Client', 'Completed', 'Cancelled', 'Archived'];

function DialogHead({ title, sub, onClose, disabled }: { title: string; sub?: string; onClose: () => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
      <div>
        <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: '#697586' }}>{sub}</div>}
      </div>
      <button className="m-icon-btn" onClick={onClose} aria-label="Close" disabled={disabled}>
        <X size={20} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment: add or edit (amount, date, method, reference, status, notes)
// ---------------------------------------------------------------------------
export function PaymentModal({ project, payment, suggested, onClose }: { project: Project; payment?: Payment; suggested?: number; onClose: () => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    amount: payment ? String(payment.amount) : suggested ? String(Math.round(suggested)) : '',
    date: toIso(payment?.date) || todayIso(),
    method: payment?.method || 'UPI',
    reference: payment?.referenceNumber || '',
    status: payment?.status || ('Confirmed' as Payment['status']),
    notes: payment?.notes || '',
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) return showToast('Enter an amount greater than 0.', 'error');
    if (!form.date) return showToast('Choose the payment date.', 'error');
    setBusy(true);
    try {
      if (payment?.id !== undefined) {
        await updatePayment(payment.id, {
          amount,
          date: form.date,
          method: form.method,
          referenceNumber: form.reference.trim(),
          status: form.status,
          notes: form.notes.trim(),
        });
        showToast('Payment updated.', 'success');
      } else {
        await addPayment({
          paymentNumber: `PAY-${Date.now().toString().slice(-6)}`,
          clientName: project.clientName,
          clientId: project.clientId,
          projectId: project.id,
          projectName: project.name,
          amount,
          date: form.date,
          method: form.method,
          referenceNumber: form.reference.trim() || undefined,
          status: form.status,
          notes: form.notes.trim() || undefined,
        });
        showToast(`${inr(amount)} received from ${project.clientName}.`, 'success');
      }
      await syncOngoingProjectValue(project);
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Could not save the payment.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-box" style={{ width: 460, maxWidth: '100%', padding: 26 }} onClick={(e) => e.stopPropagation()}>
        <DialogHead title={payment ? `Edit Payment ${payment.paymentNumber || ''}` : 'Record Payment'} sub={`${project.name} · ${project.clientName}`} onClose={onClose} disabled={busy} />
        <form onSubmit={save}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Amount (₹) *</label>
              <input className="input-base" type="number" min="1" autoFocus value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Date *</label>
              <input className="input-base" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Method</label>
              <select className="select-base" style={{ width: '100%' }} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select className="select-base" style={{ width: '100%' }} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Payment['status'] })}>
                <option value="Confirmed">Confirmed (received)</option>
                <option value="Pending">Pending</option>
                <option value="Failed">Failed / bounced</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Reference</label>
              <input className="input-base" placeholder="UPI ref / cheque no." value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Note</label>
              <input className="input-base" placeholder="e.g. October retainer" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: '#697586', marginTop: 10 }}>Only Confirmed payments count as received. Also listed on the Payments page.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving...' : payment ? 'Save Changes' : 'Save Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log work that's already done (no employee task): counts × rate, billed right away
// ---------------------------------------------------------------------------
export function LogDoneModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const types = itemTypesFor(project);
  const [form, setForm] = useState({
    date: todayIso(),
    employee: '',
    description: '',
    qty: {} as Record<string, string>,
    rate: Object.fromEntries(types.map((t) => [t, project.itemRates?.[t] ? String(project.itemRates[t]) : ''])) as Record<string, string>,
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const entries = types.map((type) => ({ type, qty: Number(form.qty[type]) || 0, rate: Number(form.rate[type]) || 0 })).filter((x) => x.qty > 0);
    if (entries.length === 0) return showToast('Enter a count for at least one item.', 'error');
    setBusy(true);
    try {
      for (const x of entries) {
        await addDeliverable({
          client: project.clientName,
          clientId: project.clientId,
          type: x.type,
          description: form.description.trim() || `${x.type} for ${project.name}`,
          qty: x.qty,
          rate: x.rate,
          amount: x.qty * x.rate,
          date: form.date,
          employee: form.employee,
          period: monthOf(form.date),
          status: 'Approved',
          projectId: project.id,
          projectName: project.name,
        });
      }
      await syncOngoingProjectValue(project);
      showToast(`Logged ${entries.map((x) => `${x.qty} ${x.type}`).join(', ')}.`, 'success');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Could not save the counts.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-box" style={{ width: 500, maxWidth: '100%', padding: 26, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <DialogHead title="Log Work Done" sub={`${project.name} · billed right away`} onClose={onClose} disabled={busy} />
        <form onSubmit={save}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Date *</label>
              <input className="input-base" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Done by</label>
              <EmployeeSelect value={form.employee} onChange={(name) => setForm({ ...form, employee: name })} placeholder="Select employee" />
            </div>
          </div>
          <div className="assign-line" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {types.map((type) => (
              <div key={type} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,0.8fr) minmax(0,0.9fr)', gap: 10, alignItems: 'end' }} data-keep-grid>
                <div style={{ fontWeight: 700, fontSize: 13.5, paddingBottom: 10 }}>{type}</div>
                <div>
                  <label style={{ ...labelStyle, fontSize: 11.5 }}>Count</label>
                  <input className="input-base" type="number" min="0" value={form.qty[type] || ''} onChange={(e) => setForm({ ...form, qty: { ...form.qty, [type]: e.target.value } })} />
                </div>
                <div>
                  <label style={{ ...labelStyle, fontSize: 11.5 }}>Price each</label>
                  <input className="input-base" type="number" min="0" value={form.rate[type] || ''} onChange={(e) => setForm({ ...form, rate: { ...form.rate, [type]: e.target.value } })} />
                </div>
              </div>
            ))}
          </div>
          <label style={{ ...labelStyle, marginTop: 12 }}>Note</label>
          <input className="input-base" placeholder="e.g. Diwali campaign creatives" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit a work item: the employee task and/or its billing entry (type, count, price, brief, assignee, due)
// ---------------------------------------------------------------------------
export function EditWorkModal({ project, task, entry, onClose }: { project: Project; task?: ProjectTask; entry?: Deliverable; onClose: () => void }) {
  const { showToast } = useToast();
  const employees = (useLiveQuery(() => db.employees.toArray(), []) || []).filter((e) => e.status !== 'Inactive');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    type: task?.workType || entry?.type || itemTypesFor(project)[0] || 'Item',
    details: task ? (task.description || '').split('\nClient:')[0] : entry?.description || '',
    qty: String(task?.quantity ?? entry?.qty ?? 1),
    rate: entry ? String(entry.rate ?? '') : '',
    employeeId: task?.assignedToId !== undefined ? String(task.assignedToId) : '',
    employeeName: task?.assignedTo || entry?.employee || '',
    dueDate: toIso(task?.dueDate) || toIso(entry?.date) || todayIso(),
    priority: (task?.priority || 'Medium') as 'Low' | 'Medium' | 'High',
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(form.qty);
    if (!form.type.trim()) return showToast('Enter what to make.', 'error');
    if (!(qty > 0)) return showToast('Enter a count.', 'error');
    const emp = employees.find((x) => String(x.id) === form.employeeId);
    setBusy(true);
    try {
      if (task?.id !== undefined) {
        const title = `${form.type}${qty > 1 ? ` × ${qty}` : ''} · ${form.details.trim() || project.name}`;
        await updateTask(task.id, {
          title,
          description: [form.details.trim(), `Client: ${project.clientName}`].filter(Boolean).join('\n'),
          workType: form.type.trim(),
          quantity: qty,
          dueDate: form.dueDate,
          priority: form.priority,
          ...(emp ? { assignedTo: emp.name, assignedToId: emp.id } : {}),
        });
      }
      const entryId = entry?.id ?? task?.deliverableId;
      if (entryId !== undefined) {
        const rate = Number(form.rate) || 0;
        await updateDeliverable(entryId, {
          type: form.type.trim(),
          qty,
          rate,
          amount: qty * rate,
          description: form.details.trim() || form.type,
          employee: emp?.name || form.employeeName,
          ...(!task ? { date: form.dueDate, period: form.dueDate.slice(0, 7) } : {}),
        });
      }
      await syncOngoingProjectValue(project);
      showToast('Work item updated.', 'success');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Could not save the changes.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const hasBilling = !!entry || !!task?.deliverableId;
  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-box" style={{ width: 560, maxWidth: '100%', padding: 26, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <DialogHead title="Edit Work Item" sub={task ? 'Changes show in the employee’s task too' : 'Logged work (no task)'} onClose={onClose} disabled={busy} />
        <form onSubmit={save}>
          <div className="assign-grid">
            <div>
              <label style={labelStyle}>What to make *</label>
              <input className="input-base" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} list="ongoing-work-types" />
              <datalist id="ongoing-work-types">
                {itemTypesFor(project).map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Count *</label>
              <input className="input-base" type="number" min="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </div>
            {hasBilling && (
              <div>
                <label style={labelStyle}>Price each (₹)</label>
                <input className="input-base" type="number" min="0" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{task ? 'Brief for the employee' : 'Description'}</label>
              <textarea className="input-base" rows={2} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
            </div>
            {task && (
              <div>
                <label style={labelStyle}>Assigned to</label>
                <select className="select-base" style={{ width: '100%' }} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  {!form.employeeId && <option value="">{form.employeeName || 'Select employee'}</option>}
                  {employees.map((x) => (
                    <option key={x.id} value={String(x.id)}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>{task ? 'Due date' : 'Date'}</label>
              <input className="input-base" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </div>
            {task && (
              <div>
                <label style={labelStyle}>Priority</label>
                <select className="select-base" style={{ width: '100%' }} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as 'Low' | 'Medium' | 'High' })}>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            )}
          </div>
          {hasBilling && (
            <div style={{ textAlign: 'right', fontSize: 13, color: '#475569', marginTop: 10 }}>
              Amount <strong style={{ color: '#1A1F36' }}>{inr((Number(form.qty) || 0) * (Number(form.rate) || 0))}</strong>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit everything about the project: name, client, service, billing, manager, status, dates, notes
// ---------------------------------------------------------------------------
export function EditOngoingProjectModal({ project, onClose, onRemoved }: { project: Project; onClose: () => void; onRemoved: () => void }) {
  const { showToast } = useToast();
  const clients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const services = useLiveQuery(() => db.services.toArray(), []) || [];
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errors, setErrors] = useState<ProjectValidationErrors>({});
  const [form, setForm] = useState<Omit<Project, 'id'>>({
    ...project,
    startDate: toDisplayDate(project.startDate),
    subServices: project.subServices || [],
    itemRates: project.itemRates || {},
    team: project.team || [],
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateProjectForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return showToast(Object.values(errs)[0] as string, 'error');
    if (project.id === undefined) return;
    setBusy(true);
    try {
      const { id: _ignore, ...rest } = form as Project;
      await updateProject(project.id, rest);
      const fresh = await db.projects.get(project.id as any);
      if (fresh) await syncOngoingProjectValue(fresh);
      showToast(form.ongoing ? 'Project updated.' : 'Project updated and moved to the regular Projects list.', 'success');
      if (!form.ongoing) onRemoved();
      else onClose();
    } catch (err: any) {
      showToast(err?.message || 'Could not save the project.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (project.id === undefined) return;
    setBusy(true);
    try {
      await deleteProject(project.id);
      showToast(`"${project.name}" deleted.`, 'info');
      onRemoved();
    } catch (err: any) {
      showToast(err?.message || 'Could not delete the project.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (project.id === undefined) return;
    setBusy(true);
    try {
      await archiveProject(project.id);
      showToast(`"${project.name}" archived.`, 'info');
      onRemoved();
    } catch (err: any) {
      showToast(err?.message || 'Could not archive the project.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-box" style={{ width: 660, maxWidth: '100%', padding: 26, maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <DialogHead title="Edit Project" sub={`${project.clientName} · ${project.serviceName}`} onClose={onClose} disabled={busy} />
        <form onSubmit={save}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Project Name *</label>
              <input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {errors.name && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{errors.name}</div>}
            </div>
            <div>
              <label style={labelStyle}>Client *</label>
              <select
                className="select-base"
                style={{ width: '100%' }}
                value={String(form.clientId)}
                onChange={(e) => {
                  const c = clients.find((x) => String(x.id) === e.target.value);
                  setForm({ ...form, clientId: c?.id ?? e.target.value, clientName: c?.name || '' });
                }}
              >
                {clients.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {clientLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Service *</label>
              <ServiceSelect formData={form} setFormData={setForm} services={services} />
            </div>
            <ProjectServiceFields formData={form} setFormData={setForm} error={errors.value} />
            <div>
              <label style={labelStyle}>Project Manager *</label>
              <EmployeeSelect value={form.manager} filter={canManageProjects} placeholder="Select Project Manager" onChange={(name) => setForm({ ...form, manager: name })} />
              {errors.manager && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{errors.manager}</div>}
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select className="select-base" style={{ width: '100%' }} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Project['status'] })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Start Date</label>
              <input
                className="input-base"
                placeholder="DD/MM/YYYY"
                inputMode="numeric"
                maxLength={10}
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: maskDateDDMMYYYY(e.target.value, form.startDate) })}
              />
              {errors.startDate && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{errors.startDate}</div>}
            </div>
            <div>
              <label style={labelStyle}>Domain / Pages</label>
              <input className="input-base" placeholder="e.g. instagram.com/brand" value={form.domain || ''} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Scope / Requirements</label>
              <textarea className="input-base" rows={2} value={form.requirements || ''} onChange={(e) => setForm({ ...form, requirements: e.target.value })} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Internal Notes</label>
              <textarea className="input-base" rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" style={{ color: '#D97706', borderColor: '#FDE68A' }} onClick={archive} disabled={busy}>
                <Archive size={14} /> Archive
              </button>
              <button type="button" className="btn-secondary" style={{ color: '#EF4444', borderColor: '#FCA5A5' }} onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
        {confirmDelete && (
          <DeleteConfirmationModal
            isOpen
            title="Delete Project"
            description={
              <>
                Delete <strong>{project.name}</strong> permanently? Its payments and work entries stay on the Payments and Deliverables pages.
              </>
            }
            isDeleting={busy}
            onConfirm={remove}
            onClose={() => setConfirmDelete(false)}
          />
        )}
      </div>
    </div>
  );
}
