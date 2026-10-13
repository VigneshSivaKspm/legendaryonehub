import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Quotation, type QuotationItem } from '../db/database';
import { newestFirst } from '../utils/sort';
import { addQuotation, updateQuotation, deleteQuotation } from '../services/quotationService';
import { useToast } from '../context/ToastContext';
import { Trash2 } from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const statusColors: Record<string, string> = {
  'Draft': 'badge-gray',
  'Sent': 'badge-blue',
  'Negotiation': 'badge-amber',
  'Converted': 'badge-green',
  'Declined': 'badge-red',
  'Rejected': 'badge-red',
};

interface QuotationLineItemState {
  description: string;
  qty: string | number;
  rate: string | number;
  amount: number;
}

interface QuotationFormErrors {
  clientName?: string;
  projectName?: string;
  lineItems?: string;
  itemErrors?: Array<{ description?: string; qty?: string; rate?: string }>;
}

export default function Quotations() {
  const { showToast } = useToast();

  const [showEditor, setShowEditor] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Preview, Send & Delete Modal States
  const [previewQuotation, setPreviewQuotation] = useState<Quotation | null>(null);
  const [sendTargetQuotation, setSendTargetQuotation] = useState<Quotation | null>(null);
  const [quotationToDelete, setQuotationToDelete] = useState<Quotation | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form states for New / Edit Quotation modal
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [quotationDate, setQuotationDate] = useState(new Date().toISOString().split('T')[0]);
  const [validityDate, setValidityDate] = useState(
    new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0]
  );
  const [lineItems, setLineItems] = useState<QuotationLineItemState[]>([
    { description: '', qty: '', rate: '', amount: 0 },
  ]);
  const [discount, setDiscount] = useState<string | number>('');
  const [errors, setErrors] = useState<QuotationFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live queries from Dexie cache (synchronized real-time with Firestore)
  const quotations = useLiveQuery(async () => newestFirst(await db.quotations.toArray(), (q) => q.date), []) || [];
  const dbClients = useLiveQuery(() => db.clients.toArray(), []) || [];

  // Summary card metric calculations derived exclusively from real quotation records
  const totalQuotations = quotations.length;

  const pendingResponseCount = useMemo(() => {
    return quotations.filter((q) => q.status === 'Sent' || q.status === 'Negotiation').length;
  }, [quotations]);

  const convertedCount = useMemo(() => {
    return quotations.filter((q) => q.status === 'Converted').length;
  }, [quotations]);

  const pipelineValue = useMemo(() => {
    return quotations.reduce((acc, q) => {
      const status = q.status || 'Draft';
      if (status !== 'Declined' && (status as string) !== 'Rejected') {
        const val = Number(q.totalAmount ?? (q as any).total ?? q.amount) || 0;
        return acc + val;
      }
      return acc;
    }, 0);
  }, [quotations]);

  const formatPipelineValue = (val: number): string => {
    if (!val || val === 0) return '₹0';
    if (val >= 100000) {
      const inLakhs = (val / 100000).toFixed(1).replace(/\.0$/, '');
      return `₹${inLakhs}L`;
    }
    return `₹${val.toLocaleString('en-IN')}`;
  };

  const filtered = useMemo(() => {
    return quotations.filter((q) => {
      const searchLower = search.toLowerCase().trim();
      const qNum = (q.quotationNumber || q.id || '').toString().toLowerCase();
      const client = (q.clientName || (q as any).client || '').toLowerCase();
      const proj = (q.projectName || (q as any).project || '').toLowerCase();

      const matchesSearch =
        !searchLower ||
        qNum.includes(searchLower) ||
        client.includes(searchLower) ||
        proj.includes(searchLower);

      const matchesStatus = statusFilter === 'All' || q.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [quotations, search, statusFilter]);

  // Modal Line Items & Tax Calculations
  const subtotal = useMemo(() => {
    return lineItems.reduce((s, l) => {
      const q = Number(l.qty) || 0;
      const r = Number(l.rate) || 0;
      return s + (q > 0 && r >= 0 ? q * r : 0);
    }, 0);
  }, [lineItems]);

  const discountNum = Math.max(0, Number(discount) || 0);
  const taxable = Math.max(0, subtotal - discountNum);
  const cgst = taxable * 0.09;
  const sgst = taxable * 0.09;
  const grandTotal = taxable + cgst + sgst;

  const handleOpenEditor = () => {
    setEditingQuotation(null);
    setClientName('');
    setProjectName('');
    setQuotationDate(new Date().toISOString().split('T')[0]);
    setValidityDate(new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0]);
    setLineItems([{ description: '', qty: '', rate: '', amount: 0 }]);
    setDiscount('');
    setErrors({});
    setShowEditor(true);
  };

  const handleOpenEditModal = (q: Quotation) => {
    setEditingQuotation(q);
    setClientName(q.clientName || (q as any).client || '');
    setProjectName(q.projectName || (q as any).project || '');
    setQuotationDate(q.date || new Date().toISOString().split('T')[0]);
    setValidityDate(q.validityDate || (q as any).validity || '');
    setDiscount(q.discount !== undefined ? String(q.discount) : '');

    const itemsList: QuotationItem[] = q.items || q.lineItems || [];
    if (itemsList.length > 0) {
      setLineItems(
        itemsList.map((item) => ({
          description: item.description || '',
          qty: item.qty ?? 1,
          rate: item.rate ?? 0,
          amount: Number(item.amount) || (Number(item.qty) || 1) * (Number(item.rate) || 0),
        }))
      );
    } else if (q.amount) {
      setLineItems([
        {
          description: q.projectName || (q as any).project || 'Quotation Services',
          qty: 1,
          rate: q.amount,
          amount: q.amount,
        },
      ]);
    } else {
      setLineItems([{ description: '', qty: '', rate: '', amount: 0 }]);
    }

    setErrors({});
    setShowEditor(true);
  };

  const handleCloseEditor = () => {
    setShowEditor(false);
    setEditingQuotation(null);
    setClientName('');
    setProjectName('');
    setLineItems([{ description: '', qty: '', rate: '', amount: 0 }]);
    setDiscount('');
    setErrors({});
  };

  const handleAddLineItem = () => {
    setLineItems((prev) => [...prev, { description: '', qty: '', rate: '', amount: 0 }]);
    if (errors.lineItems) {
      setErrors((prev) => ({ ...prev, lineItems: undefined }));
    }
  };

  const handleRemoveLineItem = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
    if (errors.itemErrors) {
      setErrors((prev) => ({
        ...prev,
        itemErrors: prev.itemErrors?.filter((_, i) => i !== index),
      }));
    }
  };

  const handleLineItemChange = (index: number, field: 'description' | 'qty' | 'rate', value: string) => {
    setLineItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: value };
      const q = Number(item.qty) || 0;
      const r = Number(item.rate) || 0;
      item.amount = q > 0 && r >= 0 ? q * r : 0;
      updated[index] = item;
      return updated;
    });

    if (errors.lineItems || errors.itemErrors) {
      setErrors((prev) => ({ ...prev, lineItems: undefined, itemErrors: undefined }));
    }
  };

  const validateForm = (): QuotationFormErrors => {
    const formErrors: QuotationFormErrors = {};
    const itemErrors: Array<{ description?: string; qty?: string; rate?: string }> = [];
    let hasItemErrors = false;

    if (!clientName || !clientName.trim()) {
      formErrors.clientName = 'Client name is required.';
    }

    if (!projectName || !projectName.trim()) {
      formErrors.projectName = 'Service or project name is required.';
    }

    if (lineItems.length === 0) {
      formErrors.lineItems = 'At least one line item is required.';
    } else {
      lineItems.forEach((item) => {
        const rowErr: { description?: string; qty?: string; rate?: string } = {};

        if (!item.description || !item.description.trim()) {
          rowErr.description = 'Description is required.';
          hasItemErrors = true;
        }

        const qStr = String(item.qty ?? '').trim();
        const qNum = Number(qStr);
        if (!qStr) {
          rowErr.qty = 'Qty is required.';
          hasItemErrors = true;
        } else if (isNaN(qNum) || qNum <= 0) {
          rowErr.qty = 'Must be > 0.';
          hasItemErrors = true;
        }

        const rStr = String(item.rate ?? '').trim();
        const rNum = Number(rStr);
        if (!rStr) {
          rowErr.rate = 'Rate is required.';
          hasItemErrors = true;
        } else if (isNaN(rNum) || rNum < 0) {
          rowErr.rate = 'Must be ≥ 0.';
          hasItemErrors = true;
        }

        itemErrors.push(rowErr);
      });

      if (hasItemErrors) {
        formErrors.itemErrors = itemErrors;
        formErrors.lineItems = 'Please fix all invalid line item fields.';
      }
    }

    return formErrors;
  };

  const handleSaveQuotation = async (status: 'Draft' | 'Sent') => {
    const formErrors = validateForm();

    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      showToast('Please fix all validation errors before saving.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanItems: QuotationItem[] = lineItems.map((li) => ({
        description: li.description.trim(),
        qty: Number(li.qty) || 1,
        rate: Number(li.rate) || 0,
        amount: (Number(li.qty) || 1) * (Number(li.rate) || 0),
      }));

      if (editingQuotation && editingQuotation.id) {
        // Update existing quotation in Firestore first, then Dexie
        await updateQuotation(editingQuotation.id, {
          clientName: clientName.trim(),
          projectName: projectName.trim(),
          date: quotationDate,
          validityDate,
          amount: subtotal,
          discount: discountNum,
          gstAmount: cgst + sgst,
          totalAmount: grandTotal,
          items: cleanItems,
          lineItems: cleanItems,
          status: status || editingQuotation.status || 'Draft',
        });
        showToast(
          `Quotation ${editingQuotation.quotationNumber || editingQuotation.id} updated successfully!`,
          'success'
        );
      } else {
        // Create new quotation in Firestore first, then Dexie
        const quotationNumber = `QT-${String(quotations.length + 1).padStart(3, '0')}`;
        await addQuotation({
          quotationNumber,
          clientName: clientName.trim(),
          projectName: projectName.trim(),
          date: quotationDate,
          validityDate,
          amount: subtotal,
          discount: discountNum,
          gstAmount: cgst + sgst,
          totalAmount: grandTotal,
          items: cleanItems,
          lineItems: cleanItems,
          status,
        });
        showToast(`Quotation ${quotationNumber} saved successfully!`, 'success');
      }

      handleCloseEditor();
    } catch (err: any) {
      console.error('Failed to save quotation:', err);
      showToast(err?.message || 'Failed to save quotation.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmMarkAsSent = async () => {
    if (!sendTargetQuotation || !sendTargetQuotation.id) return;
    setIsUpdatingStatus(true);
    try {
      await updateQuotation(sendTargetQuotation.id, { status: 'Sent' });
      showToast(
        `Quotation ${sendTargetQuotation.quotationNumber || sendTargetQuotation.id} marked as Sent!`,
        'success'
      );
      setSendTargetQuotation(null);
    } catch (err: any) {
      console.error('Failed to update quotation status:', err);
      showToast(err?.message || 'Failed to update quotation status.', 'error');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!quotationToDelete || !quotationToDelete.id) return;
    setIsDeleting(true);
    try {
      // Deletes from Firestore first, then local Dexie cache
      await deleteQuotation(quotationToDelete.id);
      showToast('Quotation deleted successfully', 'info');
      setQuotationToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete quotation:', err);
      showToast(err?.message || 'Failed to delete quotation', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Quotations</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>Create and manage client quotations</div>
        </div>
        <button className="btn-primary" onClick={handleOpenEditor}>+ New Quotation</button>
      </div>

      {/* Summary Cards derived directly from real data */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Quotations', value: totalQuotations.toString() },
          { label: 'Pending Response', value: pendingResponseCount.toString(), color: '#F59E0B' },
          { label: 'Converted', value: convertedCount.toString(), color: '#12B76A' },
          { label: 'Pipeline Value', value: formatPipelineValue(pipelineValue), color: '#3B5BDB' },
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

      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', maxWidth: 280 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
            <input
              className="input-base"
              style={{ paddingLeft: 30, fontSize: 13 }}
              placeholder="Search quotations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select-base"
            style={{ fontSize: 13 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="All">All Status</option>
            <option value="Draft">Draft</option>
            <option value="Sent">Sent</option>
            <option value="Negotiation">Negotiation</option>
            <option value="Converted">Converted</option>
            <option value="Declined">Declined</option>
          </select>
        </div>

        <table className="table-base">
          <thead>
            <tr>
              <th>QUOTATION #</th>
              <th>CLIENT / PROJECT</th>
              <th>DATE</th>
              <th>VALID TILL</th>
              <th style={{ textAlign: 'right' }}>AMOUNT</th>
              <th style={{ textAlign: 'right' }}>GST</th>
              <th style={{ textAlign: 'right' }}>GRAND TOTAL</th>
              <th>STATUS</th>
              <th style={{ textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: '#697586' }}>
                  No quotations found. Click "+ New Quotation" to create one.
                </td>
              </tr>
            ) : (
              filtered.map((q) => {
                const qNum = q.quotationNumber || q.id || 'QT-001';
                const client = q.clientName || (q as any).client || '—';
                const project = q.projectName || (q as any).project || '';
                const amt = Number(q.amount) || 0;
                const gst = Number(q.gstAmount ?? (q as any).gst) || 0;
                const totalAmt = Number(q.totalAmount ?? (q as any).total) || amt + gst;
                const status = q.status || 'Draft';
                const badgeColor = statusColors[status] || 'badge-gray';
                const validity = q.validityDate || (q as any).validity || '—';

                return (
                  <tr key={q.id}>
                    <td style={{ fontWeight: 700, color: '#3B5BDB' }}>{qNum}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{client}</div>
                      {project && <div style={{ fontSize: 11.5, color: '#697586' }}>{project}</div>}
                    </td>
                    <td style={{ color: '#697586' }}>{q.date || '—'}</td>
                    <td style={{ color: '#697586' }}>{validity}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{amt.toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right', color: '#697586' }}>₹{gst.toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14 }}>
                      ₹{totalAmt.toLocaleString('en-IN')}
                    </td>
                    <td>
                      <span className={`badge ${badgeColor}`}>{status}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px' }}
                          onClick={() => setPreviewQuotation(q)}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px' }}
                          onClick={() => setSendTargetQuotation(q)}
                        >
                          Send
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px' }}
                          onClick={() => handleOpenEditModal(q)}
                        >
                          Edit
                        </button>
                        {q.id && (
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                            onClick={() => setQuotationToDelete(q)}
                          >
                            <Trash2 size={13} style={{ marginRight: 4 }} />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* New / Edit Quotation Modal */}
      {showEditor && (
        <div className="modal-overlay" onClick={handleCloseEditor}>
          <div className="modal-box" style={{ width: 720, padding: 32 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18 }}>
                {editingQuotation ? 'Edit Quotation' : 'New Quotation'}
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={handleCloseEditor}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
              {/* Client */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                  Client <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  className="input-base"
                  style={{
                    width: '100%',
                    borderColor: errors.clientName ? '#EF4444' : undefined,
                  }}
                  placeholder="Select or enter client name"
                  list="client-options"
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    if (errors.clientName) setErrors((prev) => ({ ...prev, clientName: undefined }));
                  }}
                />
                <datalist id="client-options">
                  {dbClients.map((c) => (
                    <option key={c.id || c.name} value={c.name} />
                  ))}
                </datalist>
                {errors.clientName && (
                  <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.clientName}</div>
                )}
              </div>

              {/* Service / Project Name */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                  Service / Project Name <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  className="input-base"
                  style={{
                    width: '100%',
                    borderColor: errors.projectName ? '#EF4444' : undefined,
                  }}
                  placeholder="e.g. Website Development"
                  value={projectName}
                  onChange={(e) => {
                    setProjectName(e.target.value);
                    if (errors.projectName) setErrors((prev) => ({ ...prev, projectName: undefined }));
                  }}
                />
                {errors.projectName && (
                  <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.projectName}</div>
                )}
              </div>

              {/* Quotation Date */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                  Quotation Date
                </label>
                <input
                  className="input-base"
                  type="date"
                  value={quotationDate}
                  onChange={(e) => setQuotationDate(e.target.value)}
                />
              </div>

              {/* Valid Until */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                  Valid Until
                </label>
                <input
                  className="input-base"
                  type="date"
                  value={validityDate}
                  onChange={(e) => setValidityDate(e.target.value)}
                />
              </div>
            </div>

            {/* Line Items Table */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                  Line Items <span style={{ color: '#EF4444' }}>*</span>
                </div>
                {errors.lineItems && (
                  <div style={{ color: '#EF4444', fontSize: 12, fontWeight: 600 }}>{errors.lineItems}</div>
                )}
              </div>

              <table className="table-base" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>DESCRIPTION</th>
                    <th style={{ textAlign: 'center', width: 90 }}>QTY</th>
                    <th style={{ textAlign: 'right', width: 130 }}>RATE (₹)</th>
                    <th style={{ textAlign: 'right', width: 120 }}>AMOUNT (₹)</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => {
                    const itemErr = errors.itemErrors?.[i];
                    return (
                      <tr key={i}>
                        <td>
                          <input
                            className="input-base"
                            style={{
                              fontSize: 12.5,
                              padding: '4px 8px',
                              width: '100%',
                              borderColor: itemErr?.description ? '#EF4444' : undefined,
                            }}
                            placeholder="Item description (e.g. Web Design)"
                            value={li.description}
                            onChange={(e) => handleLineItemChange(i, 'description', e.target.value)}
                          />
                          {itemErr?.description && (
                            <div style={{ color: '#EF4444', fontSize: 11, marginTop: 2 }}>{itemErr.description}</div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            className="input-base"
                            type="number"
                            min="1"
                            placeholder="1"
                            style={{
                              fontSize: 12.5,
                              padding: '4px 8px',
                              textAlign: 'center',
                              borderColor: itemErr?.qty ? '#EF4444' : undefined,
                            }}
                            value={li.qty}
                            onChange={(e) => handleLineItemChange(i, 'qty', e.target.value)}
                          />
                          {itemErr?.qty && (
                            <div style={{ color: '#EF4444', fontSize: 11, marginTop: 2 }}>{itemErr.qty}</div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            className="input-base"
                            type="number"
                            min="0"
                            placeholder="0"
                            style={{
                              fontSize: 12.5,
                              padding: '4px 8px',
                              textAlign: 'right',
                              borderColor: itemErr?.rate ? '#EF4444' : undefined,
                            }}
                            value={li.rate}
                            onChange={(e) => handleLineItemChange(i, 'rate', e.target.value)}
                          />
                          {itemErr?.rate && (
                            <div style={{ color: '#EF4444', fontSize: 11, marginTop: 2 }}>{itemErr.rate}</div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          ₹{(Number(li.amount) || 0).toLocaleString('en-IN')}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {lineItems.length > 1 && (
                            <button
                              type="button"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 14 }}
                              onClick={() => handleRemoveLineItem(i)}
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 8, fontSize: 12 }}
                onClick={handleAddLineItem}
              >
                + Add Line Item
              </button>
            </div>

            {/* Totals Breakdown */}
            <div style={{ background: '#F8F9FC', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 600, color: '#1A1F36' }}>₹{subtotal.toLocaleString('en-IN')}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, color: '#EF4444' }}>
                <span>Discount (₹)</span>
                <input
                  className="input-base"
                  type="number"
                  min="0"
                  placeholder="0"
                  style={{ fontSize: 12.5, padding: '2px 6px', textAlign: 'right', width: 100 }}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                <span>Taxable Amount</span>
                <span style={{ fontWeight: 600, color: '#1A1F36' }}>₹{taxable.toLocaleString('en-IN')}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                <span>CGST (9%)</span>
                <span style={{ fontWeight: 600 }}>₹{cgst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                <span>SGST (9%)</span>
                <span style={{ fontWeight: 600 }}>₹{sgst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 8,
                  marginTop: 8,
                  borderTop: '1px solid #E5E9F2',
                  fontFamily: 'Plus Jakarta Sans',
                  fontWeight: 800,
                  fontSize: 16,
                  color: '#1A1F36',
                }}
              >
                <span>Grand Total</span>
                <span style={{ color: '#3B5BDB' }}>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={isSubmitting}
                onClick={() => handleSaveQuotation('Draft')}
              >
                {isSubmitting ? 'Saving...' : editingQuotation ? 'Update Draft' : 'Save Draft'}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={isSubmitting}
                onClick={() => handleSaveQuotation('Sent')}
              >
                {isSubmitting ? 'Saving...' : editingQuotation ? 'Update & Send' : 'Send to Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quotation Preview Modal */}
      {previewQuotation && (
        <div className="modal-overlay" onClick={() => setPreviewQuotation(null)}>
          <div className="modal-box" style={{ width: 680, padding: 32 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 20, color: '#3B5BDB' }}>
                    {previewQuotation.quotationNumber || previewQuotation.id || 'Quotation'}
                  </span>
                  <span className={`badge ${statusColors[previewQuotation.status || 'Draft'] || 'badge-gray'}`}>
                    {previewQuotation.status || 'Draft'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#697586', marginTop: 4 }}>
                  Quotation Details & Line Item Breakdown
                </div>
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#697586' }}
                onClick={() => setPreviewQuotation(null)}
              >
                ×
              </button>
            </div>

            {/* Client & Metadata summary header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
                padding: '16px 18px',
                background: '#F8F9FC',
                borderRadius: 12,
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 11.5, color: '#697586', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Client Name
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginTop: 2 }}>
                  {previewQuotation.clientName || (previewQuotation as any).client || '—'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, color: '#697586', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Service / Project
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#1A1F36', marginTop: 2 }}>
                  {previewQuotation.projectName || (previewQuotation as any).project || '—'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, color: '#697586', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Quotation Date
                </div>
                <div style={{ fontSize: 13, color: '#1A1F36', marginTop: 2 }}>
                  {previewQuotation.date || '—'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, color: '#697586', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Valid Until
                </div>
                <div style={{ fontSize: 13, color: '#1A1F36', marginTop: 2 }}>
                  {previewQuotation.validityDate || (previewQuotation as any).validity || '—'}
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#1A1F36' }}>
                Deliverables & Line Items
              </div>
              {(() => {
                const itemsList: QuotationItem[] =
                  previewQuotation.items ||
                  previewQuotation.lineItems ||
                  (previewQuotation.amount
                    ? [
                        {
                          description: previewQuotation.projectName || 'Quotation Services',
                          qty: 1,
                          rate: previewQuotation.amount,
                          amount: previewQuotation.amount,
                        },
                      ]
                    : []);

                const previewSubtotal = Number(previewQuotation.amount) || itemsList.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
                const previewDiscount = Number(previewQuotation.discount) || 0;
                const previewTaxable = Math.max(0, previewSubtotal - previewDiscount);
                const previewGst = Number(previewQuotation.gstAmount) || 0;
                const previewGrandTotal = Number(previewQuotation.totalAmount) || previewTaxable + previewGst;

                return (
                  <>
                    <table className="table-base" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>DESCRIPTION</th>
                          <th style={{ textAlign: 'center' }}>QTY</th>
                          <th style={{ textAlign: 'right' }}>RATE (₹)</th>
                          <th style={{ textAlign: 'right' }}>AMOUNT (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsList.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ textAlign: 'center', padding: '16px', color: '#697586' }}>
                              No line items detailed.
                            </td>
                          </tr>
                        ) : (
                          itemsList.map((item, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{item.description || 'Service Item'}</td>
                              <td style={{ textAlign: 'center' }}>{item.qty}</td>
                              <td style={{ textAlign: 'right' }}>₹{(Number(item.rate) || 0).toLocaleString('en-IN')}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                ₹{(Number(item.amount) || 0).toLocaleString('en-IN')}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>

                    {/* Financial summary breakdown */}
                    <div style={{ background: '#F8F9FC', borderRadius: 10, padding: '14px 18px', marginTop: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                        <span>Subtotal</span>
                        <span style={{ fontWeight: 600, color: '#1A1F36' }}>₹{previewSubtotal.toLocaleString('en-IN')}</span>
                      </div>

                      {previewDiscount > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#EF4444' }}>
                          <span>Discount</span>
                          <span style={{ fontWeight: 600 }}>-₹{previewDiscount.toLocaleString('en-IN')}</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                        <span>Taxable Amount</span>
                        <span style={{ fontWeight: 600, color: '#1A1F36' }}>₹{previewTaxable.toLocaleString('en-IN')}</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                        <span>CGST (9%)</span>
                        <span style={{ fontWeight: 600 }}>₹{(previewGst / 2).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#697586' }}>
                        <span>SGST (9%)</span>
                        <span style={{ fontWeight: 600 }}>₹{(previewGst / 2).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          paddingTop: 10,
                          marginTop: 8,
                          borderTop: '1px solid #E5E9F2',
                          fontFamily: 'Plus Jakarta Sans',
                          fontWeight: 800,
                          fontSize: 16,
                          color: '#1A1F36',
                        }}
                      >
                        <span>Grand Total</span>
                        <span style={{ color: '#3B5BDB' }}>₹{previewGrandTotal.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPreviewQuotation(null)}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send / Mark as Sent Action Modal */}
      {sendTargetQuotation && (
        <div className="modal-overlay" onClick={() => setSendTargetQuotation(null)}>
          <div className="modal-box" style={{ width: 480, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17 }}>
                {sendTargetQuotation.status === 'Sent' ? 'Quotation Sent Status' : 'Send Quotation'}
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={() => setSendTargetQuotation(null)}
              >
                ×
              </button>
            </div>

            {sendTargetQuotation.status === 'Sent' ? (
              <div>
                <div
                  style={{
                    padding: '14px 16px',
                    background: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    borderRadius: 10,
                    color: '#1D4ED8',
                    fontSize: 13.5,
                    marginBottom: 20,
                    lineHeight: 1.5,
                  }}
                >
                  Quotation <strong>"{sendTargetQuotation.quotationNumber || sendTargetQuotation.id}"</strong> has already been marked as <strong>Sent</strong> for client <strong>"{sendTargetQuotation.clientName || (sendTargetQuotation as any).client}"</strong>.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSendTargetQuotation(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13.5, color: '#475569', marginBottom: 20, lineHeight: 1.5 }}>
                  Are you sure you want to mark quotation <strong>"{sendTargetQuotation.quotationNumber || sendTargetQuotation.id}"</strong> for client <strong>"{sendTargetQuotation.clientName || (sendTargetQuotation as any).client}"</strong> as <strong>Sent</strong>?
                  <div style={{ fontSize: 12.5, color: '#697586', marginTop: 8 }}>
                    This operation will update the quotation status in Firestore database and refresh summary metrics.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isUpdatingStatus}
                    onClick={() => setSendTargetQuotation(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={isUpdatingStatus}
                    onClick={handleConfirmMarkAsSent}
                  >
                    {isUpdatingStatus ? 'Updating...' : 'Mark as Sent'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {quotationToDelete && (
        <DeleteConfirmationModal
          isOpen={!!quotationToDelete}
          title="Delete Quotation"
          itemName={`${quotationToDelete.quotationNumber || quotationToDelete.id} (${quotationToDelete.clientName || (quotationToDelete as any).client})`}
          description={
            <>
              Are you sure you want to delete quotation <strong style={{ color: '#1A1F36' }}>"{quotationToDelete.quotationNumber || quotationToDelete.id}"</strong> for client <strong style={{ color: '#1A1F36' }}>"{quotationToDelete.clientName || (quotationToDelete as any).client}"</strong>? This action will permanently remove it from Firestore and cannot be undone.
            </>
          }
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={() => setQuotationToDelete(null)}
        />
      )}
    </div>
  );
}
