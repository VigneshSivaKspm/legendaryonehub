import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee, type LeaveRequest } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  getAllLeaveRequests,
  addLeaveRequest,
  updateLeaveRequest,
  updateLeaveStatus,
  deleteLeaveRequest,
} from '../services/leaveService';
import { useToast } from '../context/ToastContext';
import {
  Calendar,
  CalendarDays,
  Clock,
  CheckCircle2,
  XCircle,
  Users,
  Plus,
  Search,
  Filter,
  Edit3,
  Trash2,
  AlertCircle,
  Check,
  X,
  FileText,
  Building2,
  UserCheck,
  MessageSquare,
  RefreshCw,
  CheckSquare,
} from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const LEAVE_TYPES = [
  'Casual Leave',
  'Sick Leave',
  'Earned / Paid Leave',
  'Unpaid Leave',
  'Work From Home',
] as const;

interface FormState {
  employeeId: string | number;
  leaveType: string;
  fromDate: string;
  toDate: string;
  isHalfDay: boolean;
  halfDaySession: 'Morning' | 'Afternoon';
  reason: string;
  contactNotes: string;
}

/**
 * Calculates total leave days considering fromDate, toDate, and half-day selection.
 */
export function calculateLeaveDays(
  fromDateStr: string,
  toDateStr: string,
  isHalf: boolean
): number {
  if (!fromDateStr || !toDateStr) return 0;
  const start = new Date(fromDateStr);
  const end = new Date(toDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (end < start) return 0;

  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 3600 * 24)) + 1;
  if (isHalf) {
    return diffDays > 1 ? diffDays - 0.5 : 0.5;
  }
  return diffDays;
}

/**
 * Checks for overlapping leave requests for the same employee.
 */
export function hasOverlappingLeave(
  empId: string | number,
  from: string,
  to: string,
  allRequests: LeaveRequest[],
  editingId?: string | number
): boolean {
  if (!empId || !from || !to) return false;
  return allRequests.some((r) => {
    if (editingId !== undefined && String(r.id) === String(editingId)) return false;
    if (String(r.employeeId) !== String(empId)) return false;
    if (r.status === 'Rejected') return false;
    return r.fromDate <= to && r.toDate >= from;
  });
}

/**
 * Validates leave form state and returns errors map.
 */
export function validateLeaveForm(
  formState: FormState,
  allRequests: LeaveRequest[],
  editingId?: string | number
): Record<string, string> {
  const newErrors: Record<string, string> = {};

  if (!formState.employeeId) {
    newErrors.employeeId = 'Please select an employee.';
  }

  if (!formState.leaveType) {
    newErrors.leaveType = 'Please select a leave type.';
  }

  if (!formState.fromDate) {
    newErrors.fromDate = 'From date is required.';
  }

  if (!formState.toDate) {
    newErrors.toDate = 'To date is required.';
  } else if (formState.fromDate && formState.toDate < formState.fromDate) {
    newErrors.toDate = 'To date cannot be before From date.';
  }

  const daysCount = calculateLeaveDays(formState.fromDate, formState.toDate, formState.isHalfDay);
  if (!newErrors.toDate && daysCount <= 0) {
    newErrors.toDate = 'Leave duration must be greater than 0 days.';
  }

  if (!formState.reason || !formState.reason.trim()) {
    newErrors.reason = 'Reason for leave is required.';
  }

  // Overlap validation
  if (
    formState.employeeId &&
    formState.fromDate &&
    formState.toDate &&
    formState.fromDate <= formState.toDate &&
    daysCount > 0 &&
    hasOverlappingLeave(
      formState.employeeId,
      formState.fromDate,
      formState.toDate,
      allRequests,
      editingId
    )
  ) {
    newErrors.fromDate = 'Employee already has an overlapping leave request for this date range.';
  }

  return newErrors;
}

