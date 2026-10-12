import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Client } from '../db/database';
import { newestFirst } from '../utils/sort';
import { updateClient, deleteClient, archiveClient } from '../services/clientService';
import { validateClientForm, type ClientValidationErrors } from '../utils/validation';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { computeClientFinancials, clientLabel } from '../utils/financials';
import { toDisplayDate } from '../utils/dateMask';
import CredentialsPanel from '../components/CredentialsPanel';
import { isOwnerOrAdminRole } from '../services/authService';
import { Trash2 } from 'lucide-react';

interface Props {
  clientId: number | string;
  onBack: () => void;
  onViewProject?: (id: number | string) => void;
}

const baseTabs = ['Overview', 'Projects', 'Deliverables', 'Payments', 'Quotations', 'Invoices', 'Documents', 'Activity'];

export default function ClientProfile({ clientId, onBack, onViewProject }: Props) {
  const { canManageClients, canDeleteClients, user } = useAuth();
  const tabs = isOwnerOrAdminRole(user?.role) ? [...baseTabs, 'Access'] : baseTabs;
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState('Overview');

  // Edit / Delete modal states
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch client live from database
  const client = useLiveQuery(() => db.clients.get(clientId), [clientId]);

  // Fetch projects live from DB for this client
  const clientProjects = useLiveQuery(
    async () => (client ? newestFirst(await db.projects.where('clientId').equals(client.id!).toArray(), (p) => p.startDate) : []),
    [client]
  ) || [];

  // Fetch tasks live from DB
  const clientTasks = useLiveQuery(
    () => (clientProjects.length > 0 ? db.tasks.toArray() : []),
    [clientProjects]
  ) || [];

  // Fetch activity live from DB for this client
  const activities = useLiveQuery(
    () => (client ? db.projectActivity.where('clientId').equals(client.id!).reverse().toArray() : []),
    [client]
  ) || [];

  const allProjects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const allPayments = useLiveQuery(() => db.payments.toArray(), []) || [];

  const [formData, setFormData] = useState<Partial<Client>>({});
  const [formErrors, setFormErrors] = useState<ClientValidationErrors>({});

  if (!client) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: '#697586', marginBottom: 12 }}>Loading client profile...</div>
        <button className="btn-secondary" onClick={onBack}>← Back to Clients</button>
      </div>
    );
  }

  const activeProjectsCount = clientProjects.filter((p) => p.status === 'In Progress' || p.status === 'Planning').length;
  const completedProjectsCount = clientProjects.filter((p) => p.status === 'Completed').length;

  // Derived from the client's projects and recorded payments
  const clientFin = computeClientFinancials(client, allProjects, allPayments);
  const totalVal = clientFin.totalValue;
  const paidVal = clientFin.paid;
  const pendingVal = clientFin.pending;

  const handleOpenEdit = () => {
    setFormData({
      name: client.name,
      company: client.company,
      contact: client.contact,
      phone: client.phone,
      email: client.email,
      address: client.address || '',
      city: client.city,
      status: client.status,
      gstin: client.gstin || '',
      notes: client.notes || '',
    });
    setFormErrors({});
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateClientForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await updateClient(client.id!, formData);
      showToast('Client profile updated successfully!', 'success');
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update client profile:', err);
      showToast('Failed to update client profile.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmArchive = async () => {
    setIsSubmitting(true);
    try {
      await archiveClient(client.id!);
      showToast(`Client "${client.name}" archived.`, 'info');
      setIsArchiving(false);
    } catch (err) {
      console.error('Failed to archive client:', err);
      showToast('Failed to archive client.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsSubmitting(true);
    try {
      await deleteClient(client.id!);
      showToast(`Client "${client.name}" deleted.`, 'info');
      onBack();
    } catch (err) {
      console.error('Failed to delete client:', err);
      showToast('Failed to delete client.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Back */}
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: '#697586',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'inherit',
          fontWeight: 600,
        }}
      >
        ← Back to Clients List
      </button>

      {/* Hero card */}
      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 14,
              background: '#EEF2FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 800,
              color: '#3B5BDB',
              flexShrink: 0,
            }}
          >
            {client.name.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 20, color: '#1A1F36' }}>{clientLabel(client)}</div>
                <div style={{ fontSize: 13.5, color: '#697586', marginTop: 2 }}>
                  {[client.company, client.city].filter(Boolean).join(' · ')}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <span className={`badge ${client.status === 'Active' ? 'badge-green' : client.status === 'Archived' ? 'badge-amber' : 'badge-gray'}`}>
                    {client.status}
                  </span>
                  {clientFin.services.map((sv) => (
                    <span key={sv} className="badge badge-blue">{sv}</span>
                  ))}
                  {client.joinDate && <span className="badge badge-purple">Joined: {client.joinDate}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {canManageClients && (
                  <button className="btn-secondary" style={{ fontSize: 13 }} onClick={handleOpenEdit}>
                    ✏ Edit Client
                  </button>
                )}
                {canManageClients && client.status !== 'Archived' && (
                  <button className="btn-secondary" style={{ fontSize: 13, color: '#D97706', borderColor: '#FDE68A' }} onClick={() => setIsArchiving(true)}>
                    📦 Archive
                  </button>
                )}
                {canDeleteClients && (
                  <button className="btn-secondary" style={{ fontSize: 13, color: '#EF4444', borderColor: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 5 }} onClick={() => setIsDeleting(true)}>
                    <Trash2 size={14} /> Delete
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 18 }}>
              {[
                { label: 'Total Value', value: '₹' + totalVal.toLocaleString('en-IN'), color: '#1A1F36' },
                { label: 'Amount Received', value: '₹' + paidVal.toLocaleString('en-IN'), color: '#12B76A' },
                { label: 'Pending Payment', value: pendingVal > 0 ? '₹' + pendingVal.toLocaleString('en-IN') : '₹0', color: pendingVal > 0 ? '#F59E0B' : '#697586' },
                { label: 'Active Projects', value: activeProjectsCount.toString(), color: '#3B5BDB' },
                { label: 'Completed Projects', value: completedProjectsCount.toString(), color: '#12B76A' },
              ].map((s) => (
                <div key={s.label} style={{ background: '#F8F9FC', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: 'Plus Jakarta Sans' }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Details Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#1A1F36' }}>
            Contact & Address Details
          </div>
          {[
            ['Contact Person', client.contact],
            ['Phone Number', client.phone],
            ['Email Address', client.email],
            ['Address', client.address || '—'],
            ['City', client.city],
            ['Join Date', client.joinDate || '—'],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, color: '#697586', width: 130, flexShrink: 0 }}>{l}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1F36' }}>{v}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#1A1F36' }}>
            Billing & Business Info
          </div>
          {[
            ['Services (from projects)', clientFin.services.join(', ') || '—'],
            ['Projects', String(clientFin.projectCount)],
            ['GSTIN', client.gstin || 'Not Provided'],
            ['Total Value', `₹${totalVal.toLocaleString('en-IN')}`],
            ['Paid Amount', `₹${paidVal.toLocaleString('en-IN')}`],
            ['Pending Amount', `₹${pendingVal.toLocaleString('en-IN')}`],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, color: '#697586', width: 130, flexShrink: 0 }}>{l}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1F36' }}>{v}</div>
            </div>
          ))}
          {client.notes && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E5E9F2' }}>
              <div style={{ fontSize: 12, color: '#697586', fontWeight: 600 }}>Notes:</div>
              <div style={{ fontSize: 12.5, color: '#1A1F36', marginTop: 2 }}>{client.notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div style={{ padding: '0 12px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 4, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <button key={t} className={`tab-btn${activeTab === t ? ' active' : ''}`} style={{ borderRadius: '8px 8px 0 0', padding: '10px 14px' }} onClick={() => setActiveTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ padding: 20 }}>
          {activeTab === 'Overview' && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#1A1F36' }}>Financial & Payment Collection Summary</div>
              <div style={{ background: '#F8F9FC', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, color: '#697586' }}>Collection Progress</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1A1F36' }}>
                    ₹{paidVal.toLocaleString('en-IN')} / ₹{totalVal.toLocaleString('en-IN')}
                  </span>
                </div>
                <div style={{ background: '#E5E9F2', borderRadius: 99, height: 8 }}>
                  <div style={{ background: '#3B5BDB', borderRadius: 99, height: 8, width: (totalVal > 0 ? (paidVal / totalVal) * 100 : 0) + '%' }} />
                </div>
                <div style={{ fontSize: 12, color: '#3B5BDB', marginTop: 4, fontWeight: 600 }}>
                  {totalVal > 0 ? Math.round((paidVal / totalVal) * 100) : 0}% collected
                </div>
              </div>

              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#1A1F36' }}>Client Projects Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {clientProjects.length > 0 ? (
                  clientProjects.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#F8F9FC', borderRadius: 10 }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1F36' }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: '#697586' }}>
                          Manager: {p.manager}{p.deadline ? ` • Ended: ${toDisplayDate(p.deadline)}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>₹{p.value.toLocaleString('en-IN')}</div>
                        <span className={`badge ${p.status === 'Completed' ? 'badge-green' : p.status === 'In Progress' ? 'badge-blue' : 'badge-amber'}`}>
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', padding: 20, color: '#697586' }}>No projects created for this client yet.</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'Projects' && (
            <table className="table-base">
              <thead>
                <tr>
                  <th>PROJECT NAME</th>
                  <th>SERVICE</th>
                  <th>MANAGER</th>
                  <th>END DATE</th>
                  <th>VALUE</th>
                  <th>PROGRESS</th>
                  <th>STATUS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clientProjects.length > 0 ? (
                  clientProjects.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{p.serviceName}</td>
                      <td>{p.manager}</td>
                      <td>{toDisplayDate(p.deadline) || '—'}</td>
                      <td style={{ fontWeight: 600 }}>₹{p.value.toLocaleString('en-IN')}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ background: '#E5E9F2', borderRadius: 99, height: 6, width: 80 }}>
                            <div style={{ background: '#3B5BDB', borderRadius: 99, height: 6, width: p.progress + '%' }} />
                          </div>
                          <span style={{ fontSize: 12, color: '#697586' }}>{p.progress}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${p.status === 'Completed' ? 'badge-green' : p.status === 'In Progress' ? 'badge-blue' : 'badge-amber'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td>
                        {p.id && onViewProject && (
                          <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => onViewProject(p.id!)}>
                            Open Project
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: '#697586', padding: '30px' }}>
                      No projects found for this client.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'Activity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activities.length > 0 ? (
                activities.map((act) => (
                  <div key={act.id} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: '#F8F9FC', borderRadius: 10, alignItems: 'center' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#EEF2FF', color: '#3B5BDB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                      ⚡
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>{act.title}</div>
                      <div style={{ fontSize: 11.5, color: '#697586' }}>By {act.user} • {act.timestamp}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>No recent activity logged for this client.</div>
              )}
            </div>
          )}

          {activeTab === 'Access' && (
            <CredentialsPanel
              clientId={String(client.id)}
              projects={clientProjects.map((cp) => ({ id: String(cp.id), name: cp.name }))}
            />
          )}

          {['Deliverables', 'Payments', 'Quotations', 'Invoices', 'Documents'].includes(activeTab) && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#697586' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>No {activeTab.toLowerCase()} records yet for this client</div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="modal-overlay" onClick={() => setIsEditing(false)}>
          <div className="modal-box" style={{ width: 640, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18 }}>Edit Client Profile</div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setIsEditing(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Client Name *</label>
                  <input className="input-base" value={formData.contact || ''} onChange={(e) => setFormData({ ...formData, contact: e.target.value })} />
                  {formErrors.contact && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.contact}</div>}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Company Name (optional)</label>
                  <input className="input-base" value={formData.company || ''} onChange={(e) => setFormData({ ...formData, company: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Phone Number *</label>
                  <input className="input-base" value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                  {formErrors.phone && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.phone}</div>}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Email Address *</label>
                  <input className="input-base" type="email" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                  {formErrors.email && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.email}</div>}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>City *</label>
                  <input className="input-base" value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                  {formErrors.city && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.city}</div>}
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Address (optional)</label>
                  <input className="input-base" value={formData.address || ''} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Modal */}
      {isArchiving && (
        <div className="modal-overlay" onClick={() => setIsArchiving(false)}>
          <div className="modal-box" style={{ width: 420, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36' }}>Archive Client</div>
              <div style={{ fontSize: 13, color: '#697586', marginTop: 6 }}>Are you sure you want to archive {client.name}?</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setIsArchiving(false)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1, justifyContent: 'center', background: '#D97706' }} onClick={handleConfirmArchive} disabled={isSubmitting}>
                {isSubmitting ? 'Archiving...' : 'Archive Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {isDeleting && (
        <DeleteConfirmationModal
          isOpen={isDeleting}
          title="Delete Client"
          itemName={client.name}
          description={`Are you sure you want to delete ${client.name}? This cannot be undone.`}
          isDeleting={isSubmitting}
          onConfirm={handleConfirmDelete}
          onClose={() => setIsDeleting(false)}
        />
      )}
    </div>
  );
}
