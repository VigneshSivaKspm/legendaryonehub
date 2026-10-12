import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Deliverable } from '../db/database';
import { addDeliverable, deleteDeliverable } from '../services/deliverableService';
import {
  validateDeliverableForm,
  type DeliverableFormData,
  type DeliverableValidationErrors,
} from '../utils/validation';
import { useToast } from '../context/ToastContext';
import { Trash2 } from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const initialFormState: DeliverableFormData = {
  client: '',
  type: '',
  description: '',
  qty: '',
  rate: '',
  date: new Date().toISOString().split('T')[0],
  employee: '',
};

const defaultDeliverableTypes = [
  'Poster',
  'Banner',
  'Video',
  'Reel',
  'Reel Script',
  'Design',
  'Other',
];

export default function Deliverables() {
  const { showToast } = useToast();

  const [clientFilter, setClientFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [period] = useState('01/09/2026 – 30/09/2026');

  // Form & Delete Modal states
  const [formData, setFormData] = useState<DeliverableFormData>(initialFormState);
  const [errors, setErrors] = useState<DeliverableValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deliverableToDelete, setDeliverableToDelete] = useState<Deliverable | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Live queries from Dexie cache (synchronized real-time with Firestore)
  const deliverables = useLiveQuery(() => db.deliverables.toArray(), []) || [];
  const dbClients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const dbEmployees = useLiveQuery(() => db.employees.toArray(), []) || [];

  // Clients list for dropdowns & filters
  const clientsList = useMemo(() => {
    const names = new Set<string>();
    dbClients.forEach((c) => {
      if (c.name) names.add(c.name);
    });
    deliverables.forEach((d) => {
      if (d.client) names.add(d.client);
    });
    return Array.from(names);
  }, [dbClients, deliverables]);

  // Employees list for dropdowns: only real, active employees from the Employees module
  const employeesList = useMemo(() => {
    return dbEmployees
      .filter((e) => e.name && e.status !== 'Inactive')
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  }, [dbEmployees]);

  const filtered = useMemo(() => {
    return deliverables.filter((d) => {
      const matchesClient = clientFilter === 'All' || d.client === clientFilter;
      const matchesType = typeFilter === 'All' || d.type === typeFilter;
      return matchesClient && matchesType;
    });
  }, [deliverables, clientFilter, typeFilter]);

  const total = useMemo(() => {
    return filtered.reduce((sum, d) => sum + (Number(d.qty) || 0) * (Number(d.rate) || 0), 0);
  }, [filtered]);

  // Group by client for summary cards
  const byClient = useMemo(() => {
    const map = new Map<string, { count: number; total: number; types: Set<string> }>();
    deliverables.forEach((d) => {
      const clientName = d.client || 'Unknown Client';
      const existing = map.get(clientName) || { count: 0, total: 0, types: new Set<string>() };
      const itemTotal = (Number(d.qty) || 0) * (Number(d.rate) || 0);
      if (d.type) existing.types.add(d.type);
      map.set(clientName, {
        count: existing.count + 1,
        total: existing.total + itemTotal,
        types: existing.types,
      });
    });
    return Array.from(map.entries()).map(([client, data]) => ({
      client,
      items: data.count,
      total: data.total,
      types: Array.from(data.types),
    }));
  }, [deliverables]);

  const handleFieldChange = (field: keyof DeliverableFormData, value: string) => {
    const updatedForm = { ...formData, [field]: value };
    setFormData(updatedForm);

    // Clear or update field error dynamically as user types valid input
    const validationErrors = validateDeliverableForm(updatedForm);
    setErrors((prev) => ({
      ...prev,
      [field]: validationErrors[field as keyof DeliverableValidationErrors],
    }));
  };

  const handleOpenAddModal = () => {
    setFormData(initialFormState);
    setErrors({});
    setShowAdd(true);
  };

  const handleCloseAddModal = () => {
    setShowAdd(false);
    setFormData(initialFormState);
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Validate all fields simultaneously
    const validationErrors = validateDeliverableForm(formData);

    // 2. If ANY required field is invalid, show errors, DO NOT close modal, DO NOT save to DB
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      showToast('Please fix all validation errors before saving.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const qtyNum = Number(formData.qty);
      const rateNum = Number(formData.rate);
      const amount = qtyNum * rateNum;

      // 3. Save to Firestore first (source of truth), then Dexie cache
      await addDeliverable({
        client: formData.client.trim(),
        type: formData.type.trim(),
        description: formData.description.trim(),
        qty: qtyNum,
        rate: rateNum,
        amount,
        date: formData.date.trim(),
        employee: formData.employee.trim(),
        status: 'Pending',
      });

      showToast('Deliverable added successfully!', 'success');
      handleCloseAddModal();
    } catch (err: any) {
      console.error('Error adding deliverable:', err);
      showToast(err?.message || 'Failed to save deliverable.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deliverableToDelete || !deliverableToDelete.id) return;
    setIsDeleting(true);
    try {
      // Deletes from Firestore first, then Dexie cache inside deleteDeliverable
      await deleteDeliverable(deliverableToDelete.id);
      showToast('Deliverable deleted successfully', 'info');
      setDeliverableToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete deliverable:', err);
      showToast(err?.message || 'Failed to delete deliverable', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const qtyNum = Number(formData.qty);
  const rateNum = Number(formData.rate);
  const isCalculatedValid = !isNaN(qtyNum) && qtyNum > 0 && !isNaN(rateNum) && rateNum > 0;
  const calculatedTotal = isCalculatedValid
    ? `₹${(qtyNum * rateNum).toLocaleString('en-IN')}`
    : '₹ —';

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Deliverables</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Track work delivered to each client per billing period
          </div>
        </div>
        <button className="btn-primary" onClick={handleOpenAddModal}>
          + Add Deliverable
        </button>
      </div>

      {/* Client summary cards */}
      {byClient.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {byClient.map((bc) => {
            const cDeliverables = deliverables.filter((d) => d.client === bc.client);
            return (
              <div
                key={bc.client}
                className="card"
                style={{
                  padding: 18,
                  cursor: 'pointer',
                  border: clientFilter === bc.client ? '2px solid #3B5BDB' : '1px solid #E5E9F2',
                }}
                onClick={() => setClientFilter(clientFilter === bc.client ? 'All' : bc.client)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>{bc.client}</div>
                    <div style={{ fontSize: 12, color: '#697586' }}>{period}</div>
                  </div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 17, fontWeight: 800, color: '#3B5BDB' }}>
                    ₹{bc.total.toLocaleString('en-IN')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {cDeliverables.map((d) => (
                    <div
                      key={d.id}
                      style={{ fontSize: 11.5, color: '#697586', background: '#F8F9FC', borderRadius: 6, padding: '2px 8px' }}
                    >
                      {d.type}: <strong>{d.qty}</strong>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filter bar */}
      <div className="card" style={{ borderRadius: '14px 14px 0 0' }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #E5E9F2', flexWrap: 'wrap' }}>
          <select
            className="select-base"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            style={{ fontSize: 13 }}
          >
            <option value="All">All Clients</option>
            {clientsList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="select-base"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ fontSize: 13 }}
          >
            <option value="All">All Types</option>
            {defaultDeliverableTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <div style={{ marginLeft: 'auto', fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>
            Grand Total: <span style={{ color: '#3B5BDB' }}>₹{total.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table-base">
            <thead>
              <tr>
                <th>CLIENT</th>
                <th>TYPE</th>
                <th>DESCRIPTION</th>
                <th style={{ textAlign: 'right' }}>QTY</th>
                <th style={{ textAlign: 'right' }}>RATE</th>
                <th style={{ textAlign: 'right' }}>AMOUNT</th>
                <th>DATE</th>
                <th>EMPLOYEE</th>
                <th>STATUS</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: '#697586' }}>
                    No deliverables found. Click "+ Add Deliverable" to create one.
                  </td>
                </tr>
              ) : (
                filtered.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{d.client}</td>
                    <td>
                      <span className="badge badge-blue">{d.type}</span>
                    </td>
                    <td style={{ color: '#697586', fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.description}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>{d.qty}</td>
                    <td style={{ textAlign: 'right' }}>₹{d.rate}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#3B5BDB' }}>
                      ₹{((Number(d.qty) || 0) * (Number(d.rate) || 0)).toLocaleString('en-IN')}
                    </td>
                    <td style={{ color: '#697586' }}>{d.date}</td>
                    <td>{d.employee}</td>
                    <td>
                      <span className={`badge ${d.status === 'Approved' ? 'badge-green' : 'badge-amber'}`}>
                        {d.status || 'Pending'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {d.id && (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                          onClick={() => setDeliverableToDelete(d)}
                        >
                          <Trash2 size={13} style={{ marginRight: 4 }} />
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ fontWeight: 700, padding: '12px 14px', fontSize: 13.5, color: '#1A1F36' }}>
                  Total
                </td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: '#3B5BDB', fontSize: 15, padding: '12px 14px' }}>
                  ₹{total.toLocaleString('en-IN')}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Add Deliverable Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={handleCloseAddModal}>
          <div className="modal-box" style={{ width: 560, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17 }}>Add Deliverable</div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={handleCloseAddModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Client */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Client <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{
                      width: '100%',
                      borderColor: errors.client ? '#EF4444' : undefined,
                    }}
                    value={formData.client}
                    onChange={(e) => handleFieldChange('client', e.target.value)}
                  >
                    <option value="">Select Client</option>
                    {clientsList.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {errors.client && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.client}</div>
                  )}
                </div>

                {/* Deliverable Type */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Deliverable Type <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{
                      width: '100%',
                      borderColor: errors.type ? '#EF4444' : undefined,
                    }}
                    value={formData.type}
                    onChange={(e) => handleFieldChange('type', e.target.value)}
                  >
                    <option value="">Select Type</option>
                    {defaultDeliverableTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {errors.type && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.type}</div>
                  )}
                </div>

                {/* Description */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Description <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    placeholder="Brief description of work delivered"
                    style={{
                      width: '100%',
                      borderColor: errors.description ? '#EF4444' : undefined,
                    }}
                    value={formData.description}
                    onChange={(e) => handleFieldChange('description', e.target.value)}
                  />
                  {errors.description && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.description}</div>
                  )}
                </div>

                {/* Quantity */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Quantity <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    type="number"
                    min="1"
                    placeholder="e.g. 76"
                    style={{
                      width: '100%',
                      borderColor: errors.qty ? '#EF4444' : undefined,
                    }}
                    value={formData.qty}
                    onChange={(e) => handleFieldChange('qty', e.target.value)}
                  />
                  {errors.qty && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.qty}</div>
                  )}
                </div>

                {/* Unit Rate */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Unit Rate (₹) <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    type="number"
                    min="1"
                    placeholder="e.g. 18"
                    style={{
                      width: '100%',
                      borderColor: errors.rate ? '#EF4444' : undefined,
                    }}
                    value={formData.rate}
                    onChange={(e) => handleFieldChange('rate', e.target.value)}
                  />
                  {errors.rate && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.rate}</div>
                  )}
                </div>

                {/* Date */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Date <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    type="date"
                    style={{
                      width: '100%',
                      borderColor: errors.date ? '#EF4444' : undefined,
                    }}
                    value={formData.date}
                    onChange={(e) => handleFieldChange('date', e.target.value)}
                  />
                  {errors.date && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.date}</div>
                  )}
                </div>

                {/* Employee */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Employee <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{
                      width: '100%',
                      borderColor: errors.employee ? '#EF4444' : undefined,
                    }}
                    value={formData.employee}
                    onChange={(e) => handleFieldChange('employee', e.target.value)}
                  >
                    <option value="">{employeesList.length ? 'Select Employee' : 'No employees found'}</option>
                    {formData.employee && !employeesList.includes(formData.employee) && (
                      <option value={formData.employee}>{formData.employee}</option>
                    )}
                    {employeesList.map((emp) => (
                      <option key={emp} value={emp}>
                        {emp}
                      </option>
                    ))}
                  </select>
                  {errors.employee && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.employee}</div>
                  )}
                </div>

                {/* Calculated Total */}
                <div
                  style={{
                    gridColumn: 'span 2',
                    padding: '12px 14px',
                    background: '#F8F9FC',
                    borderRadius: 10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontSize: 13, color: '#697586' }}>Calculated Total</div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#3B5BDB' }}>
                    {calculatedTotal}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCloseAddModal}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Deliverable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deliverableToDelete && (
        <DeleteConfirmationModal
          isOpen={!!deliverableToDelete}
          title="Delete Deliverable"
          itemName={`${deliverableToDelete.type} (${deliverableToDelete.client})`}
          description={
            <>
              Are you sure you want to delete deliverable <strong style={{ color: '#1A1F36' }}>"{deliverableToDelete.type}: {deliverableToDelete.description}"</strong> for client <strong style={{ color: '#1A1F36' }}>"{deliverableToDelete.client}"</strong>? This action will permanently remove it from Firestore and cannot be undone.
            </>
          }
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeliverableToDelete(null)}
        />
      )}
    </div>
  );
}
