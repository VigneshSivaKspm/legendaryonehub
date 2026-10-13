import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ListTodo,
  Edit2,
  Trash2,
  RotateCcw,
  Calendar,
  User,
  Folder,
  Package,
  Layers,
  Sparkles,
} from 'lucide-react';
import { db, type ProjectTask, type Project } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  addTask,
  updateTask,
  deleteTask,
  type TaskStatus,
  type TaskPriority,
} from '../services/taskService';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import EmployeeSelect from '../components/EmployeeSelect';
import { useAuth } from '../context/AuthContext';
import {
  itemTypesFor,
  getOngoingCategoryName,
  getOngoingCategoryBadge,
  ONGOING_SERVICES,
} from '../utils/serviceCatalog';
import { addDeliverable, updateDeliverable } from '../services/deliverableService';

export default function Tasks() {
  // Employees only see and update their own tasks; creating, editing and deleting is for managers
  const { isSelfService, myEmployee } = useAuth();
  const canManage = !isSelfService;

  // Live queries for real-time Dexie data
  const allTasks = useLiveQuery(async () => newestFirst(await db.tasks.toArray(), (t) => t.start || t.dueDate || t.deadline), []);
  const rawTasks = useMemo(() => {
    const list = allTasks || [];
    if (canManage) return list;
    const myId = myEmployee?.id !== undefined ? String(myEmployee.id) : '';
    const myName = myEmployee?.name || '';
    return list.filter(
      (t) =>
        (!!myId && t.assignedToId !== undefined && String(t.assignedToId) === myId) ||
        (!!myName && (t.assignedTo === myName || t.assignee === myName))
    );
  }, [allTasks, canManage, myEmployee]);
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];

  // Filter & Search states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<ProjectTask | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formProjectId, setFormProjectId] = useState<string>('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToId, setFormAssignedToId] = useState<string | number | undefined>(undefined);
  const [formDueDate, setFormDueDate] = useState('');
  const [formPriority, setFormPriority] = useState<TaskPriority>('Medium');
  const [formStatus, setFormStatus] = useState<TaskStatus>('Pending');
  const [errors, setErrors] = useState<{ title?: string; dueDate?: string }>({});

  // Matching fields for ongoing / deliverable work
  const [includeDeliverable, setIncludeDeliverable] = useState(false);
  const [formWorkType, setFormWorkType] = useState<string>('');
  const [customWorkType, setCustomWorkType] = useState<string>('');
  const [formQuantity, setFormQuantity] = useState<number>(1);
  const [formRate, setFormRate] = useState<string>('');
  const [formChannels, setFormChannels] = useState<string[]>([]);
  const [formDetails, setFormDetails] = useState<string>('');

  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to normalize task object fields
  const normalizedTasks = useMemo(() => {
    return rawTasks.map((t) => {
      const title = t.title || t.task || 'Untitled Task';
      const dueDate = t.dueDate || t.deadline || '';
      const assignedTo = t.assignedTo || t.assignee || 'Unassigned';
      const projectName = t.projectName || t.project || 'General';
      const workType = t.workType || '';
      const quantity = t.quantity || (t.workType ? 1 : undefined);
      const channels = t.channels || [];

      let status: TaskStatus = 'Pending';
      if (t.status === 'Completed' || t.status === 'Done') {
        status = 'Completed';
      } else if (t.status === 'In Progress' || t.status === 'Review') {
        status = 'In Progress';
      } else {
        status = 'Pending';
      }

      const isOverdue = Boolean(dueDate && dueDate < todayStr && status !== 'Completed');

      return {
        ...t,
        title,
        dueDate,
        assignedTo,
        projectName,
        workType,
        quantity,
        channels,
        status,
        isOverdue,
      };
    });
  }, [rawTasks, todayStr]);

  // Project categorization
  const ongoingProjects = useMemo(() => {
    return projects.filter((p) => p.ongoing || ONGOING_SERVICES.has(p.serviceName));
  }, [projects]);

  const regularProjects = useMemo(() => {
    return projects.filter((p) => !p.ongoing && !ONGOING_SERVICES.has(p.serviceName));
  }, [projects]);

  const selectedProject = useMemo(() => {
    return projects.find((p) => String(p.id) === String(formProjectId));
  }, [projects, formProjectId]);

  const deliverableTypes = useMemo(() => {
    if (!selectedProject) return ['Posters', 'Video', 'Reel', 'Post', 'Story', 'Carousel', 'PDF', 'Audio', 'Campaign', 'Task'];
    return itemTypesFor(selectedProject);
  }, [selectedProject]);

  const isMarketingOrMedia = useMemo(() => {
    if (!selectedProject) return true;
    return (
      selectedProject.serviceName === 'Organic Marketing' ||
      selectedProject.serviceName === 'Digital Marketing' ||
      selectedProject.serviceName === 'Media Works' ||
      (selectedProject.subServices || []).length > 0
    );
  }, [selectedProject]);

  const handleProjectChange = (newProjId: string) => {
    setFormProjectId(newProjId);
    const proj = projects.find((p) => String(p.id) === String(newProjId));
    if (proj) {
      const types = itemTypesFor(proj);
      if (types.length > 0 && !formWorkType) {
        setFormWorkType(types[0]);
        if (proj.itemRates?.[types[0]]) {
          setFormRate(String(proj.itemRates[types[0]]));
        }
      }
      if (formChannels.length === 0 && proj.subServices && proj.subServices.length > 0) {
        const potentialChannels = ['Facebook', 'Instagram', 'WhatsApp', 'Google Business Profile'];
        const matched = proj.subServices.filter((s) => potentialChannels.includes(s));
        if (matched.length > 0) setFormChannels(matched);
      }
    }
  };

  const handleAutoFillTitle = () => {
    const effectiveType = formWorkType === '__custom' ? customWorkType.trim() : formWorkType.trim();
    const qty = Number(formQuantity) || 1;
    const parts: string[] = [];
    if (effectiveType) {
      parts.push(`${qty > 1 ? `${qty} × ` : ''}${effectiveType}`);
    }
    if (formDetails.trim()) {
      parts.push(formDetails.trim());
    } else if (selectedProject) {
      parts.push(selectedProject.name);
    }
    const generated = parts.join(' · ');
    if (generated) {
      setFormTitle(generated);
      if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
    }
  };

  // Overall Statistics
  const stats = useMemo(() => {
    const total = normalizedTasks.length;
    const pending = normalizedTasks.filter((t) => t.status === 'Pending').length;
    const inProgress = normalizedTasks.filter((t) => t.status === 'In Progress').length;
    const completed = normalizedTasks.filter((t) => t.status === 'Completed').length;
    const overdue = normalizedTasks.filter((t) => t.isOverdue).length;

    return { total, pending, inProgress, completed, overdue };
  }, [normalizedTasks]);

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return normalizedTasks.filter((t) => {
      // Search term filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(query);
        const matchesDesc = (t.description || '').toLowerCase().includes(query);
        const matchesAssignee = (t.assignedTo || '').toLowerCase().includes(query);
        const matchesProject = (t.projectName || '').toLowerCase().includes(query);
        const matchesWorkType = (t.workType || '').toLowerCase().includes(query);
        const matchesChannels = (t.channels || []).join(' ').toLowerCase().includes(query);
        if (!matchesTitle && !matchesDesc && !matchesAssignee && !matchesProject && !matchesWorkType && !matchesChannels) {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'Overdue') {
          if (!t.isOverdue) return false;
        } else if (t.status !== statusFilter) {
          return false;
        }
      }

      // Priority filter
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) {
        return false;
      }

      return true;
    });
  }, [normalizedTasks, searchTerm, statusFilter, priorityFilter]);

  // Open modal for Add
  const handleOpenAdd = () => {
    setEditingTask(null);
    setFormTitle('');
    setFormDescription('');
    setFormProjectId('');
    setFormAssignedTo('');
    setFormAssignedToId(undefined);
    setFormDueDate(todayStr);
    setFormPriority('Medium');
    setFormStatus('Pending');
    setIncludeDeliverable(false);
    setFormWorkType('');
    setCustomWorkType('');
    setFormQuantity(1);
    setFormRate('');
    setFormChannels([]);
    setFormDetails('');
    setErrors({});
    setIsModalOpen(true);
  };

  // Open modal for Edit
  const handleOpenEdit = (task: ProjectTask) => {
    setEditingTask(task);
    setFormTitle(task.title || task.task || '');
    setFormDescription(task.description || '');
    setFormProjectId(task.projectId ? String(task.projectId) : '');
    setFormAssignedTo(task.assignedTo || task.assignee || '');
    setFormAssignedToId(task.assignedToId);
    setFormDueDate(task.dueDate || task.deadline || todayStr);
    setFormPriority((task.priority as TaskPriority) || 'Medium');

    let normStatus: TaskStatus = 'Pending';
    if (task.status === 'Completed' || task.status === 'Done') normStatus = 'Completed';
    else if (task.status === 'In Progress' || task.status === 'Review') normStatus = 'In Progress';
    setFormStatus(normStatus);

    const hasDeliverable = Boolean(task.workType || (task.quantity && task.quantity > 1) || task.deliverableId);
    setIncludeDeliverable(hasDeliverable);
    setFormWorkType(task.workType || '');
    setCustomWorkType('');
    setFormQuantity(task.quantity || 1);
    setFormChannels(task.channels || []);
    setFormDetails(task.description || '');

    const proj = projects.find((p) => String(p.id) === String(task.projectId));
    if (proj && task.workType && proj.itemRates?.[task.workType]) {
      setFormRate(String(proj.itemRates[task.workType]));
    } else {
      setFormRate('');
    }

    setErrors({});
    setIsModalOpen(true);
  };

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: { title?: string; dueDate?: string } = {};
    if (!formTitle.trim()) {
      newErrors.title = 'Task title is required';
    }
    if (!formDueDate) {
      newErrors.dueDate = 'Due date is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedProj = projects.find((p) => String(p.id) === String(formProjectId));
      const workTypeVal = includeDeliverable
        ? (formWorkType === '__custom' ? customWorkType.trim() : formWorkType.trim())
        : '';
      const qtyVal = includeDeliverable ? Math.max(1, Number(formQuantity) || 1) : 1;
      const rateVal = includeDeliverable ? Number(formRate) || 0 : 0;

      // Ongoing work billing sync (only if user checked includeDeliverable)
      let deliverableId = editingTask?.deliverableId;
      if (includeDeliverable && selectedProj && (selectedProj.ongoing || ONGOING_SERVICES.has(selectedProj.serviceName)) && workTypeVal) {
        if (!deliverableId) {
          deliverableId = await addDeliverable({
            client: selectedProj.clientName,
            clientId: selectedProj.clientId,
            type: workTypeVal,
            description: formDetails.trim() || formTitle.trim(),
            qty: qtyVal,
            rate: rateVal,
            amount: qtyVal * rateVal,
            date: formDueDate,
            employee: formAssignedTo.trim(),
            period: formDueDate.slice(0, 7),
            status: formStatus === 'Completed' ? 'Approved' : 'Pending',
            projectId: selectedProj.id,
            projectName: selectedProj.name,
          });
        } else {
          await updateDeliverable(deliverableId, {
            type: workTypeVal,
            description: formDetails.trim() || formTitle.trim(),
            qty: qtyVal,
            rate: rateVal,
            amount: qtyVal * rateVal,
            date: formDueDate,
            employee: formAssignedTo.trim(),
            status: formStatus === 'Completed' ? 'Approved' : 'Pending',
          });
        }
      }

      const combinedDescription = includeDeliverable && formDetails.trim()
        ? [formDetails.trim(), formDescription.trim()].filter(Boolean).join('\n')
        : formDescription.trim();

      const payload = {
        title: formTitle.trim(),
        task: formTitle.trim(),
        description: combinedDescription,
        projectId: formProjectId ? (isNaN(Number(formProjectId)) ? formProjectId : Number(formProjectId)) : '',
        projectName: selectedProj ? selectedProj.name : '',
        project: selectedProj ? selectedProj.name : '',
        client: selectedProj ? selectedProj.clientName : '',
        assignedTo: formAssignedTo.trim(),
        assignee: formAssignedTo.trim(),
        ...(formAssignedToId !== undefined ? { assignedToId: formAssignedToId } : {}),
        dueDate: formDueDate,
        deadline: formDueDate,
        priority: formPriority,
        status: formStatus,
        ...(includeDeliverable && workTypeVal ? { workType: workTypeVal } : {}),
        ...(includeDeliverable ? { quantity: qtyVal } : {}),
        ...(includeDeliverable && formChannels.length > 0 ? { channels: formChannels } : {}),
        ...(selectedProj?.ongoing ? { source: 'ongoing' as const } : {}),
        ...(includeDeliverable && deliverableId ? { deliverableId } : {}),
      };

      if (editingTask && editingTask.id) {
        await updateTask(editingTask.id, payload);
      } else {
        const newTaskId = await addTask(payload);
        if (includeDeliverable && deliverableId) {
          await updateDeliverable(deliverableId, { taskId: newTaskId });
        }
      }

      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to save task:', err);
      alert('Failed to save task. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status Change directly from list
  const handleQuickStatusChange = async (task: ProjectTask, newStatus: TaskStatus) => {
    if (!task.id) return;
    try {
      await updateTask(task.id, newStatus === 'Completed' ? { status: newStatus, progress: 100 } : { status: newStatus });
    } catch (err) {
      console.error('Failed to update task status:', err);
      alert('Failed to update status.');
    }
  };

  // Delete Task
  const handleDeleteConfirm = async () => {
    if (!deletingTask || !deletingTask.id) return;
    setIsDeleting(true);
    try {
      await deleteTask(deletingTask.id);
      setDeletingTask(null);
    } catch (err) {
      console.error('Failed to delete task:', err);
      alert('Failed to delete task. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setPriorityFilter('all');
  };

  const hasActiveFilters = searchTerm !== '' || statusFilter !== 'all' || priorityFilter !== 'all';

  return (
    <div style={{ padding: '24px 24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header Bar */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 24, fontWeight: 800, color: '#1A1F36', margin: 0 }}>
            Task Management
          </h1>
          <p style={{ fontSize: 13.5, color: '#697586', margin: '4px 0 0 0' }}>
            {canManage ? 'Track, assign, and manage team deliverables across projects' : 'Tasks assigned to you. Update the status as you work.'}
          </p>
        </div>

        {canManage && (
        <button
          onClick={handleOpenAdd}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: '#3B5BDB',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 8,
            padding: '10px 18px',
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(59, 91, 219, 0.2)',
            transition: 'all 0.2s ease',
          }}
        >
          <Plus size={18} />
          Add Task
        </button>
        )}
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 20, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Tasks
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#EEF2FF', color: '#3B5BDB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ListTodo size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#1A1F36' }}>{stats.total}</div>
        </div>

        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 20, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Pending
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#FEF3C7', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#D97706' }}>{stats.pending}</div>
        </div>

        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 20, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              In Progress
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#E0F2FE', color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0284C7' }}>{stats.inProgress}</div>
        </div>

        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 20, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Completed
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#DCFCE7', color: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#16A34A' }}>{stats.completed}</div>
        </div>

        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 20, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Overdue
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#FEE2E2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#DC2626' }}>{stats.overdue}</div>
        </div>
      </div>

      {/* Filters & Controls Bar */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          border: '1px solid #E2E8F0',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', flex: 1, minWidth: 300 }}>
          {/* Search Input */}
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}
            />
            <input
              type="text"
              placeholder="Search tasks, assignees, projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: 36,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                fontSize: 13.5,
                outline: 'none',
                backgroundColor: '#F8FAFC',
              }}
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #CBD5E1',
              fontSize: 13.5,
              outline: 'none',
              backgroundColor: '#FFFFFF',
              color: '#334155',
            }}
          >
            <option value="all">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="Overdue">Overdue Only</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #CBD5E1',
              fontSize: 13.5,
              outline: 'none',
              backgroundColor: '#FFFFFF',
              color: '#334155',
            }}
          >
            <option value="all">All Priorities</option>
            <option value="High">High Priority</option>
            <option value="Medium">Medium Priority</option>
            <option value="Low">Low Priority</option>
          </select>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #E2E8F0',
                background: '#F1F5F9',
                color: '#475569',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={14} />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Task Table / List */}
      <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {filteredTasks.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  <th style={{ padding: '14px 16px' }}>Task Title & Brief</th>
                  <th style={{ padding: '14px 16px' }}>Deliverable & Count</th>
                  <th style={{ padding: '14px 16px' }}>Project & Category</th>
                  <th style={{ padding: '14px 16px' }}>Assigned To</th>
                  <th style={{ padding: '14px 16px' }}>Due Date</th>
                  <th style={{ padding: '14px 16px' }}>Priority</th>
                  <th style={{ padding: '14px 16px' }}>Status</th>
                  {canManage && <th style={{ padding: '14px 16px', textAlign: 'center' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((t) => {
                  return (
                    <tr
                      key={t.id}
                      style={{
                        borderBottom: '1px solid #F1F5F9',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      {/* Title & Description */}
                      <td style={{ padding: '14px 16px', maxWidth: 280 }}>
                        <div style={{ fontWeight: 600, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{t.title}</span>
                          {t.isOverdue && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                background: '#FEE2E2',
                                color: '#DC2626',
                                padding: '2px 6px',
                                borderRadius: 4,
                                textTransform: 'uppercase',
                              }}
                            >
                              Overdue
                            </span>
                          )}
                        </div>
                        {t.description && (
                          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.description}
                          </div>
                        )}
                        {t.channels && t.channels.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {t.channels.map((ch) => (
                              <span key={ch} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0' }}>
                                {ch}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Deliverable & Count */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        {t.workType || (t.quantity && t.quantity > 1) ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#3730A3',
                                background: '#EEF2FF',
                                border: '1px solid #C7D2FE',
                                borderRadius: 6,
                                padding: '2px 8px',
                              }}
                            >
                              📦 {t.quantity && t.quantity > 1 ? `${t.quantity} × ` : '1 × '}
                              {t.workType || 'Item'}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: '#94A3B8', fontSize: 12 }}>—</span>
                        )}
                      </td>

                      {/* Project & Category */}
                      <td style={{ padding: '14px 16px', color: '#475569' }}>
                        {(() => {
                          const proj = projects.find(
                            (p) => String(p.id) === String(t.projectId) || p.name === t.projectName
                          );
                          const isOngoing = proj?.ongoing || (proj && ONGOING_SERVICES.has(proj.serviceName));
                          const badge = proj ? getOngoingCategoryBadge(proj.serviceName) : null;
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Folder size={14} style={{ color: isOngoing ? '#7C3AED' : '#94A3B8', flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, color: '#1E293B' }}>{t.projectName || 'General'}</span>
                              </div>
                              {proj && (
                                <div>
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 600,
                                      color: badge?.color || '#64748B',
                                      background: badge?.bg || '#F8FAFC',
                                      border: `1px solid ${badge?.border || '#E2E8F0'}`,
                                      borderRadius: 4,
                                      padding: '1px 6px',
                                      display: 'inline-block',
                                    }}
                                  >
                                    {isOngoing ? getOngoingCategoryName(proj.serviceName) : proj.serviceName || 'General Project'}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Assigned To */}
                      <td style={{ padding: '14px 16px', color: '#475569' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <User size={14} style={{ color: '#94A3B8' }} />
                          <span>{t.assignedTo || 'Unassigned'}</span>
                        </div>
                      </td>

                      {/* Due Date */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: t.isOverdue ? '#DC2626' : '#475569', fontWeight: t.isOverdue ? 600 : 400 }}>
                          <Calendar size={14} style={{ color: t.isOverdue ? '#DC2626' : '#94A3B8' }} />
                          <span>{t.dueDate || 'No Date'}</span>
                        </div>
                      </td>

                      {/* Priority */}
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 600,
                            backgroundColor:
                              t.priority === 'High' || t.priority === 'Urgent'
                                ? '#FEF2F2'
                                : t.priority === 'Medium'
                                ? '#EFF6FF'
                                : '#F8FAFC',
                            color:
                              t.priority === 'High' || t.priority === 'Urgent'
                                ? '#DC2626'
                                : t.priority === 'Medium'
                                ? '#2563EB'
                                : '#64748B',
                            border: `1px solid ${
                              t.priority === 'High' || t.priority === 'Urgent'
                                ? '#FCA5A5'
                                : t.priority === 'Medium'
                                ? '#BFDBFE'
                                : '#E2E8F0'
                            }`,
                          }}
                        >
                          {t.priority || 'Medium'}
                        </span>
                      </td>

                      {/* Quick Status Dropdown */}
                      <td style={{ padding: '14px 16px' }}>
                        <select
                          value={t.status}
                          onChange={(e) => handleQuickStatusChange(t, e.target.value as TaskStatus)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            border: '1px solid #CBD5E1',
                            outline: 'none',
                            cursor: 'pointer',
                            backgroundColor:
                              t.status === 'Completed'
                                ? '#F0FDF4'
                                : t.status === 'In Progress'
                                ? '#F0F9FF'
                                : '#FEFCE8',
                            color:
                              t.status === 'Completed'
                                ? '#166534'
                                : t.status === 'In Progress'
                                ? '#075985'
                                : '#854D0E',
                          }}
                        >
                          <option value="Pending">Pending</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                        </select>
                        {/* Assignee's progress report for unfinished work */}
                        {t.status !== 'Completed' && (t.progress !== undefined || t.delayReason) && (
                          <div style={{ marginTop: 6, maxWidth: 220 }} title={t.delayReason ? `Reason: ${t.delayReason}` : undefined}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ flex: 1, height: 5, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${Number(t.progress) || 0}%`, height: '100%', background: '#3B5BDB' }} />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>{Number(t.progress) || 0}%</span>
                            </div>
                            {t.delayReason && (
                              <div style={{ fontSize: 11, color: '#B45309', marginTop: 3, lineHeight: 1.35 }}>
                                {t.delayReason}
                                {t.progressUpdatedOn && <span style={{ color: '#94A3B8' }}> · {t.progressUpdatedOn}</span>}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      {canManage && (
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                          <button
                            onClick={() => handleOpenEdit(t)}
                            title="Edit Task"
                            style={{
                              padding: '6px 10px',
                              borderRadius: 6,
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#3B5BDB',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Edit2 size={14} />
                          </button>

                          <button
                            onClick={() => setDeletingTask(t)}
                            title="Delete Task"
                            style={{
                              padding: '6px 10px',
                              borderRadius: 6,
                              border: '1px solid #FECACA',
                              background: '#FEF2F2',
                              color: '#EF4444',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#F1F5F9',
                color: '#94A3B8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
              }}
            >
              <ListTodo size={28} />
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E293B', margin: '0 0 6px 0' }}>
              {hasActiveFilters ? 'No matching tasks found' : 'No tasks recorded yet'}
            </h3>
            <p style={{ fontSize: 13.5, color: '#64748B', maxWidth: 400, margin: '0 auto 20px auto' }}>
              {hasActiveFilters
                ? 'Try adjusting your search query or clear the active filters to see tasks.'
                : 'Get started by creating your first task to track work items across your projects.'}
            </p>

            {hasActiveFilters ? (
              <button
                onClick={handleResetFilters}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reset Filters
              </button>
            ) : canManage && (
              <button
                onClick={handleOpenAdd}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: '#3B5BDB',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Plus size={16} />
                Create First Task
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Task Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div
            className="modal-box"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 600,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #E2E8F0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
                background: '#FFFFFF',
              }}
            >
              <div>
                <h2 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 17, fontWeight: 700, color: '#1E293B', margin: 0 }}>
                  {editingTask ? 'Edit Task' : 'Add New Task'}
                </h2>
                <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748B' }}>
                  {selectedProject ? `${selectedProject.name} · ${getOngoingCategoryName(selectedProject.serviceName)}` : 'Create and assign a task to team members'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{
                  background: '#F1F5F9',
                  border: 'none',
                  borderRadius: 8,
                  color: '#64748B',
                  cursor: 'pointer',
                  padding: '6px 10px',
                  fontSize: 14,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <form
              onSubmit={handleSubmit}
              style={{
                padding: '18px 20px',
                overflowY: 'auto',
                flex: 1,
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {/* Task Title */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 5 }}>
                  Task Title <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Design Landing Page Wireframes"
                  value={formTitle}
                  onChange={(e) => {
                    setFormTitle(e.target.value);
                    if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: errors.title ? '1px solid #EF4444' : '1px solid #CBD5E1',
                    fontSize: 14,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                {errors.title && <span style={{ color: '#EF4444', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.title}</span>}
              </div>

              {/* Description */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 5 }}>
                  Description <span style={{ color: '#94A3B8', fontWeight: 400 }}>(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Add details or context for this task..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13.5,
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Linked Project & Assigned To (Stacked on mobile, side-by-side on tablet/desktop) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-4">
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 5 }}>
                    Linked Project
                  </label>
                  <select
                    value={formProjectId}
                    onChange={(e) => handleProjectChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid #CBD5E1',
                      fontSize: 13.5,
                      outline: 'none',
                      backgroundColor: '#FFFFFF',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">No Project (General)</option>
                    {ongoingProjects.length > 0 && (
                      <optgroup label="🔁 Retainers & Recurring Services (Marketing, Media, SEO)">
                        {ongoingProjects.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name} [{getOngoingCategoryName(p.serviceName)}]
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {regularProjects.length > 0 && (
                      <optgroup label="📋 Fixed-Scope Projects (Websites, Apps, Works)">
                        {regularProjects.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name} [{p.serviceName || 'Project'}]
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 5 }}>
                    Assigned To
                  </label>
                  <EmployeeSelect
                    value={formAssignedTo}
                    placeholder="Unassigned"
                    className=""
                    onChange={(name, emp) => {
                      setFormAssignedTo(name);
                      setFormAssignedToId(emp?.id);
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid #CBD5E1',
                      fontSize: 13.5,
                      outline: 'none',
                      backgroundColor: '#FFFFFF',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* ── Optional Deliverable & Counts Checkbox ── */}
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color: includeDeliverable ? '#3730A3' : '#334155',
                    userSelect: 'none',
                    background: includeDeliverable ? '#EEF2FF' : '#F8FAFC',
                    border: includeDeliverable ? '1px solid #C7D2FE' : '1px solid #E2E8F0',
                    borderRadius: 10,
                    padding: '10px 14px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeDeliverable}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIncludeDeliverable(checked);
                      if (checked && !formWorkType && deliverableTypes.length > 0) {
                        setFormWorkType(deliverableTypes[0]);
                        if (selectedProject?.itemRates?.[deliverableTypes[0]]) {
                          setFormRate(String(selectedProject.itemRates[deliverableTypes[0]]));
                        }
                      }
                    }}
                    style={{
                      accentColor: '#4F46E5',
                      width: 17,
                      height: 17,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span>Add Deliverable Details & Counts</span>
                      {selectedProject && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: '#4338CA',
                            background: '#E0E7FF',
                            borderRadius: 4,
                            padding: '1px 6px',
                          }}
                        >
                          {getOngoingCategoryName(selectedProject.serviceName)}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 400, marginTop: 2 }}>
                      Enable to specify what to make (posters, video, reels), counts, and track billing
                    </div>
                  </div>
                </label>
              </div>

              {/* ── Deliverable Details, Counts & Instructions (Shown only when checkbox is checked) ── */}
              {includeDeliverable && (
                <div
                  style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '14px 16px',
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Package size={15} style={{ color: '#4F46E5' }} />
                        <span>Deliverable Details & Counts</span>
                      </div>
                      {selectedProject && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: '#4338CA',
                            background: '#EEF2FF',
                            border: '1px solid #C7D2FE',
                            borderRadius: 6,
                            padding: '2px 8px',
                          }}
                        >
                          {getOngoingCategoryName(selectedProject.serviceName)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleAutoFillTitle}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: '#4338CA',
                        background: '#EEF2FF',
                        border: '1px solid #C7D2FE',
                        borderRadius: 6,
                        padding: '5px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      <Sparkles size={12} /> Auto-fill Title
                    </button>
                  </div>

                  {/* Mobile: Type full-width, Count & Rate side-by-side. Desktop: 3 columns */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                    {/* What to make / Deliverable Type */}
                    <div className="col-span-2 sm:col-span-1">
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                        What to make / Deliverable *
                      </label>
                      <select
                        value={formWorkType}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormWorkType(val);
                          if (selectedProject?.itemRates?.[val]) {
                            setFormRate(String(selectedProject.itemRates[val]));
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '9px 10px',
                          borderRadius: 8,
                          border: '1px solid #CBD5E1',
                          fontSize: 13.5,
                          outline: 'none',
                          backgroundColor: '#FFFFFF',
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="">Select deliverable...</option>
                        {deliverableTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        <option value="__custom">Other (Custom)...</option>
                      </select>
                      {formWorkType === '__custom' && (
                        <input
                          placeholder="e.g. Brochure, Banner, Logo"
                          value={customWorkType}
                          onChange={(e) => setCustomWorkType(e.target.value)}
                          style={{
                            width: '100%',
                            marginTop: 6,
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid #CBD5E1',
                            fontSize: 13,
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      )}
                    </div>

                    {/* Quantity / Count */}
                    <div className="col-span-1">
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                        Count / Quantity *
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formQuantity}
                        onChange={(e) => setFormQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                        style={{
                          width: '100%',
                          padding: '9px 10px',
                          borderRadius: 8,
                          border: '1px solid #CBD5E1',
                          fontSize: 13.5,
                          outline: 'none',
                          boxSizing: 'border-box',
                          backgroundColor: '#FFFFFF',
                        }}
                      />
                    </div>

                    {/* Price each (₹) */}
                    <div className="col-span-1">
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                        Price each (₹) <span style={{ color: '#94A3B8', fontWeight: 400 }}>(0 = retainer)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formRate}
                        onChange={(e) => setFormRate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 10px',
                          borderRadius: 8,
                          border: '1px solid #CBD5E1',
                          fontSize: 13.5,
                          outline: 'none',
                          boxSizing: 'border-box',
                          backgroundColor: '#FFFFFF',
                        }}
                      />
                    </div>
                  </div>

                  {/* Channels / Platforms chips */}
                  {isMarketingOrMedia && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                        Channels / Platforms
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {['Facebook', 'Instagram', 'WhatsApp', 'Google Business Profile', 'YouTube', 'Website'].map((channel) => {
                          const active = formChannels.includes(channel);
                          return (
                            <button
                              key={channel}
                              type="button"
                              onClick={() => {
                                setFormChannels(active ? formChannels.filter((c) => c !== channel) : [...formChannels, channel]);
                              }}
                              style={{
                                padding: '5px 11px',
                                borderRadius: 7,
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                                border: active ? '1px solid #3B5BDB' : '1px solid #CBD5E1',
                                background: active ? '#EEF2FF' : '#FFFFFF',
                                color: active ? '#3B5BDB' : '#475569',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {active ? '✓ ' : ''}{channel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Specific Brief / Details for Employee */}
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                      Deliverable Brief / Specific Instructions for Employee
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1080×1080 Diwali offer poster in Tamil & English, use new logo"
                      value={formDetails}
                      onChange={(e) => setFormDetails(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: '1px solid #CBD5E1',
                        fontSize: 13.5,
                        outline: 'none',
                        boxSizing: 'border-box',
                        backgroundColor: '#FFFFFF',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Due Date & Priority (Stacked on mobile, side-by-side on sm) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-4">
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 5 }}>
                    Due Date <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => {
                      setFormDueDate(e.target.value);
                      if (errors.dueDate) setErrors((prev) => ({ ...prev, dueDate: undefined }));
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: errors.dueDate ? '1px solid #EF4444' : '1px solid #CBD5E1',
                      fontSize: 13.5,
                      outline: 'none',
                      boxSizing: 'border-box',
                      backgroundColor: '#FFFFFF',
                    }}
                  />
                  {errors.dueDate && <span style={{ color: '#EF4444', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.dueDate}</span>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 5 }}>
                    Priority
                  </label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value as TaskPriority)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid #CBD5E1',
                      fontSize: 13.5,
                      outline: 'none',
                      backgroundColor: '#FFFFFF',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              {/* Status */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 5 }}>
                  Status
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as TaskStatus)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13.5,
                    outline: 'none',
                    backgroundColor: '#FFFFFF',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="Pending">Pending</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>

              {/* Actions Footer */}
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  justifyContent: 'flex-end',
                  paddingTop: 14,
                  borderTop: '1px solid #F1F5F9',
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  style={{
                    flex: '1 1 auto',
                    maxWidth: 130,
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#475569',
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    flex: '2 1 auto',
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#3B5BDB',
                    color: '#FFFFFF',
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.7 : 1,
                    textAlign: 'center',
                  }}
                >
                  {isSubmitting ? 'Saving...' : editingTask ? 'Update Task' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingTask && (
        <DeleteConfirmationModal
          isOpen={Boolean(deletingTask)}
          title="Delete Task"
          description={`Are you sure you want to delete "${deletingTask.title || deletingTask.task}"? This action will permanently remove it from Firestore and local cache.`}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeletingTask(null)}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
}
