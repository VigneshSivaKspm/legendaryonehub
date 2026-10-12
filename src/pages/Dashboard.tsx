import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { db } from '../db/database';
import { useAuth } from '../context/AuthContext';
import { computeProjectFinancials } from '../utils/financials';

interface DashboardProps {
  onNav?: (screen: string) => void;
  onViewClient?: (id: number | string) => void;
  onViewProject?: (id: number | string) => void;
}

function fmt(n: number) {
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K';
  return '₹' + n.toLocaleString('en-IN');
}

function StatCard({
  label,
  value,
  sub,
  color,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className="stat-card"
      style={{
        flex: 1,
        minWidth: 160,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onClick={onClick}
    >
      <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'Plus Jakarta Sans', color: color || '#1A1F36', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#697586', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard({ onNav, onViewClient, onViewProject }: DashboardProps) {
  const { user, companyProfile } = useAuth();

  // Fetch real Dexie persisted tables
  const clients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const invoices = useLiveQuery(() => db.invoices.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const expenses = useLiveQuery(() => db.expenses.toArray(), []) || [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const attendance = useLiveQuery(() => db.attendance.toArray(), []) || [];

  // Helper date parsing
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const getGreeting = () => {
    const hrs = today.getHours();
    if (hrs < 12) return 'Good Morning ☀️';
    if (hrs < 17) return 'Good Afternoon 🌤️';
    return 'Good Evening 🌙';
  };

  const formattedDate = today.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Calculate Real KPIs
  const totalClients = clients.length;
  const activeProjects = projects.filter((p) => p.status === 'In Progress').length;

  // Helper function to check if date string belongs to current month & year
  const isThisMonth = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }
    // Try DD/MM/YYYY
    const parts = dateStr.split(/[\/\-]/);
    if (parts.length === 3) {
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      return month === currentMonth && year === currentYear;
    }
    return false;
  };

  // Monthly Revenue (sum of payments this month)
  const monthlyRevenue = payments
    .filter((p) => isThisMonth(p.date))
    .reduce((acc, p) => acc + (p.amount || 0), 0);

  // Pending Payments: unpaid balance across projects (from recorded payments), plus invoices not tied to a project
  const projectPending = projects
    .filter((p) => p.status !== 'Cancelled' && p.status !== 'Archived')
    .reduce((acc, p) => acc + computeProjectFinancials(p, payments, invoices, expenses).pending, 0);
  const generalInvoicePending = invoices
    .filter((inv) => !inv.projectId && inv.status !== 'Cancelled' && (inv.balance || 0) > 0)
    .reduce((acc, inv) => acc + (inv.balance || 0), 0);
  const pendingPayments = projectPending + generalInvoicePending;

  // Monthly Expenses (sum of expenses this month)
  const monthlyExpenses = expenses
    .filter((e) => isThisMonth(e.date))
    .reduce((acc, e) => acc + (e.amount || 0), 0);

  // Net Profit
  const netProfit = monthlyRevenue - monthlyExpenses;

  // Dynamic Revenue vs Expenses Chart Data (Last 6 Months)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const revenueChartData = [];
  let total6MonthRev = 0;
  let total6MonthExp = 0;

  for (let i = 5; i >= 0; i--) {
    const targetDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const mIdx = targetDate.getMonth();
    const yVal = targetDate.getFullYear();

    const revForMonth = payments
      .filter((p) => {
        if (!p.date) return false;
        const d = new Date(p.date);
        if (!isNaN(d.getTime())) {
          return d.getMonth() === mIdx && d.getFullYear() === yVal;
        }
        const parts = p.date.split(/[\/\-]/);
        if (parts.length === 3) {
          return parseInt(parts[1], 10) - 1 === mIdx && parseInt(parts[2], 10) === yVal;
        }
        return false;
      })
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    const expForMonth = expenses
      .filter((e) => {
        if (!e.date) return false;
        const d = new Date(e.date);
        if (!isNaN(d.getTime())) {
          return d.getMonth() === mIdx && d.getFullYear() === yVal;
        }
        const parts = e.date.split(/[\/\-]/);
        if (parts.length === 3) {
          return parseInt(parts[1], 10) - 1 === mIdx && parseInt(parts[2], 10) === yVal;
        }
        return false;
      })
      .reduce((acc, e) => acc + (e.amount || 0), 0);

    total6MonthRev += revForMonth;
    total6MonthExp += expForMonth;

    revenueChartData.push({
      month: monthNames[mIdx],
      revenue: revForMonth,
      expenses: expForMonth,
    });
  }

  const hasFinancialChartData = total6MonthRev > 0 || total6MonthExp > 0;

  // Project Status Pie Chart Data
  const statusCounts: Record<string, number> = {};
  projects.forEach((p) => {
    const st = p.status || 'Planning';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });

  const statusColors: Record<string, string> = {
    'In Progress': '#3B5BDB',
    'Active': '#3B5BDB',
    'Completed': '#12B76A',
    'Maintenance': '#0D9488',
    'Planning': '#F59E0B',
    'On Hold': '#697586',
    'Review': '#8B5CF6',
  };

  const projectStatusData = Object.keys(statusCounts).map((statusKey) => ({
    name: statusKey,
    value: statusCounts[statusKey],
    color: statusColors[statusKey] || '#697586',
  }));

  // Outstanding Payments List
  const outstandingList = invoices
    .filter((inv) => inv.status !== 'Cancelled' && (inv.balance || 0) > 0)
    .slice(0, 5);

  // Recent Payments List
  const recentPaymentsList = [...payments]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 5);

  // Today's Tasks
  const todayDateStr = today.toISOString().split('T')[0];
  const todayTasksList = tasks
    .filter((t) => {
      const taskDate = t.dueDate || t.deadline;
      return taskDate === todayDateStr || (t.status !== 'Completed' && t.status !== 'Done');
    })
    .slice(0, 4);

  // Attendance Today
  const todayAttendance = attendance.filter((a) => a.date === todayDateStr);
  const presentCount = todayAttendance.filter((a) => a.status === 'Present').length;
  const absentCount = todayAttendance.filter((a) => a.status === 'Absent').length;
  const leaveCount = todayAttendance.filter((a) => a.status === 'On Leave' || a.status === 'Half Day').length;

  return (
    <div style={{ padding: '24px 24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 22, fontWeight: 800, color: '#1A1F36' }}>
            {getGreeting()}, {user?.name || 'Partner'}
          </div>
          <div style={{ fontSize: 13.5, color: '#697586', marginTop: 3 }}>
            Here's what's happening at <strong>{companyProfile?.companyName || 'Legendary One Technologies'}</strong> — {formattedDate}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onNav && (
            <button className="btn-secondary" style={{ fontSize: 12.5 }} onClick={() => onNav('reports')}>
              📊 View Reports
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard
          label="Total Clients"
          value={totalClients.toString()}
          sub={totalClients === 0 ? 'No clients added' : `${totalClients} active client accounts`}
          onClick={() => onNav?.('clients')}
        />
        <StatCard
          label="Active Projects"
          value={activeProjects.toString()}
          sub={projects.length === 0 ? 'No projects created' : `${projects.length} total projects`}
          onClick={() => onNav?.('projects')}
        />
        <StatCard
          label="Monthly Revenue"
          value={fmt(monthlyRevenue)}
          sub="Payments received this month"
          color="#3B5BDB"
          onClick={() => onNav?.('payments')}
        />
        <StatCard
          label="Pending Payments"
          value={fmt(pendingPayments)}
          sub={`${outstandingList.length} outstanding invoices`}
          color={pendingPayments > 0 ? '#F59E0B' : '#697586'}
          onClick={() => onNav?.('invoices')}
        />
        <StatCard
          label="Monthly Expenses"
          value={fmt(monthlyExpenses)}
          sub="Recorded this month"
          onClick={() => onNav?.('expenses')}
        />
        <StatCard
          label="Net Profit"
          value={fmt(netProfit)}
          sub="Revenue minus expenses"
          color={netProfit >= 0 ? '#12B76A' : '#EF4444'}
          onClick={() => onNav?.('reports')}
        />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 }}>
        {/* Revenue vs Expenses Chart */}
        <div className="card" style={{ padding: 20, minHeight: 280, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>Revenue vs Expenses</div>
              <div style={{ fontSize: 12, color: '#697586' }}>Past 6 Months</div>
            </div>
            {hasFinancialChartData && (
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#697586' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B5BDB', display: 'inline-block' }} />
                  Revenue
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#697586' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
                  Expenses
                </span>
              </div>
            )}
          </div>

          {hasFinancialChartData ? (
            <div style={{ flex: 1, width: '100%', minHeight: 200 }}>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={revenueChartData}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B5BDB" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3B5BDB" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#697586' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#697586' }} axisLine={false} tickLine={false} tickFormatter={(v) => '₹' + v} />
                  <Tooltip formatter={(v: any) => ['₹' + Number(v).toLocaleString('en-IN')]} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E9F2' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#3B5BDB" strokeWidth={2} fill="url(#rev)" />
                  <Area type="monotone" dataKey="expenses" stroke="#F59E0B" strokeWidth={2} fill="url(#exp)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 20px', background: '#F8F9FC', borderRadius: 10, border: '1px dashed #E5E9F2', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1F36', marginBottom: 4 }}>No financial records yet</div>
              <div style={{ fontSize: 12, color: '#697586', maxWidth: 300, marginBottom: 12 }}>
                Record your first client payment or business expense to generate real monthly revenue trends.
              </div>
              {onNav && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => onNav('payments')}>
                    + Record Payment
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => onNav('expenses')}>
                    + Add Expense
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Project Status Donut */}
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 15, color: '#1A1F36', marginBottom: 4 }}>
            Project Status
          </div>
          <div style={{ fontSize: 12, color: '#697586', marginBottom: 12 }}>
            {projects.length === 0 ? 'No active projects' : `${projects.length} total projects`}
          </div>

          {projects.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={projectStatusData} cx="50%" cy="50%" innerRadius={42} outerRadius={65} paddingAngle={3} dataKey="value">
                    {projectStatusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {projectStatusData.map((d) => (
                  <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: 'inline-block' }} />
                      <span style={{ color: '#697586' }}>{d.name}</span>
                    </span>
                    <span style={{ fontWeight: 700, color: '#1A1F36' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 10px', background: '#F8F9FC', borderRadius: 10, border: '1px dashed #E5E9F2', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1F36', marginBottom: 4 }}>No projects created</div>
              <div style={{ fontSize: 11.5, color: '#697586', marginBottom: 10 }}>Start tracking project progress cleanly.</div>
              {onNav && (
                <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => onNav('projects')}>
                  + Add Project
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {/* Outstanding Payments */}
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>Outstanding Payments</div>
            {onNav && (
              <span style={{ fontSize: 12, color: '#3B5BDB', cursor: 'pointer', fontWeight: 600 }} onClick={() => onNav('invoices')}>
                View All →
              </span>
            )}
          </div>

          {outstandingList.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {outstandingList.map((inv) => (
                <div
                  key={inv.id}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}
                  onClick={() => onNav?.('invoices')}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>{inv.clientName}</div>
                    <div style={{ fontSize: 11.5, color: '#697586' }}>
                      {inv.invoiceNumber || `INV-${inv.id}`} · Due {inv.dueDate}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: inv.status === 'Overdue' ? '#EF4444' : '#1A1F36' }}>
                      ₹{(inv.balance || 0).toLocaleString('en-IN')}
                    </div>
                    <span className={`badge ${inv.status === 'Overdue' ? 'badge-red' : inv.status === 'Partially Paid' ? 'badge-amber' : 'badge-blue'}`} style={{ fontSize: 10 }}>
                      {inv.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 12px', background: '#F8F9FC', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>✅</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>No outstanding payments</div>
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 2 }}>All client invoices are fully paid!</div>
            </div>
          )}
        </div>

        {/* Recent Payments */}
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>Recent Payments</div>
            {onNav && (
              <span style={{ fontSize: 12, color: '#3B5BDB', cursor: 'pointer', fontWeight: 600 }} onClick={() => onNav('payments')}>
                View All →
              </span>
            )}
          </div>

          {recentPaymentsList.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentPaymentsList.map((p, i) => (
                <div
                  key={p.id || i}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}
                  onClick={() => onNav?.('payments')}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>{p.clientName}</div>
                    <div style={{ fontSize: 11.5, color: '#697586' }}>
                      {p.date} · {p.method}
                    </div>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#12B76A' }}>
                    +₹{p.amount.toLocaleString('en-IN')}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 12px', background: '#F8F9FC', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>💳</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>No payments recorded</div>
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 2 }}>Payments recorded from clients will appear here.</div>
            </div>
          )}
        </div>

        {/* Today's Tasks & Attendance */}
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>Today's Tasks</div>
            {onNav && (
              <span style={{ fontSize: 12, color: '#3B5BDB', cursor: 'pointer', fontWeight: 600 }} onClick={() => onNav('tasks')}>
                View All →
              </span>
            )}
          </div>

          {todayTasksList.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              {todayTasksList.map((t) => (
                <div
                  key={t.id}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '4px 0' }}
                  onClick={() => onNav?.('tasks')}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: t.priority === 'Urgent' ? '#EF4444' : t.priority === 'High' ? '#F59E0B' : '#3B5BDB',
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1F36', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title || t.task}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#697586' }}>
                      {t.assignedTo || t.assignee || 'Unassigned'} · {t.dueDate || t.deadline || 'Today'}
                    </div>
                  </div>
                  <span className={`badge ${t.status === 'Completed' || t.status === 'Done' ? 'badge-green' : t.status === 'In Progress' ? 'badge-blue' : 'badge-amber'}`} style={{ fontSize: 10, flexShrink: 0 }}>
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '16px 10px', background: '#F8F9FC', borderRadius: 8, textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#697586' }}>No tasks due today</div>
            </div>
          )}

          {/* Attendance Today Widget */}
          <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
              ATTENDANCE TODAY
            </div>
            <div style={{ display: 'flex', gap: 14, background: '#F8F9FC', padding: '10px 12px', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#12B76A' }}>{presentCount}</div>
                <div style={{ fontSize: 11, color: '#697586' }}>Present</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#EF4444' }}>{absentCount}</div>
                <div style={{ fontSize: 11, color: '#697586' }}>Absent</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#F59E0B' }}>{leaveCount}</div>
                <div style={{ fontSize: 11, color: '#697586' }}>On Leave</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
