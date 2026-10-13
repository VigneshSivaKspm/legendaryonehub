import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { db, type Payment, type Project, type ProjectTask, type ProjectMilestone, type ProjectFile } from '../db/database';
import { newestFirst } from '../utils/sort';
import { updateProject, addProjectMilestone, addProjectFile, addProjectActivity } from '../services/projectService';
import { deletePayment } from '../services/paymentService';
import { addTask } from '../services/taskService';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import EmployeeSelect from '../components/EmployeeSelect';
import CredentialsPanel from '../components/CredentialsPanel';
import { PaymentModal } from '../components/OngoingDialogs';
import OngoingProjectDetail from './OngoingProjectDetail';
import { isOwnerOrAdminRole } from '../services/authService';
import { computeProjectFinancials, paymentsForProject } from '../utils/financials';
import { toDisplayDate } from '../utils/dateMask';

interface Props {
  projectId: number | string;
  onBack: () => void;
}

const baseTabs = ['Overview', 'Tasks', 'Milestones', 'Team', 'Requirements', 'Files', 'Payments', 'Activity'];

const priorityColors: Record<string, string> = {
  Urgent: 'badge-red',
  High: 'badge-amber',
  Medium: 'badge-blue',
  Low: 'badge-gray',
};

export default function ProjectDetail({ projectId, onBack }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const tabs = isOwnerOrAdminRole(user?.role) ? [...baseTabs, 'Access'] : baseTabs;
  const [activeTab, setActiveTab] = useState('Overview');

  // Modals & form state
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [showFileModal, setShowFileModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState<{ open: boolean; payment?: Payment }>({ open: false });

  // New task form
  const [taskName, setTaskName] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskAssigneeId, setTaskAssigneeId] = useState<string | number | undefined>(undefined);
  const [taskPriority, setTaskPriority] = useState<ProjectTask['priority']>('High');
  const [taskHours, setTaskHours] = useState(8);

  // New milestone form
  const [mLabel, setMLabel] = useState('');
  const [mAmount, setMAmount] = useState(25000);
  const [mDate, setMDate] = useState(new Date().toLocaleDateString('en-GB'));
  const [mStatus, setMStatus] = useState<'Received' | 'Pending'>('Pending');

  // New file form
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState('PDF');

  // Edit project form
  const [editProgress, setEditProgress] = useState(0);
  const [editStatus, setEditStatus] = useState<Project['status']>('In Progress');
  const [editExpenses, setEditExpenses] = useState(0);

  // Dexie live queries
  const p = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const tasks = useLiveQuery(async () => newestFirst(await db.tasks.where('projectId').equals(projectId).toArray(), (t) => t.start || t.dueDate), [projectId]) || [];
  const milestones = useLiveQuery(() => db.projectMilestones.where('projectId').equals(projectId).toArray(), [projectId]) || [];
  const files = useLiveQuery(async () => newestFirst(await db.projectFiles.where('projectId').equals(projectId).toArray()), [projectId]) || [];
  const activityLogs = useLiveQuery(() => db.projectActivity.where('projectId').equals(projectId).reverse().toArray(), [projectId]) || [];
  const allPayments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const allInvoices = useLiveQuery(() => db.invoices.toArray(), []) || [];
  const allExpenses = useLiveQuery(() => db.expenses.toArray(), []) || [];

  if (!p) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: '#697586', marginBottom: 12 }}>Loading project details...</div>
        <button className="btn-secondary" onClick={onBack}>← Back to Projects List</button>
      </div>
    );
  }

  if (p.ongoing) {
    return <OngoingProjectDetail projectId={projectId} onBack={onBack} />;
  }

  // Live figures from recorded payments, invoices and expenses for this project
  const fin = computeProjectFinancials(p, allPayments, allInvoices, allExpenses);
  const expenses = fin.expenses;
  const estimatedProfit = fin.profit;
  const pendingAmount = fin.pending;
  const receivedAmount = fin.received;
  const projectInvoices = allInvoices.filter((inv) => inv.projectId !== undefined && String(inv.projectId) === String(p.id));
  const projectPayments = paymentsForProject(p, allPayments, allInvoices).sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );
  const projectExpenses = allExpenses.filter((ex) => ex.projectId !== undefined && String(ex.projectId) === String(p.id));
  const teamMembers = Array.from(
    new Set(
      [...(p.team || []), ...tasks.map((t) => t.assignedTo || t.assignee || '')].filter(
        (m) => !!m && m !== p.manager
      )
    )
  );

  // Create Task handler
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim()) return;
    if (!taskAssignee) {
      showToast('Please select an employee to assign this task to.', 'error');
      return;
    }

    try {
      await addTask({
        projectId: p.id!,
        title: taskName.trim(),
        projectName: p.name,
        client: p.clientName,
        assignedTo: taskAssignee,
        assignedToId: taskAssigneeId,
        priority: taskPriority,
        start: new Date().toLocaleDateString('en-GB'),
        dueDate: '',
        estimated: taskHours,
        logged: 0,
        status: 'Pending',
      });
      await addProjectActivity({
        projectId: String(p.id),
        title: `Task "${taskName.trim()}" assigned to ${taskAssignee}`,
        user: user?.name || 'User',
        timestamp: `${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
        type: 'task',
      });
      showToast(`Task "${taskName}" added to project!`, 'success');
      setTaskName('');
      setTaskAssignee('');
      setTaskAssigneeId(undefined);
      setShowTaskModal(false);
    } catch (err) {
      console.error(err);
      showToast('Failed to add task.', 'error');
    }
  };

  // Create Milestone handler
  const handleCreateMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mLabel.trim()) return;

    try {
      const pct = p.value > 0 ? Math.round((mAmount / p.value) * 100) : 0;
      await addProjectMilestone({
        projectId: p.id!,
        label: mLabel.trim(),
        amount: Number(mAmount) || 0,
        pct,
        status: mStatus,
        date: mDate,
      });
      showToast(`Milestone "${mLabel}" created!`, 'success');
      setMLabel('');
      setShowMilestoneModal(false);
    } catch (err) {
      console.error(err);
      showToast('Failed to create milestone.', 'error');
    }
  };

  // Add File handler
  const handleAddFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;

    try {
      await addProjectFile({
        projectId: p.id!,
        name: fileName.trim(),
        size: '2.4 MB',
        uploadedBy: 'Current User',
        date: new Date().toLocaleDateString('en-GB'),
        type: fileType,
      });
      showToast(`File "${fileName}" attached to project!`, 'success');
      setFileName('');
      setShowFileModal(false);
    } catch (err) {
      console.error(err);
      showToast('Failed to attach file.', 'error');
    }
  };

  // Quick edit project status/progress
  const handleSaveQuickEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProject(p.id!, {
        progress: editProgress,
        status: editStatus,
        ...(fin.expenseCount === 0 ? { expenses: editExpenses } : {}),
      });
      showToast('Project progress updated!', 'success');
      setShowEditModal(false);
    } catch (err) {
      console.error(err);
      showToast('Failed to update project.', 'error');
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Back button */}
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
        ← Back to Projects List
      </button>

      {/* Hero Header */}
      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 20, color: '#1A1F36', marginBottom: 4 }}>
              {p.name}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-purple">Client: {p.clientName}</span>
              <span className="badge badge-blue">Service: {p.serviceName}</span>
              <span className={`badge ${p.status === 'Completed' ? 'badge-green' : p.status === 'In Progress' ? 'badge-blue' : p.status === 'Maintenance' ? 'badge-teal' : 'badge-amber'}`}>
                {p.status}
              </span>
              {p.deadline && <span className="badge badge-green">Completed: {toDisplayDate(p.deadline)}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-secondary"
              style={{ fontSize: 13 }}
              onClick={() => {
                setEditProgress(p.progress);
                setEditStatus(p.status);
                setEditExpenses(expenses);
                setShowEditModal(true);
              }}
            >
              ✏ Edit Project
            </button>
            <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => setShowTaskModal(true)}>
              + Add Task
            </button>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, color: '#697586', fontWeight: 600 }}>Overall Project Completion</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#3B5BDB' }}>{p.progress}%</span>
          </div>
          <div style={{ background: '#E5E9F2', borderRadius: 99, height: 10 }}>
            <div
              style={{
                background: 'linear-gradient(90deg, #3B5BDB, #0EA5E9)',
                borderRadius: 99,
                height: 10,
                width: p.progress + '%',
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>

        {/* Key Financial KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 18 }}>
          {[
            { label: 'Project Value', value: '₹' + p.value.toLocaleString('en-IN'), color: '#1A1F36' },
            { label: 'Amount Received', value: '₹' + receivedAmount.toLocaleString('en-IN'), color: '#12B76A' },
            { label: 'Pending Amount', value: pendingAmount > 0 ? '₹' + pendingAmount.toLocaleString('en-IN') : '₹0', color: pendingAmount > 0 ? '#F59E0B' : '#697586' },
            { label: 'Project Expenses', value: '₹' + expenses.toLocaleString('en-IN'), color: '#EF4444' },
            { label: 'Est. Profit', value: '₹' + estimatedProfit.toLocaleString('en-IN'), color: '#12B76A' },
          ].map((s) => (
            <div key={s.label} style={{ background: '#F8F9FC', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11.5, color: '#697586', marginBottom: 4, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: s.color, fontFamily: 'Plus Jakarta Sans' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div style={{ padding: '0 12px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 4, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <button key={t} className={`tab-btn${activeTab === t ? ' active' : ''}`} style={{ padding: '10px 14px' }} onClick={() => setActiveTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ padding: 20 }}>
          {/* OVERVIEW TAB */}
          {activeTab === 'Overview' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div style={{ background: '#F8F9FC', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 10 }}>Project Overview</div>
                  {[
                    ['Client', p.clientName],
                    ['Service', p.serviceName],
                    ['Domain(s)', p.domain || '—'],
                    ['Project Manager', p.manager],
                    ['Start Date', toDisplayDate(p.startDate) || '—'],
                    ['End Date', toDisplayDate(p.deadline) || 'In progress'],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #E5E9F2', fontSize: 13 }}>
                      <span style={{ color: '#697586' }}>{l}</span>
                      <span style={{ fontWeight: 600, color: '#1A1F36' }}>{v}</span>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#F8F9FC', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 10 }}>Financial Summary</div>
                  {[
                    ['Total Project Value', `₹${p.value.toLocaleString('en-IN')}`],
                    ['Invoiced', `₹${fin.invoiced.toLocaleString('en-IN')} (${projectInvoices.length} invoice${projectInvoices.length === 1 ? '' : 's'})`],
                    ['Received Payment', `₹${receivedAmount.toLocaleString('en-IN')} (${fin.paymentCount} payment${fin.paymentCount === 1 ? '' : 's'})`],
                    ['Pending Payment', `₹${pendingAmount.toLocaleString('en-IN')}`],
                    ['Incurred Expenses', `₹${expenses.toLocaleString('en-IN')}${fin.expenseCount ? ` (${fin.expenseCount} record${fin.expenseCount === 1 ? '' : 's'})` : ' (estimate)'}`],
                    ['Estimated Profit', `₹${estimatedProfit.toLocaleString('en-IN')}`],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #E5E9F2', fontSize: 13 }}>
                      <span style={{ color: '#697586' }}>{l}</span>
                      <span style={{ fontWeight: 600, color: '#1A1F36' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {p.requirements && (
                <div style={{ background: '#F8F9FC', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 6 }}>Requirements & Scope</div>
                  <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{p.requirements}</div>
                </div>
              )}
            </div>
          )}

          {/* TASKS TAB */}
          {activeTab === 'Tasks' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>Tasks ({tasks.length})</div>
                <button className="btn-primary" style={{ fontSize: 12.5 }} onClick={() => setShowTaskModal(true)}>
                  + Add Task
                </button>
              </div>

              <table className="table-base">
                <thead>
                  <tr>
                    <th>TASK DESCRIPTION</th>
                    <th>ASSIGNED TO</th>
                    <th>PRIORITY</th>
                    <th>DEADLINE</th>
                    <th>HOURS</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length > 0 ? (
                    tasks.map((t) => (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600, maxWidth: 240 }}>{t.title || t.task}</td>
                        <td>{t.assignedTo || t.assignee || '—'}</td>
                        <td>
                          <span className={`badge ${priorityColors[t.priority || ''] || 'badge-gray'}`}>{t.priority}</span>
                        </td>
                        <td>{t.dueDate || t.deadline || '—'}</td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{t.logged || 0}</span>
                          <span style={{ color: '#697586' }}>/{t.estimated || 0}h</span>
                        </td>
                        <td>
                          <span className={`badge ${t.status === 'Done' || t.status === 'Completed' ? 'badge-green' : t.status === 'In Progress' ? 'badge-blue' : 'badge-amber'}`}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: '#697586', padding: '30px' }}>
                        No tasks added for this project yet. Click "+ Add Task" to create one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* MILESTONES TAB */}
          {activeTab === 'Milestones' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>Payment Milestones</div>
                <button className="btn-secondary" style={{ fontSize: 12.5 }} onClick={() => setShowMilestoneModal(true)}>
                  + Add Milestone
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {milestones.length > 0 ? (
                  milestones.map((m, i) => (
                    <div key={m.id || i} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '14px 16px', border: '1px solid #E5E9F2', borderRadius: 12 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: m.status === 'Received' ? '#DCFCE7' : '#F1F5F9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: 13,
                          color: m.status === 'Received' ? '#12B76A' : '#94A3B8',
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36' }}>{m.label} ({m.pct}%)</div>
                        <div style={{ fontSize: 12, color: '#697586' }}>Due: {m.date}</div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>₹{m.amount.toLocaleString('en-IN')}</div>
                      <span className={`badge ${m.status === 'Received' ? 'badge-green' : 'badge-amber'}`}>{m.status}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', color: '#697586', padding: '30px' }}>No milestones created yet.</div>
                )}
              </div>
            </div>
          )}

          {/* TEAM TAB */}
          {activeTab === 'Team' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#1A1F36' }}>Assigned Project Team</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[p.manager, ...teamMembers].filter(Boolean).map((member, i) => (
                  <div key={member} style={{ padding: 14, border: '1px solid #E5E9F2', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: '50%',
                        background: '#EEF2FF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#3B5BDB',
                      }}
                    >
                      {member.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1A1F36' }}>{member}</div>
                      <div style={{ fontSize: 11.5, color: '#697586' }}>{i === 0 ? 'Project Manager' : 'Team Member'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* REQUIREMENTS TAB */}
          {activeTab === 'Requirements' && (
            <div style={{ padding: 16, background: '#F8F9FC', borderRadius: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36', marginBottom: 8 }}>Project Requirements & Deliverable Specs</div>
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>{p.requirements || 'No specific requirements logged.'}</p>
            </div>
          )}

          {/* FILES TAB */}
          {activeTab === 'Files' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>Project Files</div>
                <button className="btn-secondary" style={{ fontSize: 12.5 }} onClick={() => setShowFileModal(true)}>
                  + Attach File
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {files.length > 0 ? (
                  files.map((f) => (
                    <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', border: '1px solid #E5E9F2', borderRadius: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 20 }}>📄</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#1A1F36' }}>{f.name}</div>
                          <div style={{ fontSize: 11.5, color: '#697586' }}>
                            {f.size} • Uploaded by {f.uploadedBy} on {f.date}
                          </div>
                        </div>
                      </div>
                      <button className="btn-secondary" style={{ fontSize: 11.5 }}>⬇ Download</button>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', color: '#697586', padding: '30px' }}>No files attached yet.</div>
                )}
              </div>
            </div>
          )}

          {/* PAYMENTS TAB */}
          {activeTab === 'Payments' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#1A1F36' }}>Invoices & Payments</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
                {[
                  { label: 'Project Value', value: fin.value, color: '#1A1F36' },
                  { label: 'Invoiced', value: fin.invoiced, color: '#3B5BDB' },
                  { label: 'Total Collected', value: receivedAmount, color: '#12B76A' },
                  { label: 'Pending Balance', value: pendingAmount, color: pendingAmount > 0 ? '#F59E0B' : '#697586' },
                ].map((s) => (
                  <div key={s.label} style={{ padding: 14, background: '#F8F9FC', borderRadius: 10 }}>
                    <div style={{ fontSize: 12, color: '#697586' }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>₹{s.value.toLocaleString('en-IN')}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1A1F36', marginBottom: 8 }}>Invoices ({projectInvoices.length})</div>
              <table className="table-base" style={{ marginBottom: 20 }}>
                <thead>
                  <tr>
                    <th>INVOICE #</th>
                    <th>DATE</th>
                    <th style={{ textAlign: 'right' }}>TOTAL</th>
                    <th style={{ textAlign: 'right' }}>PAID</th>
                    <th style={{ textAlign: 'right' }}>BALANCE</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {projectInvoices.length > 0 ? (
                    projectInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 700, color: '#3B5BDB' }}>{inv.invoiceNumber}</td>
                        <td style={{ color: '#697586' }}>{inv.date}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{(inv.totalAmount || 0).toLocaleString('en-IN')}</td>
                        <td style={{ textAlign: 'right', color: '#12B76A' }}>₹{(inv.paidAmount || 0).toLocaleString('en-IN')}</td>
                        <td style={{ textAlign: 'right', color: (inv.balance || 0) > 0 ? '#F59E0B' : '#697586' }}>₹{(inv.balance || 0).toLocaleString('en-IN')}</td>
                        <td>
                          <span className={`badge ${inv.status === 'Paid' ? 'badge-green' : inv.status === 'Partially Paid' ? 'badge-amber' : inv.status === 'Overdue' ? 'badge-red' : 'badge-blue'}`}>{inv.status}</span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: '#697586', padding: '20px' }}>
                        No invoices linked to this project. Choose this project when creating an invoice.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1A1F36' }}>Payments ({projectPayments.length})</div>
                <button className="btn-primary" style={{ fontSize: 12.5, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setPaymentModal({ open: true })}>
                  <Plus size={14} /> Record Payment
                </button>
              </div>
              <table className="table-base" style={{ marginBottom: 20 }}>
                <thead>
                  <tr>
                    <th>PAYMENT #</th>
                    <th>DATE</th>
                    <th>INVOICE</th>
                    <th>METHOD</th>
                    <th style={{ textAlign: 'right' }}>AMOUNT</th>
                    <th>STATUS</th>
                    <th style={{ textAlign: 'center' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {projectPayments.length > 0 ? (
                    projectPayments.map((pm) => (
                      <tr key={pm.id}>
                        <td style={{ fontWeight: 600 }}>{pm.paymentNumber}</td>
                        <td style={{ color: '#697586' }}>{pm.date}</td>
                        <td>{pm.invoiceNumber || '—'}</td>
                        <td>{pm.method}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A' }}>₹{(pm.amount || 0).toLocaleString('en-IN')}</td>
                        <td>
                          <span className={`badge ${pm.status === 'Confirmed' ? 'badge-green' : pm.status === 'Pending' ? 'badge-amber' : 'badge-red'}`}>{pm.status}</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                            <button
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}
                              title="Edit Payment"
                              onClick={() => setPaymentModal({ open: true, payment: pm })}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}
                              title="Delete Payment"
                              onClick={async () => {
                                if (!pm.id || !confirm(`Delete payment ${pm.paymentNumber || pm.id}?`)) return;
                                try {
                                  await deletePayment(pm.id);
                                  showToast('Payment deleted.', 'info');
                                } catch (err: any) {
                                  showToast(err?.message || 'Could not delete payment.', 'error');
                                }
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: '#697586', padding: '20px' }}>
                        No payments recorded for this project yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {projectExpenses.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1A1F36', marginBottom: 8 }}>Expenses ({projectExpenses.length})</div>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>EXPENSE</th>
                        <th>CATEGORY</th>
                        <th>DATE</th>
                        <th style={{ textAlign: 'right' }}>AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectExpenses.map((ex) => (
                        <tr key={ex.id}>
                          <td style={{ fontWeight: 600 }}>{ex.name}</td>
                          <td>{ex.category}</td>
                          <td style={{ color: '#697586' }}>{ex.date}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>₹{(ex.amount || 0).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* ACTIVITY TAB */}
          {activeTab === 'Access' && (
            <CredentialsPanel clientId={String(p.clientId)} projectId={String(p.id)} projectName={p.name} />
          )}

          {activeTab === 'Activity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activityLogs.length > 0 ? (
                activityLogs.map((act) => (
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
                <div style={{ textAlign: 'center', padding: '30px', color: '#697586' }}>No activity logged yet.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Task Modal */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal-box" style={{ width: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Add Task to Project</div>
            <form onSubmit={handleCreateTask}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Task Name *</label>
                  <input className="input-base" placeholder="e.g. Design homepage wireframes" value={taskName} onChange={(e) => setTaskName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Assignee *</label>
                  <EmployeeSelect
                    value={taskAssignee}
                    onChange={(name, emp) => {
                      setTaskAssignee(name);
                      setTaskAssigneeId(emp?.id);
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Priority</label>
                  <select className="select-base" style={{ width: '100%' }} value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as any)}>
                    <option value="Urgent">Urgent</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Estimated Hours</label>
                  <input className="input-base" type="number" value={taskHours} onChange={(e) => setTaskHours(Number(e.target.value))} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowTaskModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Task</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Milestone Modal */}
      {showMilestoneModal && (
        <div className="modal-overlay" onClick={() => setShowMilestoneModal(false)}>
          <div className="modal-box" style={{ width: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Create Payment Milestone</div>
            <form onSubmit={handleCreateMilestone}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Milestone Title *</label>
                  <input className="input-base" placeholder="e.g. Design Signoff (20%)" value={mLabel} onChange={(e) => setMLabel(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Amount (₹)</label>
                  <input className="input-base" type="number" value={mAmount} onChange={(e) => setMAmount(Number(e.target.value))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Due Date</label>
                  <input className="input-base" value={mDate} onChange={(e) => setMDate(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Status</label>
                  <select className="select-base" style={{ width: '100%' }} value={mStatus} onChange={(e) => setMStatus(e.target.value as any)}>
                    <option value="Pending">Pending</option>
                    <option value="Received">Received</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowMilestoneModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Milestone</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add File Modal */}
      {showFileModal && (
        <div className="modal-overlay" onClick={() => setShowFileModal(false)}>
          <div className="modal-box" style={{ width: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Attach File to Project</div>
            <form onSubmit={handleAddFile}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>File Name *</label>
                  <input className="input-base" placeholder="e.g. SRS_Requirement_Doc.pdf" value={fileName} onChange={(e) => setFileName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>File Type</label>
                  <select className="select-base" style={{ width: '100%' }} value={fileType} onChange={(e) => setFileType(e.target.value)}>
                    <option value="PDF">PDF Document</option>
                    <option value="DOCX">Word Document</option>
                    <option value="ZIP">ZIP Archive</option>
                    <option value="PNG">PNG Image</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowFileModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Attach File</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Edit Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-box" style={{ width: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Update Project Progress</div>
            <form onSubmit={handleSaveQuickEdit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Progress ({editProgress}%)</label>
                  <input type="range" min="0" max="100" style={{ width: '100%' }} value={editProgress} onChange={(e) => setEditProgress(Number(e.target.value))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Status</label>
                  <select className="select-base" style={{ width: '100%' }} value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                    <option value="Planning">Planning</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Waiting for Client">Waiting for Client</option>
                    <option value="Testing">Testing</option>
                    <option value="Revision">Revision</option>
                    <option value="Completed">Completed</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Cancelled">Cancelled</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Project Expenses (₹)</label>
                  <input
                    className="input-base"
                    type="number"
                    value={fin.expenseCount > 0 ? expenses : editExpenses}
                    disabled={fin.expenseCount > 0}
                    onChange={(e) => setEditExpenses(Number(e.target.value))}
                  />
                  {fin.expenseCount > 0 && (
                    <div style={{ fontSize: 11.5, color: '#697586', marginTop: 4 }}>Synced from {fin.expenseCount} expense record(s) in Expenses.</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {paymentModal.open && (
        <PaymentModal
          project={p}
          payment={paymentModal.payment}
          suggested={paymentModal.payment ? undefined : pendingAmount}
          onClose={() => setPaymentModal({ open: false })}
        />
      )}
    </div>
  );
}
