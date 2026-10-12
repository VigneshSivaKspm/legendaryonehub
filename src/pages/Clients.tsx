import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Client } from '../db/database';
import { newestFirst } from '../utils/sort';
import { addClient, updateClient, deleteClient, archiveClient } from '../services/clientService';
import { validateClientForm, type ClientValidationErrors } from '../utils/validation';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { computeClientFinancials, clientLabel } from '../utils/financials';
import { maskDateDDMMYYYY } from '../utils/dateMask';

interface Props {
  onViewClient: (id: number | string) => void;
}

const initialFormState: Omit<Client, 'id'> = {
  name: '',
  company: '',
  contact: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  gstin: '',
  services: '',
  billing: 'Monthly Retainer',
  pricing: 0,
  totalValue: 0,
  paid: 0,
  pending: 0,
  projects: 0,
  joinDate: new Date().toLocaleDateString('en-GB'),
  status: 'Active',
  notes: '',
};

export default function Clients({ onViewClient }: Props) {
  const { canManageClients, canDeleteClients } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [serviceFilter, setServiceFilter] = useState('All');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [archivingClient, setArchivingClient] = useState<Client | null>(null);

  // Form state
  const [formData, setFormData] = useState<Omit<Client, 'id'>>(initialFormState);
  const [formErrors, setFormErrors] = useState<ClientValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch live clients & services from Dexie database
  const clients = useLiveQuery(async () => newestFirst(await db.clients.toArray(), (c) => c.joinDate), []) || [];
  const dbServices = useLiveQuery(() => db.services.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];

  // Totals come from each client's projects and payments, not from hand-entered figures
  const financialsById = new Map(
    clients.map((c) => [String(c.id), computeClientFinancials(c, projects, payments)])
  );
  const fin = (c: Client) => financialsById.get(String(c.id))!;

  // Filter clients dynamically
  const filtered = clients.filter((c) => {
    const query = search.toLowerCase();
    const matchSearch =
      c.name.toLowerCase().includes(query) ||
      c.company.toLowerCase().includes(query) ||
      c.contact.toLowerCase().includes(query) ||
      c.phone.includes(query) ||
      c.email.toLowerCase().includes(query) ||
      c.city.toLowerCase().includes(query);

    const matchStatus = statusFilter === 'All' || c.status === statusFilter;
    const matchService = serviceFilter === 'All' || fin(c).services.includes(serviceFilter);

    return matchSearch && matchStatus && matchService;
  });

  // Dynamic summary stats
  const totalClientsCount = clients.length;
  const activeClientsCount = clients.filter((c) => c.status === 'Active').length;
  const totalValue = clients.reduce((acc, c) => acc + fin(c).totalValue, 0);
  const totalRevenue = clients.reduce((acc, c) => acc + fin(c).paid, 0);
  const totalOutstanding = clients.reduce((acc, c) => acc + fin(c).pending, 0);

  const formatCurrency = (amount: number) => {
    if (amount >= 100000) {
      return '₹' + (amount / 100000).toFixed(1) + 'L';
    }
    return '₹' + amount.toLocaleString('en-IN');
  };

  // Open Add Modal
  const handleOpenAdd = () => {
    setFormData({
      ...initialFormState,
      joinDate: new Date().toLocaleDateString('en-GB'),
    });
    setFormErrors({});
    setShowAddModal(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingClient(client);
    setFormData({
      name: client.name,
      company: client.company,
      contact: client.contact,
      phone: client.phone,
      email: client.email,
      address: client.address || '',
      city: client.city,
      gstin: client.gstin || '',
      services: client.services || 'Website Development',
      billing: client.billing || 'Monthly Retainer',
      pricing: client.pricing || 0,
      totalValue: client.totalValue || 0,
      paid: client.paid || 0,
      pending: client.pending || 0,
      projects: client.projects || 0,
      joinDate: client.joinDate || new Date().toLocaleDateString('en-GB'),
      status: client.status || 'Active',
      notes: client.notes || '',
    });
    setFormErrors({});
  };

  // Open Delete Modal
  const handleOpenDelete = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingClient(client);
  };

  // Open Archive Modal
  const handleOpenArchive = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    setArchivingClient(client);
  };

  // Handle Form Inputs
  const handleInputChange = (field: keyof Omit<Client, 'id'>, value: any) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };
      // New clients are named after the contact person; existing names are kept on edit
      if (field === 'contact' && !editingClient) updated.name = String(value).trim();
      return updated;
    });

    if (formErrors[field as keyof ClientValidationErrors]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    if (field === 'contact' && formErrors.name) {
      setFormErrors((prev) => ({ ...prev, name: undefined }));
    }
  };

  // Submit Add Client
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateClientForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await addClient(formData);
      showToast(`Client "${formData.name}" created successfully!`, 'success');
      setShowAddModal(false);
      setFormData(initialFormState);
    } catch (err) {
      console.error('Failed to create client:', err);
      showToast('Failed to create client. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Edit Client
  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient?.id) return;

    const errors = validateClientForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await updateClient(editingClient.id, formData);
      showToast(`Client "${formData.name}" updated successfully!`, 'success');
      setEditingClient(null);
    } catch (err) {
      console.error('Failed to update client:', err);
      showToast('Failed to update client. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm Archive Client
  const handleConfirmArchive = async () => {
    if (!archivingClient?.id) return;

    setIsSubmitting(true);
    try {
      await archiveClient(archivingClient.id);
      showToast(`Client "${archivingClient.name}" archived successfully!`, 'info');
      setArchivingClient(null);
    } catch (err) {
      console.error('Failed to archive client:', err);
      showToast('Failed to archive client.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm Delete Client
  const handleConfirmDelete = async () => {
    if (!deletingClient?.id) return;

    setIsSubmitting(true);
    try {
      await deleteClient(deletingClient.id);
      showToast(`Client "${deletingClient.name}" deleted permanently.`, 'info');
      setDeletingClient(null);
    } catch (err) {
      console.error('Failed to delete client:', err);
      showToast('Failed to delete client.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Client Management</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Manage all client accounts, billing, contact details & Persistent DB records
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => showToast('Client export generated.', 'info')}>
            ⬇ Export CSV
          </button>
          {canManageClients && (
            <button className="btn-primary" onClick={handleOpenAdd}>
              + Add New Client
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Clients', value: totalClientsCount.toString(), color: '#3B5BDB' },
          { label: 'Active Clients', value: activeClientsCount.toString(), color: '#12B76A' },
          { label: 'Total Value', value: formatCurrency(totalValue), color: '#1A1F36' },
          { label: 'Received', value: formatCurrency(totalRevenue), color: '#12B76A' },
          { label: 'Pending', value: formatCurrency(totalOutstanding), color: '#F59E0B' },
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

      {/* Filters */}
      <div className="card" style={{ marginBottom: 0, borderRadius: '14px 14px 0 0' }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #E5E9F2', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 320 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
            <input
              className="input-base"
              style={{ paddingLeft: 30, fontSize: 13 }}
              placeholder="Search clients by name, company, contact, city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="select-base" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Archived">Archived</option>
          </select>

          <select className="select-base" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="All">All Services</option>
            {dbServices.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table-base">
            <thead>
              <tr>
                <th>CLIENT</th>
                <th>CONTACT & EMAIL</th>
                <th>SERVICES</th>
                <th style={{ textAlign: 'right' }}>TOTAL VALUE</th>
                <th style={{ textAlign: 'right' }}>PAID</th>
                <th style={{ textAlign: 'right' }}>PENDING</th>
                <th style={{ textAlign: 'center' }}>PROJECTS</th>
                <th>STATUS</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => c.id && onViewClient(c.id)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          background: '#EEF2FF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#3B5BDB',
                          flexShrink: 0,
                        }}
                      >
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1A1F36' }}>{clientLabel(c)}</div>
                        <div style={{ fontSize: 11.5, color: '#697586' }}>
                          {[c.company, c.city].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.contact}</div>
                    <div style={{ fontSize: 11.5, color: '#697586' }}>
                      {c.phone} • {c.email}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 13, color: '#1A1F36', fontWeight: 500 }}>{fin(c).services.join(', ') || '—'}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13.5 }}>₹{fin(c).totalValue.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', color: '#12B76A', fontWeight: 600, fontSize: 13.5 }}>₹{fin(c).paid.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', color: fin(c).pending > 0 ? '#F59E0B' : '#697586', fontWeight: 600, fontSize: 13.5 }}>
                    {fin(c).pending > 0 ? '₹' + fin(c).pending.toLocaleString('en-IN') : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, color: '#3B5BDB' }}>{fin(c).projectCount}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        c.status === 'Active'
                          ? 'badge-green'
                          : c.status === 'Archived'
                          ? 'badge-amber'
                          : 'badge-gray'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 11.5, padding: '4px 8px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          c.id && onViewClient(c.id);
                        }}
                      >
                        View
                      </button>
                      {canManageClients && (
                        <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={(e) => handleOpenEdit(c, e)}>
                          Edit
                        </button>
                      )}
                      {canManageClients && c.status !== 'Archived' && (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', color: '#D97706', borderColor: '#FDE68A' }}
                          onClick={(e) => handleOpenArchive(c, e)}
                        >
                          Archive
                        </button>
                      )}
                      {canDeleteClients && (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                          onClick={(e) => handleOpenDelete(c, e)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#697586' }}>
                    No clients match your search or filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12.5, color: '#697586' }}>
            Showing {filtered.length} of {clients.length} clients
          </div>
        </div>
      </div>

      {/* Add Client Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" style={{ width: 680, padding: 28, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>Add New Client</div>
                <div style={{ fontSize: 12, color: '#697586' }}>Enter business and contact details. Services and billing come from the client's projects.</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setShowAddModal(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleCreateClient}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Company Name (optional)</label>
                  <input
                    className="input-base"
                    placeholder="e.g. GS Distributors Pvt Ltd"
                    value={formData.company}
                    onChange={(e) => handleInputChange('company', e.target.value)}
                  />
                  {formErrors.company && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.company}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Client Name *</label>
                  <input
                    className="input-base"
                    placeholder="e.g. Ganesh Sharma"
                    value={formData.contact}
                    onChange={(e) => handleInputChange('contact', e.target.value)}
                  />
                  {formErrors.contact && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.contact}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Phone Number *</label>
                  <input
                    className="input-base"
                    placeholder="e.g. 9876543210"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                  />
                  {formErrors.phone && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.phone}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Email Address *</label>
                  <input
                    className="input-base"
                    type="email"
                    placeholder="e.g. ganesh@gsdist.com"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                  />
                  {formErrors.email && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.email}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>City *</label>
                  <input
                    className="input-base"
                    placeholder="e.g. Chennai"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                  />
                  {formErrors.city && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.city}</div>}
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Address (optional)</label>
                  <input
                    className="input-base"
                    placeholder="e.g. 42, Mount Road, Guindy, Chennai"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Join Date</label>
                  <input
                    className="input-base"
                    placeholder="DD/MM/YYYY"
                    inputMode="numeric"
                    maxLength={10}
                    value={formData.joinDate}
                    onChange={(e) => handleInputChange('joinDate', maskDateDDMMYYYY(e.target.value, formData.joinDate))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Status</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value as any)}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>GSTIN (optional)</label>
                  <input
                    className="input-base"
                    placeholder="e.g. 33AABCG1234F1ZL"
                    value={formData.gstin}
                    onChange={(e) => handleInputChange('gstin', e.target.value)}
                  />
                  {formErrors.gstin && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.gstin}</div>}
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Client Notes</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="Special requirements, account history, contract terms..."
                    value={formData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Add Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Client Modal */}
      {editingClient && (
        <div className="modal-overlay" onClick={() => setEditingClient(null)}>
          <div className="modal-box" style={{ width: 680, padding: 28, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>
                  Edit Client — {editingClient.name}
                </div>
                <div style={{ fontSize: 12, color: '#697586' }}>Update details stored persistently in database</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setEditingClient(null)}>
                ×
              </button>
            </div>

            <form onSubmit={handleUpdateClient}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Company Name (optional)</label>
                  <input className="input-base" value={formData.company} onChange={(e) => handleInputChange('company', e.target.value)} />
                  {formErrors.company && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.company}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Client Name *</label>
                  <input className="input-base" value={formData.contact} onChange={(e) => handleInputChange('contact', e.target.value)} />
                  {formErrors.contact && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.contact}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Phone Number *</label>
                  <input className="input-base" value={formData.phone} onChange={(e) => handleInputChange('phone', e.target.value)} />
                  {formErrors.phone && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.phone}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Email Address *</label>
                  <input className="input-base" type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} />
                  {formErrors.email && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.email}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>City *</label>
                  <input className="input-base" value={formData.city} onChange={(e) => handleInputChange('city', e.target.value)} />
                  {formErrors.city && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.city}</div>}
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Address (optional)</label>
                  <input className="input-base" value={formData.address} onChange={(e) => handleInputChange('address', e.target.value)} />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Status</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value as any)}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>GSTIN</label>
                  <input className="input-base" value={formData.gstin} onChange={(e) => handleInputChange('gstin', e.target.value)} />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Client Notes</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    value={formData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditingClient(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Modal */}
      {archivingClient && (
        <div className="modal-overlay" onClick={() => setArchivingClient(null)}>
          <div className="modal-box" style={{ width: 440, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                  background: '#FEF3C7',
                  color: '#D97706',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  marginBottom: 12,
                }}
              >
                📦
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36' }}>Archive Client</div>
              <div style={{ fontSize: 13, color: '#697586', marginTop: 6, lineHeight: 1.4 }}>
                Are you sure you want to archive <strong>{archivingClient.name}</strong>? Archived clients will be hidden from default active views but remain in the database.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setArchivingClient(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', background: '#D97706' }}
                onClick={handleConfirmArchive}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Archiving...' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingClient && (
        <DeleteConfirmationModal
          isOpen={!!deletingClient}
          title="Delete Client"
          description={
            <>
              Are you sure you want to delete <strong>{deletingClient.name}</strong> ({deletingClient.company})? This action will permanently remove the record from the database.
            </>
          }
          isDeleting={isSubmitting}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeletingClient(null)}
        />
      )}
    </div>
  );
}
