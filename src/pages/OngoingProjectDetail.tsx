import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronLeft,
  Pencil,
  Plus,
  Phone,
  Mail,
  Users,
  Wallet,
  ListChecks,
  CalendarClock,
  FileText,
  LayoutGrid,
  Trash2,
  ClipboardCheck,
  Clock,
} from 'lucide-react';
import { db, type Deliverable, type Payment, type ProjectTask } from '../db/database';
import { useToast } from '../context/ToastContext';
import { deletePayment } from '../services/paymentService';
import { deleteTask, updateTask } from '../services/taskService';
import { deleteDeliverable } from '../services/deliverableService';
import { syncOngoingProjectValue } from '../services/serviceCatalogService';
import { describeSchedule, time12 } from '../services/ongoingWorkService';
import { clientLabel, paymentsForProject } from '../utils/financials';
import { isTaskDone } from '../utils/attendanceTimes';
import { currentMonth, monthLabel, ongoingStatement, openingAmountFor, workFor } from '../utils/serviceCatalog';
import { AssignWorkModal, SchedulePanel } from '../components/OngoingAssign';
import { PaymentModal, LogDoneModal, EditWorkModal, EditOngoingProjectModal, billingLine, inr, prettyDate } from '../components/OngoingDialogs';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

type Tab = 'overview' | 'work' | 'posts' | 'payments' | 'statement';

const statusTone: Record<string, string> = {
  'In Progress': 'badge-blue',
  Completed: 'badge-green',
  'On Hold': 'badge-gray',
  'Waiting for Client': 'badge-amber',
  Cancelled: 'badge-red',
  Archived: 'badge-gray',
};

interface Props {
  projectId: string | number;
  onBack: () => void;
}

