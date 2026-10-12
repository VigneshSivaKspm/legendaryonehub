import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Project } from '../db/database';
import { newestFirst } from '../utils/sort';
import { addProject, updateProject, deleteProject, archiveProject } from '../services/projectService';
import { validateProjectForm, type ProjectValidationErrors } from '../utils/validation';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import EmployeeSelect, { canManageProjects } from '../components/EmployeeSelect';
import { clientLabel, computeProjectFinancials } from '../utils/financials';
import { maskDateDDMMYYYY, toDisplayDate, todayDDMMYYYY } from '../utils/dateMask';
import OngoingWorks from '../components/OngoingWorks';
import ProjectServiceFields, { ServiceSelect } from '../components/ProjectServiceFields';
import { migrateServiceCatalog } from '../services/serviceCatalogService';
import { ONGOING_SERVICES, LEGACY_SERVICE_MAP } from '../utils/serviceCatalog';

interface Props {
  onViewProject: (id: number | string) => void;
}

const statusColors: Record<string, string> = {
  'In Progress': 'badge-blue',
  'Completed': 'badge-green',
  'Waiting for Client': 'badge-amber',
  'Maintenance': 'badge-teal',
  'Planning': 'badge-purple',
  'On Hold': 'badge-gray',
  'Testing': 'badge-cyan',
  'Revision': 'badge-orange',
  'Cancelled': 'badge-red',
  'Archived': 'badge-gray',
};

const projectStatuses: Project['status'][] = [
  'Planning',
  'In Progress',
  'Waiting for Client',
  'Testing',
  'Revision',
  'Completed',
  'Maintenance',
  'On Hold',
  'Cancelled',
  'Archived',
];

const initialFormState: Omit<Project, 'id'> = {
  name: '',
  clientId: 0,
  clientName: '',
  serviceName: 'Website Development',
  manager: '',
  team: [],
  startDate: '',
  deadline: '',
  value: 0,
  received: 0,
  pending: 0,
  expenses: 0,
  estimatedProfit: 0,
  progress: 0,
  status: 'In Progress',
  notes: '',
  requirements: '',
  domain: '',
  subServices: [],
  ongoing: false,
  monthlyRetainer: 0,
  itemRates: {},
};

