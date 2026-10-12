import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { db, type Expense } from '../db/database';
import { addExpense, deleteExpense } from '../services/expenseService';
import { useToast } from '../context/ToastContext';
import { Trash2, Download, FileText } from 'lucide-react';
import { COMPANY_EXPENSES, type CompanyExpense } from '../data/companyExpenses';

/* ─── Category colours ─────────────────────────────────────────────────── */
const categoryColors: Record<string, string> = {
  'Office Rent': '#3B5BDB',
  'Software Subscription': '#0EA5E9',
  'Hosting': '#8B5CF6',
  'Marketing': '#EC4899',
  'Electricity': '#F59E0B',
  'Wi-Fi': '#10B981',
  'Travel': '#6366F1',
  'Equipment': '#14B8A6',
  'Salary': '#EF4444',
  'Commission': '#F97316',
  'Printing & Certificates': '#A855F7',
  'Furniture': '#D97706',
  'Office Supplies': '#64748B',
  'Events & Awards': '#8B5CF6',
  'Other': '#94A3B8',
};

const defaultCategories = [
  'Office Rent', 'Software Subscription', 'Hosting', 'Marketing',
  'Electricity', 'Wi-Fi', 'Travel', 'Equipment', 'Salary', 'Commission',
  'Printing & Certificates', 'Furniture', 'Office Supplies',
  'Events & Awards', 'Other',
];

const recurringCategories = new Set([
  'Office Rent', 'Electricity', 'Wi-Fi', 'Software Subscription', 'Hosting', 'Salary',
]);

