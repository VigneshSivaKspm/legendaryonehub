import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2, Edit3, Repeat, X } from 'lucide-react';
import { db, type PayrollAdjustment } from '../db/database';
import {
  addPayrollAdjustment,
  updatePayrollAdjustment,
  deletePayrollAdjustment,
  adjustmentAppliesTo,
} from '../services/payrollAdjustmentService';
import { useToast } from '../context/ToastContext';
import DeleteConfirmationModal from './DeleteConfirmationModal';

const ALLOWANCE_COMPONENTS = ['HRA', 'Travel Allowance', 'Food Allowance', 'Medical Allowance', 'Internet / Phone', 'Special Allowance', 'Incentive', 'Other'];
const DEDUCTION_COMPONENTS = ['Provident Fund (PF)', 'ESI', 'Professional Tax', 'TDS', 'Salary Advance', 'Loan Repayment', 'Late Penalty', 'Other'];

const formatINR = (n: number) => '₹' + (Math.round(n) || 0).toLocaleString('en-IN');

const formatMonth = (m: string) => {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

interface FormState {
  employeeId: string;
  type: 'Allowance' | 'Deduction';
  component: string;
  customComponent: string;
  amount: string;
  month: string;
  recurring: boolean;
  endMonth: string;
  notes: string;
}

const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;

/** "Allowances & Deductions" tab of Payroll. Entries feed the payroll run for their month(s). */
export default function PayrollAdjustments({ selectedMonth }: { selectedMonth: string }) {
  const { showToast } = useToast();
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const adjustments = useLiveQuery(() => db.payrollAdjustments.toArray(), []) || [];

  const [typeFilter, setTypeFilter] = useState<'All' | 'Allowance' | 'Deduction'>('All');
  const [showOnlyMonth, setShowOnlyMonth] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PayrollAdjustment | null>(null);
  const [toDelete, setToDelete] = useState<PayrollAdjustment | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const emptyForm = (): FormState => ({
    employeeId: '',
    type: 'Allowance',
    component: ALLOWANCE_COMPONENTS[0],
    customComponent: '',
    amount: '',
    month: selectedMonth,
    recurring: false,
    endMonth: '',
    notes: '',
  });
  const [form, setForm] = useState<FormState>(emptyForm);

  const activeEmployees = employees.filter((e) => e.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name));

  const rows = useMemo(() => {
    return adjustments
      .filter((a) => typeFilter === 'All' || a.type === typeFilter)
      .filter((a) => !showOnlyMonth || adjustmentAppliesTo(a, selectedMonth))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.type.localeCompare(b.type));
  }, [adjustments, typeFilter, showOnlyMonth, selectedMonth]);

  const monthTotals = useMemo(() => {
    let allowances = 0;
    let deductions = 0;
    adjustments
      .filter((a) => adjustmentAppliesTo(a, selectedMonth))
      .forEach((a) => {
        if (a.type === 'Allowance') allowances += Number(a.amount) || 0;
        else deductions += Number(a.amount) || 0;
      });
    return { allowances, deductions };
  }, [adjustments, selectedMonth]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setErrors({});
    setShowForm(true);
  };

  const openEdit = (a: PayrollAdjustment) => {
    const list = a.type === 'Allowance' ? ALLOWANCE_COMPONENTS : DEDUCTION_COMPONENTS;
    const known = list.includes(a.component);
    setEditing(a);
    setForm({
      employeeId: String(a.employeeId),
      type: a.type,
      component: known ? a.component : 'Other',
      customComponent: known ? '' : a.component,
      amount: String(a.amount),
      month: a.month,
      recurring: !!a.recurring,
      endMonth: a.endMonth || '',
      notes: a.notes || '',
    });
    setErrors({});
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.employeeId) errs.employeeId = 'Select an employee.';
    const amt = Number(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) errs.amount = 'Enter an amount greater than 0.';
    if (!form.month) errs.month = 'Select the month.';
    const componentName = form.component === 'Other' ? form.customComponent.trim() : form.component;
    if (!componentName) errs.component = 'Enter a name for this component.';
    if (form.recurring && form.endMonth && form.endMonth < form.month) errs.endMonth = 'End month must be after the start month.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    const emp = employees.find((x) => String(x.id) === form.employeeId);
    const payload: Omit<PayrollAdjustment, 'id'> = {
      employeeId: emp?.id ?? form.employeeId,
      employeeName: emp?.name || 'Employee',
      type: form.type,
      component: componentName,
      amount: amt,
      month: form.month,
      recurring: form.recurring,
      endMonth: form.recurring && form.endMonth ? form.endMonth : undefined,
      notes: form.notes.trim() || undefined,
    };

    setBusy(true);
    try {
      if (editing?.id) {
        await updatePayrollAdjustment(editing.id, { ...payload, endMonth: payload.endMonth || '' });
        showToast(`${payload.type} updated. Pending payroll re-synced.`, 'success');
      } else {
        await addPayrollAdjustment(payload);
        showToast(`${payload.type} added for ${payload.employeeName}. Pending payroll re-synced.`, 'success');
      }
      setShowForm(false);
    } catch (err: any) {
      showToast(err?.message || 'Failed to save entry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete?.id) return;
    setBusy(true);
    try {
      await deletePayrollAdjustment(toDelete.id);
      showToast('Entry removed. Pending payroll re-synced.', 'info');
      setToDelete(null);
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete entry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const components = form.type === 'Allowance' ? ALLOWANCE_COMPONENTS : DEDUCTION_COMPONENTS;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="stat-card" style={{ flex: '1 1 180px' }}>
          <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Allowances · {formatMonth(selectedMonth)}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#12B76A', marginTop: 4 }}>{formatINR(monthTotals.allowances)}</div>
        </div>
        <div className="stat-card" style={{ flex: '1 1 180px' }}>
          <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Deductions · {formatMonth(selectedMonth)}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#EF4444', marginTop: 4 }}>{formatINR(monthTotals.deductions)}</div>
        </div>
        <div className="stat-card" style={{ flex: '2 1 320px', fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
          Entries here are added to each employee's payroll for the month. Recurring entries apply every month from their start
          month. Changes re-sync <strong>pending</strong> payroll records automatically; paid records are not changed.
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select-base" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={{ fontSize: 13 }}>
            <option value="All">Allowances & Deductions</option>
            <option value="Allowance">Allowances only</option>
            <option value="Deduction">Deductions only</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
            <input type="checkbox" checked={showOnlyMonth} onChange={(e) => setShowOnlyMonth(e.target.checked)} />
            Only entries for {formatMonth(selectedMonth)}
          </label>
          <button type="button" className="btn-primary" style={{ marginLeft: 'auto', fontSize: 13 }} onClick={openAdd}>
            <Plus size={15} /> Add Allowance / Deduction
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table-base">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>TYPE</th>
                <th>COMPONENT</th>
                <th>APPLIES</th>
                <th style={{ textAlign: 'right' }}>AMOUNT</th>
                <th>NOTES</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#697586' }}>
                    No allowances or deductions {showOnlyMonth ? `for ${formatMonth(selectedMonth)}` : 'added yet'}.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.employeeName}</td>
                    <td>
                      <span className={`badge ${a.type === 'Allowance' ? 'badge-green' : 'badge-red'}`}>{a.type}</span>
                    </td>
                    <td>{a.component}</td>
                    <td style={{ fontSize: 12.5, color: '#475569' }}>
                      {a.recurring ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Repeat size={12} /> Monthly from {formatMonth(a.month)}
                          {a.endMonth ? ` to ${formatMonth(a.endMonth)}` : ''}
                        </span>
                      ) : (
                        formatMonth(a.month)
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: a.type === 'Allowance' ? '#12B76A' : '#EF4444' }}>
                      {a.type === 'Allowance' ? '+' : '−'}
                      {formatINR(a.amount)}
                    </td>
                    <td style={{ fontSize: 12.5, color: '#697586', maxWidth: 180 }}>{a.notes || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => openEdit(a)}>
                          <Edit3 size={12} /> Edit
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                          onClick={() => setToDelete(a)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" style={{ width: 520, maxWidth: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>
                {editing ? 'Edit Entry' : 'Add Allowance / Deduction'}
              </div>
              <button type="button" onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#697586', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Employee *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.employeeId ? '#EF4444' : undefined }}
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                  >
                    <option value="">Select Employee</option>
                    {activeEmployees.map((emp) => (
                      <option key={emp.id} value={String(emp.id)}>
                        {emp.name} {emp.employeeId ? `(${emp.employeeId})` : ''}
                      </option>
                    ))}
                  </select>
                  {errors.employeeId && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.employeeId}</div>}
                </div>

                <div>
                  <label style={labelStyle}>Type *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={form.type}
                    onChange={(e) => {
                      const type = e.target.value as FormState['type'];
                      setForm({ ...form, type, component: (type === 'Allowance' ? ALLOWANCE_COMPONENTS : DEDUCTION_COMPONENTS)[0] });
                    }}
                  >
                    <option value="Allowance">Allowance (+)</option>
                    <option value="Deduction">Deduction (−)</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Component *</label>
                  <select className="select-base" style={{ width: '100%' }} value={form.component} onChange={(e) => setForm({ ...form, component: e.target.value })}>
                    {components.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {form.component === 'Other' && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={labelStyle}>Component Name *</label>
                    <input
                      className="input-base"
                      placeholder="e.g. Night Shift Allowance"
                      value={form.customComponent}
                      style={{ borderColor: errors.component ? '#EF4444' : undefined }}
                      onChange={(e) => setForm({ ...form, customComponent: e.target.value })}
                    />
                    {errors.component && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.component}</div>}
                  </div>
                )}

                <div>
                  <label style={labelStyle}>Amount (₹) *</label>
                  <input
                    className="input-base"
                    type="number"
                    min="1"
                    placeholder="e.g. 2000"
                    value={form.amount}
                    style={{ borderColor: errors.amount ? '#EF4444' : undefined }}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                  {errors.amount && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.amount}</div>}
                </div>

                <div>
                  <label style={labelStyle}>{form.recurring ? 'Start Month *' : 'Month *'}</label>
                  <input className="input-base" type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
                  {errors.month && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.month}</div>}
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#1A1F36', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
                    Repeat every month
                  </label>
                </div>

                {form.recurring && (
                  <div>
                    <label style={labelStyle}>End Month (optional)</label>
                    <input className="input-base" type="month" value={form.endMonth} onChange={(e) => setForm({ ...form, endMonth: e.target.value })} />
                    {errors.endMonth && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.endMonth}</div>}
                  </div>
                )}

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Notes</label>
                  <input className="input-base" placeholder="Optional" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving...' : editing ? 'Save Changes' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toDelete && (
        <DeleteConfirmationModal
          isOpen={!!toDelete}
          title="Remove Entry"
          itemName={`${toDelete.component} — ${toDelete.employeeName}`}
          description={<>Remove this {toDelete.type.toLowerCase()}? Pending payroll records will be recalculated.</>}
          isDeleting={busy}
          onConfirm={handleDelete}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
