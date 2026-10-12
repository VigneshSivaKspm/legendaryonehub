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
} from 'lucide-react';
import { db, type ProjectTask, type Project } from '../db/database';
import {
  addTask,
  updateTask,
  deleteTask,
  type TaskStatus,
  type TaskPriority,
} from '../services/taskService';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import EmployeeSelect from '../components/EmployeeSelect';

export default function Tasks() {
  // Live queries for real-time Dexie data
  const rawTasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
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

  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to normalize task object fields
  const normalizedTasks = useMemo(() => {
    return rawTasks.map((t) => {
      const title = t.title || t.task || 'Untitled Task';
      const dueDate = t.dueDate || t.deadline || '';
      const assignedTo = t.assignedTo || t.assignee || 'Unassigned';
      const projectName = t.projectName || t.project || 'General';

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
        status,
        isOverdue,
      };
    });
  }, [rawTasks, todayStr]);

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
        if (!matchesTitle && !matchesDesc && !matchesAssignee && !matchesProject) {
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
      const selectedProject = projects.find((p) => String(p.id) === String(formProjectId));

      const payload = {
        title: formTitle.trim(),
        task: formTitle.trim(),
        description: formDescription.trim(),
        projectId: formProjectId ? (isNaN(Number(formProjectId)) ? formProjectId : Number(formProjectId)) : '',
        projectName: selectedProject ? selectedProject.name : '',
        project: selectedProject ? selectedProject.name : '',
        assignedTo: formAssignedTo.trim(),
        assignee: formAssignedTo.trim(),
        ...(formAssignedToId !== undefined ? { assignedToId: formAssignedToId } : {}),
        dueDate: formDueDate,
        deadline: formDueDate,
        priority: formPriority,
        status: formStatus,
      };

      if (editingTask && editingTask.id) {
        await updateTask(editingTask.id, payload);
      } else {
        await addTask(payload);
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
      await updateTask(task.id, { status: newStatus });
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
            Track, assign, and manage team deliverables across projects
          </p>
        </div>

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
                  <th style={{ padding: '14px 16px' }}>Task Title</th>
                  <th style={{ padding: '14px 16px' }}>Project</th>
                  <th style={{ padding: '14px 16px' }}>Assigned To</th>
                  <th style={{ padding: '14px 16px' }}>Due Date</th>
                  <th style={{ padding: '14px 16px' }}>Priority</th>
                  <th style={{ padding: '14px 16px' }}>Status</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center' }}>Actions</th>
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
                      <td style={{ padding: '14px 16px', maxWidth: 300 }}>
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
                      </td>

                      {/* Project */}
                      <td style={{ padding: '14px 16px', color: '#475569' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Folder size={14} style={{ color: '#94A3B8' }} />
                          <span>{t.projectName || 'General'}</span>
                        </div>
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
                      </td>

                      {/* Actions */}
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
            ) : (
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
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 16,
              width: '100%',
              maxWidth: 540,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 18, fontWeight: 700, color: '#1E293B', margin: 0 }}>
                {editingTask ? 'Edit Task' : 'Add New Task'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} style={{ padding: '20px 24px' }}>
              {/* Task Title */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
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
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Description <span style={{ color: '#94A3B8', fontWeight: 400 }}>(Optional)</span>
                </label>
                <textarea
                  rows={3}
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

              {/* Linked Project & Assigned To */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Linked Project
                  </label>
                  <select
                    value={formProjectId}
                    onChange={(e) => setFormProjectId(e.target.value)}
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
                    {projects.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
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

              {/* Due Date & Priority */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
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
                    }}
                  />
                  {errors.dueDate && <span style={{ color: '#EF4444', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.dueDate}</span>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
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
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
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

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#475569',
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#3B5BDB',
                    color: '#FFFFFF',
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.7 : 1,
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