export default function Projects({ onViewProject }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [pageTab, setPageTab] = useState<'projects' | 'ongoing' | 'expenses'>('projects');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [serviceFilter, setServiceFilter] = useState('All');

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [archivingProject, setArchivingProject] = useState<Project | null>(null);

  // Form states
  const [formData, setFormData] = useState<Omit<Project, 'id'>>(initialFormState);
  const [formErrors, setFormErrors] = useState<ProjectValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live queries from Dexie database
  const projects = useLiveQuery(async () => newestFirst(await db.projects.toArray(), (p) => p.startDate), []) || [];
  const clients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const services = useLiveQuery(() => db.services.toArray(), []) || [];
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const invoices = useLiveQuery(() => db.invoices.toArray(), []) || [];
  const expenses = useLiveQuery(async () => newestFirst(await db.expenses.toArray(), (e) => e.date), []) || [];
  const deliverables = useLiveQuery(() => db.deliverables.toArray(), []) || [];
  // Never-ending work lives in its own tab; the main list is fixed-scope projects
  const regularProjects = projects.filter((p) => !p.ongoing);
  const ongoingProjects = projects.filter((p) => p.ongoing && p.status !== 'Archived');
  const activeServices = services.filter((s) => s.status !== 'Archived' && !LEGACY_SERVICE_MAP[s.name]);

  // Catalog update: Media Works / Organic Marketing services, old Video Editing & Graphic Design moved over
  useEffect(() => {
    if (services.length === 0) return;
    migrateServiceCatalog()
      .then((moved) => moved > 0 && showToast(`${moved} Video Editing / Graphic Design project(s) moved to Media Works.`, 'info'))
      .catch((err) => console.warn('[Projects] Service catalog update failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.length]);
  const projectManagerCount = employees.filter((e) => canManageProjects(e) && e.status !== 'Inactive').length;
  const editingProjectPaymentCount = editingProject
    ? payments.filter((pm) => pm.projectId !== undefined && String(pm.projectId) === String(editingProject.id)).length
    : 0;

  // Filter projects dynamically
  const filtered = regularProjects.filter((p) => {
    const query = search.toLowerCase();
    const matchSearch =
      p.name.toLowerCase().includes(query) ||
      p.clientName.toLowerCase().includes(query) ||
      p.serviceName.toLowerCase().includes(query) ||
      (p.subServices || []).join(' ').toLowerCase().includes(query) ||
      p.manager.toLowerCase().includes(query);

    const matchStatus = statusFilter === 'All' || p.status === statusFilter;
    const matchService = serviceFilter === 'All' || p.serviceName === serviceFilter;

    return matchSearch && matchStatus && matchService;
  });

  // Calculate summary stats
  const totalProjectsCount = projects.length;
  const inProgressCount = projects.filter((p) => p.status === 'In Progress').length;
  // Same basis as the Clients page: received comes from recorded payments
  const projectFin = projects.map((p) => computeProjectFinancials(p, payments, invoices, expenses));
  const totalValueSum = projectFin.reduce((acc, f) => acc + f.value, 0);
  const receivedSum = projectFin.reduce((acc, f) => acc + f.received, 0);
  const pendingPaymentsSum = projectFin.reduce((acc, f) => acc + f.pending, 0);

  // Project-linked expenses from DB
  const projectLinkedExpenses = expenses.filter((e) => e.projectId || e.projectName);
  const projectExpensesTotal = projectLinkedExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const formatCurrency = (amount: number) => {
    if (amount >= 100000) {
      return '₹' + (amount / 100000).toFixed(1) + 'L';
    }
    return '₹' + amount.toLocaleString('en-IN');
  };

  // Open Create Modal
  const handleOpenAdd = () => {
    const defaultClient = clients[0];
    const serviceName = pageTab === 'ongoing' ? 'Media Works' : activeServices[0]?.name || 'Website Development';
    setFormData({
      ...initialFormState,
      clientId: defaultClient?.id || 0,
      clientName: defaultClient?.name || '',
      serviceName,
      ongoing: ONGOING_SERVICES.has(serviceName),
    });
    setFormErrors({});
    setShowAdd(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(project);
    setFormData({
      name: project.name,
      clientId: project.clientId,
      clientName: project.clientName,
      serviceName: project.serviceName,
      manager: project.manager,
      team: project.team || [],
      startDate: toDisplayDate(project.startDate),
      deadline: project.deadline,
      value: project.value,
      received: project.received,
      pending: project.pending,
      expenses: project.expenses || 0,
      estimatedProfit: project.estimatedProfit || 0,
      progress: project.progress,
      status: project.status,
      notes: project.notes || '',
      requirements: project.requirements || '',
      domain: project.domain || '',
      subServices: project.subServices || [],
      ongoing: !!project.ongoing,
      monthlyRetainer: project.monthlyRetainer || 0,
      itemRates: project.itemRates || {},
    });
    setFormErrors({});
  };

  // Open Archive Modal
  const handleOpenArchive = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setArchivingProject(project);
  };

  // Open Delete Modal
  const handleOpenDelete = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingProject(project);
  };

  // Handle Form field changes
  const handleClientChange = (clientId: string) => {
    const selectedClient = clients.find((c) => String(c.id) === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId: selectedClient?.id ?? clientId,
      clientName: selectedClient?.name || '',
    }));
  };

  const handleValueChange = (val: number, rec: number) => {
    const valueNum = Math.max(0, val);
    const recNum = Math.max(0, rec);
    const pend = Math.max(0, valueNum - recNum);
    setFormData((prev) => ({
      ...prev,
      value: valueNum,
      received: recNum,
      pending: pend,
      estimatedProfit: valueNum - (prev.expenses || 0),
    }));
  };

  // Submit Add Project
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateProjectForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await addProject(formData);
      showToast(`Project "${formData.name}" created successfully!`, 'success');
      setShowAdd(false);
    } catch (err) {
      console.error('Failed to create project:', err);
      showToast('Failed to create project.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Update Project
  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject?.id) return;

    const errors = validateProjectForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await updateProject(editingProject.id, formData);
      showToast(`Project "${formData.name}" updated successfully!`, 'success');
      setEditingProject(null);
    } catch (err) {
      console.error('Failed to update project:', err);
      showToast('Failed to update project.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm Archive
  const handleConfirmArchive = async () => {
    if (!archivingProject?.id) return;

    setIsSubmitting(true);
    try {
      await archiveProject(archivingProject.id);
      showToast(`Project "${archivingProject.name}" archived successfully!`, 'info');
      setArchivingProject(null);
    } catch (err) {
      console.error('Failed to archive project:', err);
      showToast('Failed to archive project.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!deletingProject?.id) return;

    setIsSubmitting(true);
    try {
      await deleteProject(deletingProject.id);
      showToast(`Project "${deletingProject.name}" deleted permanently.`, 'info');
      setDeletingProject(null);
    } catch (err) {
      console.error('Failed to delete project:', err);
      showToast('Failed to delete project.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Project Management</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Manage all company projects, assignments, progress & client links (Real-time DB)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => showToast('Exporting project list...', 'info')}>
            ⬇ Export CSV
          </button>
          <button className="btn-primary" onClick={handleOpenAdd}>
            + Create New Project
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Projects', value: totalProjectsCount.toString(), color: '#1A1F36' },
          { label: 'In Progress', value: inProgressCount.toString(), color: '#3B5BDB' },
          { label: 'Total Value', value: formatCurrency(totalValueSum), color: '#1A1F36' },
          { label: 'Received', value: formatCurrency(receivedSum), color: '#12B76A' },
          { label: 'Pending', value: formatCurrency(pendingPaymentsSum), color: '#F59E0B' },
          { label: 'Project Expenses', value: formatCurrency(projectExpensesTotal), color: '#EF4444' },
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

      {/* Table Card with Tabs */}
      <div className="card" style={{ borderRadius: '14px 14px 0 0' }}>
        {/* ── Tab switcher ── */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setPageTab('projects')}
              style={{
                padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                background: pageTab === 'projects' ? '#3B5BDB' : '#F1F5F9',
                color: pageTab === 'projects' ? '#fff' : '#697586',
              }}
            >
              📋 Projects ({regularProjects.length})
            </button>
            <button
              onClick={() => setPageTab('ongoing')}
              style={{
                padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                background: pageTab === 'ongoing' ? '#7C3AED' : '#F1F5F9',
                color: pageTab === 'ongoing' ? '#fff' : '#697586',
              }}
            >
              🔁 Ongoing Works ({ongoingProjects.length})
            </button>
            <button
              onClick={() => setPageTab('expenses')}
              style={{
                padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                background: pageTab === 'expenses' ? '#EF4444' : '#F1F5F9',
                color: pageTab === 'expenses' ? '#fff' : '#697586',
              }}
            >
              💸 Project Expenses ({projectLinkedExpenses.length})
            </button>
          </div>

          {/* Filters — only shown for Projects tab */}
          {pageTab === 'projects' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', minWidth: 200, maxWidth: 280 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
                <input
                  className="input-base"
                  style={{ paddingLeft: 30, fontSize: 13 }}
                  placeholder="Search projects by name, client, manager..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="select-base" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 13 }}>
                <option value="All">All Statuses</option>
                {projectStatuses.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
              <select className="select-base" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} style={{ fontSize: 13 }}>
                <option value="All">All Services</option>
                {activeServices.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* Expenses tab summary */}
          {pageTab === 'expenses' && projectLinkedExpenses.length > 0 && (
            <div style={{ fontSize: 13, color: '#697586' }}>
              Total: <strong style={{ color: '#EF4444' }}>₹{projectExpensesTotal.toLocaleString('en-IN')}</strong>
            </div>
          )}
        </div>

        {/* ── Projects Table ── */}
        {pageTab === 'projects' && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>PROJECT NAME & CLIENT</th>
                    <th>CLIENT</th>
                    <th>MANAGER</th>
                    <th>END DATE</th>
                    <th style={{ textAlign: 'right' }}>VALUE</th>
                    <th style={{ textAlign: 'right' }}>RECEIVED</th>
                    <th style={{ textAlign: 'right' }}>PENDING</th>
                    <th>PROGRESS</th>
                    <th>STATUS</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => p.id && onViewProject(p.id)}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1A1F36', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#3B5BDB', fontWeight: 600, marginTop: 1 }}>
                          {p.clientName}
                        </div>
                        <div style={{ fontSize: 11, color: '#697586', marginTop: 1 }}>
                          {p.serviceName}
                          {p.subServices?.length ? ` · ${p.subServices.join(', ')}` : ''}
                        </div>
                      </td>
                      <td style={{ fontSize: 13, fontWeight: 500 }}>{p.clientName}</td>
                      <td style={{ fontSize: 13 }}>{p.manager}</td>
                      <td style={{ fontSize: 13, color: '#697586' }}>{toDisplayDate(p.deadline) || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{p.value.toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right', color: '#12B76A', fontWeight: 600 }}>₹{p.received.toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right', color: p.pending > 0 ? '#F59E0B' : '#697586', fontWeight: 600 }}>
                        {p.pending > 0 ? '₹' + p.pending.toLocaleString('en-IN') : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
                          <div style={{ background: '#E5E9F2', borderRadius: 99, height: 6, flex: 1 }}>
                            <div
                              style={{
                                background: p.progress === 100 ? '#12B76A' : '#3B5BDB',
                                borderRadius: 99,
                                height: 6,
                                width: p.progress + '%',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 12, color: '#697586', flexShrink: 0 }}>{p.progress}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${statusColors[p.status] || 'badge-gray'}`}>{p.status}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            className="btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 8px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              p.id && onViewProject(p.id);
                            }}
                          >
                            View
                          </button>
                          <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={(e) => handleOpenEdit(p, e)}>
                            Edit
                          </button>
                          {p.status !== 'Archived' && (
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11.5, padding: '4px 8px', color: '#D97706', borderColor: '#FDE68A' }}
                              onClick={(e) => handleOpenArchive(p, e)}
                            >
                              Archive
                            </button>
                          )}
                          <button
                            className="btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                            onClick={(e) => handleOpenDelete(p, e)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: '#697586' }}>
                        No projects match your search or filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9', fontSize: 12.5, color: '#697586' }}>
              Showing {filtered.length} of {regularProjects.length} projects · ongoing works are in their own tab
            </div>
          </>
        )}

        {/* ── Ongoing Works ── */}
        {pageTab === 'ongoing' && (
          <OngoingWorks
            projects={ongoingProjects}
            clients={clients}
            deliverables={deliverables}
            payments={payments}
            invoices={invoices}
            onEdit={handleOpenEdit}
          />
        )}

        {/* ── Project Expenses Table ── */}
        {pageTab === 'expenses' && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>EXPENSE</th>
                    <th>PROJECT</th>
                    <th>CATEGORY</th>
                    <th style={{ textAlign: 'right' }}>AMOUNT</th>
                    <th>DATE</th>
                    <th>PAID TO</th>
                    <th>METHOD</th>
                    <th>NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  {projectLinkedExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '48px 16px', color: '#697586' }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                        <div style={{ fontWeight: 600, fontSize: 15, color: '#1A1F36', marginBottom: 4 }}>No project expenses recorded yet</div>
                        <div style={{ fontSize: 13 }}>Add expenses from the Expenses page and link them to a project.</div>
                      </td>
                    </tr>
                  ) : (
                    projectLinkedExpenses.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                          <div style={{ fontSize: 11, color: '#697586' }}>{e.expenseNumber || e.id}</div>
                        </td>
                        <td>
                          <span style={{ fontSize: 12.5, color: '#3B5BDB', fontWeight: 600 }}>{e.projectName || '—'}</span>
                        </td>
                        <td>
                          <span className="badge badge-gray">{e.category || 'Other'}</span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444', fontSize: 14 }}>
                          ₹{(Number(e.amount) || 0).toLocaleString('en-IN')}
                        </td>
                        <td style={{ fontSize: 12.5, color: '#697586' }}>{e.date || '—'}</td>
                        <td style={{ fontSize: 13 }}>{e.paidTo || '—'}</td>
                        <td>
                          <span className={`badge ${e.method === 'UPI' ? 'badge-cyan' : e.method === 'Card' ? 'badge-purple' : e.method === 'Cash' ? 'badge-gray' : 'badge-blue'}`}>
                            {e.method || 'Bank Transfer'}
                          </span>
                        </td>
                        <td style={{ fontSize: 11.5, color: '#697586', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.notes || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9', fontSize: 12.5, color: '#697586' }}>
              {projectLinkedExpenses.length} project expense{projectLinkedExpenses.length !== 1 ? 's' : ''} · Total:{' '}
              <strong style={{ color: '#EF4444' }}>₹{projectExpensesTotal.toLocaleString('en-IN')}</strong>
            </div>
          </>
        )}
      </div>

      {/* Add Project Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-box" style={{ width: 640, padding: 28, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>Create New Project</div>
                <div style={{ fontSize: 12, color: '#697586' }}>Link project to client and service, assign team & set timeline</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setShowAdd(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleCreateProject}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Name *</label>
                  <input
                    className="input-base"
                    placeholder="e.g. Temple India Website Redesign"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                  {formErrors.name && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.name}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Linked Client *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.clientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {clientLabel(c)}
                      </option>
                    ))}
                  </select>
                  {formErrors.clientId && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.clientId}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Service Category *</label>
                  <ServiceSelect formData={formData} setFormData={setFormData} services={services} />
                  {formErrors.serviceName && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.serviceName}</div>}
                </div>

                <ProjectServiceFields formData={formData} setFormData={setFormData} error={formErrors.value} />

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Manager *</label>
                  <EmployeeSelect
                    value={formData.manager}
                    filter={canManageProjects}
                    placeholder="Select Project Manager"
                    onChange={(name) => setFormData({ ...formData, manager: name })}
                  />
                  {projectManagerCount === 0 && (
                    <div style={{ fontSize: 11.5, color: '#697586', marginTop: 4 }}>
                      No managers yet. In Employees, set an employee's Access Role to "Project Manager".
                    </div>
                  )}
                  {formErrors.manager && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.manager}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Status</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any, ...(e.target.value === 'Completed' ? { progress: 100 } : {}) })}
                  >
                    {projectStatuses.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                {!formData.ongoing && (
                <>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Value (₹) *</label>
                  <input
                    className="input-base"
                    type="number"
                    placeholder="e.g. 120000"
                    value={formData.value || ''}
                    onChange={(e) => handleValueChange(Number(e.target.value), formData.received)}
                  />
                  {formErrors.value && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.value}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Amount Received (₹)</label>
                  <input
                    className="input-base"
                    type="number"
                    placeholder="e.g. 72000"
                    value={formData.received || ''}
                    onChange={(e) => handleValueChange(formData.value, Number(e.target.value))}
                  />
                </div>
                </>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Start Date</label>
                  <input
                    className="input-base"
                    placeholder="DD/MM/YYYY"
                    inputMode="numeric"
                    maxLength={10}
                    value={formData.startDate}
                    style={{ borderColor: formErrors.startDate ? '#EF4444' : undefined }}
                    onChange={(e) => setFormData({ ...formData, startDate: maskDateDDMMYYYY(e.target.value, formData.startDate) })}
                  />
                  {formErrors.startDate && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.startDate}</div>}
                </div>

                {!formData.ongoing && (
                <>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>End Date</label>
                  <input
                    className="input-base"
                    disabled
                    value={formData.progress >= 100 || formData.status === 'Completed' ? toDisplayDate(formData.deadline) || todayDDMMYYYY() : ''}
                    placeholder="Set automatically on completion"
                  />
                  <div style={{ fontSize: 11.5, color: '#697586', marginTop: 4 }}>Filled in when progress hits 100% or status is Completed.</div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Progress (%)</label>
                  <input
                    className="input-base"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.progress}
                    onChange={(e) => setFormData({ ...formData, progress: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  />
                </div>
                </>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Estimated Expenses (₹)</label>
                  <input
                    className="input-base"
                    type="number"
                    value={formData.expenses || 0}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expenses: Number(e.target.value),
                        estimatedProfit: formData.value - Number(e.target.value),
                      })
                    }
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Domain(s)</label>
                  <input
                    className="input-base"
                    placeholder="e.g. example.in, example.com"
                    value={formData.domain || ''}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Requirements & Scope</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="Key deliverables, tech stack, dependencies..."
                    value={formData.requirements}
                    onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Notes</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="Internal project notes..."
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {editingProject && (
        <div className="modal-overlay" onClick={() => setEditingProject(null)}>
          <div className="modal-box" style={{ width: 640, padding: 28, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>
                  Edit Project — {editingProject.name}
                </div>
                <div style={{ fontSize: 12, color: '#697586' }}>Update project details in database</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setEditingProject(null)}>
                ×
              </button>
            </div>

            <form onSubmit={handleUpdateProject}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Name *</label>
                  <input className="input-base" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                  {formErrors.name && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.name}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Linked Client *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.clientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {clientLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Service Category *</label>
                  <ServiceSelect formData={formData} setFormData={setFormData} services={services} />
                </div>

                <ProjectServiceFields formData={formData} setFormData={setFormData} error={formErrors.value} />

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Manager *</label>
                  <EmployeeSelect
                    value={formData.manager}
                    filter={canManageProjects}
                    placeholder="Select Project Manager"
                    onChange={(name) => setFormData({ ...formData, manager: name })}
                  />
                  {projectManagerCount === 0 && (
                    <div style={{ fontSize: 11.5, color: '#697586', marginTop: 4 }}>
                      No managers yet. In Employees, set an employee's Access Role to "Project Manager".
                    </div>
                  )}
                  {formErrors.manager && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.manager}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Status</label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any, ...(e.target.value === 'Completed' ? { progress: 100 } : {}) })}
                  >
                    {projectStatuses.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                {!formData.ongoing && (
                <>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Value (₹) *</label>
                  <input
                    className="input-base"
                    type="number"
                    value={formData.value}
                    onChange={(e) => handleValueChange(Number(e.target.value), formData.received)}
                  />
                  {formErrors.value && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.value}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Amount Received (₹)</label>
                  <input
                    className="input-base"
                    type="number"
                    value={formData.received}
                    disabled={editingProjectPaymentCount > 0}
                    onChange={(e) => handleValueChange(formData.value, Number(e.target.value))}
                  />
                  {editingProjectPaymentCount > 0 && (
                    <div style={{ fontSize: 11.5, color: '#697586', marginTop: 4 }}>
                      Synced from {editingProjectPaymentCount} recorded payment{editingProjectPaymentCount === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
                </>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Start Date</label>
                  <input
                    className="input-base"
                    placeholder="DD/MM/YYYY"
                    inputMode="numeric"
                    maxLength={10}
                    value={formData.startDate}
                    style={{ borderColor: formErrors.startDate ? '#EF4444' : undefined }}
                    onChange={(e) => setFormData({ ...formData, startDate: maskDateDDMMYYYY(e.target.value, formData.startDate) })}
                  />
                  {formErrors.startDate && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.startDate}</div>}
                </div>

                {!formData.ongoing && (
                <>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>End Date</label>
                  <input
                    className="input-base"
                    disabled
                    value={formData.progress >= 100 || formData.status === 'Completed' ? toDisplayDate(formData.deadline) || todayDDMMYYYY() : ''}
                    placeholder="Set automatically on completion"
                  />
                  <div style={{ fontSize: 11.5, color: '#697586', marginTop: 4 }}>Filled in when progress hits 100% or status is Completed.</div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Progress (%)</label>
                  <input
                    className="input-base"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.progress}
                    onChange={(e) => setFormData({ ...formData, progress: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  />
                </div>
                </>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Expenses (₹)</label>
                  <input
                    className="input-base"
                    type="number"
                    value={formData.expenses}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expenses: Number(e.target.value),
                        estimatedProfit: formData.value - Number(e.target.value),
                      })
                    }
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Domain(s)</label>
                  <input
                    className="input-base"
                    placeholder="e.g. example.in, example.com"
                    value={formData.domain || ''}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Requirements & Scope</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    value={formData.requirements}
                    onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Project Notes</label>
                  <textarea className="input-base" rows={2} value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditingProject(null)}>
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
      {archivingProject && (
        <div className="modal-overlay" onClick={() => setArchivingProject(null)}>
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
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36' }}>Archive Project</div>
              <div style={{ fontSize: 13, color: '#697586', marginTop: 6, lineHeight: 1.4 }}>
                Are you sure you want to archive project <strong>{archivingProject.name}</strong>?
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setArchivingProject(null)}>
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
      {deletingProject && (
        <DeleteConfirmationModal
          isOpen={!!deletingProject}
          title="Delete Project"
          description={
            <>
              Are you sure you want to delete <strong>{deletingProject.name}</strong>? This action cannot be undone.
            </>
          }
          isDeleting={isSubmitting}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeletingProject(null)}
        />
      )}
    </div>
  );
}
