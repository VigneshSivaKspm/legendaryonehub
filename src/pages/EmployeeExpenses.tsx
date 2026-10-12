import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type PayrollAdjustment } from '../db/database';
import { newestFirst } from '../utils/sort';
import { useToast } from '../context/ToastContext';
import { addPayrollAdjustment, updatePayrollAdjustment, deletePayrollAdjustment } from '../services/payrollAdjustmentService';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { Plus, Search, Edit3, Trash2, Wallet, Users, Receipt, CheckCircle2, Clock } from 'lucide-react';

const CATEGORIES = ['Food / Meals', 'Travel', 'Fuel', 'Salary Advance', 'Personal Purchase', 'Phone / Internet', 'Loan', 'Damage / Loss', 'Other'];

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;

interface FormState {
  employeeId: string;
  date: string;
  category: string;
  description: string;
  amount: string;
  month: string;
}

/**
 * Money an employee owes the company (advances, personal purchases, meals, fuel…).
 * Each entry is a salary deduction for the chosen month, so payroll recovers it on salary day.
 */
export default function EmployeeExpenses() {
  const { showToast } = useToast();
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PayrollAdjustment | null>(null);
  const [toDelete, setToDelete] = useState<PayrollAdjustment | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Salary month follows the expense date until the admin picks one by hand
  const [monthTouched, setMonthTouched] = useState(false);
  const [form, setForm] = useState<FormState>({ employeeId: '', date: localDate(), category: CATEGORIES[0], description: '', amount: '', month: '' });

  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const adjustments = useLiveQuery(() => db.payrollAdjustments.toArray(), []) || [];
  const payroll = useLiveQuery(() => db.payroll.toArray(), []) || [];

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );
  const expenses = useMemo(
    () => newestFirst(adjustments.filter((a) => a.source === 'employeeExpense'), (a) => a.date),
    [adjustments]
  );

  const payrollFor = (employeeId: string | number, m: string) =>
    payroll.find((p) => String(p.employeeId) === String(employeeId) && p.month === m);
  const isPaid = (a: PayrollAdjustment) => payrollFor(a.employeeId, a.month)?.status === 'Paid';

  /** Deduct from the expense's own month, or the next one if that salary is already paid. */
  const defaultSalaryMonth = (employeeId: string, date: string) => {
    const m = (date || localDate()).slice(0, 7);
    return employeeId && payrollFor(employeeId, m)?.status === 'Paid' ? nextMonth(m) : m;
  };

  const monthExpenses = expenses.filter((a) => a.month === month);
  const filtered = monthExpenses.filter((a) => {
    if (employeeFilter !== 'All' && String(a.employeeId) !== employeeFilter) return false;
    if (categoryFilter !== 'All' && a.category !== categoryFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && ![a.employeeName, a.description, a.category, a.notes].some((v) => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });

  const total = monthExpenses.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const deducted = monthExpenses.filter(isPaid).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const perEmployee = activeEmployees
    .map((emp) => {
      const list = monthExpenses.filter((a) => String(a.employeeId) === String(emp.id));
      return { emp, count: list.length, total: list.reduce((s, a) => s + (Number(a.amount) || 0), 0), pay: payrollFor(emp.id!, month) };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.total - a.total);

  // ---------- form ----------
  const openAdd = () => {
    const employeeId = employeeFilter !== 'All' ? employeeFilter : '';
    setEditing(null);
    setErrors({});
    setMonthTouched(false);
    setForm({ employeeId, date: localDate(), category: CATEGORIES[0], description: '', amount: '', month: defaultSalaryMonth(employeeId, localDate()) });
    setShowForm(true);
  };

  const openEdit = (a: PayrollAdjustment) => {
    setEditing(a);
    setErrors({});
    setMonthTouched(true);
    setForm({
      employeeId: String(a.employeeId),
      date: a.date || `${a.month}-01`,
      category: a.category || 'Other',
      description: a.description || a.notes || '',
      amount: String(a.amount),
      month: a.month,
    });
    setShowForm(true);
  };

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      if (!monthTouched && (patch.date !== undefined || patch.employeeId !== undefined)) {
        next.month = defaultSalaryMonth(next.employeeId, next.date);
      }
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const emp = activeEmployees.find((x) => String(x.id) === form.employeeId) || employees.find((x) => String(x.id) === form.employeeId);
    if (!emp) errs.employeeId = 'Select an employee.';
    if (!form.date) errs.date = 'Date is required.';
    if (!form.description.trim()) errs.description = 'Describe the expense.';
    if (!(Number(form.amount) > 0)) errs.amount = 'Enter an amount greater than 0.';
    if (!form.month) errs.month = 'Choose the salary month.';
    else if (emp && payrollFor(emp.id!, form.month)?.status === 'Paid')
      errs.month = `${emp.name}'s ${monthLabel(form.month)} salary is already paid. Pick a later month.`;
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !emp) return;

    const data: Omit<PayrollAdjustment, 'id'> = {
      employeeId: emp.id!,
      employeeName: emp.name,
      type: 'Deduction',
      component: `Expense · ${form.category}`,
      amount: Number(form.amount),
      month: form.month,
      recurring: false,
      notes: form.description.trim(),
      source: 'employeeExpense',
      date: form.date,
      category: form.category,
      description: form.description.trim(),
    };
    setBusy(true);
    try {
      if (editing?.id) {
        await updatePayrollAdjustment(editing.id, data);
        showToast('Expense updated.', 'success');
      } else {
        await addPayrollAdjustment(data);
        showToast(`${inr(data.amount)} recorded for ${emp.name}; it will be deducted from the ${monthLabel(form.month)} salary.`, 'success');
      }
      setShowForm(false);
    } catch (err: any) {
      showToast(err?.message || 'Could not save the expense.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete?.id) return;
    setBusy(true);
    try {
      await deletePayrollAdjustment(toDelete.id);
      showToast('Expense deleted.', 'info');
      setToDelete(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not delete the expense.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const statusCell = (a: PayrollAdjustment) => {
    const p = payrollFor(a.employeeId, a.month);
    if (p?.status === 'Paid') return <span className="badge badge-green">Deducted{p.paymentDate ? ` · ${p.paymentDate}` : ''}</span>;
    if (p) return <span className="badge badge-amber">On pending payroll</span>;
    return <span className="badge badge-gray">Deducts on salary day</span>;
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wallet size={22} style={{ color: '#3B5BDB' }} /> Employee Expenses
          </div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Advances, meals, fuel and other money spent for employees. Each month's total is deducted from their salary.
          </div>
        </div>
        <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} onClick={openAdd} disabled={activeEmployees.length === 0}>
          <Plus size={15} /> Add Expense
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: `Total · ${monthLabel(month)}`, value: inr(total), color: '#EF4444', icon: <Receipt size={14} /> },
          { label: 'Employees', value: String(perEmployee.length), color: '#1A1F36', icon: <Users size={14} /> },
          { label: 'Entries', value: String(monthExpenses.length), color: '#1A1F36', icon: <Wallet size={14} /> },
          { label: 'Already Deducted', value: inr(deducted), color: '#12B76A', icon: <CheckCircle2 size={14} /> },
          { label: 'To Deduct', value: inr(total - deducted), color: '#F59E0B', icon: <Clock size={14} /> },
        ].map((c) => (
          <div key={c.label} className="stat-card" style={{ flex: '1 1 160px' }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              {c.icon} {c.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, fontFamily: 'Plus Jakarta Sans' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Per-employee totals */}
      {perEmployee.length > 0 && (
        <div className="card" style={{ marginBottom: 20, overflowX: 'auto' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
            Monthly totals by employee · deducted from the {monthLabel(month)} salary
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th style={{ textAlign: 'center' }}>ENTRIES</th>
                <th style={{ textAlign: 'right' }}>MONTHLY SALARY</th>
                <th style={{ textAlign: 'right' }}>EXPENSES TO DEDUCT</th>
                <th style={{ textAlign: 'right' }}>SALARY AFTER EXPENSES</th>
                <th>PAYROLL</th>
              </tr>
            </thead>
            <tbody>
              {perEmployee.map(({ emp, count, total: empTotal, pay }) => (
                <tr key={emp.id} style={{ cursor: 'pointer' }} onClick={() => setEmployeeFilter(String(emp.id))}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{emp.name}</div>
                    <div style={{ fontSize: 11.5, color: '#697586' }}>{emp.employeeId} · {emp.role}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>{count}</td>
                  <td style={{ textAlign: 'right' }}>{inr(emp.salary)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>−{inr(empTotal)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{inr(Math.max(0, (Number(emp.salary) || 0) - empTotal))}</td>
                  <td>
                    {pay ? (
                      <span className={`badge ${pay.status === 'Paid' ? 'badge-green' : 'badge-amber'}`}>
                        {pay.status === 'Paid' ? 'Paid' : 'Pending'} · net {inr(pay.netSalary)}
                      </span>
                    ) : (
                      <span className="badge badge-gray">Not generated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '8px 16px', fontSize: 11.5, color: '#697586' }}>
            "Salary after expenses" is before attendance deductions and incentives. The payroll net includes everything.
          </div>
        </div>
      )}

      {/* Entries */}
      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input-base" type="month" style={{ width: 170, fontSize: 13 }} value={month} onChange={(e) => setMonth(e.target.value)} title="Salary month the expenses are deducted from" />
          <select className="select-base" style={{ fontSize: 13 }} value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="All">All Employees</option>
            {activeEmployees.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name}
              </option>
            ))}
          </select>
          <select className="select-base" style={{ fontSize: 13 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 280 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586' }} />
            <input className="input-base" style={{ paddingLeft: 30, fontSize: 13, width: '100%' }} placeholder="Search expenses..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {(employeeFilter !== 'All' || categoryFilter !== 'All' || search) && (
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => { setEmployeeFilter('All'); setCategoryFilter('All'); setSearch(''); }}>
              Clear filters
            </button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table-base">
            <thead>
              <tr>
                <th>DATE</th>
                <th>EMPLOYEE</th>
                <th>CATEGORY</th>
                <th>DESCRIPTION</th>
                <th style={{ textAlign: 'right' }}>AMOUNT</th>
                <th>SALARY MONTH</th>
                <th>STATUS</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#697586' }}>
                    No employee expenses to deduct from the {monthLabel(month)} salary.
                  </td>
                </tr>
              ) : (
                filtered.map((a) => {
                  const paid = isPaid(a);
                  return (
                    <tr key={a.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {a.date ? new Date(a.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td style={{ fontWeight: 600 }}>{a.employeeName}</td>
                      <td>
                        <span className="badge badge-blue">{a.category || 'Other'}</span>
                      </td>
                      <td style={{ fontSize: 12.5, color: '#475569', maxWidth: 280 }}>{a.description || a.notes || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>{inr(a.amount)}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{monthLabel(a.month)}</td>
                      <td>{statusCell(a)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {paid ? (
                          <span style={{ fontSize: 11.5, color: '#697586' }}>On a paid payslip</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => openEdit(a)}>
                              <Edit3 size={12} /> Edit
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                              onClick={() => setToDelete(a)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / edit */}
      {showForm && (
        <div className="modal-overlay" onClick={() => !busy && setShowForm(false)}>
          <div className="modal-box" style={{ width: 500, maxWidth: '100%', padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36', marginBottom: 16 }}>
              {editing ? 'Edit Expense' : 'Add Employee Expense'}
            </div>
            <form onSubmit={handleSave} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Employee *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.employeeId ? '#EF4444' : undefined }}
                    value={form.employeeId}
                    onChange={(e) => updateForm({ employeeId: e.target.value })}
                  >
                    <option value="">Select employee...</option>
                    {activeEmployees.map((e) => (
                      <option key={e.id} value={String(e.id)}>
                        {e.name} ({e.employeeId})
                      </option>
                    ))}
                  </select>
                  {errors.employeeId && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.employeeId}</div>}
                </div>
                <div>
                  <label style={labelStyle}>Date *</label>
                  <input className="input-base" type="date" style={{ width: '100%' }} value={form.date} onChange={(e) => updateForm({ date: e.target.value })} />
                  {errors.date && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.date}</div>}
                </div>
                <div>
                  <label style={labelStyle}>Category *</label>
                  <select className="select-base" style={{ width: '100%' }} value={form.category} onChange={(e) => updateForm({ category: e.target.value })}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Description *</label>
                  <input
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.description ? '#EF4444' : undefined }}
                    placeholder="e.g. Lunch at client site / Advance for rent"
                    value={form.description}
                    onChange={(e) => updateForm({ description: e.target.value })}
                  />
                  {errors.description && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.description}</div>}
                </div>
                <div>
                  <label style={labelStyle}>Amount (₹) *</label>
                  <input
                    className="input-base"
                    type="number"
                    min="1"
                    style={{ width: '100%', borderColor: errors.amount ? '#EF4444' : undefined }}
                    value={form.amount}
                    onChange={(e) => updateForm({ amount: e.target.value })}
                  />
                  {errors.amount && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.amount}</div>}
                </div>
                <div>
                  <label style={labelStyle}>Deduct from salary of *</label>
                  <input
                    className="input-base"
                    type="month"
                    style={{ width: '100%', borderColor: errors.month ? '#EF4444' : undefined }}
                    value={form.month}
                    onChange={(e) => {
                      setMonthTouched(true);
                      setForm((prev) => ({ ...prev, month: e.target.value }));
                    }}
                  />
                </div>
                {errors.month && <div style={{ gridColumn: 'span 2', color: '#EF4444', fontSize: 11.5, marginTop: -8 }}>{errors.month}</div>}
              </div>
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 12 }}>
                The amount is deducted on the payslip for that month. If that salary is already paid, the next month is used.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving...' : editing ? 'Update Expense' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toDelete && (
        <DeleteConfirmationModal
          isOpen={!!toDelete}
          title="Delete Expense"
          itemName={`${toDelete.employeeName} · ${inr(toDelete.amount)}`}
          description={
            <>
              Delete this {inr(toDelete.amount)} expense for <strong style={{ color: '#1A1F36' }}>{toDelete.employeeName}</strong>? It will no longer be
              deducted from their salary.
            </>
          }
          isDeleting={busy}
          onConfirm={handleDelete}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
