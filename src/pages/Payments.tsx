import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Payment } from '../db/database';
import { addPayment, deletePayment } from '../services/paymentService';
import { useToast } from '../context/ToastContext';
import { Trash2 } from 'lucide-react';
import { belongsToClient, clientLabel } from '../utils/financials';

const methodColors: Record<string, string> = {
  'Bank Transfer': 'badge-blue',
  'UPI': 'badge-cyan',
  'Cash': 'badge-gray',
  'Cheque': 'badge-purple',
  'Card': 'badge-orange',
};

const statusColors: Record<string, string> = {
  Confirmed: 'badge-green',
  Pending: 'badge-amber',
  Failed: 'badge-red',
};

export default function Payments() {
  const { showToast } = useToast();

  // Search and Filters
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('All Clients');
  const [methodFilter, setMethodFilter] = useState('All Methods');
  const [statusFilter, setStatusFilter] = useState('All Statuses');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  // Form states for new payment
  const [clientName, setClientName] = useState('');
  const [invoiceId, setInvoiceId] = useState<string | number>('');
  const [projectId, setProjectId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod] = useState('UPI');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [status, setStatus] = useState<'Confirmed' | 'Pending'>('Confirmed');

  // Live query from Dexie cache (synchronized real-time with Firestore)
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const clients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const invoices = useLiveQuery(() => db.invoices.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];

  // Filter payments
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      const pNum = (p.paymentNumber || p.id || '').toString().toLowerCase();
      const cName = (p.clientName || '').toLowerCase();
      const invNum = (p.invoiceNumber || '').toLowerCase();
      const projName = (p.projectName || '').toLowerCase();
      const refNum = (p.referenceNumber || '').toLowerCase();
      const q = search.toLowerCase().trim();

      const matchesSearch =
        !q ||
        pNum.includes(q) ||
        cName.includes(q) ||
        invNum.includes(q) ||
        projName.includes(q) ||
        refNum.includes(q);

      const matchesClient = clientFilter === 'All Clients' || p.clientName === clientFilter;
      const matchesMethod = methodFilter === 'All Methods' || p.method === methodFilter;
      const matchesStatus = statusFilter === 'All Statuses' || p.status === statusFilter;

      return matchesSearch && matchesClient && matchesMethod && matchesStatus;
    });
  }, [payments, search, clientFilter, methodFilter, statusFilter]);

  // Unique client names for dropdown
  const uniqueClientNames = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c.name) set.add(c.name);
    });
    payments.forEach((p) => {
      if (p.clientName) set.add(p.clientName);
    });
    return Array.from(set);
  }, [clients, payments]);

  // Invoices & projects for selected client in modal
  const selectedClient = clients.find((c) => c.name === clientName);
  const clientInvoices = useMemo(() => {
    if (!clientName) return invoices.filter((i) => (i.balance || 0) > 0);
    return invoices.filter((i) => (selectedClient ? belongsToClient(i, selectedClient) : i.clientName === clientName));
  }, [invoices, clientName, selectedClient]);
  const clientProjects = useMemo(() => {
    if (!selectedClient) return [];
    return projects.filter((p) => belongsToClient(p, selectedClient));
  }, [projects, selectedClient]);

  const selectedInvoice = invoices.find((i) => String(i.id) === String(invoiceId));
  // An invoice tied to a project fixes the payment's project
  const invoiceLocksProject = !!selectedInvoice?.projectId;

  // Dynamic Date calculations
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentMonthName = now.toLocaleDateString('en-US', { month: 'short' });

  const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const lastMonthYear = lastMonthDate.getFullYear();
  const lastMonthNumber = lastMonthDate.getMonth();

  const metrics = useMemo(() => {
    let thisMonthTotal = 0;
    let thisMonthUPI = 0;
    let thisMonthBank = 0;
    let lastMonthTotal = 0;
    let totalAllTime = 0;

    const methodBreakdown: Record<string, { count: number; amount: number; color: string }> = {
      'Bank Transfer': { count: 0, amount: 0, color: '#3B5BDB' },
      'UPI': { count: 0, amount: 0, color: '#0EA5E9' },
      'Cheque': { count: 0, amount: 0, color: '#8B5CF6' },
      'Cash': { count: 0, amount: 0, color: '#94A3B8' },
      'Card': { count: 0, amount: 0, color: '#F97316' },
    };

    payments.forEach((p) => {
      const amt = Number(p.amount) || 0;
      totalAllTime += amt;

      const m = p.method || 'Other';
      if (!methodBreakdown[m]) {
        methodBreakdown[m] = { count: 0, amount: 0, color: '#64748B' };
      }
      methodBreakdown[m].count += 1;
      methodBreakdown[m].amount += amt;

      const dateStr = p.date || p.createdAt;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
            thisMonthTotal += amt;
            if (m === 'UPI') thisMonthUPI += amt;
            if (m === 'Bank Transfer') thisMonthBank += amt;
          } else if (d.getFullYear() === lastMonthYear && d.getMonth() === lastMonthNumber) {
            lastMonthTotal += amt;
          }
        }
      }
    });

    const avgPayment = payments.length > 0 ? Math.round(totalAllTime / payments.length) : 0;

    return {
      thisMonthTotal,
      thisMonthUPI,
      thisMonthBank,
      totalAllTime,
      lastMonthTotal,
      avgPayment,
      methodBreakdown,
    };
  }, [payments, currentYear, currentMonth, lastMonthYear, lastMonthNumber]);

  // Handle Client Selection in Modal
  const handleClientChange = (name: string) => {
    setClientName(name);
    setInvoiceId('');
    setProjectId('');
  };

  // Handle Invoice Selection in Modal
  const handleInvoiceChange = (invIdStr: string) => {
    setInvoiceId(invIdStr);
    if (!invIdStr) return;
    const selectedInv = invoices.find((i) => String(i.id) === invIdStr);
    if (selectedInv) {
      if (selectedInv.clientName) setClientName(selectedInv.clientName);
      const proj =
        projects.find((p) => selectedInv.projectId !== undefined && String(p.id) === String(selectedInv.projectId)) ||
        projects.find((p) => !!selectedInv.projectName && p.name === selectedInv.projectName);
      setProjectId(proj?.id !== undefined ? String(proj.id) : '');
      if (selectedInv.balance !== undefined && selectedInv.balance > 0) {
        setAmount(String(selectedInv.balance));
      }
    }
  };

  // Handle Form Reset
  const resetForm = () => {
    setClientName('');
    setInvoiceId('');
    setProjectId('');
    setAmount('');
    setDate(new Date().toISOString().split('T')[0]);
    setMethod('UPI');
    setReferenceNumber('');
    setStatus('Confirmed');
  };

  // Record Payment Submit Handler
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      showToast('Please select or enter a client name.', 'error');
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      showToast('Please enter a valid payment amount greater than ₹0.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedClientObj = clients.find((c) => c.name.toLowerCase() === clientName.trim().toLowerCase());
      const selectedInv = invoices.find((i) => String(i.id) === String(invoiceId));
      const payNum = `PAY-${Date.now().toString().slice(-6)}`;

      const paymentPayload: Omit<Payment, 'id'> = {
        paymentNumber: payNum,
        clientName: clientName.trim(),
        amount: numAmount,
        date: date || new Date().toISOString().split('T')[0],
        method,
        status,
      };

      const resolvedClientId = selectedClientObj?.id || selectedInv?.clientId;
      if (resolvedClientId !== undefined && resolvedClientId !== null && resolvedClientId !== '') {
        paymentPayload.clientId = resolvedClientId;
      }

      if (selectedInv?.invoiceNumber) {
        paymentPayload.invoiceNumber = selectedInv.invoiceNumber;
      }

      if (selectedInv?.id !== undefined && selectedInv?.id !== null && selectedInv?.id !== '') {
        paymentPayload.invoiceId = selectedInv.id;
      }

      const resolvedProject =
        projects.find((p) => String(p.id) === projectId) ||
        projects.find((p) => selectedInv?.projectId !== undefined && String(p.id) === String(selectedInv.projectId));
      if (resolvedProject?.id !== undefined) {
        paymentPayload.projectId = resolvedProject.id;
        paymentPayload.projectName = resolvedProject.name;
      } else if (selectedInv?.projectName) {
        paymentPayload.projectName = selectedInv.projectName;
      }

      if (referenceNumber.trim()) {
        paymentPayload.referenceNumber = referenceNumber.trim();
      }

      await addPayment(paymentPayload);

      showToast(`Payment ${payNum} recorded successfully!`, 'success');
      resetForm();
      setShowAddModal(false);
    } catch (err: any) {
      console.error('Failed to record payment:', err);
      showToast(err?.message || 'Failed to record payment.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Payment Deletion
  const handleDeletePayment = async (p: Payment) => {
    if (!p.id) return;
    if (!confirm(`Are you sure you want to delete payment ${p.paymentNumber || p.id}?`)) return;

    setDeletingId(p.id);
    try {
      await deletePayment(p.id);
      showToast(`Payment ${p.paymentNumber || p.id} deleted successfully.`, 'success');
    } catch (err: any) {
      console.error('Failed to delete payment:', err);
      showToast(err?.message || 'Failed to delete payment.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // Export CSV Handler
  const handleExportCSV = () => {
    if (filteredPayments.length === 0) {
      showToast('No payment records to export.', 'info');
      return;
    }

    const headers = ['Payment ID', 'Client Name', 'Invoice', 'Project', 'Amount (INR)', 'Date', 'Method', 'Reference', 'Status'];
    const rows = filteredPayments.map((p) => [
      `"${p.paymentNumber || p.id || ''}"`,
      `"${p.clientName || ''}"`,
      `"${p.invoiceNumber || ''}"`,
      `"${p.projectName || ''}"`,
      p.amount || 0,
      `"${p.date || ''}"`,
      `"${p.method || ''}"`,
      `"${p.referenceNumber || ''}"`,
      `"${p.status || 'Confirmed'}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `payments_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${filteredPayments.length} payment records.`, 'success');
  };

  const formatINR = (val: number) => '₹' + (val || 0).toLocaleString('en-IN');

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Payments</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Real-time client payments, transaction history, and method analytics
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={handleExportCSV}>
            ⬇ Export
          </button>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>
            + Record Payment
          </button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: `Total Received (${currentMonthName})`, value: formatINR(metrics.thisMonthTotal), color: '#12B76A' },
          { label: 'Via UPI (This Month)', value: formatINR(metrics.thisMonthUPI) },
          { label: 'Via Bank Transfer (This Month)', value: formatINR(metrics.thisMonthBank) },
          { label: 'All-Time Collected', value: formatINR(metrics.totalAllTime), color: '#3B5BDB' },
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color || '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        {/* Left Column: Payments Table Card */}
        <div className="card">
          {/* Filters Bar */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 280 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
              <input
                className="input-base"
                style={{ paddingLeft: 30, fontSize: 13 }}
                placeholder="Search payments, ID, ref..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="select-base"
              style={{ fontSize: 13, minWidth: 140 }}
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
            >
              <option value="All Clients">All Clients</option>
              {uniqueClientNames.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              className="select-base"
              style={{ fontSize: 13, minWidth: 130 }}
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
            >
              <option value="All Methods">All Methods</option>
              <option value="UPI">UPI</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
              <option value="Card">Card</option>
            </select>

            <select
              className="select-base"
              style={{ fontSize: 13, minWidth: 130 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All Statuses">All Statuses</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Pending">Pending</option>
              <option value="Failed">Failed</option>
            </select>

            {(search || clientFilter !== 'All Clients' || methodFilter !== 'All Methods' || statusFilter !== 'All Statuses') && (
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => {
                  setSearch('');
                  setClientFilter('All Clients');
                  setMethodFilter('All Methods');
                  setStatusFilter('All Statuses');
                }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>PAYMENT ID</th>
                  <th>CLIENT</th>
                  <th>INVOICE</th>
                  <th>PROJECT</th>
                  <th style={{ textAlign: 'right' }}>AMOUNT</th>
                  <th>DATE</th>
                  <th>METHOD</th>
                  <th>REFERENCE</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'center' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '48px 16px', color: '#697586' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>💳</div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#1A1F36', marginBottom: 4 }}>No payments found</div>
                      <div style={{ fontSize: 13 }}>
                        {search || clientFilter !== 'All Clients' || methodFilter !== 'All Methods' || statusFilter !== 'All Statuses'
                          ? 'Try adjusting your search or active filters.'
                          : 'Record your first client payment to view payment history and analytics.'}
                      </div>
                      {!search && clientFilter === 'All Clients' && methodFilter === 'All Methods' && statusFilter === 'All Statuses' && (
                        <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setShowAddModal(true)}>
                          + Record Payment
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700, color: '#3B5BDB', fontSize: 12.5 }}>
                        {p.paymentNumber || p.id}
                      </td>
                      <td style={{ fontWeight: 600 }}>{p.clientName || '-'}</td>
                      <td style={{ fontSize: 12.5, color: '#697586' }}>{p.invoiceNumber || '-'}</td>
                      <td style={{ fontSize: 12.5, color: '#697586', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.projectName || '-'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A', fontSize: 14 }}>
                        +{formatINR(Number(p.amount) || 0)}
                      </td>
                      <td style={{ color: '#697586', fontSize: 12.5 }}>{p.date || '-'}</td>
                      <td>
                        <span className={`badge ${methodColors[p.method] || 'badge-gray'}`}>{p.method || 'Other'}</span>
                      </td>
                      <td style={{ fontSize: 11.5, color: '#697586' }}>{p.referenceNumber || '-'}</td>
                      <td>
                        <span className={`badge ${statusColors[p.status] || 'badge-green'}`}>{p.status || 'Confirmed'}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#EF4444',
                            fontSize: 14,
                            opacity: deletingId === p.id ? 0.4 : 1,
                          }}
                          disabled={deletingId === p.id}
                          title="Delete Payment"
                          onClick={() => handleDeletePayment(p)}
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
        </div>

        {/* Right Column: Dynamic Breakdown & Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Payment Methods Breakdown */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, marginBottom: 14 }}>
              Payment Methods
            </div>
            {Object.entries(metrics.methodBreakdown).map(([mName, mData]) => {
              const pct = metrics.totalAllTime > 0 ? ((mData.amount / metrics.totalAllTime) * 100).toFixed(1) : '0';
              return (
                <div key={mName} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{mName}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{formatINR(mData.amount)}</span>
                  </div>
                  <div style={{ background: '#E5E9F2', borderRadius: 99, height: 6 }}>
                    <div style={{ background: mData.color, borderRadius: 99, height: 6, width: `${pct}%`, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#697586', marginTop: 2 }}>
                    {mData.count} {mData.count === 1 ? 'transaction' : 'transactions'} ({pct}%)
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Stats */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
              Quick Stats
            </div>
            {[
              { label: 'This Month', value: formatINR(metrics.thisMonthTotal), color: '#12B76A' },
              { label: 'Last Month', value: formatINR(metrics.lastMonthTotal), color: '#1A1F36' },
              { label: 'Avg Payment', value: formatINR(metrics.avgPayment), color: '#1A1F36' },
            ].map((s) => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ fontSize: 12.5, color: '#697586' }}>{s.label}</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Record Payment Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 520,
              padding: 24,
              background: '#FFFFFF',
              borderRadius: 12,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1E293B' }}>
                + Record Payment
              </div>
              <button
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748B' }}
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordPayment} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Client Name Input/Select */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                  Client Name <span style={{ color: '#EF4444' }}>*</span>
                </label>
                {clients.length > 0 ? (
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={clientName}
                    onChange={(e) => handleClientChange(e.target.value)}
                  >
                    <option value="">-- Select Client --</option>
                    {clients.map((c) => (
                      <option key={c.id || c.name} value={c.name}>{clientLabel(c)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input-base"
                    style={{ width: '100%' }}
                    placeholder="Enter Client Name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                )}
              </div>

              {/* Related Invoice Select */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                  Invoice (Optional)
                </label>
                <select
                  className="select-base"
                  style={{ width: '100%' }}
                  value={invoiceId}
                  onChange={(e) => handleInvoiceChange(e.target.value)}
                >
                  <option value="">-- No Invoice Selected --</option>
                  {clientInvoices.map((inv) => (
                    <option key={inv.id} value={String(inv.id)}>
                      {inv.invoiceNumber} - Balance: ₹{(inv.balance || 0).toLocaleString('en-IN')}
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Name & Amount */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                    Project
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={projectId}
                    disabled={!selectedClient || invoiceLocksProject}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">
                      {!selectedClient ? 'Select a client first' : clientProjects.length ? 'General (no project)' : 'No projects for this client'}
                    </option>
                    {clientProjects.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.name}</option>
                    ))}
                  </select>
                  {invoiceLocksProject && (
                    <div style={{ fontSize: 11, color: '#697586', marginTop: 4 }}>Taken from {selectedInvoice?.invoiceNumber}</div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                    Amount (₹) <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="input-base"
                    style={{ width: '100%' }}
                    placeholder="e.g. 25000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>

              {/* Date & Payment Method */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                    Payment Date <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="input-base"
                    style={{ width: '100%' }}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                    Payment Method
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="UPI">UPI</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Card">Card</option>
                  </select>
                </div>
              </div>

              {/* Reference Number & Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                    Reference / UTR No.
                  </label>
                  <input
                    className="input-base"
                    style={{ width: '100%' }}
                    placeholder="e.g. UTR-987654321"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                    Payment Status
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'Confirmed' | 'Pending')}
                  >
                    <option value="Confirmed">Confirmed</option>
                    <option value="Pending">Pending</option>
                  </select>
                </div>
              </div>

              {/* Form Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, borderTop: '1px solid #E2E8F0', paddingTop: 14 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