/** Full page for one ongoing project: billing, work & tasks, daily posts, payments and the monthly statement. */
export default function OngoingProjectDetail({ projectId, onBack }: Props) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [workFilter, setWorkFilter] = useState<'open' | 'done' | 'logged' | 'all'>('open');
  const [dialog, setDialog] = useState<
    | { kind: 'edit' }
    | { kind: 'assign' }
    | { kind: 'log' }
    | { kind: 'pay'; payment?: Payment }
    | { kind: 'work'; task?: ProjectTask; entry?: Deliverable }
    | null
  >(null);
  const [toDelete, setToDelete] = useState<{ kind: 'payment'; item: Payment } | { kind: 'task'; item: ProjectTask } | { kind: 'entry'; item: Deliverable } | null>(null);
  const [busy, setBusy] = useState(false);

  const project = useLiveQuery(() => db.projects.get(projectId as any), [projectId]);
  const client = useLiveQuery(async () => (project ? db.clients.get(project.clientId as any) : undefined), [project?.clientId]);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const deliverables = useLiveQuery(() => db.deliverables.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const invoices = useLiveQuery(() => db.invoices.toArray(), []) || [];

  const st = useMemo(() => (project ? ongoingStatement(project, deliverables, payments, invoices) : null), [project, deliverables, payments, invoices]);
  const projectTasks = useMemo(
    () =>
      tasks
        .filter((t) => project && String(t.projectId ?? '') === String(project.id))
        .sort((a, b) => `${b.dueDate || ''}${b.dueTime || ''}`.localeCompare(`${a.dueDate || ''}${a.dueTime || ''}`)),
    [tasks, project]
  );
  const entries = useMemo(() => (project ? workFor(project, deliverables) : []), [project, deliverables]);
  const loggedEntries = entries.filter((d) => !d.taskId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const entryById = useMemo(() => new Map(entries.map((d) => [String(d.id), d])), [entries]);
  const projectPayments = useMemo(
    () => (project ? paymentsForProject(project, payments, invoices).sort((a, b) => String(b.date).localeCompare(String(a.date))) : []),
    [project, payments, invoices]
  );

  // Keep the stored project value equal to what's been billed
  const syncedValRef = useRef<number | null>(null);
  useEffect(() => {
    if (!project || !st) return;
    const billed = Math.round(st.billed);
    if (billed === Math.round(Number(project.value) || 0)) return;
    if (syncedValRef.current === billed) return;
    syncedValRef.current = billed;
    syncOngoingProjectValue(project).catch(() => undefined);
  }, [project?.id, Math.round(st?.billed || 0)]);

  if (project === undefined) return <div style={{ padding: 40, textAlign: 'center', color: '#697586' }}>Loading…</div>;
  if (!project || !st) {
    return (
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 32, textAlign: 'center', color: '#697586' }}>
          This project no longer exists.
          <div style={{ marginTop: 12 }}>
            <button className="btn-secondary" onClick={onBack}>
              Back to Ongoing Works
            </button>
          </div>
        </div>
      </div>
    );
  }

  const thisMonth = st.months.find((m) => m.month === currentMonth());
  const openTasks = projectTasks.filter((t) => !isTaskDone(t));
  const doneTasks = projectTasks.filter(isTaskDone);
  const activeSchedules = (project.schedules || []).filter((s) => s.active);
  const opening = openingAmountFor(project);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      if (toDelete.kind === 'payment' && toDelete.item.id !== undefined) await deletePayment(toDelete.item.id);
      if (toDelete.kind === 'task' && toDelete.item.id !== undefined) await deleteTask(toDelete.item.id);
      if (toDelete.kind === 'entry' && toDelete.item.id !== undefined) await deleteDeliverable(toDelete.item.id);
      await syncOngoingProjectValue(project);
      showToast(toDelete.kind === 'payment' ? 'Payment deleted.' : 'Work item deleted.', 'info');
      setToDelete(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not delete.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setTaskStatus = async (t: ProjectTask, status: ProjectTask['status']) => {
    if (t.id === undefined) return;
    try {
      await updateTask(t.id, status === 'Completed' ? { status, progress: 100 } : { status });
      await syncOngoingProjectValue(project);
    } catch (err: any) {
      showToast(err?.message || 'Could not update the task.', 'error');
    }
  };

  const shownTasks = workFilter === 'open' ? openTasks : workFilter === 'done' ? doneTasks : workFilter === 'all' ? projectTasks : [];

  const tabs: { key: Tab; label: string; icon: typeof LayoutGrid; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutGrid },
    { key: 'work', label: 'Work & Tasks', icon: ListChecks, count: openTasks.length },
    { key: 'posts', label: 'Daily Posts', icon: CalendarClock, count: activeSchedules.length },
    { key: 'payments', label: 'Payments', icon: Wallet, count: projectPayments.length },
    { key: 'statement', label: 'Statement', icon: FileText },
  ];

  return (
    <div className="op-page" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <button className="op-back" onClick={onBack}>
        <ChevronLeft size={16} /> Ongoing Works
      </button>

      {/* Header */}
      <div className="op-head">
        <div style={{ minWidth: 0 }}>
          <div className="op-title">{project.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <span className={`badge ${statusTone[project.status] || 'badge-gray'}`}>{project.status}</span>
            <span className="badge badge-blue">{project.serviceName}</span>
            {(project.subServices || []).map((s) => (
              <span key={s} className="badge badge-gray">
                {s}
              </span>
            ))}
          </div>
          <div className="op-client">
            <strong>{client ? clientLabel(client) : project.clientName}</strong>
            {client?.phone && (
              <a href={`tel:${client.phone}`}>
                <Phone size={13} /> {client.phone}
              </a>
            )}
            {client?.email && (
              <a href={`mailto:${client.email}`}>
                <Mail size={13} /> {client.email}
              </a>
            )}
          </div>
        </div>
        <div className="op-head-actions">
          <button className="btn-secondary" onClick={() => setDialog({ kind: 'edit' })}>
            <Pencil size={14} /> Edit Project
          </button>
          <button className="btn-secondary" onClick={() => setDialog({ kind: 'pay' })}>
            <Wallet size={14} /> + Payment
          </button>
          <button className="btn-primary" onClick={() => setDialog({ kind: 'assign' })}>
            <Plus size={15} /> Assign Work
          </button>
        </div>
      </div>

      {/* Money */}
      <div className="op-kpis">
        <div className="op-kpi">
          <span>Billed</span>
          <strong>{inr(st.billed)}</strong>
          <em>This month {inr(thisMonth?.billed || 0)}</em>
        </div>
        <div className="op-kpi">
          <span>Received</span>
          <strong style={{ color: '#12B76A' }}>{inr(st.received)}</strong>
          <em>This month {inr(thisMonth?.received || 0)}</em>
        </div>
        <div className="op-kpi">
          <span>{st.advance ? 'Advance' : 'Outstanding'}</span>
          <strong style={{ color: st.advance ? '#12B76A' : st.outstanding ? '#F59E0B' : '#12B76A' }}>{inr(st.advance || st.outstanding)}</strong>
          <em>{st.advance ? 'Paid ahead of billing' : st.outstanding ? 'To collect' : 'All settled'}</em>
        </div>
        <div className="op-kpi">
          <span>In Progress</span>
          <strong style={{ color: '#475569' }}>{inr(st.inProgressValue)}</strong>
          <em>{openTasks.length} open task(s)</em>
        </div>
      </div>

      {/* Tabs */}
      <div className="op-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            <t.icon size={15} /> {t.label}
            {!!t.count && <span className="op-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="op-grid">
          <div className="card op-card">
            <div className="op-card-head">
              <span>Billing</span>
              <button className="ws-link" onClick={() => setDialog({ kind: 'edit' })}>
                Edit
              </button>
            </div>
            <div className="op-rows">
              <div>
                <span>Monthly retainer</span>
                <strong>{project.monthlyRetainer ? inr(project.monthlyRetainer) : '—'}</strong>
              </div>
              {Object.entries(project.itemRates || {}).map(([t, r]) => (
                <div key={t}>
                  <span>Price per {t}</span>
                  <strong>{r ? inr(r) : 'In retainer'}</strong>
                </div>
              ))}
              <div>
                <span>Opening amount</span>
                <strong>{opening ? inr(opening) : '—'}</strong>
              </div>
              <div>
                <span>Started</span>
                <strong>{prettyDate(project.startDate)}</strong>
              </div>
            </div>
          </div>

          <div className="card op-card">
            <div className="op-card-head">
              <span>Team & Work</span>
              <button className="ws-link" onClick={() => setTab('work')}>
                Open
              </button>
            </div>
            <div className="op-rows">
              <div>
                <span>Manager</span>
                <strong>{project.manager || '—'}</strong>
              </div>
              <div>
                <span>Team</span>
                <strong style={{ textAlign: 'right' }}>{(project.team || []).join(', ') || '—'}</strong>
              </div>
              <div>
                <span>Open tasks</span>
                <strong>{openTasks.length}</strong>
              </div>
              <div>
                <span>Completed tasks</span>
                <strong>{doneTasks.length}</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => setDialog({ kind: 'assign' })}>
                <Plus size={14} /> Assign Work
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setDialog({ kind: 'log' })}>
                <ClipboardCheck size={14} /> Log Done
              </button>
            </div>
          </div>

          <div className="card op-card">
            <div className="op-card-head">
              <span>Daily Posts</span>
              <button className="ws-link" onClick={() => setTab('posts')}>
                Manage
              </button>
            </div>
            {activeSchedules.length === 0 ? (
              <div style={{ fontSize: 13, color: '#697586' }}>No posting schedule. Set one to send morning & evening post tasks automatically.</div>
            ) : (
              activeSchedules.map((s) => (
                <div key={s.id} className="op-schedule">
                  <CalendarClock size={16} color="#3B5BDB" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                      {s.employeeName} · {s.workType}
                    </div>
                    <div style={{ fontSize: 12, color: '#697586' }}>
                      {describeSchedule(s)}
                      {s.channels.length ? ` · ${s.channels.join(', ')}` : ''}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="card op-card">
            <div className="op-card-head">
              <span>Latest payments</span>
              <button className="ws-link" onClick={() => setTab('payments')}>
                All
              </button>
            </div>
            {projectPayments.length === 0 ? (
              <div style={{ fontSize: 13, color: '#697586' }}>No payments yet.</div>
            ) : (
              <div className="op-rows">
                {projectPayments.slice(0, 4).map((pm) => (
                  <div key={pm.id}>
                    <span>
                      {prettyDate(pm.date)} · {pm.method}
                    </span>
                    <strong style={{ color: pm.status === 'Confirmed' ? '#12B76A' : '#F59E0B' }}>{inr(pm.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(project.requirements || project.notes || project.domain) && (
            <div className="card op-card" style={{ gridColumn: '1 / -1' }}>
              <div className="op-card-head">
                <span>Notes</span>
              </div>
              {project.domain && <div style={{ fontSize: 13, marginBottom: 6 }}>🌐 {project.domain}</div>}
              {project.requirements && <div style={{ fontSize: 13, color: '#475569', whiteSpace: 'pre-line', marginBottom: 6 }}>{project.requirements}</div>}
              {project.notes && <div style={{ fontSize: 13, color: '#697586', whiteSpace: 'pre-line' }}>{project.notes}</div>}
            </div>
          )}
        </div>
      )}

      {/* Work & tasks */}
      {tab === 'work' && (
        <div>
          <div className="op-toolbar">
            <div className="ws-chips" style={{ marginBottom: 0 }}>
              {(
                [
                  ['open', 'Open', openTasks.length],
                  ['done', 'Completed', doneTasks.length],
                  ['logged', 'Logged', loggedEntries.length],
                  ['all', 'All tasks', projectTasks.length],
                ] as const
              ).map(([k, label, n]) => (
                <button key={k} className={`ws-chip${workFilter === k ? ' active' : ''}`} onClick={() => setWorkFilter(k)}>
                  {label} <span className="ws-chip-count">{n}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => setDialog({ kind: 'log' })}>
                <ClipboardCheck size={14} /> Log Done
              </button>
              <button className="btn-primary" onClick={() => setDialog({ kind: 'assign' })}>
                <Plus size={14} /> Assign Work
              </button>
            </div>
          </div>

          {workFilter === 'logged' ? (
            loggedEntries.length === 0 ? (
              <div className="ws-empty">
                <ClipboardCheck size={28} color="#98A2B3" />
                <div>No logged work. Use Log Done to record work finished without a task.</div>
              </div>
            ) : (
              <div className="ws-list">
                {loggedEntries.map((d) => (
                  <div key={d.id} className="ws-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="ws-card-title">
                          {d.type} × {d.qty}
                        </div>
                        <div className="ws-card-meta">
                          {prettyDate(d.date)}
                          {d.employee ? ` · ${d.employee}` : ''}
                        </div>
                      </div>
                      <strong style={{ fontSize: 15 }}>{inr(Number(d.amount ?? d.qty * d.rate))}</strong>
                    </div>
                    {d.description && <div className="ws-card-desc">{d.description}</div>}
                    <div className="ws-card-actions">
                      <button className="btn-secondary" onClick={() => setDialog({ kind: 'work', entry: d })}>
                        <Pencil size={13} /> Edit
                      </button>
                      <button className="btn-secondary" style={{ color: '#EF4444', borderColor: '#FCA5A5' }} onClick={() => setToDelete({ kind: 'entry', item: d })}>
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : shownTasks.length === 0 ? (
            <div className="ws-empty">
              <ListChecks size={28} color="#98A2B3" />
              <div>{workFilter === 'open' ? 'No open tasks. Assign work to your team.' : 'Nothing here yet.'}</div>
            </div>
          ) : (
            <div className="ws-list">
              {shownTasks.map((t) => {
                const bill = t.deliverableId ? entryById.get(String(t.deliverableId)) : undefined;
                const done = isTaskDone(t);
                const normalized = t.status === 'Done' ? 'Completed' : t.status === 'To Do' || t.status === 'Review' ? 'In Progress' : t.status || 'Pending';
                return (
                  <div key={t.id} className={`ws-card${done ? ' done' : ''}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="ws-card-title">{t.title || t.task}</div>
                        <div className="ws-card-meta">
                          {t.assignedTo || 'Unassigned'} · {prettyDate(t.dueDate)}
                          {t.dueTime ? ` · ${time12(t.dueTime)}` : ''}
                        </div>
                      </div>
                      {bill && <strong style={{ fontSize: 14.5, whiteSpace: 'nowrap' }}>{inr(Number(bill.amount ?? bill.qty * bill.rate))}</strong>}
                    </div>
                    <div className="ws-work-chips">
                      {t.source === 'schedule' && (
                        <span className="ws-work-chip time">
                          <Clock size={12} /> Daily post
                        </span>
                      )}
                      {bill && <span className={`ws-work-chip ${bill.status === 'Approved' ? '' : 'channel'}`}>{bill.status === 'Approved' ? 'Billed' : 'Bills on completion'}</span>}
                      {!!t.progress && !done && <span className="ws-work-chip channel">{t.progress}% done</span>}
                    </div>
                    {t.delayReason && !done && <div className="ws-note warn">{t.delayReason}</div>}
                    <div className="ws-card-actions">
                      <select className="select-base" style={{ flex: 1, minWidth: 130 }} value={normalized} onChange={(e) => setTaskStatus(t, e.target.value as ProjectTask['status'])}>
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                      </select>
                      <button className="btn-secondary" style={{ flex: '0 0 auto' }} onClick={() => setDialog({ kind: 'work', task: t, entry: bill })}>
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        className="btn-secondary"
                        style={{ flex: '0 0 auto', color: '#EF4444', borderColor: '#FCA5A5' }}
                        onClick={() => setToDelete({ kind: 'task', item: t })}
                        aria-label="Delete task"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Daily posts */}
      {tab === 'posts' && (
        <div className="card op-card">
          <SchedulePanel key={String(project.id)} project={project} />
        </div>
      )}

      {/* Payments */}
      {tab === 'payments' && (
        <div>
          <div className="op-toolbar">
            <div style={{ fontSize: 13, color: '#475569' }}>
              Received <strong style={{ color: '#12B76A' }}>{inr(st.received)}</strong> of {inr(st.billed)} billed
            </div>
            <button className="btn-primary" onClick={() => setDialog({ kind: 'pay' })}>
              <Plus size={14} /> Record Payment
            </button>
          </div>
          {projectPayments.length === 0 ? (
            <div className="ws-empty">
              <Wallet size={28} color="#98A2B3" />
              <div>No payments yet.</div>
            </div>
          ) : (
            <div className="ws-list">
              {projectPayments.map((pm) => (
                <div key={pm.id} className="ws-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="ws-card-title">{prettyDate(pm.date)}</div>
                      <div className="ws-card-meta">
                        {pm.paymentNumber} · {pm.method}
                        {pm.referenceNumber ? ` · ${pm.referenceNumber}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 17, fontWeight: 800, color: pm.status === 'Confirmed' ? '#12B76A' : '#F59E0B', fontFamily: 'Plus Jakarta Sans' }}>{inr(pm.amount)}</div>
                      <span className={`badge ${pm.status === 'Confirmed' ? 'badge-green' : pm.status === 'Pending' ? 'badge-amber' : 'badge-red'}`}>{pm.status}</span>
                    </div>
                  </div>
                  {pm.notes && <div className="ws-card-desc">{pm.notes}</div>}
                  {pm.invoiceNumber && <div className="ws-note">Linked to invoice {pm.invoiceNumber}</div>}
                  <div className="ws-card-actions">
                    <button className="btn-secondary" onClick={() => setDialog({ kind: 'pay', payment: pm })}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button className="btn-secondary" style={{ color: '#EF4444', borderColor: '#FCA5A5' }} onClick={() => setToDelete({ kind: 'payment', item: pm })}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Statement */}
      {tab === 'statement' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #EEF0F5', fontSize: 13, color: '#475569' }}>
            {billingLine(project)}
            {opening ? ` · opening ${inr(opening)}` : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>MONTH</th>
                  <th style={{ textAlign: 'right' }}>RETAINER</th>
                  <th>WORK</th>
                  <th style={{ textAlign: 'right' }}>BILLED</th>
                  <th style={{ textAlign: 'right' }}>RECEIVED</th>
                  <th style={{ textAlign: 'right' }}>BALANCE</th>
                </tr>
              </thead>
              <tbody>
                {[...st.months].reverse().map((m) => (
                  <tr key={m.month}>
                    <td style={{ fontWeight: 600 }}>{monthLabel(m.month)}</td>
                    <td style={{ textAlign: 'right' }}>{m.retainer ? inr(m.retainer) : '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {[...(m.opening ? [`Opening (${inr(m.opening)})`] : []), ...m.items.map((i) => `${i.type} × ${i.qty} (${inr(i.amount)})`)].join(' · ') || '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(m.billed)}</td>
                    <td style={{ textAlign: 'right', color: '#12B76A', fontWeight: 600 }}>{m.received ? inr(m.received) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: m.balance > 0 ? '#F59E0B' : '#12B76A' }}>
                      {m.balance < 0 ? `${inr(-m.balance)} adv.` : inr(m.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {dialog?.kind === 'edit' && <EditOngoingProjectModal project={project} onClose={() => setDialog(null)} onRemoved={onBack} />}
      {dialog?.kind === 'assign' && <AssignWorkModal project={project} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'log' && <LogDoneModal project={project} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'pay' && <PaymentModal project={project} payment={dialog.payment} suggested={dialog.payment ? undefined : st.outstanding} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'work' && <EditWorkModal project={project} task={dialog.task} entry={dialog.entry} onClose={() => setDialog(null)} />}
      {toDelete && (
        <DeleteConfirmationModal
          isOpen
          title={toDelete.kind === 'payment' ? 'Delete Payment' : 'Delete Work Item'}
          description={
            toDelete.kind === 'payment' ? (
              <>
                Delete the <strong>{inr(toDelete.item.amount)}</strong> payment from {prettyDate(toDelete.item.date)}? The outstanding balance goes up by that amount.
              </>
            ) : toDelete.kind === 'task' ? (
              <>
                Delete <strong>{toDelete.item.title || toDelete.item.task}</strong>? It disappears from the employee's tasks
                {isTaskDone(toDelete.item) ? '; billed work stays on the statement.' : ' and its unbilled amount is removed.'}
              </>
            ) : (
              <>
                Delete <strong>
                  {toDelete.item.type} × {toDelete.item.qty}
                </strong>{' '}
                ({inr(Number(toDelete.item.amount ?? 0))})? The bill goes down by that amount.
              </>
            )
          }
          isDeleting={busy}
          onConfirm={confirmDelete}
          onClose={() => setToDelete(null)}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#98A2B3', marginTop: 20 }}>
        <Users size={13} /> Team members see only their tasks, never prices or payments.
      </div>
    </div>
  );
}