/* ─── Helper: format a CompanyExpense date for display ─────────────────── */
const formatCEDate = (ce: CompanyExpense): string => {
  if (ce.monthOnly) {
    const d = new Date(ce.date);
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  const [y, m, day] = ce.date.split('-');
  return `${day}-${m}-${y}`;
};

/* ─── Export helpers ────────────────────────────────────────────────────── */
function exportCSV(rows: CompanyExpense[]) {
  const header = 'S.No,Date,Name,Category,Amount,Paid To,Notes';
  const lines = rows.map((r) =>
    [
      r.sno,
      formatCEDate(r),
      `"${r.name}"`,
      r.category,
      r.amount,
      r.paidTo ? `"${r.paidTo}"` : '',
      r.notes ? `"${r.notes}"` : '',
    ].join(',')
  );
  const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'company_expenses.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(rows: CompanyExpense[]) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'company_expenses.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Component ─────────────────────────────────────────────────────────── */
export default function Expenses() {
  const { showToast } = useToast();

  // Search & Filter States
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [periodFilter, setPeriodFilter] = useState('All Time');
  const [activeTab, setActiveTab] = useState<'company' | 'project'>('company');

  // Modal States
  const [showAdd, setShowAdd] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Form States
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Office Rent');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paidTo, setPaidTo] = useState('');
  const [method, setMethod] = useState('Bank Transfer');
  const [projectId, setProjectId] = useState<string | number>('');
  const [notes, setNotes] = useState('');

  // Live queries from Dexie
  const dbExpenses = useLiveQuery(() => db.expenses.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];

  // Combined: static company expenses + DB project-linked expenses
  const companyExpensesFiltered = useMemo(() => {
    return COMPANY_EXPENSES.filter((e) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.paidTo || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q);

      const matchesCat = categoryFilter === 'All Categories' || e.category === categoryFilter;

      let matchesPeriod = true;
      if (periodFilter !== 'All Time') {
        const d = new Date(e.date);
        const now = new Date();
        if (periodFilter === 'This Month') {
          matchesPeriod = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        } else if (periodFilter === 'This Quarter') {
          const currentQ = Math.floor(now.getMonth() / 3);
          matchesPeriod = d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === currentQ;
        } else if (periodFilter === 'This Year') {
          matchesPeriod = d.getFullYear() === now.getFullYear();
        }
      }

      return matchesSearch && matchesCat && matchesPeriod;
    });
  }, [search, categoryFilter, periodFilter]);

  // Project expenses from DB
  const projectExpensesFiltered = useMemo(() => {
    return dbExpenses.filter((e) => {
      if (!e.projectId && !e.projectName) return false;
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (e.name || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q) ||
        (e.paidTo || '').toLowerCase().includes(q) ||
        (e.projectName || '').toLowerCase().includes(q);

      const matchesCat = categoryFilter === 'All Categories' || e.category === categoryFilter;

      let matchesPeriod = true;
      const dateStr = e.date || e.createdAt;
      if (dateStr && periodFilter !== 'All Time') {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          const now = new Date();
          if (periodFilter === 'This Month') {
            matchesPeriod = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
          } else if (periodFilter === 'This Quarter') {
            const currentQ = Math.floor(now.getMonth() / 3);
            matchesPeriod = d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === currentQ;
          } else if (periodFilter === 'This Year') {
            matchesPeriod = d.getFullYear() === now.getFullYear();
          }
        }
      }

      return matchesSearch && matchesCat && matchesPeriod;
    });
  }, [dbExpenses, search, categoryFilter, periodFilter]);

  /* ── KPI Metrics ── */
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentMonthName = now.toLocaleDateString('en-US', { month: 'short' });

  const metrics = useMemo(() => {
    let companyTotal = 0;
    let thisMonthTotal = 0;
    let recurringTotal = 0;
    let projectExpensesTotal = 0;

    COMPANY_EXPENSES.forEach((e) => {
      const amt = e.amount;
      companyTotal += amt;
      const d = new Date(e.date);
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        thisMonthTotal += amt;
      }
      if (recurringCategories.has(e.category)) {
        recurringTotal += amt;
      }
    });

    dbExpenses.forEach((e) => {
      const amt = Number(e.amount) || 0;
      const dateStr = e.date || e.createdAt;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
            thisMonthTotal += amt;
          }
        }
      }
      if (recurringCategories.has(e.category)) recurringTotal += amt;
      if (e.projectId || e.projectName) projectExpensesTotal += amt;
    });

    return { companyTotal, thisMonthTotal, recurringTotal, projectExpensesTotal };
  }, [dbExpenses, currentYear, currentMonth]);

  /* ── Category Breakdown (company expenses) ── */
  const categoryBreakdownData = useMemo(() => {
    const catMap: Record<string, number> = {};
    COMPANY_EXPENSES.forEach((e) => {
      catMap[e.category] = (catMap[e.category] || 0) + e.amount;
    });
    return Object.entries(catMap)
      .map(([catName, val]) => ({ name: catName, value: val, color: categoryColors[catName] || '#94A3B8' }))
      .sort((a, b) => b.value - a.value);
  }, []);

  /* ── Monthly trend (last 6 months from company expenses) ── */
  const monthlyTrendData = useMemo(() => {
    const months: { month: string; year: number; monthIdx: number; amount: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      months.push({ month: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), monthIdx: d.getMonth(), amount: 0 });
    }
    COMPANY_EXPENSES.forEach((e) => {
      const d = new Date(e.date);
      const target = months.find((m) => m.year === d.getFullYear() && m.monthIdx === d.getMonth());
      if (target) target.amount += e.amount;
    });
    return months;
  }, [currentYear, currentMonth]);

  const hasTrendData = monthlyTrendData.some((m) => m.amount > 0);
  const hasCategoryData = categoryBreakdownData.some((c) => c.value > 0);

  /* ── Form Reset ── */
  const resetForm = () => {
    setName(''); setCategory('Office Rent'); setAmount('');
    setDate(new Date().toISOString().split('T')[0]);
    setPaidTo(''); setMethod('Bank Transfer'); setProjectId(''); setNotes('');
  };

  /* ── Add Expense Submit ── */
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { showToast('Please enter an expense name.', 'error'); return; }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) { showToast('Please enter a valid expense amount greater than ₹0.', 'error'); return; }

    setIsSubmitting(true);
    try {
      const expNum = `EXP-${Date.now().toString().slice(-6)}`;
      const selectedProj = projects.find((p) => String(p.id) === String(projectId));
      const payload: Omit<Expense, 'id'> = {
        expenseNumber: expNum, name: name.trim(), category,
        amount: numAmount, date: date || new Date().toISOString().split('T')[0],
      };
      if (paidTo.trim()) payload.paidTo = paidTo.trim();
      if (method) payload.method = method;
      if (selectedProj) {
        payload.projectId = selectedProj.id;
        payload.projectName = selectedProj.name;
        if (selectedProj.clientId) payload.clientId = selectedProj.clientId;
      }
      if (notes.trim()) payload.notes = notes.trim();
      await addExpense(payload);
      showToast(`Expense ${expNum} added successfully!`, 'success');
      resetForm();
      setShowAdd(false);
    } catch (err: any) {
      showToast(err?.message || 'Failed to save expense.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ── Delete Expense ── */
  const handleDeleteExpense = async (exp: Expense) => {
    if (!exp.id) return;
    if (!confirm(`Are you sure you want to delete expense "${exp.name}"?`)) return;
    setDeletingId(exp.id);
    try {
      await deleteExpense(exp.id);
      showToast(`Expense "${exp.name}" deleted successfully.`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete expense.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const formatINR = (val: number) => '₹' + (val || 0).toLocaleString('en-IN');

  const activeRows = activeTab === 'company' ? companyExpensesFiltered : projectExpensesFiltered;
  const activeTotal = activeRows.reduce((s, r) => s + (Number((r as any).amount) || 0), 0);

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Expenses</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Track and manage all company expenses — overhead + project-linked
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Export dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn-secondary"
              style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setShowExportMenu((v) => !v)}
            >
              <Download size={14} /> Export
            </button>
            {showExportMenu && (
              <div
                style={{
                  position: 'absolute', right: 0, top: 36, background: '#fff',
                  border: '1px solid #E5E9F2', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                  zIndex: 999, minWidth: 160, padding: 6,
                }}
              >
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderRadius: 6 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  onClick={() => { exportCSV(companyExpensesFiltered); setShowExportMenu(false); }}
                >
                  <FileText size={14} /> Export CSV
                </button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderRadius: 6 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  onClick={() => { exportJSON(companyExpensesFiltered); setShowExportMenu(false); }}
                >
                  <FileText size={14} /> Export JSON
                </button>
              </div>
            )}
          </div>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Company Expenses', value: formatINR(metrics.companyTotal), color: '#3B5BDB' },
          { label: `${currentMonthName} ${currentYear} Total`, value: formatINR(metrics.thisMonthTotal), color: '#EF4444' },
          { label: 'Recurring Expenses', value: formatINR(metrics.recurringTotal), color: '#F59E0B' },
          { label: 'Project Expenses (DB)', value: formatINR(metrics.projectExpensesTotal), color: '#12B76A' },
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: 'Plus Jakarta Sans' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginBottom: 16 }}>
        {/* Trend */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Monthly Expenses Trend</div>
          <div style={{ fontSize: 12, color: '#697586', marginBottom: 12 }}>
            {monthlyTrendData[0]?.month} – {monthlyTrendData[5]?.month} {currentYear}
          </div>
          {!hasTrendData ? (
            <div style={{ height: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#697586', background: '#F8FAFC', borderRadius: 8 }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📊</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>No trend data</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#697586' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#697586' }} axisLine={false} tickLine={false} tickFormatter={(v) => '₹' + (v / 1000) + 'K'} />
                <Tooltip formatter={(v: any) => ['₹' + Number(v).toLocaleString('en-IN')]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="amount" fill="#3B5BDB" radius={[4, 4, 0, 0]} fillOpacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Category breakdown */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>By Category</div>
          <div style={{ fontSize: 12, color: '#697586', marginBottom: 8 }}>All-Time Breakdown</div>
          {!hasCategoryData ? (
            <div style={{ height: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#697586', background: '#F8FAFC', borderRadius: 8 }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🏷️</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>No category breakdown</div>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={categoryBreakdownData} cx="50%" cy="50%" outerRadius={52} dataKey="value">
                    {categoryBreakdownData.map((e, i) => (
                      <Cell key={i} fill={e.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => ['₹' + Number(v).toLocaleString('en-IN')]} contentStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, maxHeight: 90, overflowY: 'auto' }}>
                {categoryBreakdownData.slice(0, 5).map((d) => (
                  <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#697586' }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: d.color, display: 'inline-block' }} />
                      {d.name}
                    </span>
                    <span style={{ fontWeight: 600, color: '#1A1F36' }}>{formatINR(d.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table Section */}
      <div className="card">
        {/* Tab + Filters Bar */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {(['company', 'project'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  background: activeTab === tab ? '#3B5BDB' : '#F1F5F9',
                  color: activeTab === tab ? '#fff' : '#697586',
                  transition: 'all 0.15s',
                }}
              >
                {tab === 'company' ? `🏢 Company Overhead (${COMPANY_EXPENSES.length})` : `📁 Project Expenses (${dbExpenses.filter(e => e.projectId || e.projectName).length})`}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 280 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
              <input
                className="input-base"
                style={{ paddingLeft: 30, fontSize: 13 }}
                placeholder="Search expenses, vendor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select className="select-base" style={{ fontSize: 13, minWidth: 160 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All Categories">All Categories</option>
              {defaultCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>

            <select className="select-base" style={{ fontSize: 13, minWidth: 140 }} value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
              <option value="All Time">All Time</option>
              <option value="This Month">This Month</option>
              <option value="This Quarter">This Quarter</option>
              <option value="This Year">This Year</option>
            </select>

            {(search || categoryFilter !== 'All Categories' || periodFilter !== 'All Time') && (
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => { setSearch(''); setCategoryFilter('All Categories'); setPeriodFilter('All Time'); }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* ── COMPANY OVERHEAD TABLE ── */}
        {activeTab === 'company' && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>DATE</th>
                  <th>EXPENSE</th>
                  <th>CATEGORY</th>
                  <th style={{ textAlign: 'right' }}>AMOUNT</th>
                  <th>PAID TO</th>
                  <th>NOTES</th>
                </tr>
              </thead>
              <tbody>
                {companyExpensesFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px 16px', color: '#697586' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>💸</div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#1A1F36', marginBottom: 4 }}>No expenses match filters</div>
                      <div style={{ fontSize: 13 }}>Try adjusting your search or filter criteria.</div>
                    </td>
                  </tr>
                ) : (
                  companyExpensesFiltered.map((e) => (
                    <tr key={e.sno}>
                      <td style={{ fontSize: 12, color: '#697586', textAlign: 'center' }}>{e.sno}</td>
                      <td style={{ fontSize: 12.5, color: '#697586', whiteSpace: 'nowrap' }}>
                        {formatCEDate(e)}
                        {e.monthOnly && (
                          <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 4, fontStyle: 'italic' }}>(month)</span>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                      </td>
                      <td>
                        <span className="badge badge-gray" style={{ background: (categoryColors[e.category] || '#94A3B8') + '18', color: categoryColors[e.category] || '#64748B', border: `1px solid ${categoryColors[e.category] || '#94A3B8'}40` }}>
                          {e.category}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444', fontSize: 14 }}>
                        {formatINR(e.amount)}
                      </td>
                      <td style={{ fontSize: 13 }}>{e.paidTo || '—'}</td>
                      <td style={{ fontSize: 11.5, color: '#697586', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.notes ? (
                          e.notes.startsWith('http') ? (
                            <a href={e.notes} target="_blank" rel="noreferrer" style={{ color: '#3B5BDB', textDecoration: 'underline' }}>View Link</a>
                          ) : e.notes
                        ) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── PROJECT EXPENSES TABLE (from DB) ── */}
        {activeTab === 'project' && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>EXPENSE</th>
                  <th>CATEGORY</th>
                  <th style={{ textAlign: 'right' }}>AMOUNT</th>
                  <th>DATE</th>
                  <th>PAID TO</th>
                  <th>METHOD</th>
                  <th>PROJECT</th>
                  <th style={{ textAlign: 'center' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {projectExpensesFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '48px 16px', color: '#697586' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#1A1F36', marginBottom: 4 }}>No project expenses found</div>
                      <div style={{ fontSize: 13 }}>Add project-linked expenses using the "+ Add Expense" button and link them to a project.</div>
                    </td>
                  </tr>
                ) : (
                  projectExpensesFiltered.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                        <div style={{ fontSize: 11, color: '#697586' }}>{e.expenseNumber || e.id}</div>
                      </td>
                      <td>
                        <span className="badge badge-gray">{e.category || 'Other'}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444', fontSize: 14 }}>
                        {formatINR(Number(e.amount) || 0)}
                      </td>
                      <td style={{ color: '#697586', fontSize: 12.5 }}>{e.date || '—'}</td>
                      <td style={{ fontSize: 13 }}>{e.paidTo || '—'}</td>
                      <td>
                        <span className={`badge ${e.method === 'UPI' ? 'badge-cyan' : e.method === 'Card' ? 'badge-purple' : e.method === 'Cash' ? 'badge-gray' : 'badge-blue'}`}>
                          {e.method || 'Bank Transfer'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: '#3B5BDB', fontWeight: 600 }}>{e.projectName || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 14, opacity: deletingId === e.id ? 0.4 : 1 }}
                          disabled={deletingId === e.id}
                          title="Delete Expense"
                          onClick={() => handleDeleteExpense(e)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12.5, color: '#697586' }}>
            Showing {activeTab === 'company' ? companyExpensesFiltered.length : projectExpensesFiltered.length} expenses
          </div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
            Total: <span style={{ color: '#EF4444' }}>{formatINR(activeTotal)}</span>
          </div>
        </div>
      </div>

      {/* Add Expense Modal */}
      {showAdd && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 560, padding: 24, background: '#FFFFFF', borderRadius: 12, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1E293B' }}>+ Add Expense</div>
              <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748B' }} onClick={() => setShowAdd(false)}>✕</button>
            </div>

            <form onSubmit={handleSaveExpense} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Expense Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input className="input-base" style={{ width: '100%' }} placeholder="e.g. Office Rent — Oct 2026" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Category <span style={{ color: '#EF4444' }}>*</span></label>
                  <select className="select-base" style={{ width: '100%' }} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {defaultCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Amount (₹) <span style={{ color: '#EF4444' }}>*</span></label>
                  <input className="input-base" type="number" min="1" style={{ width: '100%' }} placeholder="e.g. 18000" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Date <span style={{ color: '#EF4444' }}>*</span></label>
                  <input className="input-base" type="date" style={{ width: '100%' }} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Paid To</label>
                  <input className="input-base" style={{ width: '100%' }} placeholder="Vendor / Person name" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Payment Method</label>
                  <select className="select-base" style={{ width: '100%' }} value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Project (optional)</label>
                  <select className="select-base" style={{ width: '100%' }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">— None (Company Overhead) —</option>
                    {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                  </select>
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Notes</label>
                  <input className="input-base" style={{ width: '100%' }} placeholder="Optional notes or receipt references" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, borderTop: '1px solid #E2E8F0', paddingTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)} disabled={isSubmitting}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
