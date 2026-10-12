import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee, type AttendanceRecord } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  getAllAttendance,
  addAttendance,
  updateAttendance,
  deleteAttendance,
  bulkSaveAttendance,
  decideAttendanceRequest,
} from '../services/attendanceService';
import {
  useAttendancePolicy,
  saveAttendancePolicy,
  getPublicIp,
  type AttendancePolicy,
} from '../services/attendancePolicyService';
import { isOwnerOrAdminRole } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Calendar,
  UserCheck,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  Users,
  Search,
  Plus,
  CheckSquare,
  CalendarDays,
  UserX,
  LogOut,
  Wifi,
  Hourglass,
} from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import AttendanceRequestBadges from '../components/AttendanceRequestBadges';
import {
  WORK_START,
  LUNCH_MAX_MINUTES,
  REQUEST_LABELS,
  defaultCheckInFor,
  statusHasTimes,
  formatTime12h,
  formatLunch,
  lunchMinutes,
  minutesOf,
  overtimeFor,
  toHHMM,
  isCheckedIn,
  pendingRequests,
  toTimeInputValue,
  type RequestKind,
} from '../utils/attendanceTimes';

type ViewTab = 'daily' | 'monthly';
type AttendanceStatus = 'Present' | 'Absent' | 'On Leave' | 'Late' | 'Half Day';

interface SingleFormState {
  employeeId: string | number;
  date: string;
  status: AttendanceStatus;
  checkIn: string;
  checkOut: string;
  overtimeHours: string;
  notes: string;
}

