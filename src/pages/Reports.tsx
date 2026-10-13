import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { db } from '../db/database';

const reports = [
  'Profit & Loss',
  'Revenue',
  'Expenses',
  'Outstanding Payments',
  'Client Revenue',
  'Service Revenue',
  'GST Summary',
  'Employee Productivity',
  'Payroll',
] as const;

const CHART_COLORS = ['#3B5BDB', '#0EA5E9', '#8B5CF6', '#12B76A', '#F59E0B', '#F97316', '#EC4899', '#6366F1', '#14B8A6'];

export function formatINR(val: number): string {
  const n = Math.round(Number(val) || 0);
  const isNeg = n < 0;
  const absN = Math.abs(n);
  const formatted = absN.toLocaleString('en-IN');
  return isNeg ? `-₹${formatted}` : `₹${formatted}`;
}

export default function Reports() {
  const [activeReport, setActiveReport] = useState<typeof reports[number]>('Profit & Loss');
  const [periodFilter, setPeriodFilter] = useState<'All Time' | 'This FY' | 'This Quarter' | 'This Month'>('All Time');

  // Fetch real Dexie persisted tables (synchronized in real time with Firestore)
  const clients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const invoices = useLiveQuery(() => db.invoices.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const expenses = useLiveQuery(() => db.expenses.toArray(), []) || [];
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];

  // Service a payment belongs to, via its project (falls back to the client's legacy service)
  const serviceOfPayment = (p: { projectId?: number | string; projectName?: string; clientName?: string }) => {
    const proj = projects.find(
      (pr) => (p.projectId !== undefined && String(pr.id) === String(p.projectId)) || (!!p.projectName && pr.name === p.projectName)
    );
    if (proj?.serviceName) return proj.serviceName;
    return clients.find((c) => c.name === p.clientName)?.services || 'General Services';
  };

  // Date filter logic
  const filterByDate = (dateStr?: string) => {
    if (!dateStr || periodFilter === 'All Time') return true;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return true;
    const now = new Date();

    if (periodFilter === 'This Month') {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    if (periodFilter === 'This Quarter') {
      const qNow = Math.floor(now.getMonth() / 3);
      const qD = Math.floor(d.getMonth() / 3);
      return qD === qNow && d.getFullYear() === now.getFullYear();
    }
    if (periodFilter === 'This FY') {
      const year = now.getFullYear();
      const month = now.getMonth();
      const fyStartYear = month >= 3 ? year : year - 1;
      const fyStart = new Date(fyStartYear, 3, 1);
      const fyEnd = new Date(fyStartYear + 1, 2, 31, 23, 59, 59);
      return d >= fyStart && d <= fyEnd;
    }
    return true;
  };

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => filterByDate(p.date || p.createdAt));
  }, [payments, periodFilter]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => filterByDate(e.date || e.createdAt));
  }, [expenses, periodFilter]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((i) => filterByDate(i.date || i.createdAt));
  }, [invoices, periodFilter]);

  // Tab 1: Profit & Loss calculations
  const totalRevenue = useMemo(() => {
    return filteredPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [filteredPayments]);

  const totalExpenses = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [filteredExpenses]);

  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0';

  // Monthly P&L Data
  const monthlyPLData = useMemo(() => {
    const monthMap: Record<string, { month: string; sortKey: string; revenue: number; expenses: number; profit: number }> = {};

    filteredPayments.forEach((p) => {
      const dateStr = p.date || p.createdAt;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;
      const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[monthLabel]) {
        monthMap[monthLabel] = { month: monthLabel, sortKey, revenue: 0, expenses: 0, profit: 0 };
      }
      monthMap[monthLabel].revenue += Number(p.amount) || 0;
    });

    filteredExpenses.forEach((e) => {
      const dateStr = e.date || e.createdAt;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;
      const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[monthLabel]) {
        monthMap[monthLabel] = { month: monthLabel, sortKey, revenue: 0, expenses: 0, profit: 0 };
      }
      monthMap[monthLabel].expenses += Number(e.amount) || 0;
    });

    const list = Object.values(monthMap).map((item) => ({
      ...item,
      profit: item.revenue - item.expenses,
    }));

    list.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return list;
  }, [filteredPayments, filteredExpenses]);

  // Tab 2: Revenue calculations
  const totalInvoiced = useMemo(() => {
    return filteredInvoices.reduce((sum, inv) => sum + (Number(inv.totalAmount) || 0), 0);
  }, [filteredInvoices]);

  const pendingRevenue = Math.max(0, totalInvoiced - totalRevenue);

  // Tab 3: Expenses breakdown by category
  const expenseCategoryData = useMemo(() => {
    const catMap: Record<string, number> = {};
    filteredExpenses.forEach((e) => {
      const cat = e.category || 'Other';
      catMap[cat] = (catMap[cat] || 0) + (Number(e.amount) || 0);
    });
    const totalExp = Object.values(catMap).reduce((a, b) => a + b, 0);

    return Object.entries(catMap)
      .map(([name, value], i) => ({
        name,
        value,
        pct: totalExp > 0 ? ((value / totalExp) * 100).toFixed(1) : '0',
        color: CHART_COLORS[i % CHART_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);

  // Tab 4: Outstanding Payments
  const outstandingInvoices = useMemo(() => {
    return filteredInvoices.filter((inv) => {
      const bal = Number(inv.balance ?? (Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)));
      return inv.status !== 'Paid' && inv.status !== 'Cancelled' && bal > 0;
    });
  }, [filteredInvoices]);

  const totalOutstanding = useMemo(() => {
    return outstandingInvoices.reduce((sum, inv) => {
      return sum + Number(inv.balance ?? (Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)));
    }, 0);
  }, [outstandingInvoices]);

  // Tab 5: Client Revenue
  const clientRevData = useMemo(() => {
    const clientMap: Record<string, { id: string | number; name: string; company: string; service: string; totalValue: number; paid: number; pending: number }> = {};

    clients.forEach((c) => {
      const key = String(c.id || c.name);
      clientMap[key] = {
        id: c.id || c.name,
        name: c.name,
        company: c.company || '—',
        service: c.services || 'General Services',
        totalValue: Number(c.totalValue) || 0,
        paid: Number(c.paid) || 0,
        pending: Number(c.pending) || 0,
      };
    });

    // Attribute payments to clients
    filteredPayments.forEach((p) => {
      if (p.clientName) {
        const foundKey = Object.keys(clientMap).find((k) => clientMap[k].name.toLowerCase() === p.clientName.toLowerCase());
        if (foundKey) {
          clientMap[foundKey].paid += Number(p.amount) || 0;
        } else {
          clientMap[p.clientName] = {
            id: p.clientName,
            name: p.clientName,
            company: '—',
            service: serviceOfPayment(p),
            totalValue: Number(p.amount) || 0,
            paid: Number(p.amount) || 0,
            pending: 0,
          };
        }
      }
    });

    return Object.values(clientMap).sort((a, b) => b.paid - a.paid);
  }, [clients, filteredPayments]);

  // Tab 6: Service Revenue
  const serviceRevData = useMemo(() => {
    const serviceMap: Record<string, number> = {};

    filteredPayments.forEach((p) => {
      const sName = serviceOfPayment(p);
      serviceMap[sName] = (serviceMap[sName] || 0) + (Number(p.amount) || 0);
    });

    clients.forEach((c) => {
      if (c.services && c.paid > 0 && Object.keys(serviceMap).length === 0) {
        serviceMap[c.services] = (serviceMap[c.services] || 0) + (Number(c.paid) || 0);
      }
    });

    const totalVal = Object.values(serviceMap).reduce((a, b) => a + b, 0);

    return Object.entries(serviceMap)
      .map(([name, value], i) => ({
        name,
        value,
        pct: totalVal > 0 ? ((value / totalVal) * 100).toFixed(1) : '0',
        color: CHART_COLORS[i % CHART_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredPayments, clients]);

  // Tab 7: GST Summary
  const gstInvoices = useMemo(() => {
    return filteredInvoices.filter((inv) => Number(inv.taxAmount) > 0 || inv.gstin);
  }, [filteredInvoices]);

  const totalGSTCollected = useMemo(() => {
    return gstInvoices.reduce((sum, inv) => sum + (Number(inv.taxAmount) || 0), 0);
  }, [gstInvoices]);

  const totalTaxableSales = useMemo(() => {
    return gstInvoices.reduce((sum, inv) => sum + (Number(inv.totalAmount || 0) - Number(inv.taxAmount || 0)), 0);
  }, [gstInvoices]);

  // Tab 8: Employee Productivity
  const employeeProductivityData = useMemo(() => {
    const empMap: Record<string, { name: string; role: string; assigned: number; completed: number; loggedHours: number }> = {};

    employees.forEach((emp) => {
      empMap[emp.name] = {
        name: emp.name,
        role: emp.role || emp.dept || 'Team Member',
        assigned: 0,
        completed: 0,
        loggedHours: 0,
      };
    });

    tasks.forEach((t) => {
      const assignee = t.assignee || 'Unassigned';
      if (!empMap[assignee]) {
        empMap[assignee] = { name: assignee, role: 'Team Member', assigned: 0, completed: 0, loggedHours: 0 };
      }
      empMap[assignee].assigned += 1;
      if (t.status === 'Done') empMap[assignee].completed += 1;
      empMap[assignee].loggedHours += Number(t.logged) || 0;
    });

    return Object.values(empMap);
  }, [employees, tasks]);

  // Tab 9: Payroll List
  const payrollList = useMemo(() => {
    return employees.map((emp) => ({
      id: emp.employeeId || `EMP-${emp.id}`,
      name: emp.name,
      role: emp.role || 'Employee',
      dept: emp.dept || 'Engineering',
      joiningDate: emp.joiningDate || '—',
      salary: Number(emp.salary) || 0,
      status: emp.status || 'Active',
    }));
  }, [employees]);

  const totalPayroll = useMemo(() => {
    return payrollList.reduce((sum, e) => sum + e.salary, 0);
  }, [payrollList]);

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div className="page-title">Financial Reports</div>
        <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>Real-time business performance & analytics derived from Firestore</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        {/* Sidebar report list */}
        <div className="card" style={{ padding: 10, height: 'fit-content' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#697586', letterSpacing: '0.08em', padding: '6px 10px 4px', textTransform: 'uppercase' }}>
            Reports
          </div>
          {reports.map((r) => (
            <button
              key={r}
              onClick={() => setActiveReport(r)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                borderRadius: 8,
                border: 'none',
                fontSize: 13,
                cursor: 'pointer',
                background: activeReport === r ? '#EEF2FF' : 'transparent',
                color: activeReport === r ? '#3B5BDB' : '#697586',
                fontWeight: activeReport === r ? 600 : 400,
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Report content area */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>{activeReport}</div>
              <div style={{ fontSize: 12.5, color: '#697586' }}>Real Business Data · {periodFilter}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                className="select-base"
                style={{ fontSize: 12.5 }}
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value as any)}
              >
                <option value="All Time">All Time</option>
                <option value="This FY">This FY</option>
                <option value="This Quarter">This Quarter</option>
                <option value="This Month">This Month</option>
              </select>
            </div>
          </div>

          {/* 1. PROFIT & LOSS */}
          {activeReport === 'Profit & Loss' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                {[
                  { label: 'Total Revenue', value: formatINR(totalRevenue), color: '#12B76A' },
                  { label: 'Total Expenses', value: formatINR(totalExpenses), color: '#EF4444' },
                  { label: 'Net Profit', value: formatINR(netProfit), color: netProfit >= 0 ? '#3B5BDB' : '#EF4444' },
                  { label: 'Profit Margin', value: `${profitMargin}%`, color: '#8B5CF6' },
                ].map((s) => (
                  <div key={s.label} className="stat-card" style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'Plus Jakarta Sans' }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Revenue, Expenses & Profit Breakdown</div>
                {monthlyPLData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={monthlyPLData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#697586' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#697586' }} axisLine={false} tickLine={false} tickFormatter={(v) => '₹' + (v / 1000) + 'K'} />
                      <Tooltip formatter={(v: any) => [formatINR(v)]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="revenue" fill="#3B5BDB" radius={[3, 3, 0, 0]} name="Revenue" />
                      <Bar dataKey="expenses" fill="#F59E0B" radius={[3, 3, 0, 0]} name="Expenses" />
                      <Bar dataKey="profit" fill="#12B76A" radius={[3, 3, 0, 0]} name="Net Profit" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: '#697586' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>No P&L transactions recorded for this period</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Record client payments or company expenses in Firestore to generate real P&L analytics.</div>
                  </div>
                )}
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>MONTH</th>
                      <th style={{ textAlign: 'right' }}>REVENUE</th>
                      <th style={{ textAlign: 'right' }}>EXPENSES</th>
                      <th style={{ textAlign: 'right' }}>NET PROFIT</th>
                      <th style={{ textAlign: 'right' }}>MARGIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyPLData.map((d) => (
                      <tr key={d.month}>
                        <td style={{ fontWeight: 600 }}>{d.month}</td>
                        <td style={{ textAlign: 'right', color: '#12B76A', fontWeight: 600 }}>{formatINR(d.revenue)}</td>
                        <td style={{ textAlign: 'right', color: '#EF4444', fontWeight: 600 }}>{formatINR(d.expenses)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(d.profit)}</td>
                        <td style={{ textAlign: 'right', color: '#8B5CF6', fontWeight: 600 }}>
                          {d.revenue > 0 ? Math.round((d.profit / d.revenue) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                    {monthlyPLData.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>
                          No monthly transactions available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 2. REVENUE */}
          {activeReport === 'Revenue' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                {[
                  { label: 'Total Invoiced', value: formatINR(totalInvoiced), color: '#3B5BDB' },
                  { label: 'Received Revenue', value: formatINR(totalRevenue), color: '#12B76A' },
                  { label: 'Pending Revenue', value: formatINR(pendingRevenue), color: '#F59E0B' },
                ].map((s) => (
                  <div key={s.label} className="stat-card" style={{ flex: 1 }}>
                    <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'Plus Jakarta Sans' }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Payments Received Log</div>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>CLIENT</th>
                      <th>PAYMENT METHOD</th>
                      <th>REFERENCE</th>
                      <th style={{ textAlign: 'right' }}>AMOUNT</th>
                      <th>DATE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>{p.clientName || '—'}</td>
                        <td><span className="badge badge-blue">{p.method || '—'}</span></td>
                        <td style={{ fontSize: 12, color: '#697586' }}>{p.referenceNumber || '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A' }}>{formatINR(p.amount)}</td>
                        <td>{p.date || '—'}</td>
                      </tr>
                    ))}
                    {filteredPayments.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>
                          No payment records found in Firestore.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 3. EXPENSES */}
          {activeReport === 'Expenses' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Total Expenses</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#EF4444', fontFamily: 'Plus Jakarta Sans' }}>{formatINR(totalExpenses)}</div>
                </div>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Categories Count</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>{expenseCategoryData.length}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div className="card" style={{ padding: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Expenses by Category</div>
                  {expenseCategoryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={expenseCategoryData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, pct }: any) => `${name} ${pct}%`} labelLine={false} fontSize={10}>
                          {expenseCategoryData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => [formatINR(v)]} contentStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#697586', fontSize: 12.5 }}>No expense records available.</div>
                  )}
                </div>

                <div className="card" style={{ padding: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Category Breakdown</div>
                  {expenseCategoryData.map((s) => (
                    <div key={s.name} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: '#1A1F36', fontWeight: 500 }}>{s.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{formatINR(s.value)}</span>
                      </div>
                      <div style={{ background: '#E5E9F2', borderRadius: 99, height: 6 }}>
                        <div style={{ background: s.color, borderRadius: 99, height: 6, width: `${s.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  {expenseCategoryData.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#697586', fontSize: 12.5 }}>No categories to display.</div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* 4. OUTSTANDING PAYMENTS */}
          {activeReport === 'Outstanding Payments' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Total Outstanding</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#F59E0B', fontFamily: 'Plus Jakarta Sans' }}>{formatINR(totalOutstanding)}</div>
                </div>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Unpaid Invoices</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>{outstandingInvoices.length}</div>
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>INVOICE #</th>
                      <th>CLIENT</th>
                      <th>DATE</th>
                      <th>DUE DATE</th>
                      <th style={{ textAlign: 'right' }}>TOTAL AMOUNT</th>
                      <th style={{ textAlign: 'right' }}>BALANCE DUE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstandingInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                        <td>{inv.clientName}</td>
                        <td>{inv.date}</td>
                        <td style={{ color: '#EF4444' }}>{inv.dueDate || '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatINR(inv.totalAmount)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>{formatINR(inv.balance ?? (inv.totalAmount - (inv.paidAmount || 0)))}</td>
                        <td><span className="badge badge-amber">{inv.status || 'Sent'}</span></td>
                      </tr>
                    ))}
                    {outstandingInvoices.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>
                          🎉 No outstanding payments. All invoices are settled or none exist!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 5. CLIENT REVENUE */}
          {activeReport === 'Client Revenue' && (
            <>
              <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Revenue by Client</div>
                {clientRevData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={clientRevData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#697586' }} axisLine={false} tickLine={false} tickFormatter={(v) => '₹' + (v / 1000) + 'K'} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#697586' }} axisLine={false} tickLine={false} width={100} />
                      <Tooltip formatter={(v: any) => [formatINR(v)]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="paid" fill="#3B5BDB" radius={[0, 4, 4, 0]} name="Collected Revenue" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ padding: '30px', textAlign: 'center', color: '#697586', fontSize: 12.5 }}>No client revenue available.</div>
                )}
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>CLIENT</th>
                      <th>SERVICE</th>
                      <th style={{ textAlign: 'right' }}>TOTAL VALUE</th>
                      <th style={{ textAlign: 'right' }}>COLLECTED</th>
                      <th style={{ textAlign: 'right' }}>PENDING</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientRevData.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td style={{ fontSize: 12.5, color: '#697586' }}>{c.service}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatINR(c.totalValue)}</td>
                        <td style={{ textAlign: 'right', color: '#12B76A', fontWeight: 600 }}>{formatINR(c.paid)}</td>
                        <td style={{ textAlign: 'right', color: c.pending > 0 ? '#F59E0B' : '#697586', fontWeight: 600 }}>{formatINR(c.pending)}</td>
                      </tr>
                    ))}
                    {clientRevData.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>
                          No client revenue records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 6. SERVICE REVENUE */}
          {activeReport === 'Service Revenue' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Revenue by Service</div>
                {serviceRevData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={serviceRevData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, pct }: any) => `${name} ${pct}%`} labelLine={false} fontSize={10}>
                        {serviceRevData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => [formatINR(v)]} contentStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: '#697586', fontSize: 12.5 }}>No service revenue data available.</div>
                )}
              </div>

              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Service Breakdown</div>
                {serviceRevData.map((s) => (
                  <div key={s.name} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: '#1A1F36', fontWeight: 500 }}>{s.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{formatINR(s.value)}</span>
                    </div>
                    <div style={{ background: '#E5E9F2', borderRadius: 99, height: 6 }}>
                      <div style={{ background: s.color, borderRadius: 99, height: 6, width: `${s.pct}%` }} />
                    </div>
                  </div>
                ))}
                {serviceRevData.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '30px', color: '#697586', fontSize: 12.5 }}>No services recorded.</div>
                )}
              </div>
            </div>
          )}

          {/* 7. GST SUMMARY */}
          {activeReport === 'GST Summary' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Output GST Collected</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#12B76A', fontFamily: 'Plus Jakarta Sans' }}>{formatINR(totalGSTCollected)}</div>
                </div>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Taxable Sales</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#3B5BDB', fontFamily: 'Plus Jakarta Sans' }}>{formatINR(totalTaxableSales)}</div>
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>INVOICE #</th>
                      <th>CLIENT</th>
                      <th>GSTIN</th>
                      <th style={{ textAlign: 'right' }}>TAXABLE VALUE</th>
                      <th style={{ textAlign: 'right' }}>TAX AMOUNT</th>
                      <th style={{ textAlign: 'right' }}>TOTAL AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gstInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                        <td>{inv.clientName}</td>
                        <td style={{ fontSize: 12, color: '#697586' }}>{inv.gstin || '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatINR(Number(inv.totalAmount || 0) - Number(inv.taxAmount || 0))}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A' }}>{formatINR(Number(inv.taxAmount || 0))}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(Number(inv.totalAmount || 0))}</td>
                      </tr>
                    ))}
                    {gstInvoices.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>
                          No GST invoices recorded in Firestore.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 8. EMPLOYEE PRODUCTIVITY */}
          {activeReport === 'Employee Productivity' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Team Members</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#3B5BDB', fontFamily: 'Plus Jakarta Sans' }}>{employees.length}</div>
                </div>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Total Tasks Completed</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#12B76A', fontFamily: 'Plus Jakarta Sans' }}>
                    {tasks.filter((t) => t.status === 'Done').length} / {tasks.length}
                  </div>
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>EMPLOYEE</th>
                      <th>ROLE</th>
                      <th style={{ textAlign: 'center' }}>ASSIGNED TASKS</th>
                      <th style={{ textAlign: 'center' }}>COMPLETED</th>
                      <th style={{ textAlign: 'right' }}>LOGGED HOURS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeProductivityData.map((e) => (
                      <tr key={e.name}>
                        <td style={{ fontWeight: 600 }}>{e.name}</td>
                        <td style={{ fontSize: 12.5, color: '#697586' }}>{e.role}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{e.assigned}</td>
                        <td style={{ textAlign: 'center', color: '#12B76A', fontWeight: 700 }}>{e.completed}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{e.loggedHours} hrs</td>
                      </tr>
                    ))}
                    {employeeProductivityData.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>
                          No employee productivity records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 9. PAYROLL */}
          {activeReport === 'Payroll' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Total Monthly Payroll</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#3B5BDB', fontFamily: 'Plus Jakarta Sans' }}>{formatINR(totalPayroll)}</div>
                </div>
                <div className="stat-card" style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Employees Count</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>{payrollList.length}</div>
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>EMPLOYEE ID</th>
                      <th>NAME</th>
                      <th>ROLE</th>
                      <th>DESIGNATION</th>
                      <th style={{ textAlign: 'right' }}>MONTHLY SALARY</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollList.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.id}</td>
                        <td style={{ fontWeight: 600 }}>{e.name}</td>
                        <td style={{ fontSize: 12.5, color: '#697586' }}>{e.role}</td>
                        <td>{e.role}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#3B5BDB' }}>{formatINR(e.salary)}</td>
                        <td><span className="badge badge-green">{e.status}</span></td>
                      </tr>
                    ))}
                    {payrollList.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>
                          No payroll records found in Firestore.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
