import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CompanyService } from '../db/database';
import {
  getAllServices,
  addService,
  updateService,
  toggleServiceStatus,
  archiveService,
  deleteService,
} from '../services/serviceService';
import { validateServiceForm, type ServiceValidationErrors } from '../utils/validation';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const pricingTypes: CompanyService['pricingType'][] = [
  'Monthly Retainer',
  'One-Time',
  'Fixed Price',
  'Per Unit',
  'Milestone',
  'Hourly',
];

const initialFormState: Omit<CompanyService, 'id'> = {
  name: '',
  description: '',
  pricingType: 'Fixed Price',
  defaultPrice: 0,
  status: 'Active',
};

export default function Services() {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [pricingFilter, setPricingFilter] = useState('All');

  // Sync from Firestore on mount
  useEffect(() => {
    getAllServices().catch((err) => {
      console.warn('[Services] Sync warning:', err);
    });
  }, []);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingService, setEditingService] = useState<CompanyService | null>(null);
  const [archivingService, setArchivingService] = useState<CompanyService | null>(null);
  const [deletingService, setDeletingService] = useState<CompanyService | null>(null);

  // Form states
  const [formData, setFormData] = useState<Omit<CompanyService, 'id'>>(initialFormState);
  const [formErrors, setFormErrors] = useState<ServiceValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live query from Dexie DB
  const services = useLiveQuery(() => db.services.toArray(), []) || [];

  // Filter services
  const filtered = services.filter((s) => {
    const query = search.toLowerCase();
    const matchSearch =
      s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query);
    const matchStatus = statusFilter === 'All' || s.status === statusFilter;
    const matchPricing = pricingFilter === 'All' || s.pricingType === pricingFilter;

    return matchSearch && matchStatus && matchPricing;
  });

  // KPI calculations
  const totalServices = services.length;
  const activeServicesCount = services.filter((s) => s.status === 'Active').length;
  const inactiveServicesCount = services.filter((s) => s.status === 'Inactive').length;

  const handleOpenAdd = () => {
    setFormData(initialFormState);
    setFormErrors({});
    setShowAddModal(true);
  };

  const handleOpenEdit = (service: CompanyService, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingService(service);
    setFormData({
      name: service.name,
      description: service.description,
      pricingType: service.pricingType,
      defaultPrice: service.defaultPrice,
      status: service.status,
    });
    setFormErrors({});
  };

  const handleToggleStatus = async (service: CompanyService, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!service.id) return;
    try {
      await toggleServiceStatus(service.id);
      const newSt = service.status === 'Active' ? 'Inactive' : 'Active';
      showToast(`Service "${service.name}" marked as ${newSt}.`, 'info');
    } catch (err) {
      console.error(err);
      showToast('Failed to change status.', 'error');
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateServiceForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await addService(formData);
      showToast(`Service "${formData.name}" created successfully!`, 'success');
      setShowAddModal(false);
    } catch (err) {
      console.error(err);
      showToast('Failed to create service.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService?.id) return;

    const errors = validateServiceForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await updateService(editingService.id, formData);
      showToast(`Service "${formData.name}" updated successfully!`, 'success');
      setEditingService(null);
    } catch (err) {
      console.error(err);
      showToast('Failed to update service.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archivingService?.id) return;

    setIsSubmitting(true);
    try {
      await archiveService(archivingService.id);
      showToast(`Service "${archivingService.name}" archived.`, 'info');
      setArchivingService(null);
    } catch (err) {
      console.error(err);
      showToast('Failed to archive service.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingService?.id) return;

    setIsSubmitting(true);
    try {
      await deleteService(deletingService.id);
      showToast(`Service "${deletingService.name}" deleted permanently.`, 'info');
      setDeletingService(null);
    } catch (err) {
      console.error(err);
      showToast('Failed to delete service.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      showToast('No service records to export.', 'error');
      return;
    }

    const headers = [
      'Service Name',
      'Description',
      'Pricing Type',
      'Default Price (INR)',
      'Status',
    ];

    const escapeCSV = (val: string | number | undefined | null) => {
      const str = val === undefined || val === null ? '' : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = filtered.map((s) => [
      escapeCSV(s.name),
      escapeCSV(s.description),
      escapeCSV(s.pricingType),
      escapeCSV(s.defaultPrice),
      escapeCSV(s.status),
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().split('T')[0];
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `services_export_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${filtered.length} service(s) to CSV.`, 'success');
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Services Catalogue</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Manage company services, pricing models & default prices (Real-time DB)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={handleExportCSV}>
            ⬇ Export CSV
          </button>
          <button className="btn-primary" onClick={handleOpenAdd}>
            + Add New Service
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Services', value: totalServices.toString(), color: '#1A1F36' },
          { label: 'Active Services', value: activeServicesCount.toString(), color: '#12B76A' },
          { label: 'Inactive Services', value: inactiveServicesCount.toString(), color: '#F59E0B' },
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

      {/* Services Table Card */}
      <div className="card" style={{ borderRadius: '14px 14px 0 0' }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #E5E9F2', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 300 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
            <input
              className="input-base"
              style={{ paddingLeft: 30, fontSize: 13 }}
              placeholder="Search services by name or description..."
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

          <select className="select-base" value={pricingFilter} onChange={(e) => setPricingFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="All">All Pricing Types</option>
            {pricingTypes.map((pt) => (
              <option key={pt} value={pt}>
                {pt}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table-base">
            <thead>
              <tr>
                <th>SERVICE NAME</th>
                <th>DESCRIPTION</th>
                <th>PRICING TYPE</th>
                <th style={{ textAlign: 'right' }}>DEFAULT PRICE</th>
                <th>STATUS</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>{s.name}</div>
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    <div style={{ fontSize: 12.5, color: '#697586', lineHeight: 1.4 }}>{s.description}</div>
                  </td>
                  <td>
                    <span className="badge badge-blue">{s.pricingType}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
                    ₹{s.defaultPrice.toLocaleString('en-IN')}
                  </td>
                  <td>
                    <span className={`badge ${s.status === 'Active' ? 'badge-green' : s.status === 'Archived' ? 'badge-amber' : 'badge-gray'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 11.5, padding: '4px 8px' }}
                        onClick={(e) => handleToggleStatus(s, e)}
                      >
                        {s.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={(e) => handleOpenEdit(s, e)}>
                        Edit
                      </button>
                      {s.status !== 'Archived' && (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', color: '#D97706', borderColor: '#FDE68A' }}
                          onClick={(e) => { e.stopPropagation(); setArchivingService(s); }}
                        >
                          Archive
                        </button>
                      )}
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                        onClick={(e) => { e.stopPropagation(); setDeletingService(s); }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#697586' }}>
                    No services match your search or filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9', fontSize: 12.5, color: '#697586' }}>
          Showing {filtered.length} of {services.length} services
        </div>
      </div>

      {/* Add Service Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" style={{ width: 540, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>Add New Service</div>
                <div style={{ fontSize: 12, color: '#697586' }}>Add a new service offerings to the company catalogue</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setShowAddModal(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleCreateService}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Service Name *</label>
                  <input
                    className="input-base"
                    placeholder="e.g. Website Development"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                  {formErrors.name && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.name}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Description *</label>
                  <textarea
                    className="input-base"
                    rows={3}
                    placeholder="Provide a detailed description of service scope..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                  {formErrors.description && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.description}</div>}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Pricing Type *</label>
                    <select
                      className="select-base"
                      style={{ width: '100%' }}
                      value={formData.pricingType}
                      onChange={(e) => setFormData({ ...formData, pricingType: e.target.value as any })}
                    >
                      {pricingTypes.map((pt) => (
                        <option key={pt} value={pt}>
                          {pt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Default Price (₹) *</label>
                    <input
                      className="input-base"
                      type="number"
                      placeholder="e.g. 45000"
                      value={formData.defaultPrice || ''}
                      onChange={(e) => setFormData({ ...formData, defaultPrice: Number(e.target.value) })}
                    />
                    {formErrors.defaultPrice && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.defaultPrice}</div>}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Status</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Add Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Service Modal */}
      {editingService && (
        <div className="modal-overlay" onClick={() => setEditingService(null)}>
          <div className="modal-box" style={{ width: 540, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>
                  Edit Service — {editingService.name}
                </div>
                <div style={{ fontSize: 12, color: '#697586' }}>Update service pricing & description</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setEditingService(null)}>
                ×
              </button>
            </div>

            <form onSubmit={handleUpdateService}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Service Name *</label>
                  <input className="input-base" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                  {formErrors.name && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.name}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Description *</label>
                  <textarea
                    className="input-base"
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                  {formErrors.description && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.description}</div>}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Pricing Type *</label>
                    <select
                      className="select-base"
                      style={{ width: '100%' }}
                      value={formData.pricingType}
                      onChange={(e) => setFormData({ ...formData, pricingType: e.target.value as any })}
                    >
                      {pricingTypes.map((pt) => (
                        <option key={pt} value={pt}>
                          {pt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Default Price (₹) *</label>
                    <input
                      className="input-base"
                      type="number"
                      value={formData.defaultPrice}
                      onChange={(e) => setFormData({ ...formData, defaultPrice: Number(e.target.value) })}
                    />
                    {formErrors.defaultPrice && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.defaultPrice}</div>}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Status</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditingService(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Modal */}
      {archivingService && (
        <div className="modal-overlay" onClick={() => setArchivingService(null)}>
          <div className="modal-box" style={{ width: 420, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36' }}>Archive Service</div>
              <div style={{ fontSize: 13, color: '#697586', marginTop: 6 }}>
                Are you sure you want to archive <strong>{archivingService.name}</strong>?
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setArchivingService(null)}>
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

      {/* Delete Modal */}
      {deletingService && (
        <DeleteConfirmationModal
          isOpen={!!deletingService}
          title="Delete Service"
          description={
            <>
              Are you sure you want to delete <strong>{deletingService.name}</strong>? This action cannot be undone.
            </>
          }
          isDeleting={isSubmitting}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeletingService(null)}
        />
      )}
    </div>
  );
}
