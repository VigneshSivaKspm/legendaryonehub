import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Invoice } from '../db/database';
import { newestFirst } from '../utils/sort';
import { addInvoice, deleteInvoice } from '../services/invoiceService';
import { addPayment } from '../services/paymentService';
import { useToast } from '../context/ToastContext';
import { Trash2 } from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { belongsToClient, clientLabel } from '../utils/financials';

const statusColors: Record<string, string> = {
  Draft: 'badge-gray',
  Sent: 'badge-blue',
  'Partially Paid': 'badge-amber',
  Paid: 'badge-green',
  Overdue: 'badge-red',
};

export default function Invoices() {
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRecord, setShowRecord] = useState<Invoice | null>(null);
  const [showDetails, setShowDetails] = useState<Invoice | null>(null);
  const [deletingInvoice, setDeletingInvoice] = useState<Invoice | null>(null);
  const [search, setSearch] = useState('');

  // Form states
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [paymentRef, setPaymentRef] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New Invoice state
  const [newInvClientId, setNewInvClientId] = useState('');
  const [newInvProjectId, setNewInvProjectId] = useState('');
  const [newInvAmount, setNewInvAmount] = useState(0);
  const [newInvDueDate, setNewInvDueDate] = useState('');

  // Fetch live invoices, payments & clients from Dexie cache (synchronized in real time with Firestore)
  const invoices = useLiveQuery(async () => newestFirst(await db.invoices.toArray(), (i) => i.date), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const clients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];

  const newInvClient = clients.find((c) => String(c.id) === newInvClientId);
  const clientProjects = newInvClient
    ? projects.filter((p) => belongsToClient(p, newInvClient) && p.status !== 'Archived')
    : [];

  const resetNewInvoiceForm = () => {
    setNewInvClientId('');
    setNewInvProjectId('');
    setNewInvAmount(0);
    setNewInvDueDate('');
  };

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      const ms =
        (inv.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
        (inv.invoiceNumber || '').toLowerCase().includes(search.toLowerCase());
      const mst = statusFilter === 'All' || inv.status === statusFilter;
      return ms && mst;
    });
  }, [invoices, search, statusFilter]);

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
  const totalRevenue = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0);
  const totalPending = invoices.reduce((s, i) => s + (i.balance || 0), 0);
  const overdue = invoices.filter((i) => i.status === 'Overdue').reduce((s, i) => s + (i.balance || 0), 0);

  // Invoice Payments for Details Modal
  const invoicePayments = useMemo(() => {
    if (!showDetails) return [];
    return payments.filter(
      (p) =>
        (showDetails.id && String(p.invoiceId) === String(showDetails.id)) ||
        (showDetails.invoiceNumber && p.invoiceNumber === showDetails.invoiceNumber)
    );
  }, [payments, showDetails]);

  const handleOpenRecord = (inv: Invoice) => {
    setShowRecord(inv);
    setPaymentAmount(inv.balance || 0);
    setPaymentRef('');
  };

  const handleConfirmPayment = async () => {
    if (!showRecord) return;
    setIsSubmitting(true);
    try {
      await addPayment({
        paymentNumber: `PAY-${Date.now().toString().slice(-6)}`,
        clientName: showRecord.clientName,
        clientId: showRecord.clientId,
        invoiceNumber: showRecord.invoiceNumber,
        invoiceId: showRecord.id,
        projectId: showRecord.projectId,
        projectName: showRecord.projectName,
        amount: Number(paymentAmount) || 0,
        date: paymentDate,
        method: paymentMethod,
        referenceNumber: paymentRef,
        status: 'Confirmed',
      });
      showToast('Payment recorded successfully in Firestore!', 'success');
      setShowRecord(null);
    } catch (err) {
      console.error('Failed to record payment:', err);
      showToast('Failed to record payment.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvClient || newInvAmount <= 0) {
      showToast('Please select client and enter valid total amount.', 'error');
      return;
    }
    const linkedProject = clientProjects.find((p) => String(p.id) === newInvProjectId);
    setIsSubmitting(true);
    try {
      const invNum = `INV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
      await addInvoice({
        invoiceNumber: invNum,
        date: new Date().toLocaleDateString('en-GB'),
        clientId: newInvClient.id,
        clientName: newInvClient.name,
        gstin: newInvClient.gstin || undefined,
        projectId: linkedProject?.id,
        projectName: linkedProject?.name,
        totalAmount: Number(newInvAmount),
        paidAmount: 0,
        balance: Number(newInvAmount),
        dueDate: newInvDueDate
          ? new Date(newInvDueDate).toLocaleDateString('en-GB')
          : new Date().toLocaleDateString('en-GB'),
        status: 'Sent',
      });
      showToast(`Invoice "${invNum}" created in Firestore.`, 'success');
      setShowAddModal(false);
      resetNewInvoiceForm();
    } catch (err) {
      console.error('Failed to create invoice:', err);
      showToast('Failed to create invoice.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeleteInvoice = async () => {
    if (!deletingInvoice || !deletingInvoice.id) return;
    setIsSubmitting(true);
    try {
      const invNum = deletingInvoice.invoiceNumber || `INV-${deletingInvoice.id}`;
      await deleteInvoice(deletingInvoice.id);
      showToast(`Invoice "${invNum}" deleted successfully!`, 'info');
      setDeletingInvoice(null);
    } catch (err: any) {
      console.error('Failed to delete invoice:', err);
      showToast(err?.message || 'Failed to delete invoice.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      showToast('No invoice records to export.', 'info');
      return;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `legendary-one-gst-invoices-${dateStr}.csv`;

    const headers = [
      'Invoice Number',
      'Invoice Date',
      'Client',
      'Project',
      'Total Amount (INR)',
      'Paid Amount (INR)',
      'Balance (INR)',
      'Due Date',
      'Status',
    ];

    const rows = filtered.map((inv) => [
      `"${inv.invoiceNumber || `INV-${inv.id}`}"`,
      `"${inv.date || ''}"`,
      `"${inv.clientName || ''}"`,
      `"${inv.projectName || 'General'}"`,
      inv.totalAmount || 0,
      inv.paidAmount || 0,
      inv.balance || 0,
      `"${inv.dueDate || ''}"`,
      `"${inv.status || ''}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Exported ${filtered.length} invoice records to ${filename}.`, 'success');
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Invoices & GST</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>Manage GST invoices and track collections stored in Firestore</div>
        </div>
        <button className="btn-primary" onClick={() => { resetNewInvoiceForm(); setShowAddModal(true); }}>+ New Invoice</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Invoiced', value: '₹' + totalInvoiced.toLocaleString('en-IN') },
          { label: 'Collected', value: '₹' + totalRevenue.toLocaleString('en-IN'), color: '#12B76A' },
          { label: 'Pending', value: '₹' + totalPending.toLocaleString('en-IN'), color: '#F59E0B' },
          { label: 'Overdue', value: '₹' + overdue.toLocaleString('en-IN'), color: '#EF4444' },
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color || '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 0, padding: '12px 0 0' }}>
        {['All', 'Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{ padding: '7px 14px', borderRadius: '8px 8px 0 0', border: '1px solid ' + (statusFilter === s ? '#E5E9F2' : 'transparent'), borderBottom: statusFilter === s ? '1px solid #fff' : '1px solid #E5E9F2', background: statusFilter === s ? '#fff' : 'transparent', fontSize: 12.5, fontWeight: statusFilter === s ? 600 : 400, color: statusFilter === s ? '#1A1F36' : '#697586', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="card" style={{ borderRadius: '0 14px 14px 14px' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', maxWidth: 280 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
            <input className="input-base" style={{ paddingLeft: 30, fontSize: 13 }} placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn-secondary" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={handleExportCSV}>⬇ Export GST</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table-base">
            <thead>
              <tr>
                <th>INVOICE #</th>
                <th>DATE</th>
                <th>CLIENT</th>
                <th>PROJECT</th>
                <th style={{ textAlign: 'right' }}>TOTAL</th>
                <th style={{ textAlign: 'right' }}>PAID</th>
                <th style={{ textAlign: 'right' }}>BALANCE</th>
                <th>DUE DATE</th>
                <th>STATUS</th>
                <th style={{ textAlign: 'center' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td
                    style={{ fontWeight: 700, color: '#3B5BDB', cursor: 'pointer' }}
                    title="Click to view details"
                    onClick={() => setShowDetails(inv)}
                  >
                    {inv.invoiceNumber || `INV-${inv.id}`}
                  </td>
                  <td style={{ color: '#697586' }}>{inv.date}</td>
                  <td style={{ fontWeight: 600 }}>{inv.clientName}</td>
                  <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#697586', fontSize: 12.5 }}>{inv.projectName || 'General'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{inv.totalAmount.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', color: '#12B76A', fontWeight: 600 }}>₹{inv.paidAmount.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', color: inv.balance > 0 ? (inv.status === 'Overdue' ? '#EF4444' : '#F59E0B') : '#697586', fontWeight: 600 }}>
                    {inv.balance > 0 ? '₹' + inv.balance.toLocaleString('en-IN') : '—'}
                  </td>
                  <td style={{ color: inv.status === 'Overdue' ? '#EF4444' : '#697586', fontWeight: inv.status === 'Overdue' ? 600 : 400 }}>{inv.dueDate}</td>
                  <td><span className={`badge ${statusColors[inv.status] || 'badge-gray'}`}>{inv.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 11.5, padding: '4px 8px' }}
                        title="View Details"
                        onClick={() => setShowDetails(inv)}
                      >
                        View
                      </button>

                      {inv.balance > 0 && (
                        <button
                          className="btn-primary"
                          style={{ fontSize: 11.5, padding: '4px 8px' }}
                          title="Record Payment"
                          onClick={() => handleOpenRecord(inv)}
                        >
                          Pay
                        </button>
                      )}

                      <button
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#EF4444',
                          padding: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                        title="Delete Invoice"
                        onClick={() => setDeletingInvoice(inv)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: '#697586' }}>
                    No invoices recorded in Firestore yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Invoice Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" style={{ width: 440, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17 }}>Create New Invoice</div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateInvoice}>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Client *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={newInvClientId}
                    onChange={(e) => {
                      setNewInvClientId(e.target.value);
                      setNewInvProjectId('');
                    }}
                  >
                    <option value="">Select Client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={String(c.id)}>{clientLabel(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Project</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={newInvProjectId}
                    disabled={!newInvClient}
                    onChange={(e) => {
                      const id = e.target.value;
                      setNewInvProjectId(id);
                      const proj = clientProjects.find((p) => String(p.id) === id);
                      // Suggest the project's unpaid balance as the invoice amount
                      if (proj && !newInvAmount) {
                        setNewInvAmount(Math.max(0, (Number(proj.value) || 0) - (Number(proj.received) || 0)));
                      }
                    }}
                  >
                    <option value="">
                      {!newInvClient
                        ? 'Select a client first'
                        : clientProjects.length === 0
                        ? 'No projects for this client (General)'
                        : 'General (no project)'}
                    </option>
                    {clientProjects.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} — ₹{(Number(p.value) || 0).toLocaleString('en-IN')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Total Invoice Amount (₹) *</label>
                  <input className="input-base" type="number" value={newInvAmount || ''} onChange={(e) => setNewInvAmount(Number(e.target.value))} placeholder="e.g. 25000" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Due Date</label>
                  <input className="input-base" type="date" value={newInvDueDate} onChange={(e) => setNewInvDueDate(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={isSubmitting}>{isSubmitting ? 'Creating...' : 'Create Invoice'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Details Modal */}
      {showDetails && (
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
          onClick={() => setShowDetails(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 580,
              padding: 24,
              background: '#FFFFFF',
              borderRadius: 14,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1E293B' }}>
                  {showDetails.invoiceNumber || `INV-${showDetails.id}`}
                </div>
                <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
                  Issued on {showDetails.date || '-'} · Due on {showDetails.dueDate || '-'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`badge ${statusColors[showDetails.status] || 'badge-gray'}`}>
                  {showDetails.status}
                </span>
                <button
                  style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748B' }}
                  onClick={() => setShowDetails(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Grid Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20, background: '#F8FAFC', padding: 14, borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Client</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', marginTop: 2 }}>{showDetails.clientName}</div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Project</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', marginTop: 2 }}>{showDetails.projectName || 'General'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Total Amount</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1E293B', marginTop: 2, fontFamily: 'Plus Jakarta Sans' }}>
                  ₹{(showDetails.totalAmount || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Paid Amount</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#12B76A', marginTop: 2, fontFamily: 'Plus Jakarta Sans' }}>
                  ₹{(showDetails.paidAmount || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div style={{ gridColumn: 'span 2', borderTop: '1px solid #E2E8F0', paddingTop: 10, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Balance Due</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: showDetails.balance > 0 ? '#EF4444' : '#12B76A', fontFamily: 'Plus Jakarta Sans' }}>
                  ₹{(showDetails.balance || 0).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Payment History */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 13.5, color: '#1E293B', marginBottom: 8 }}>
                Payment History ({invoicePayments.length})
              </div>
              {invoicePayments.length === 0 ? (
                <div style={{ fontSize: 12.5, color: '#64748B', fontStyle: 'italic', background: '#F1F5F9', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                  No payment transactions recorded for this invoice yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                  {invoicePayments.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#F8FAFC', borderRadius: 8, fontSize: 12.5 }}>
                      <div>
                        <span style={{ fontWeight: 700, color: '#3B5BDB' }}>{p.paymentNumber || p.id}</span>
                        <span style={{ color: '#64748B', marginLeft: 8 }}>{p.date} · {p.method}</span>
                        {p.referenceNumber && <span style={{ color: '#94A3B8', marginLeft: 6 }}>({p.referenceNumber})</span>}
                      </div>
                      <div style={{ fontWeight: 700, color: '#12B76A' }}>
                        +₹{(Number(p.amount) || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid #E2E8F0', paddingTop: 14 }}>
              {showDetails.balance > 0 && (
                <button
                  className="btn-primary"
                  style={{ fontSize: 13 }}
                  onClick={() => {
                    const targetInv = showDetails;
                    setShowDetails(null);
                    handleOpenRecord(targetInv);
                  }}
                >
                  Record Payment
                </button>
              )}
              <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowDetails(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showRecord && (
        <div className="modal-overlay" onClick={() => setShowRecord(null)}>
          <div className="modal-box" style={{ width: 440, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17 }}>Record Payment</div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setShowRecord(null)}>×</button>
            </div>

            <div style={{ background: '#F8F9FC', borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: '#697586', marginBottom: 2 }}>{showRecord.invoiceNumber} · {showRecord.clientName}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#697586' }}>Balance Due</span>
                <span style={{ fontWeight: 800, fontSize: 17, color: '#EF4444', fontFamily: 'Plus Jakarta Sans' }}>₹{showRecord.balance.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Amount Received (₹)</label>
                <input className="input-base" type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(Number(e.target.value))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Payment Date</label>
                <input className="input-base" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Payment Method</label>
                <select className="select-base" style={{ width: '100%' }} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option>UPI</option><option>Bank Transfer</option><option>Cash</option><option>Cheque</option><option>Card</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Reference Number</label>
                <input className="input-base" placeholder="UTR / Transaction ID" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowRecord(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={handleConfirmPayment} disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Confirm Payment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Invoice Confirmation Modal */}
      {deletingInvoice && (
        <DeleteConfirmationModal
          isOpen={!!deletingInvoice}
          title="Delete Invoice"
          itemName={deletingInvoice.invoiceNumber || `INV-${deletingInvoice.id}`}
          description={
            <>
              Are you sure you want to delete invoice <strong style={{ color: '#1A1F36' }}>"{deletingInvoice.invoiceNumber || `INV-${deletingInvoice.id}`}"</strong>? This action will permanently remove the invoice record from Firestore and local cache.
            </>
          }
          isDeleting={isSubmitting}
          onConfirm={handleConfirmDeleteInvoice}
          onClose={() => setDeletingInvoice(null)}
        />
      )}
    </div>
  );
}