export default function Leave() {
  const { showToast } = useToast();

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);

  // Filters
  const [search, setSearch] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [monthFilter, setMonthFilter] = useState('');

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);
  const [requestToDelete, setRequestToDelete] = useState<LeaveRequest | null>(null);
  const [statusModal, setStatusModal] = useState<{
    request: LeaveRequest;
    actionStatus: 'Approved' | 'Rejected';
  } | null>(null);

  const [adminRemarksInput, setAdminRemarksInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Form State
  const [form, setForm] = useState<FormState>({
    employeeId: '',
    leaveType: 'Casual Leave',
    fromDate: todayStr,
    toDate: todayStr,
    isHalfDay: false,
    halfDaySession: 'Morning',
    reason: '',
    contactNotes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Synchronize from Firestore on mount
  useEffect(() => {
    getAllLeaveRequests().catch((err) => {
      console.warn('[Leave] Firestore sync warning:', err);
    });
  }, []);

  // Live queries from Dexie local cache
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const leaveRequests = useLiveQuery(async () => newestFirst(await db.leaveRequests.toArray(), (l) => l.fromDate), []) || [];

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => e.status !== 'Inactive');
  }, [employees]);

  // Calculated Summary Cards (Real values only)
  const summary = useMemo(() => {
    const total = leaveRequests.length;
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    const onLeaveEmpIds = new Set<string | number>();

    leaveRequests.forEach((r) => {
      if (r.status === 'Pending') pending++;
      else if (r.status === 'Approved') {
        approved++;
        if (r.fromDate <= todayStr && r.toDate >= todayStr) {
          onLeaveEmpIds.add(r.employeeId);
        }
      } else if (r.status === 'Rejected') rejected++;
    });

    return {
      total,
      pending,
      approved,
      rejected,
      onLeaveToday: onLeaveEmpIds.size,
    };
  }, [leaveRequests, todayStr]);

  // Form calculated duration
  const calculatedDays = useMemo(() => {
    return calculateLeaveDays(form.fromDate, form.toDate, form.isHalfDay);
  }, [form.fromDate, form.toDate, form.isHalfDay]);

  // Reactive field update with immediate validation clearing/updating
  const updateFormField = (updates: Partial<FormState>) => {
    const updatedForm = { ...form, ...updates };
    setForm(updatedForm);

    if (hasSubmitted || Object.keys(errors).length > 0) {
      const liveErrors = validateLeaveForm(updatedForm, leaveRequests, editingRequest?.id);
      setErrors(liveErrors);
    }
  };

  // Filtered leave requests list
  const filteredRequests = useMemo(() => {
    return leaveRequests
      .filter((r) => {
        // Employee filter
        if (employeeFilter !== 'All' && String(r.employeeId) !== String(employeeFilter)) {
          return false;
        }
        // Leave Type filter
        if (leaveTypeFilter !== 'All' && r.leaveType !== leaveTypeFilter) {
          return false;
        }
        // Status filter
        if (statusFilter !== 'All' && r.status !== statusFilter) {
          return false;
        }
        // Month filter (matches fromDate or toDate in YYYY-MM)
        if (monthFilter) {
          const fromMonth = r.fromDate?.slice(0, 7);
          const toMonth = r.toDate?.slice(0, 7);
          if (fromMonth !== monthFilter && toMonth !== monthFilter) {
            return false;
          }
        }
        // Text Search
        if (search.trim()) {
          const q = search.toLowerCase();
          const empName = (r.employeeName || '').toLowerCase();
          const empCode = (r.employeeCode || '').toLowerCase();
          const reasonText = (r.reason || '').toLowerCase();
          const typeText = (r.leaveType || '').toLowerCase();
          const remarksText = (r.adminRemarks || '').toLowerCase();

          if (
            !empName.includes(q) &&
            !empCode.includes(q) &&
            !reasonText.includes(q) &&
            !typeText.includes(q) &&
            !remarksText.includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const dateA = a.createdAt || a.fromDate || '';
        const dateB = b.createdAt || b.fromDate || '';
        return dateB.localeCompare(dateA);
      });
  }, [leaveRequests, employeeFilter, leaveTypeFilter, statusFilter, monthFilter, search]);

  // Handlers
  const handleOpenCreateModal = () => {
    setEditingRequest(null);
    setForm({
      employeeId: activeEmployees.length > 0 ? activeEmployees[0].id || '' : '',
      leaveType: 'Casual Leave',
      fromDate: todayStr,
      toDate: todayStr,
      isHalfDay: false,
      halfDaySession: 'Morning',
      reason: '',
      contactNotes: '',
    });
    setErrors({});
    setHasSubmitted(false);
    setShowModal(true);
  };

  const handleOpenEditModal = (req: LeaveRequest) => {
    if (req.status !== 'Pending') {
      showToast('Only pending leave requests can be edited.', 'error');
      return;
    }
    setEditingRequest(req);
    setForm({
      employeeId: req.employeeId,
      leaveType: req.leaveType,
      fromDate: req.fromDate,
      toDate: req.toDate,
      isHalfDay: Boolean(req.isHalfDay),
      halfDaySession: req.halfDaySession === 'Afternoon' ? 'Afternoon' : 'Morning',
      reason: req.reason || '',
      contactNotes: req.contactNotes || '',
    });
    setErrors({});
    setHasSubmitted(false);
    setShowModal(true);
  };

  const handleSaveLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);

    const validationErrors = validateLeaveForm(form, leaveRequests, editingRequest?.id);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});
    const daysCount = calculateLeaveDays(form.fromDate, form.toDate, form.isHalfDay);
    const selectedEmp = activeEmployees.find((e) => String(e.id) === String(form.employeeId));
    const empName = selectedEmp ? selectedEmp.name : 'Unknown Employee';
    const empCode = selectedEmp ? selectedEmp.employeeId || '' : '';
    const empDept = selectedEmp ? selectedEmp.dept || '' : '';

    setIsSubmitting(true);
    try {
      if (editingRequest && editingRequest.id) {
        await updateLeaveRequest(editingRequest.id, {
          employeeId: form.employeeId,
          employeeName: empName,
          employeeCode: empCode,
          department: empDept,
          leaveType: form.leaveType,
          fromDate: form.fromDate,
          toDate: form.toDate,
          days: daysCount,
          isHalfDay: form.isHalfDay,
          halfDaySession: form.isHalfDay ? form.halfDaySession : 'Full Day',
          reason: form.reason.trim(),
          contactNotes: form.contactNotes.trim(),
        });
        showToast('Leave request updated successfully.', 'success');
      } else {
        await addLeaveRequest({
          employeeId: form.employeeId,
          employeeName: empName,
          employeeCode: empCode,
          department: empDept,
          leaveType: form.leaveType,
          fromDate: form.fromDate,
          toDate: form.toDate,
          days: daysCount,
          isHalfDay: form.isHalfDay,
          halfDaySession: form.isHalfDay ? form.halfDaySession : 'Full Day',
          reason: form.reason.trim(),
          contactNotes: form.contactNotes.trim(),
          status: 'Pending',
        });
        showToast('Leave request submitted successfully.', 'success');
      }
      setShowModal(false);
    } catch (err: any) {
      console.error('Failed to save leave request:', err);
      showToast(err?.message || 'Failed to save leave request. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenStatusModal = (req: LeaveRequest, actionStatus: 'Approved' | 'Rejected') => {
    setStatusModal({ request: req, actionStatus });
    setAdminRemarksInput(req.adminRemarks || '');
  };

  const handleConfirmStatusChange = async () => {
    if (!statusModal || !statusModal.request.id) return;
    setIsUpdatingStatus(true);
    try {
      await updateLeaveStatus(
        statusModal.request.id,
        statusModal.actionStatus,
        adminRemarksInput,
        'Admin / Management'
      );
      showToast(
        `Leave request for ${statusModal.request.employeeName} has been ${statusModal.actionStatus.toLowerCase()}.`,
        'success'
      );
      setStatusModal(null);
      setAdminRemarksInput('');
    } catch (err: any) {
      console.error('Failed to update status:', err);
      showToast(err?.message || 'Failed to update leave request status.', 'error');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!requestToDelete || !requestToDelete.id) return;
    setIsDeleting(true);
    try {
      await deleteLeaveRequest(requestToDelete.id);
      showToast('Leave request deleted permanently.', 'success');
      setRequestToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete leave request:', err);
      showToast(err?.message || 'Failed to delete leave request.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Helper for Leave Type styling
  const getLeaveTypeBadge = (type: string) => {
    switch (type) {
      case 'Casual Leave':
        return { bg: '#E0F2FE', color: '#0369A1', border: '#BAE6FD' };
      case 'Sick Leave':
        return { bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' };
      case 'Earned / Paid Leave':
        return { bg: '#D1FAE5', color: '#047857', border: '#A7F3D0' };
      case 'Unpaid Leave':
        return { bg: '#F3E8FF', color: '#6B21A8', border: '#E9D5FF' };
      case 'Work From Home':
        return { bg: '#EEF2FF', color: '#4338CA', border: '#C7D2FE' };
      default:
        return { bg: '#F1F5F9', color: '#475569', border: '#E2E8F0' };
    }
  };

  // Helper for Status Badge styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Approved':
        return {
          bg: '#ECFDF5',
          color: '#059669',
          border: '#A7F3D0',
          icon: <CheckCircle2 size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />,
        };
      case 'Rejected':
        return {
          bg: '#FEF2F2',
          color: '#DC2626',
          border: '#FECACA',
          icon: <XCircle size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />,
        };
      case 'Pending':
      default:
        return {
          bg: '#FFFBEB',
          color: '#D97706',
          border: '#FDE68A',
          icon: <Clock size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />,
        };
    }
  };

  return (
    <div style={{ padding: '24px 24px 40px', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      {/* PAGE HEADER */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#EEF2FF',
              color: '#4F46E5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CalendarDays size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>
              Leave Management
            </h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: '2px 0 0 0' }}>
              Track employee leave requests, balances & approval workflows
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={handleOpenCreateModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            fontSize: 13.5,
            fontWeight: 600,
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          <Plus size={18} strokeWidth={2.5} />
          Apply Leave
        </button>
      </div>

      {/* SUMMARY CARDS (Real values only) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Total Requests */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '18px 20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>Total Requests</span>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: '#EFF6FF',
                color: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Calendar size={18} strokeWidth={2.2} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>
            {summary.total}
          </div>
        </div>

        {/* Pending */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '18px 20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>Pending</span>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: '#FEF3C7',
                color: '#D97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={18} strokeWidth={2.2} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#D97706', marginTop: 10 }}>
            {summary.pending}
          </div>
        </div>

        {/* Approved */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '18px 20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>Approved</span>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: '#D1FAE5',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircle2 size={18} strokeWidth={2.2} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#059669', marginTop: 10 }}>
            {summary.approved}
          </div>
        </div>

        {/* Rejected */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '18px 20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>Rejected</span>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: '#FFE4E6',
                color: '#E11D48',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <XCircle size={18} strokeWidth={2.2} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#E11D48', marginTop: 10 }}>
            {summary.rejected}
          </div>
        </div>

        {/* On Leave Today */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '18px 20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>
              On Leave Today
            </span>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: '#F3E8FF',
                color: '#9333EA',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Users size={18} strokeWidth={2.2} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#9333EA', marginTop: 10 }}>
            {summary.onLeaveToday}
          </div>
        </div>
      </div>

      {/* ZERO STATE WHEN NO EMPLOYEES EXIST */}
      {employees.length === 0 ? (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 16,
            padding: 48,
            textAlign: 'center',
            border: '1px dashed #CBD5E1',
            margin: '24px 0',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#F1F5F9',
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
            }}
          >
            <Users size={32} strokeWidth={1.8} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
            No Employees Added
          </h3>
          <p
            style={{
              fontSize: 14,
              color: '#64748B',
              maxWidth: 440,
              margin: '0 auto 20px auto',
              lineHeight: 1.5,
            }}
          >
            Before team members can apply for leave, employees must be added to the system.
          </p>
        </div>
      ) : (
        <>
          {/* FILTERS & SEARCH ROW */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 14,
              padding: 16,
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              marginBottom: 20,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
            }}
          >
            {/* Search Input */}
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 200 }}>
              <Search
                size={16}
                color="#94A3B8"
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
              />
              <input
                type="text"
                className="input-field"
                placeholder="Search employee, leave type, reason..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 36, fontSize: 13, height: 38 }}
              />
            </div>

            {/* Employee Filter */}
            <div style={{ flex: '0 1 160px', minWidth: 140 }}>
              <select
                className="input-field"
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                style={{ fontSize: 13, height: 38 }}
              >
                <option value="All">All Employees</option>
                {activeEmployees.map((emp) => (
                  <option key={emp.id} value={String(emp.id)}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Leave Type Filter */}
            <div style={{ flex: '0 1 160px', minWidth: 140 }}>
              <select
                className="input-field"
                value={leaveTypeFilter}
                onChange={(e) => setLeaveTypeFilter(e.target.value)}
                style={{ fontSize: 13, height: 38 }}
              >
                <option value="All">All Leave Types</option>
                {LEAVE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div style={{ flex: '0 1 140px', minWidth: 120 }}>
              <select
                className="input-field"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ fontSize: 13, height: 38 }}
              >
                <option value="All">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>

            {/* Month Filter */}
            <div style={{ flex: '0 1 140px', minWidth: 130 }}>
              <input
                type="month"
                className="input-field"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                style={{ fontSize: 13, height: 38 }}
                title="Filter by Month"
              />
            </div>

            {/* Reset Filters button */}
            {(search ||
              employeeFilter !== 'All' ||
              leaveTypeFilter !== 'All' ||
              statusFilter !== 'All' ||
              monthFilter) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSearch('');
                  setEmployeeFilter('All');
                  setLeaveTypeFilter('All');
                  setStatusFilter('All');
                  setMonthFilter('');
                }}
                style={{ fontSize: 12.5, height: 38, padding: '0 12px' }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* TABLE OR ZERO STATE */}
          {filteredRequests.length === 0 ? (
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: 40,
                textAlign: 'center',
                border: '1px solid #E2E8F0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: '#F8FAFC',
                  color: '#94A3B8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px auto',
                }}
              >
                <CalendarDays size={28} strokeWidth={1.8} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                No Leave Requests Found
              </h3>
              <p style={{ fontSize: 13, color: '#64748B', margin: '0 auto 16px auto', maxWidth: 360 }}>
                {leaveRequests.length === 0
                  ? 'No leave requests have been created yet. Click "Apply Leave" to add one.'
                  : 'No records match your active search or filter criteria.'}
              </p>
              {leaveRequests.length === 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleOpenCreateModal}
                  style={{ fontSize: 13 }}
                >
                  <Plus size={16} style={{ marginRight: 6 }} /> Apply Leave
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 14,
                border: '1px solid #E2E8F0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    textAlign: 'left',
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: '#F8FAFC',
                        borderBottom: '1px solid #E2E8F0',
                        color: '#475569',
                        fontWeight: 700,
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <th style={{ padding: '14px 16px' }}>Employee</th>
                      <th style={{ padding: '14px 12px' }}>EMP ID</th>
                      <th style={{ padding: '14px 12px' }}>Leave Type</th>
                      <th style={{ padding: '14px 12px' }}>From</th>
                      <th style={{ padding: '14px 12px' }}>To</th>
                      <th style={{ padding: '14px 12px', textAlign: 'center' }}>Days</th>
                      <th style={{ padding: '14px 12px' }}>Reason</th>
                      <th style={{ padding: '14px 12px' }}>Status</th>
                      <th style={{ padding: '14px 12px' }}>Applied Date</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req, idx) => {
                      const typeBadge = getLeaveTypeBadge(req.leaveType);
                      const statusBadge = getStatusBadge(req.status);
                      const appliedDateFormatted = req.createdAt
                        ? new Date(req.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : req.fromDate;

                      return (
                        <tr
                          key={req.id || idx}
                          style={{
                            borderBottom: '1px solid #F1F5F9',
                            transition: 'background 0.15s ease',
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = '#F8FAFC')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = 'transparent')
                          }
                        >
                          {/* Employee Name */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: '50%',
                                  background: '#EEF2FF',
                                  color: '#4F46E5',
                                  fontWeight: 700,
                                  fontSize: 12,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {req.employeeName
                                  ? req.employeeName.substring(0, 2)
                                  : 'EM'}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: '#0F172A' }}>
                                  {req.employeeName}
                                </div>
                                {req.contactNotes && (
                                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                                    Handover: {req.contactNotes}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* EMP ID */}
                          <td style={{ padding: '14px 12px', color: '#64748B', fontWeight: 600 }}>
                            {req.employeeCode || '-'}
                          </td>

                          {/* Leave Type */}
                          <td style={{ padding: '14px 12px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '4px 10px',
                                borderRadius: 20,
                                fontSize: 12,
                                fontWeight: 600,
                                background: typeBadge.bg,
                                color: typeBadge.color,
                                border: `1px solid ${typeBadge.border}`,
                              }}
                            >
                              {req.leaveType}
                              {req.isHalfDay && (
                                <span style={{ marginLeft: 4, opacity: 0.8, fontSize: 11 }}>
                                  ({req.halfDaySession || 'Half Day'})
                                </span>
                              )}
                            </span>
                          </td>

                          {/* From Date */}
                          <td style={{ padding: '14px 12px', color: '#1E293B', fontWeight: 600 }}>
                            {req.fromDate}
                          </td>

                          {/* To Date */}
                          <td style={{ padding: '14px 12px', color: '#1E293B', fontWeight: 600 }}>
                            {req.toDate}
                          </td>

                          {/* Days */}
                          <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 6,
                                background: '#F1F5F9',
                                color: '#334155',
                                fontWeight: 700,
                                fontSize: 12.5,
                              }}
                            >
                              {req.days} {req.days === 1 ? 'Day' : 'Days'}
                            </span>
                          </td>

                          {/* Reason */}
                          <td style={{ padding: '14px 12px', color: '#475569', maxWidth: 220 }}>
                            <div
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={req.reason}
                            >
                              {req.reason}
                            </div>
                            {req.adminRemarks && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#059669',
                                  marginTop: 2,
                                  fontStyle: 'italic',
                                }}
                              >
                                Remarks: {req.adminRemarks}
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td style={{ padding: '14px 12px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '4px 10px',
                                borderRadius: 20,
                                fontSize: 12,
                                fontWeight: 700,
                                background: statusBadge.bg,
                                color: statusBadge.color,
                                border: `1px solid ${statusBadge.border}`,
                              }}
                            >
                              {statusBadge.icon}
                              {req.status}
                            </span>
                          </td>

                          {/* Applied Date */}
                          <td style={{ padding: '14px 12px', color: '#64748B', fontSize: 12 }}>
                            {appliedDateFormatted}
                          </td>

                          {/* Actions */}
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              {/* Approve / Reject buttons */}
                              {req.status === 'Pending' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStatusModal(req, 'Approved')}
                                    style={{
                                      border: '1px solid #A7F3D0',
                                      background: '#ECFDF5',
                                      color: '#059669',
                                      borderRadius: 6,
                                      padding: '5px 9px',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                    title="Approve Leave"
                                  >
                                    <Check size={14} strokeWidth={2.5} /> Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStatusModal(req, 'Rejected')}
                                    style={{
                                      border: '1px solid #FECACA',
                                      background: '#FEF2F2',
                                      color: '#DC2626',
                                      borderRadius: 6,
                                      padding: '5px 9px',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                    title="Reject Leave"
                                  >
                                    <X size={14} strokeWidth={2.5} /> Reject
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(req)}
                                    style={{
                                      border: '1px solid #CBD5E1',
                                      background: '#FFFFFF',
                                      color: '#475569',
                                      borderRadius: 6,
                                      padding: 6,
                                      cursor: 'pointer',
                                    }}
                                    title="Edit Pending Request"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenStatusModal(
                                      req,
                                      req.status === 'Approved' ? 'Rejected' : 'Approved'
                                    )
                                  }
                                  style={{
                                    border: '1px solid #E2E8F0',
                                    background: '#F8FAFC',
                                    color: '#475569',
                                    borderRadius: 6,
                                    padding: '5px 9px',
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                  title="Change Status"
                                >
                                  Change Status
                                </button>
                              )}

                              {/* Delete button */}
                              <button
                                type="button"
                                onClick={() => setRequestToDelete(req)}
                                style={{
                                  border: '1px solid #FEE2E2',
                                  background: '#FEF2F2',
                                  color: '#DC2626',
                                  borderRadius: 6,
                                  padding: 6,
                                  cursor: 'pointer',
                                }}
                                title="Delete Leave Request"
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
            </div>
          )}
        </>
      )}

      {/* CREATE / EDIT LEAVE MODAL */}
      {showModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 540,
              padding: 28,
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <h2 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 17, fontWeight: 700, color: '#1A1F36', margin: 0 }}>
                {editingRequest ? 'Edit Pending Leave Request' : 'Apply for Leave'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveLeaveRequest}>
              {/* Employee Selection */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Employee <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <select
                  className="input-field"
                  value={String(form.employeeId)}
                  onChange={(e) => updateFormField({ employeeId: e.target.value })}
                  disabled={Boolean(editingRequest)}
                  style={{ width: '100%' }}
                >
                  <option value="">-- Select Employee --</option>
                  {activeEmployees.map((emp) => (
                    <option key={emp.id} value={String(emp.id)}>
                      {emp.name} ({emp.employeeId || 'No ID'}){emp.role ? ` - ${emp.role}` : ''}
                    </option>
                  ))}
                </select>
                {errors.employeeId && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{errors.employeeId}</div>
                )}
              </div>

              {/* Leave Type */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Leave Type <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <select
                  className="input-field"
                  value={form.leaveType}
                  onChange={(e) => updateFormField({ leaveType: e.target.value })}
                  style={{ width: '100%' }}
                >
                  {LEAVE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                {errors.leaveType && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{errors.leaveType}</div>
                )}
              </div>

              {/* Dates Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    From Date <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="input-field"
                    value={form.fromDate}
                    onChange={(e) => updateFormField({ fromDate: e.target.value })}
                    style={{ width: '100%' }}
                  />
                  {errors.fromDate && (
                    <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{errors.fromDate}</div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    To Date <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="input-field"
                    value={form.toDate}
                    onChange={(e) => updateFormField({ toDate: e.target.value })}
                    style={{ width: '100%' }}
                  />
                  {errors.toDate && (
                    <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{errors.toDate}</div>
                  )}
                </div>
              </div>

              {/* Half Day Option */}
              <div
                style={{
                  background: '#F8FAFC',
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 16,
                  border: '1px solid #E2E8F0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                    <input
                      type="checkbox"
                      checked={form.isHalfDay}
                      onChange={(e) => updateFormField({ isHalfDay: e.target.checked })}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    Half-Day Leave
                  </label>

                  {form.isHalfDay && (
                    <div style={{ display: 'flex', gap: 12 }}>
                      <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="halfDaySession"
                          checked={form.halfDaySession === 'Morning'}
                          onChange={() => updateFormField({ halfDaySession: 'Morning' })}
                        />
                        Morning Session
                      </label>
                      <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="halfDaySession"
                          checked={form.halfDaySession === 'Afternoon'}
                          onChange={() => updateFormField({ halfDaySession: 'Afternoon' })}
                        />
                        Afternoon Session
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Auto Calculated Days Banner */}
              <div
                style={{
                  background: calculatedDays > 0 ? '#EEF2FF' : '#FEF2F2',
                  border: `1px solid ${calculatedDays > 0 ? '#C7D2FE' : '#FECACA'}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: calculatedDays > 0 ? '#3730A3' : '#991B1B' }}>
                  Total Days: {calculatedDays} {calculatedDays === 1 ? 'Day' : 'Days'}
                </div>
                {form.isHalfDay && (
                  <span style={{ fontSize: 12, color: '#4338CA', fontStyle: 'italic' }}>
                    (Half Day Applied)
                  </span>
                )}
              </div>

              {/* Reason */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Reason for Leave <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Explain reason for leave..."
                  value={form.reason}
                  onChange={(e) => updateFormField({ reason: e.target.value })}
                  style={{ width: '100%', resize: 'vertical' }}
                />
                {errors.reason && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{errors.reason}</div>
                )}
              </div>

              {/* Handover / Emergency Contact Notes */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Handover / Contact Notes <span style={{ fontWeight: 400, color: '#64748B' }}>(Optional)</span>
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Work delegated to colleague / Emergency phone number"
                  value={form.contactNotes}
                  onChange={(e) => updateFormField({ contactNotes: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmitting}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {isSubmitting
                    ? 'Saving...'
                    : editingRequest
                    ? 'Update Leave Request'
                    : 'Submit Leave Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* APPROVAL / REJECTION REMARKS MODAL */}
      {statusModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setStatusModal(null)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 460,
              padding: 24,
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: statusModal.actionStatus === 'Approved' ? '#D1FAE5' : '#FEE2E2',
                  color: statusModal.actionStatus === 'Approved' ? '#059669' : '#DC2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px auto',
                }}
              >
                {statusModal.actionStatus === 'Approved' ? (
                  <CheckCircle2 size={26} strokeWidth={2.2} />
                ) : (
                  <XCircle size={26} strokeWidth={2.2} />
                )}
              </div>

              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: '0 0 6px 0' }}>
                {statusModal.actionStatus === 'Approved' ? 'Approve Leave Request' : 'Reject Leave Request'}
              </h3>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                Request for <strong>{statusModal.request.employeeName}</strong> ({statusModal.request.days} Days from{' '}
                {statusModal.request.fromDate} to {statusModal.request.toDate})
              </p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                Approval / Rejection Remarks
              </label>
              <textarea
                className="input-field"
                rows={3}
                placeholder={
                  statusModal.actionStatus === 'Approved'
                    ? 'Optional remarks (e.g. Approved by Management)'
                    : 'Reason for rejection...'
                }
                value={adminRemarksInput}
                onChange={(e) => setAdminRemarksInput(e.target.value)}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setStatusModal(null)}
                disabled={isUpdatingStatus}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  background: statusModal.actionStatus === 'Approved' ? '#059669' : '#DC2626',
                  border: 'none',
                }}
                disabled={isUpdatingStatus}
                onClick={handleConfirmStatusChange}
              >
                {isUpdatingStatus
                  ? 'Saving...'
                  : statusModal.actionStatus === 'Approved'
                  ? 'Confirm Approval'
                  : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHARED DELETE CONFIRMATION MODAL */}
      <DeleteConfirmationModal
        isOpen={Boolean(requestToDelete)}
        title="Delete Leave Request"
        itemName={
          requestToDelete
            ? `${requestToDelete.employeeName} (${requestToDelete.leaveType} from ${requestToDelete.fromDate} to ${requestToDelete.toDate})`
            : ''
        }
        isDeleting={isDeleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setRequestToDelete(null)}
      />
    </div>
  );
}