export default function Attendance() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const isAdmin = isOwnerOrAdminRole(user?.role);
  const adminName = user?.name || user?.email || 'Admin';
  const { policy } = useAttendancePolicy();

  // Approvals
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [decidingKey, setDecidingKey] = useState('');

  // Check-out from the list
  const [checkOutTarget, setCheckOutTarget] = useState<AttendanceRecord | null>(null);
  const [checkOutTime, setCheckOutTime] = useState('');

  // Office network settings
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [networkDraft, setNetworkDraft] = useState<AttendancePolicy>({ requireOfficeNetwork: false, networks: [] });
  const [currentIp, setCurrentIp] = useState('');
  const [ipError, setIpError] = useState('');
  const [newNetworkLabel, setNewNetworkLabel] = useState('');

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const [activeTab, setActiveTab] = useState<ViewTab>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Modals
  const [showMarkModal, setShowMarkModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<AttendanceRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Single Form State
  const [singleForm, setSingleForm] = useState<SingleFormState>({
    employeeId: '',
    date: todayStr,
    status: 'Present',
    checkIn: WORK_START,
    checkOut: '',
    overtimeHours: '',
    notes: '',
  });
  const [singleErrors, setSingleErrors] = useState<Record<string, string>>({});

  // Bulk Form State: array of items per active employee for selectedDate
  const [bulkState, setBulkState] = useState<
    Array<{
      employeeId: string | number;
      employeeCode: string;
      name: string;
      dept: string;
      status: AttendanceStatus;
      checkIn: string;
      notes: string;
      existingId?: string | number;
    }>
  >([]);

  // Synchronize with Firestore on mount
  useEffect(() => {
    getAllAttendance().catch((err) => {
      console.warn('Failed initial attendance fetch:', err);
    });
  }, []);

  // Live queries from Dexie cache
  const employees = useLiveQuery(async () => newestFirst(await db.employees.toArray(), (e) => e.joiningDate), []) || [];
  const attendanceRecords = useLiveQuery(async () => newestFirst(await db.attendance.toArray(), (a) => a.date), []) || [];

  // Active employees list
  const activeEmployees = useMemo(() => {
    return employees.filter((e) => e.status !== 'Inactive');
  }, [employees]);

  // Map of attendance records for the selectedDate keyed by employeeId/code
  const dailyAttendanceMap = useMemo(() => {
    const map = new Map<string | number, AttendanceRecord>();
    attendanceRecords.forEach((r) => {
      if (r.date === selectedDate) {
        if (r.employeeId) map.set(String(r.employeeId), r);
        if (r.employeeCode) map.set(String(r.employeeCode), r);
      }
    });
    return map;
  }, [attendanceRecords, selectedDate]);

  // Statistics for Daily View / Current Date
  const dailyStats = useMemo(() => {
    const total = activeEmployees.length;
    let present = 0;
    let absent = 0;
    let onLeave = 0;
    let late = 0;
    let halfDay = 0;

    activeEmployees.forEach((emp) => {
      const rec =
        dailyAttendanceMap.get(String(emp.id)) ||
        dailyAttendanceMap.get(String(emp.employeeId));
      if (rec) {
        if (rec.status === 'Present') present++;
        else if (rec.status === 'Absent') absent++;
        else if (rec.status === 'On Leave') onLeave++;
        else if (rec.status === 'Late') late++;
        else if (rec.status === 'Half Day') halfDay++;
      }
    });

    const attended = present + late + halfDay * 0.5;
    const percentage = total > 0 ? Math.round((attended / total) * 100) : 0;

    return { total, present, absent, onLeave, late, halfDay, percentage };
  }, [activeEmployees, dailyAttendanceMap]);

  // Statistics for Monthly View / Selected Month
  const monthlyStats = useMemo(() => {
    const monthRecords = attendanceRecords.filter((r) => r.date.startsWith(selectedMonth));
    const totalEmp = activeEmployees.length;
    let present = 0;
    let absent = 0;
    let onLeave = 0;
    let late = 0;
    let halfDay = 0;

    monthRecords.forEach((r) => {
      if (r.status === 'Present') present++;
      else if (r.status === 'Absent') absent++;
      else if (r.status === 'On Leave') onLeave++;
      else if (r.status === 'Late') late++;
      else if (r.status === 'Half Day') halfDay++;
    });

    const totalDaysRecorded = monthRecords.length;
    const effectiveAttended = present + late + halfDay * 0.5;
    const percentage =
      totalDaysRecorded > 0
        ? Math.round((effectiveAttended / totalDaysRecorded) * 100)
        : 0;

    return {
      totalEmp,
      present,
      absent,
      onLeave,
      late,
      halfDay,
      totalDaysRecorded,
      percentage,
    };
  }, [attendanceRecords, selectedMonth, activeEmployees]);

  // Daily View Filtered Employees
  const filteredDailyEmployees = useMemo(() => {
    return activeEmployees.filter((emp) => {
      const q = search.toLowerCase().trim();
      const empName = (emp.name || '').toLowerCase();
      const empCode = (emp.employeeId || emp.id || '').toString().toLowerCase();

      const matchesSearch = !q || empName.includes(q) || empCode.includes(q);
      const rec =
        dailyAttendanceMap.get(String(emp.id)) ||
        dailyAttendanceMap.get(String(emp.employeeId));
      const currentStatus = rec ? rec.status : 'Unmarked';

      const matchesStatus = statusFilter === 'All' || currentStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [activeEmployees, search, statusFilter, dailyAttendanceMap]);

  // Monthly View Employee Summaries
  const monthlyEmployeeSummaries = useMemo(() => {
    const monthRecords = attendanceRecords.filter((r) => r.date.startsWith(selectedMonth));

    return activeEmployees
      .filter((emp) => {
        const q = search.toLowerCase().trim();
        const empName = (emp.name || '').toLowerCase();
        const empCode = (emp.employeeId || emp.id || '').toString().toLowerCase();
        const matchesSearch = !q || empName.includes(q) || empCode.includes(q);
        return matchesSearch;
      })
      .map((emp) => {
        const empRecs = monthRecords.filter(
          (r) =>
            String(r.employeeId) === String(emp.id) ||
            String(r.employeeCode) === String(emp.employeeId) ||
            r.employeeName.toLowerCase() === emp.name.toLowerCase()
        );

        let present = 0;
        let absent = 0;
        let onLeave = 0;
        let late = 0;
        let halfDay = 0;

        empRecs.forEach((r) => {
          if (r.status === 'Present') present++;
          else if (r.status === 'Absent') absent++;
          else if (r.status === 'On Leave') onLeave++;
          else if (r.status === 'Late') late++;
          else if (r.status === 'Half Day') halfDay++;
        });

        const totalMarked = empRecs.length;
        const effectiveAttended = present + late + halfDay * 0.5;
        const empPercentage =
          totalMarked > 0 ? Math.round((effectiveAttended / totalMarked) * 100) : 0;

        return {
          employee: emp,
          present,
          absent,
          onLeave,
          late,
          halfDay,
          totalMarked,
          empPercentage,
        };
      });
  }, [activeEmployees, attendanceRecords, selectedMonth, search]);

  // Single Modal Handlers
  const handleOpenMarkModal = (emp?: Employee, existingRec?: AttendanceRecord) => {
    setSingleErrors({});
    if (existingRec) {
      setEditingRecord(existingRec);
      setSingleForm({
        employeeId: existingRec.employeeId || emp?.id || '',
        date: existingRec.date || selectedDate,
        status: existingRec.status || 'Present',
        checkIn: toTimeInputValue(existingRec.checkIn),
        checkOut: toTimeInputValue(existingRec.checkOut),
        overtimeHours: existingRec.overtimeHours ? String(existingRec.overtimeHours) : '',
        notes: existingRec.notes || '',
      });
    } else if (emp) {
      const rec =
        dailyAttendanceMap.get(String(emp.id)) ||
        dailyAttendanceMap.get(String(emp.employeeId));
      if (rec) {
        setEditingRecord(rec);
        setSingleForm({
          employeeId: emp.id || emp.employeeId,
          date: rec.date,
          status: rec.status,
          checkIn: toTimeInputValue(rec.checkIn),
          checkOut: toTimeInputValue(rec.checkOut),
          overtimeHours: rec.overtimeHours ? String(rec.overtimeHours) : '',
          notes: rec.notes || '',
        });
      } else {
        setEditingRecord(null);
        setSingleForm({
          employeeId: emp.id || emp.employeeId,
          date: selectedDate,
          status: 'Present',
          checkIn: WORK_START,
          checkOut: '',
          overtimeHours: '',
          notes: '',
        });
      }
    } else {
      setEditingRecord(null);
      setSingleForm({
        employeeId: activeEmployees.length > 0 ? activeEmployees[0].id || '' : '',
        date: selectedDate,
        status: 'Present',
        checkIn: WORK_START,
        checkOut: '',
        overtimeHours: '',
        notes: '',
      });
    }
    setShowMarkModal(true);
  };

  const handleCloseMarkModal = () => {
    setShowMarkModal(false);
    setEditingRecord(null);
    setSingleErrors({});
  };

  const validateSingleForm = () => {
    const errs: Record<string, string> = {};
    if (!singleForm.employeeId) errs.employeeId = 'Please select an employee.';
    if (!singleForm.date) errs.date = 'Date is required.';
    if (!singleForm.status) errs.status = 'Status is required.';
    const ot = Number(singleForm.overtimeHours || 0);
    if (isNaN(ot) || ot < 0 || ot > 16) errs.overtimeHours = 'Overtime must be between 0 and 16 hours.';

    // Check duplicate if creating a new record for same employee + date
    if (!editingRecord) {
      const emp = activeEmployees.find(
        (e) => String(e.id) === String(singleForm.employeeId) || String(e.employeeId) === String(singleForm.employeeId)
      );
      if (emp) {
        const dup = attendanceRecords.find(
          (r) =>
            r.date === singleForm.date &&
            (String(r.employeeId) === String(emp.id) ||
              String(r.employeeCode) === String(emp.employeeId))
        );
        if (dup) {
          errs.employeeId = `An attendance record already exists for ${emp.name} on ${singleForm.date}. Edit the existing record instead.`;
        }
      }
    }

    return errs;
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateSingleForm();
    if (Object.keys(errs).length > 0) {
      setSingleErrors(errs);
      showToast('Please resolve validation errors before saving.', 'error');
      return;
    }

    const emp = activeEmployees.find(
      (e) => String(e.id) === String(singleForm.employeeId) || String(e.employeeId) === String(singleForm.employeeId)
    );
    if (!emp) {
      showToast('Selected employee was not found.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Omit<AttendanceRecord, 'id'> = {
        employeeId: emp.id,
        employeeCode: emp.employeeId || String(emp.id),
        employeeName: emp.name,
        dept: emp.dept,
        date: singleForm.date,
        status: singleForm.status,
        // Absent / On Leave days carry no times or overtime
        checkIn: statusHasTimes(singleForm.status) ? singleForm.checkIn.trim() : '',
        checkOut: statusHasTimes(singleForm.status) ? singleForm.checkOut.trim() : '',
        overtimeHours: statusHasTimes(singleForm.status) ? Number(singleForm.overtimeHours) || 0 : 0,
        notes: singleForm.notes.trim(),
      };

      if (editingRecord && editingRecord.id) {
        await updateAttendance(editingRecord.id, payload);
        showToast(`Attendance updated for ${emp.name}`, 'success');
      } else {
        await addAttendance(payload);
        showToast(`Attendance recorded for ${emp.name}`, 'success');
      }
      handleCloseMarkModal();
    } catch (err: any) {
      console.error('Failed to save attendance:', err);
      showToast(err?.message || 'Failed to save attendance.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Bulk Modal Handlers
  const handleOpenBulkModal = () => {
    if (activeEmployees.length === 0) {
      showToast('No active employees found to mark bulk attendance.', 'info');
      return;
    }

    const initialBulk = activeEmployees.map((emp) => {
      const rec =
        dailyAttendanceMap.get(String(emp.id)) ||
        dailyAttendanceMap.get(String(emp.employeeId));
      return {
        employeeId: emp.id || '',
        employeeCode: emp.employeeId || String(emp.id || ''),
        name: emp.name,
        dept: emp.dept || '',
        status: (rec?.status || 'Present') as AttendanceStatus,
        checkIn: rec ? toTimeInputValue(rec.checkIn) : defaultCheckInFor('Present'),
        notes: rec?.notes || '',
        existingId: rec?.id,
      };
    });

    setBulkState(initialBulk);
    setShowBulkModal(true);
  };

  const handleSetAllBulkStatus = (status: AttendanceStatus) => {
    setBulkState((prev) =>
      prev.map((item) => ({
        ...item,
        status,
        checkIn: defaultCheckInFor(status),
      }))
    );
  };

  const handleBulkSubmit = async () => {
    if (bulkState.length === 0) return;
    setIsSubmitting(true);
    try {
      const recordsToSave = bulkState.map((item) => {
        const hasTimes = statusHasTimes(item.status);
        return {
          existingId: item.existingId,
          record: {
            employeeId: item.employeeId,
            employeeCode: item.employeeCode,
            employeeName: item.name,
            dept: item.dept,
            date: selectedDate,
            status: item.status,
            checkIn: hasTimes ? item.checkIn.trim() : '',
            // Check-out is recorded at sign-off: keep an existing one, clear it only for Absent / On Leave
            ...(!hasTimes || !item.existingId ? { checkOut: '', overtimeHours: 0 } : {}),
            notes: item.notes.trim(),
          },
        };
      });

      await bulkSaveAttendance(recordsToSave);
      showToast(`Bulk attendance saved for ${recordsToSave.length} employees`, 'success');
      setShowBulkModal(false);
    } catch (err: any) {
      console.error('Failed bulk attendance save:', err);
      showToast(err?.message || 'Failed to save bulk attendance', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pending late check-in / long lunch / check-out requests from employees, newest first
  const pendingApprovals = useMemo(
    () =>
      attendanceRecords
        .flatMap((rec) => pendingRequests(rec).map((p) => ({ rec, ...p, key: `${rec.id}:${p.kind}` })))
        .sort((a, b) => b.rec.date.localeCompare(a.rec.date) || b.request.requestedAt.localeCompare(a.request.requestedAt)),
    [attendanceRecords]
  );

  const handleDecide = async (rec: AttendanceRecord, kind: RequestKind, approve: boolean) => {
    const key = `${rec.id}:${kind}`;
    setDecidingKey(key);
    try {
      await decideAttendanceRequest(rec, kind, approve, adminName, remarks[key] || '');
      showToast(`${REQUEST_LABELS[kind]} for ${rec.employeeName} ${approve ? 'approved' : 'rejected'}.`, approve ? 'success' : 'info');
      setRemarks((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err: any) {
      showToast(err?.message || 'Could not save the decision.', 'error');
    } finally {
      setDecidingKey('');
    }
  };

  const openCheckOut = (rec: AttendanceRecord) => {
    setCheckOutTarget(rec);
    setCheckOutTime(rec.checkOutRequest?.status === 'Pending' ? rec.checkOutRequest.time : toHHMM(new Date()));
  };

  const handleAdminCheckOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkOutTarget?.id) return;
    if (!checkOutTime) {
      showToast('Please enter the check-out time.', 'error');
      return;
    }
    if (checkOutTarget.checkIn && minutesOf(checkOutTime) <= minutesOf(checkOutTarget.checkIn)) {
      showToast('Check-out must be after the check-in time.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const pending = checkOutTarget.checkOutRequest?.status === 'Pending' ? checkOutTarget.checkOutRequest : null;
      await updateAttendance(checkOutTarget.id, {
        checkOut: checkOutTime,
        overtimeHours: overtimeFor(checkOutTime),
        // Closing the day from here also settles any check-out request the employee sent
        ...(pending
          ? { checkOutRequest: { ...pending, status: 'Approved' as const, decidedAt: new Date().toISOString(), decidedBy: adminName } }
          : {}),
      });
      showToast(`${checkOutTarget.employeeName} checked out at ${formatTime12h(checkOutTime)}.`, 'success');
      setCheckOutTarget(null);
    } catch (err: any) {
      showToast(err?.message || 'Check-out failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openNetworkModal = async () => {
    setNetworkDraft({ requireOfficeNetwork: policy.requireOfficeNetwork, networks: [...policy.networks] });
    setNewNetworkLabel('');
    setCurrentIp('');
    setIpError('');
    setShowNetworkModal(true);
    try {
      setCurrentIp(await getPublicIp());
    } catch (err: any) {
      setIpError(err?.message || 'Could not detect this network.');
    }
  };

  const handleAddCurrentNetwork = () => {
    if (!currentIp || networkDraft.networks.some((n) => n.ip === currentIp)) return;
    setNetworkDraft((prev) => ({
      requireOfficeNetwork: true,
      networks: [
        ...prev.networks,
        { ip: currentIp, label: newNetworkLabel.trim() || 'Office WiFi', addedAt: new Date().toISOString() },
      ],
    }));
    setNewNetworkLabel('');
  };

  const handleSaveNetwork = async () => {
    if (networkDraft.requireOfficeNetwork && networkDraft.networks.length === 0) {
      showToast('Add at least one office network, or turn the restriction off.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      await saveAttendancePolicy(networkDraft, adminName);
      showToast('Office network settings saved.', 'success');
      setShowNetworkModal(false);
    } catch (err: any) {
      showToast(err?.message || 'Could not save office network settings.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Handler
  const handleConfirmDelete = async () => {
    if (!recordToDelete || !recordToDelete.id) return;
    setIsDeleting(true);
    try {
      await deleteAttendance(recordToDelete.id);
      showToast('Attendance record deleted successfully', 'info');
      setRecordToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete attendance record:', err);
      showToast(err?.message || 'Failed to delete attendance record', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'Present':
        return 'badge-green';
      case 'Absent':
        return 'badge-red';
      case 'On Leave':
        return 'badge-amber';
      case 'Late':
        return 'badge-amber';
      case 'Half Day':
        return 'badge-blue';
      default:
        return 'badge-gray';
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Calendar size={22} style={{ color: '#3B5BDB' }} />
            Attendance Management
          </div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Track daily attendance, working hours, and monthly summaries
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <button
              className="btn-secondary"
              style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={openNetworkModal}
              title="Limit employee check-in / lunch / check-out to the office WiFi"
            >
              <Wifi size={14} style={{ color: policy.requireOfficeNetwork && policy.networks.length ? '#12B76A' : '#697586' }} />
              Office Network
            </button>
          )}
          {activeEmployees.length > 0 && (
            <>
              <button
                className="btn-secondary"
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={handleOpenBulkModal}
              >
                <CheckSquare size={14} /> Bulk Attendance
              </button>
              <button
                className="btn-primary"
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => handleOpenMarkModal()}
              >
                <Plus size={15} /> Mark Attendance
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {activeTab === 'daily' ? (
          <>
            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#697586',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Users size={14} /> Total Active
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#1A1F36',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {dailyStats.total}
              </div>
            </div>

            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#697586',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <UserCheck size={14} style={{ color: '#12B76A' }} /> Present
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#12B76A',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {dailyStats.present}
              </div>
            </div>

            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#697586',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <UserX size={14} style={{ color: '#F04438' }} /> Absent
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#F04438',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {dailyStats.absent}
              </div>
            </div>

            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#697586',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Clock size={14} style={{ color: '#F59E0B' }} /> Late / Half Day
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#F59E0B',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {dailyStats.late + dailyStats.halfDay}
              </div>
            </div>

            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#697586',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CheckCircle2 size={14} style={{ color: '#3B5BDB' }} /> Attendance Rate
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#3B5BDB',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {dailyStats.percentage}%
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#697586',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                }}
              >
                Total Records
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#1A1F36',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {monthlyStats.totalDaysRecorded}
              </div>
            </div>

            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  color: '#12B76A',
                }}
              >
                Total Present
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#12B76A',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {monthlyStats.present}
              </div>
            </div>

            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  color: '#F04438',
                }}
              >
                Total Absent
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#F04438',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {monthlyStats.absent}
              </div>
            </div>

            <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  color: '#3B5BDB',
                }}
              >
                Monthly Avg Rate
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#3B5BDB',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {monthlyStats.percentage}%
              </div>
            </div>
          </>
        )}
      </div>

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="card" style={{ marginBottom: 20, border: '1px solid #FEDF89' }}>
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #FEDF89',
              background: '#FFFAEB',
              borderRadius: '12px 12px 0 0',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 700,
              fontSize: 14,
              color: '#B54708',
            }}
          >
            <Hourglass size={15} /> Pending Approvals ({pendingApprovals.length})
            <span style={{ fontWeight: 500, fontSize: 12, color: '#697586' }}>
              · Late check-ins, long lunch breaks and early / incomplete-task check-outs
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>EMPLOYEE</th>
                  <th>DATE</th>
                  <th>REQUEST</th>
                  <th>TIME</th>
                  <th>WHY IT NEEDS APPROVAL</th>
                  <th>EMPLOYEE'S REASON</th>
                  <th>REMARKS</th>
                  <th style={{ textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {pendingApprovals.map(({ rec, kind, request, key }) => (
                  <tr key={key}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{rec.employeeName}</div>
                      <div style={{ fontSize: 11.5, color: '#697586' }}>{rec.employeeCode}</div>
                    </td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{rec.date}</td>
                    <td>
                      <span className="badge badge-amber">{REQUEST_LABELS[kind]}</span>
                    </td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                      {kind === 'lunchRequest' ? formatLunch(rec) : formatTime12h(request.time)}
                    </td>
                    <td style={{ fontSize: 12, color: '#B54708', maxWidth: 260 }}>
                      {request.reasons.map((r) => (
                        <div key={r}>• {r}</div>
                      ))}
                    </td>
                    <td style={{ fontSize: 12.5, color: '#475569', maxWidth: 220 }}>{request.note || '—'}</td>
                    <td>
                      <input
                        className="input-base"
                        style={{ fontSize: 12, padding: '4px 8px', width: 150 }}
                        placeholder="Optional"
                        value={remarks[key] || ''}
                        onChange={(e) => setRemarks((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ fontSize: 11.5, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                          disabled={decidingKey === key}
                          onClick={() => handleDecide(rec, kind, true)}
                        >
                          <CheckCircle2 size={12} /> Approve
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 10px', color: '#EF4444', borderColor: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 4 }}
                          disabled={decidingKey === key}
                          onClick={() => handleDecide(rec, kind, false)}
                        >
                          <XCircle size={12} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 16px', fontSize: 11.5, color: '#697586' }}>
            Approving a late check-in marks the day Late; rejecting it marks the day Absent. Approving a check-out records it at the
            time the employee asked; rejecting keeps them checked in.
          </div>
        </div>
      )}

      {/* Tabs & Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #E5E9F2',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {/* Tab buttons */}
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 3, borderRadius: 8 }}>
            <button
              type="button"
              style={{
                border: 'none',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: activeTab === 'daily' ? '#FFFFFF' : 'transparent',
                color: activeTab === 'daily' ? '#1A1F36' : '#697586',
                boxShadow: activeTab === 'daily' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onClick={() => setActiveTab('daily')}
            >
              <Calendar size={14} /> Daily View
            </button>
            <button
              type="button"
              style={{
                border: 'none',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: activeTab === 'monthly' ? '#FFFFFF' : 'transparent',
                color: activeTab === 'monthly' ? '#1A1F36' : '#697586',
                boxShadow: activeTab === 'monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onClick={() => setActiveTab('monthly')}
            >
              <CalendarDays size={14} /> Monthly View
            </button>
          </div>

          {/* Filters & Selector */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {activeTab === 'daily' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586' }}>Date:</span>
                <input
                  type="date"
                  className="input-base"
                  style={{ fontSize: 13, width: 150 }}
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586' }}>Month:</span>
                <input
                  type="month"
                  className="input-base"
                  style={{ fontSize: 13, width: 160 }}
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                />
              </div>
            )}

            <div style={{ position: 'relative', width: 200 }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#697586',
                }}
              />
              <input
                className="input-base"
                style={{ paddingLeft: 30, fontSize: 13, width: '100%' }}
                placeholder="Search employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {activeTab === 'daily' && (
              <select
                className="select-base"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ fontSize: 13 }}
              >
                <option value="All">All Status</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="On Leave">On Leave</option>
                <option value="Late">Late</option>
                <option value="Half Day">Half Day</option>
                <option value="Unmarked">Unmarked</option>
              </select>
            )}
          </div>
        </div>

        {/* Content Table */}
        {activeTab === 'daily' ? (
          <table className="table-base">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>EMPLOYEE ID</th>
                <th>STATUS</th>
                <th>CHECK-IN</th>
                <th>LUNCH</th>
                <th>CHECK-OUT</th>
                <th>OVERTIME</th>
                <th>NOTES</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '40px 20px', color: '#697586' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <AlertCircle size={32} style={{ color: '#94A3B8' }} />
                      <div style={{ fontWeight: 600, color: '#1A1F36', fontSize: 15 }}>No Employees Found</div>
                      <div style={{ fontSize: 13, maxWidth: 420 }}>
                        No active employee records exist in the system. Please add employees in the Employees module first to mark attendance.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filteredDailyEmployees.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: '#697586' }}>
                    No matching attendance records found for date <strong>{selectedDate}</strong>.
                  </td>
                </tr>
              ) : (
                filteredDailyEmployees.map((emp) => {
                  const initials = (emp.name || '')
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() || 'EM';

                  const rec =
                    dailyAttendanceMap.get(String(emp.id)) ||
                    dailyAttendanceMap.get(String(emp.employeeId));

                  const currentStatus = rec ? rec.status : 'Unmarked';
                  const badgeClass = getStatusBadgeStyle(currentStatus);

                  return (
                    <tr key={emp.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: '50%',
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
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{emp.name}</div>
                            <div style={{ fontSize: 11.5, color: '#697586' }}>{emp.role}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5, color: '#3B5BDB', fontWeight: 600 }}>
                        {emp.employeeId || emp.id}
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`}>{currentStatus}</span>
                        {rec && <AttendanceRequestBadges rec={rec} />}
                      </td>
                      <td style={{ fontSize: 13, color: '#697586' }}>{formatTime12h(rec?.checkIn)}</td>
                      <td
                        style={{
                          fontSize: 12.5,
                          whiteSpace: 'nowrap',
                          color: rec && (lunchMinutes(rec) || 0) > LUNCH_MAX_MINUTES ? '#EF4444' : '#697586',
                        }}
                      >
                        {rec ? formatLunch(rec) : '—'}
                      </td>
                      <td style={{ fontSize: 13, color: '#697586' }}>{formatTime12h(rec?.checkOut)}</td>
                      <td style={{ fontSize: 13, color: rec?.overtimeHours ? '#3B5BDB' : '#697586', fontWeight: rec?.overtimeHours ? 600 : 400 }}>
                        {rec?.overtimeHours ? `${rec.overtimeHours}h` : '—'}
                      </td>
                      <td style={{ fontSize: 12.5, color: '#697586', maxWidth: 160 }}>
                        {rec?.notes || '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {rec && isCheckedIn(rec) && !rec.checkOut && (
                            <button
                              type="button"
                              className="btn-primary"
                              style={{ fontSize: 11.5, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                              onClick={() => openCheckOut(rec)}
                            >
                              <LogOut size={12} /> Check Out
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => handleOpenMarkModal(emp, rec)}
                          >
                            <Edit3 size={12} /> {rec ? 'Edit' : 'Mark'}
                          </button>
                          {rec && rec.id && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{
                                fontSize: 11.5,
                                padding: '4px 8px',
                                color: '#EF4444',
                                borderColor: '#FCA5A5',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                              onClick={() => setRecordToDelete(rec)}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          /* Monthly Summary View */
          <table className="table-base">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>EMPLOYEE ID</th>
                <th style={{ textAlign: 'center' }}>PRESENT</th>
                <th style={{ textAlign: 'center' }}>ABSENT</th>
                <th style={{ textAlign: 'center' }}>ON LEAVE</th>
                <th style={{ textAlign: 'center' }}>LATE</th>
                <th style={{ textAlign: 'center' }}>HALF DAY</th>
                <th style={{ textAlign: 'right' }}>MONTHLY RATE</th>
              </tr>
            </thead>
            <tbody>
              {monthlyEmployeeSummaries.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: '#697586' }}>
                    No matching monthly attendance records found for {selectedMonth}.
                  </td>
                </tr>
              ) : (
                monthlyEmployeeSummaries.map((item) => {
                  const emp = item.employee;
                  const initials = (emp.name || '')
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() || 'EM';

                  return (
                    <tr key={emp.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: '50%',
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
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{emp.name}</div>
                            <div style={{ fontSize: 11.5, color: '#697586' }}>{emp.role}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5, color: '#3B5BDB', fontWeight: 600 }}>
                        {emp.employeeId || emp.id}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#12B76A' }}>
                        {item.present}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#F04438' }}>
                        {item.absent}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: '#F59E0B' }}>
                        {item.onLeave}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: '#F59E0B' }}>
                        {item.late}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: '#3B5BDB' }}>
                        {item.halfDay}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        <span
                          className={`badge ${
                            item.empPercentage >= 85
                              ? 'badge-green'
                              : item.empPercentage >= 70
                              ? 'badge-blue'
                              : 'badge-amber'
                          }`}
                        >
                          {item.empPercentage}%
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Mark / Edit Single Attendance Modal */}
      {showMarkModal && (
        <div className="modal-overlay" onClick={handleCloseMarkModal}>
          <div className="modal-box" style={{ width: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 16 }}>
                {editingRecord ? 'Edit Attendance Record' : 'Mark Attendance'}
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={handleCloseMarkModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSingleSubmit} noValidate>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Employee Select */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Employee <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: singleErrors.employeeId ? '#EF4444' : undefined }}
                    value={singleForm.employeeId}
                    disabled={!!editingRecord}
                    onChange={(e) => {
                      setSingleForm((prev) => ({ ...prev, employeeId: e.target.value }));
                      if (singleErrors.employeeId) setSingleErrors((prev) => ({ ...prev, employeeId: '' }));
                    }}
                  >
                    <option value="">Select Employee...</option>
                    {activeEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id || emp.employeeId}>
                        {emp.name} ({emp.employeeId || emp.id})
                      </option>
                    ))}
                  </select>
                  {singleErrors.employeeId && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{singleErrors.employeeId}</div>
                  )}
                </div>

                {/* Date */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Date <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="input-base"
                    style={{ width: '100%', borderColor: singleErrors.date ? '#EF4444' : undefined }}
                    value={singleForm.date}
                    disabled={!!editingRecord}
                    onChange={(e) => {
                      setSingleForm((prev) => ({ ...prev, date: e.target.value }));
                      if (singleErrors.date) setSingleErrors((prev) => ({ ...prev, date: '' }));
                    }}
                  />
                  {singleErrors.date && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{singleErrors.date}</div>
                  )}
                </div>

                {/* Status */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Status <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: singleErrors.status ? '#EF4444' : undefined }}
                    value={singleForm.status}
                    onChange={(e) => {
                      const status = e.target.value as AttendanceStatus;
                      setSingleForm((prev) => ({
                        ...prev,
                        status,
                        checkIn: defaultCheckInFor(status),
                        checkOut: statusHasTimes(status) ? prev.checkOut : '',
                        overtimeHours: statusHasTimes(status) ? prev.overtimeHours : '',
                      }));
                      if (singleErrors.status) setSingleErrors((prev) => ({ ...prev, status: '' }));
                    }}
                  >
                    <option value="Present">Present</option>
                    <option value="Absent">Absent</option>
                    <option value="On Leave">On Leave</option>
                    <option value="Late">Late</option>
                    <option value="Half Day">Half Day</option>
                  </select>
                </div>

                {/* Check-in only; check-out is recorded from the list when the employee signs off.
                    Check-out & overtime are editable only on a day that was already checked out. */}
                {statusHasTimes(singleForm.status) ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                        Check-In Time
                      </label>
                      <input
                        type="time"
                        className="input-base"
                        style={{ width: '100%' }}
                        value={singleForm.checkIn}
                        onChange={(e) => setSingleForm((prev) => ({ ...prev, checkIn: e.target.value }))}
                      />
                    </div>
                    {editingRecord?.checkOut ? (
                    <>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                        Check-Out Time
                      </label>
                      <input
                        type="time"
                        className="input-base"
                        style={{ width: '100%' }}
                        value={singleForm.checkOut}
                        onChange={(e) => setSingleForm((prev) => ({ ...prev, checkOut: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                        Overtime (hrs)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="16"
                        step="0.5"
                        className="input-base"
                        placeholder="0"
                        style={{ width: '100%', borderColor: singleErrors.overtimeHours ? '#EF4444' : undefined }}
                        value={singleForm.overtimeHours}
                        onChange={(e) => setSingleForm((prev) => ({ ...prev, overtimeHours: e.target.value }))}
                      />
                    </div>
                    </>
                    ) : null}
                    {singleErrors.overtimeHours && (
                      <div style={{ gridColumn: 'span 3', color: '#EF4444', fontSize: 11.5 }}>{singleErrors.overtimeHours}</div>
                    )}
                    <div style={{ gridColumn: 'span 3', fontSize: 11.5, color: '#697586', marginTop: -4 }}>
                      Working hours are 9:00 AM – 6:00 PM (half day: 2:00 PM – 6:00 PM).{' '}
                      {editingRecord?.checkOut
                        ? 'Time after 6:00 PM counts as overtime.'
                        : 'Check-out is recorded later from the list (or by the employee) when they sign off.'}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#697586', background: '#F8F9FC', border: '1px solid #E5E9F2', borderRadius: 8, padding: '8px 12px' }}>
                    No check-in / check-out time is recorded for {singleForm.status}.
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Notes / Remarks
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    placeholder="Optional remarks (e.g. Approved leave / Remote)"
                    style={{ width: '100%' }}
                    value={singleForm.notes}
                    onChange={(e) => setSingleForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={handleCloseMarkModal} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : editingRecord ? 'Update Record' : 'Save Attendance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Attendance Modal */}
      {showBulkModal && (
        <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
          <div className="modal-box" style={{ width: 800, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E9F2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 16 }}>
                  Bulk Attendance for {selectedDate}
                </div>
                <div style={{ fontSize: 12, color: '#697586', marginTop: 2 }}>
                  Set attendance status for all {bulkState.length} active employees at once
                </div>
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={() => setShowBulkModal(false)}
              >
                ×
              </button>
            </div>

            {/* Quick Bulk Actions */}
            <div style={{ padding: '12px 24px', background: '#F8FAFC', borderBottom: '1px solid #E5E9F2', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#475569' }}>Set All Status:</span>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 11.5, padding: '3px 10px' }}
                onClick={() => handleSetAllBulkStatus('Present')}
              >
                All Present
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 11.5, padding: '3px 10px' }}
                onClick={() => handleSetAllBulkStatus('Absent')}
              >
                All Absent
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 11.5, padding: '3px 10px' }}
                onClick={() => handleSetAllBulkStatus('On Leave')}
              >
                All On Leave
              </button>
            </div>

            {/* Bulk Table */}
            <div style={{ overflowY: 'auto', padding: '0 24px', flex: 1, maxHeight: 420 }}>
              <table className="table-base" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>EMPLOYEE</th>
                    <th>STATUS</th>
                    <th>CHECK-IN</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkState.map((item, idx) => (
                    <tr key={item.employeeId}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: '#697586' }}>
                          {item.employeeCode}
                        </div>
                      </td>
                      <td>
                        <select
                          className="select-base"
                          style={{ fontSize: 12.5, padding: '4px 8px' }}
                          value={item.status}
                          onChange={(e) => {
                            const val = e.target.value as AttendanceStatus;
                            setBulkState((prev) =>
                              prev.map((row, i) =>
                                i === idx
                                  ? { ...row, status: val, checkIn: defaultCheckInFor(val) }
                                  : row
                              )
                            );
                          }}
                        >
                          <option value="Present">Present</option>
                          <option value="Absent">Absent</option>
                          <option value="On Leave">On Leave</option>
                          <option value="Late">Late</option>
                          <option value="Half Day">Half Day</option>
                        </select>
                      </td>
                      {statusHasTimes(item.status) ? (
                        <>
                          <td>
                            <input
                              type="time"
                              className="input-base"
                              style={{ fontSize: 12, padding: '4px 8px', width: 110 }}
                              value={item.checkIn}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBulkState((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, checkIn: val } : row))
                                );
                              }}
                            />
                          </td>
                        </>
                      ) : (
                        <td style={{ fontSize: 12, color: '#94A3B8' }}>
                          No time for {item.status}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E9F2', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowBulkModal(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleBulkSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving Batch...' : 'Save Bulk Attendance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check-Out Modal (from the daily list) */}
      {checkOutTarget && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setCheckOutTarget(null)}>
          <div className="modal-box" style={{ width: 400, maxWidth: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              Check Out {checkOutTarget.employeeName}
            </div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 16 }}>
              {checkOutTarget.date} · Checked in at {formatTime12h(checkOutTarget.checkIn)}
              {checkOutTarget.lunchOut ? ` · Lunch ${formatLunch(checkOutTarget)}` : ''}
            </div>
            {checkOutTarget.checkOutRequest?.status === 'Pending' && (
              <div style={{ fontSize: 12, color: '#B54708', background: '#FFFAEB', border: '1px solid #FEDF89', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
                This employee asked to check out at {formatTime12h(checkOutTarget.checkOutRequest.time)}. Saving approves that request.
              </div>
            )}
            <form onSubmit={handleAdminCheckOut}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Check-Out Time</label>
              <input
                type="time"
                className="input-base"
                style={{ width: '100%' }}
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
              />
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 6 }}>
                {overtimeFor(checkOutTime) > 0 ? `${overtimeFor(checkOutTime)}h overtime will be recorded.` : 'Time after 6:00 PM counts as overtime.'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={() => setCheckOutTarget(null)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Check Out'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Office Network Modal */}
      {showNetworkModal && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setShowNetworkModal(false)}>
          <div className="modal-box" style={{ width: 520, maxWidth: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Wifi size={17} style={{ color: '#3B5BDB' }} /> Office Network
            </div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 16, lineHeight: 1.5 }}>
              Employees can check in, take lunch and check out only from these networks. Browsers can't read WiFi names, so a
              network is identified by its public internet address. Every device on the office WiFi shares it.
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#1A1F36', cursor: 'pointer', marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={networkDraft.requireOfficeNetwork}
                onChange={(e) => setNetworkDraft((prev) => ({ ...prev, requireOfficeNetwork: e.target.checked }))}
              />
              Require office WiFi for employee check-in, lunch and check-out
            </label>

            <div style={{ background: '#F8F9FC', border: '1px solid #E5E9F2', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>This device's network</div>
              {ipError ? (
                <div style={{ fontSize: 12.5, color: '#EF4444' }}>{ipError}</div>
              ) : !currentIp ? (
                <div style={{ fontSize: 12.5, color: '#697586' }}>Detecting…</div>
              ) : networkDraft.networks.some((n) => n.ip === currentIp) ? (
                <div style={{ fontSize: 12.5, color: '#12B76A', fontWeight: 600 }}>{currentIp} · already an office network</div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1A1F36' }}>{currentIp}</span>
                  <input
                    className="input-base"
                    style={{ fontSize: 12.5, flex: '1 1 140px' }}
                    placeholder="Label, e.g. Office WiFi"
                    value={newNetworkLabel}
                    onChange={(e) => setNewNetworkLabel(e.target.value)}
                  />
                  <button type="button" className="btn-primary" style={{ fontSize: 12.5 }} onClick={handleAddCurrentNetwork}>
                    <Plus size={13} style={{ verticalAlign: -2 }} /> Add this network
                  </button>
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Allowed networks</div>
            {networkDraft.networks.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 6 }}>
                None yet. Open this screen on a device connected to the office WiFi and click "Add this network".
              </div>
            ) : (
              networkDraft.networks.map((n) => (
                <div
                  key={n.ip}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #E5E9F2', fontSize: 13 }}
                >
                  <span>
                    <strong>{n.label}</strong> <span style={{ color: '#697586' }}>· {n.ip}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 11.5, padding: '3px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                    onClick={() => setNetworkDraft((prev) => ({ ...prev, networks: prev.networks.filter((x) => x.ip !== n.ip) }))}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
            <div style={{ fontSize: 11.5, color: '#697586', marginTop: 10, lineHeight: 1.5 }}>
              If your internet provider changes the office address (for example after a router restart) employees will be blocked.
              Open this screen from the office and add the new network.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowNetworkModal(false)} disabled={isSubmitting}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSaveNetwork} disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shared Delete Confirmation Modal */}
      {recordToDelete && (
        <DeleteConfirmationModal
          isOpen={!!recordToDelete}
          title="Delete Attendance Record"
          itemName={`${recordToDelete.employeeName} (${recordToDelete.date})`}
          description={
            <>
              Are you sure you want to delete attendance record for <strong style={{ color: '#1A1F36' }}>{recordToDelete.employeeName}</strong> on <strong style={{ color: '#1A1F36' }}>{recordToDelete.date}</strong>? This action will permanently remove the entry from Firestore.
            </>
          }
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={() => setRecordToDelete(null)}
        />
      )}
    </div>
  );
}
