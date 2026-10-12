import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee, type Project, type TimesheetEntry } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  getAllTimesheets,
  addTimesheet,
  updateTimesheet,
  deleteTimesheet,
} from '../services/timesheetService';
import { useToast } from '../context/ToastContext';
import {
  Clock,
  Calendar,
  DollarSign,
  CheckCircle2,
  XCircle,
  Plus,
  Search,
  Edit3,
  Trash2,
  Users,
  Briefcase,
  CalendarDays,
  AlertCircle,
  CheckSquare,
} from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

type PeriodMode = 'daily' | 'weekly' | 'monthly';

interface FormState {
  employeeId: string | number;
  projectId: string | number;
  date: string;
  taskDescription: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes: string | number;
  isBillable: boolean;
  notes: string;
}

/**
 * Calculates net worked hours from start time, end time, and break duration in minutes.
 * Supports HH:mm and hh:mm AM/PM formats.
 */
export function calculateDurationHours(
  startStr: string,
  endStr: string,
  breakMins: number = 0
): number {
  if (!startStr || !endStr) return 0;

  const parseToMinutes = (timeStr: string): number | null => {
    const clean = timeStr.trim().toUpperCase();
    if (!clean) return null;

    const match12 = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (match12) {
      let hrs = parseInt(match12[1], 10);
      const mins = parseInt(match12[2], 10);
      const period = match12[3];
      if (hrs === 12) hrs = 0;
      if (period === 'PM') hrs += 12;
      return hrs * 60 + mins;
    }

    const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      const hrs = parseInt(match24[1], 10);
      const mins = parseInt(match24[2], 10);
      return hrs * 60 + mins;
    }

    return null;
  };

  const startMins = parseToMinutes(startStr);
  const endMins = parseToMinutes(endStr);

  if (startMins === null || endMins === null) return 0;
  if (endMins <= startMins) return 0;

  const totalMins = endMins - startMins - (Number(breakMins) || 0);
  if (totalMins <= 0) return 0;

  return Math.round((totalMins / 60) * 10) / 10;
}

export default function Timesheets() {
  const { showToast } = useToast();

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const [periodMode, setPeriodMode] = useState<PeriodMode>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);

  // Filters
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [billableFilter, setBillableFilter] = useState('All');
  const [search, setSearch] = useState('');

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimesheetEntry | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<TimesheetEntry | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form state
  const [form, setForm] = useState<FormState>({
    employeeId: '',
    projectId: '',
    date: todayStr,
    taskDescription: '',
    startTime: '09:00',
    endTime: '17:30',
    breakDurationMinutes: 30,
    isBillable: true,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Synchronize from Firestore on mount
  useEffect(() => {
    getAllTimesheets().catch((err) => {
      console.warn('Initial timesheets fetch error:', err);
    });
  }, []);

  // Live queries from Dexie cache
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const timesheetRecords = useLiveQuery(async () => newestFirst(await db.timesheets.toArray(), (t) => t.date), []) || [];

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => e.status !== 'Inactive');
  }, [employees]);

  // Calculated duration for modal form
  const computedFormHours = useMemo(() => {
    return calculateDurationHours(
      form.startTime,
      form.endTime,
      Number(form.breakDurationMinutes) || 0
    );
  }, [form.startTime, form.endTime, form.breakDurationMinutes]);

  // Filter entries based on PeriodMode and selected date/month
  const periodFilteredEntries = useMemo(() => {
    return timesheetRecords.filter((rec) => {
      if (periodMode === 'daily') {
        return rec.date === selectedDate;
      } else if (periodMode === 'monthly') {
        return rec.date.startsWith(selectedMonth);
      } else if (periodMode === 'weekly') {
        // Calculate week bounds (Monday to Sunday for selectedDate)
        const target = new Date(selectedDate);
        if (isNaN(target.getTime())) return true;
        const day = target.getDay(); // 0 is Sun, 1 is Mon...
        const diffToMon = target.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(target.setDate(diffToMon));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const monStr = monday.toISOString().split('T')[0];
        const sunStr = sunday.toISOString().split('T')[0];
        return rec.date >= monStr && rec.date <= sunStr;
      }
      return true;
    });
  }, [timesheetRecords, periodMode, selectedDate, selectedMonth]);

  // Apply search and dropdown filters
  const filteredEntries = useMemo(() => {
    return periodFilteredEntries.filter((rec) => {
      const q = search.toLowerCase().trim();
      const empMatch = !q || (rec.employeeName || '').toLowerCase().includes(q);
      const projMatch = !q || (rec.projectName || '').toLowerCase().includes(q);
      const taskMatch = !q || (rec.taskDescription || '').toLowerCase().includes(q);
      const matchesSearch = empMatch || projMatch || taskMatch;

      const matchesEmp =
        employeeFilter === 'All' || String(rec.employeeId) === String(employeeFilter);
      const matchesProj =
        projectFilter === 'All' || String(rec.projectId) === String(projectFilter);
      const matchesBillable =
        billableFilter === 'All' ||
        (billableFilter === 'Billable' && rec.isBillable) ||
        (billableFilter === 'Non-Billable' && !rec.isBillable);

      return matchesSearch && matchesEmp && matchesProj && matchesBillable;
    });
  }, [periodFilteredEntries, search, employeeFilter, projectFilter, billableFilter]);

  // Summary Metrics calculated purely from filtered real timesheet data
  const summaryMetrics = useMemo(() => {
    const totalHours = filteredEntries.reduce((sum, r) => sum + (Number(r.totalHours) || 0), 0);
    const billableHours = filteredEntries
      .filter((r) => r.isBillable)
      .reduce((sum, r) => sum + (Number(r.totalHours) || 0), 0);
    const nonBillableHours = filteredEntries
      .filter((r) => !r.isBillable)
      .reduce((sum, r) => sum + (Number(r.totalHours) || 0), 0);

    const uniqueEmployees = new Set(filteredEntries.map((r) => String(r.employeeId))).size;
    const uniqueDates = new Set(filteredEntries.map((r) => r.date)).size;

    const avgHoursPerDay =
      uniqueDates > 0 ? Math.round((totalHours / uniqueDates) * 10) / 10 : 0;

    return {
      totalHours: Math.round(totalHours * 10) / 10,
      billableHours: Math.round(billableHours * 10) / 10,
      nonBillableHours: Math.round(nonBillableHours * 10) / 10,
      activeEmployees: uniqueEmployees,
      avgHoursPerDay,
    };
  }, [filteredEntries]);

  // Modal handlers
  const handleOpenAddModal = () => {
    if (activeEmployees.length === 0) {
      showToast('Please add active employees in the Employees module first.', 'info');
      return;
    }
    if (projects.length === 0) {
      showToast('Please add projects in the Projects module first.', 'info');
      return;
    }

    setEditingEntry(null);
    setForm({
      employeeId: activeEmployees[0]?.id || activeEmployees[0]?.employeeId || '',
      projectId: projects[0]?.id || '',
      date: selectedDate,
      taskDescription: '',
      startTime: '09:00',
      endTime: '17:30',
      breakDurationMinutes: 30,
      isBillable: true,
      notes: '',
    });
    setErrors({});
    setShowModal(true);
  };

  const handleOpenEditModal = (entry: TimesheetEntry) => {
    setEditingEntry(entry);
    setForm({
      employeeId: entry.employeeId || '',
      projectId: entry.projectId || '',
      date: entry.date || todayStr,
      taskDescription: entry.taskDescription || '',
      startTime: entry.startTime || '09:00',
      endTime: entry.endTime || '17:30',
      breakDurationMinutes: entry.breakDurationMinutes ?? 0,
      isBillable: entry.isBillable ?? true,
      notes: entry.notes || '',
    });
    setErrors({});
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEntry(null);
    setErrors({});
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.employeeId) errs.employeeId = 'Employee selection is required.';
    if (!form.projectId) errs.projectId = 'Project selection is required.';
    if (!form.date) errs.date = 'Date is required.';
    if (!form.taskDescription.trim()) errs.taskDescription = 'Work description is required.';
    if (!form.startTime.trim()) errs.startTime = 'Start time is required.';
    if (!form.endTime.trim()) errs.endTime = 'End time is required.';

    const duration = calculateDurationHours(
      form.startTime,
      form.endTime,
      Number(form.breakDurationMinutes) || 0
    );

    if (duration <= 0) {
      errs.endTime = 'End time must be after Start time and result in worked hours > 0.';
    }

    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateForm();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      showToast('Please resolve validation errors before saving.', 'error');
      return;
    }

    const emp = activeEmployees.find((e) => String(e.id) === String(form.employeeId) || String(e.employeeId) === String(form.employeeId));
    const proj = projects.find((p) => String(p.id) === String(form.projectId));

    if (!emp) {
      showToast('Selected employee not found.', 'error');
      return;
    }
    if (!proj) {
      showToast('Selected project not found.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const workedHours = calculateDurationHours(
        form.startTime,
        form.endTime,
        Number(form.breakDurationMinutes) || 0
      );

      const payload: Omit<TimesheetEntry, 'id'> = {
        employeeId: emp.id || emp.employeeId,
        employeeName: emp.name,
        projectId: proj.id || '',
        projectName: proj.name,
        date: form.date,
        taskDescription: form.taskDescription.trim(),
        startTime: form.startTime.trim(),
        endTime: form.endTime.trim(),
        breakDurationMinutes: Number(form.breakDurationMinutes) || 0,
        totalHours: workedHours,
        isBillable: form.isBillable,
        notes: form.notes.trim(),
      };

      if (editingEntry && editingEntry.id) {
        await updateTimesheet(editingEntry.id, payload);
        showToast('Timesheet entry updated successfully!', 'success');
      } else {
        await addTimesheet(payload);
        showToast('Timesheet entry created successfully!', 'success');
      }

      handleCloseModal();
    } catch (err: any) {
      console.error('Failed to save timesheet:', err);
      showToast(err?.message || 'Failed to save timesheet entry.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!entryToDelete || !entryToDelete.id) return;
    setIsDeleting(true);
    try {
      await deleteTimesheet(entryToDelete.id);
      showToast('Timesheet entry deleted successfully', 'info');
      setEntryToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete timesheet:', err);
      showToast(err?.message || 'Failed to delete timesheet entry', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const missingDependencyMsg = useMemo(() => {
    if (activeEmployees.length === 0 && projects.length === 0) {
      return 'No active employees or projects exist in the system. Please create employees in the Employees module and projects in the Projects module first.';
    }
    if (activeEmployees.length === 0) {
      return 'No active employees exist. Please create employees in the Employees module before logging timesheets.';
    }
    if (projects.length === 0) {
      return 'No projects exist. Please create projects in the Projects module before logging timesheets.';
    }
    return null;
  }, [activeEmployees, projects]);

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
            <Clock size={22} style={{ color: '#3B5BDB' }} />
            Timesheets
          </div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
            Log employee work hours, billable time, and project tasks
          </div>
        </div>

        <button
          className="btn-primary"
          style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={handleOpenAddModal}
        >
          <Plus size={15} /> Log Timesheet
        </button>
      </div>

      {/* Dependency Warning */}
      {missingDependencyMsg && (
        <div
          style={{
            padding: '14px 18px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 8,
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: '#991B1B',
            fontSize: 13,
          }}
        >
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <div>{missingDependencyMsg}</div>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
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
            <Clock size={14} style={{ color: '#3B5BDB' }} /> Total Hours
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#1A1F36',
              fontFamily: 'Plus Jakarta Sans',
            }}
          >
            {summaryMetrics.totalHours} hrs
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
            <DollarSign size={14} style={{ color: '#12B76A' }} /> Billable Hours
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#12B76A',
              fontFamily: 'Plus Jakarta Sans',
            }}
          >
            {summaryMetrics.billableHours} hrs
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
            <CheckCircle2 size={14} style={{ color: '#64748B' }} /> Non-Billable
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#64748B',
              fontFamily: 'Plus Jakarta Sans',
            }}
          >
            {summaryMetrics.nonBillableHours} hrs
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
            <Users size={14} style={{ color: '#3B5BDB' }} /> Logged Employees
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#1A1F36',
              fontFamily: 'Plus Jakarta Sans',
            }}
          >
            {summaryMetrics.activeEmployees}
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
            <CalendarDays size={14} style={{ color: '#F59E0B' }} /> Avg Hours / Day
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#F59E0B',
              fontFamily: 'Plus Jakarta Sans',
            }}
          >
            {summaryMetrics.avgHoursPerDay} hrs
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="card">
        {/* Controls Bar */}
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
          {/* View selector tabs */}
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
                background: periodMode === 'daily' ? '#FFFFFF' : 'transparent',
                color: periodMode === 'daily' ? '#1A1F36' : '#697586',
                boxShadow: periodMode === 'daily' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onClick={() => setPeriodMode('daily')}
            >
              <Calendar size={14} /> Daily
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
                background: periodMode === 'weekly' ? '#FFFFFF' : 'transparent',
                color: periodMode === 'weekly' ? '#1A1F36' : '#697586',
                boxShadow: periodMode === 'weekly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onClick={() => setPeriodMode('weekly')}
            >
              <CheckSquare size={14} /> Weekly
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
                background: periodMode === 'monthly' ? '#FFFFFF' : 'transparent',
                color: periodMode === 'monthly' ? '#1A1F36' : '#697586',
                boxShadow: periodMode === 'monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onClick={() => setPeriodMode('monthly')}
            >
              <CalendarDays size={14} /> Monthly
            </button>
          </div>

          {/* Date Selector & Filters */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {periodMode !== 'monthly' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#697586' }}>
                  {periodMode === 'daily' ? 'Date:' : 'Week Date:'}
                </span>
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

            <div style={{ position: 'relative', width: 180 }}>
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
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="select-base"
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              style={{ fontSize: 13 }}
            >
              <option value="All">All Employees</option>
              {activeEmployees.map((e) => (
                <option key={e.id} value={e.id || e.employeeId}>
                  {e.name}
                </option>
              ))}
            </select>

            <select
              className="select-base"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              style={{ fontSize: 13 }}
            >
              <option value="All">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              className="select-base"
              value={billableFilter}
              onChange={(e) => setBillableFilter(e.target.value)}
              style={{ fontSize: 13 }}
            >
              <option value="All">All Billing</option>
              <option value="Billable">Billable</option>
              <option value="Non-Billable">Non-Billable</option>
            </select>
          </div>
        </div>

        {/* Timesheets Table */}
        <table className="table-base">
          <thead>
            <tr>
              <th>EMPLOYEE</th>
              <th>PROJECT</th>
              <th>TASK / DESCRIPTION</th>
              <th>DATE</th>
              <th>START - END</th>
              <th>BREAK</th>
              <th style={{ textAlign: 'right' }}>HOURS</th>
              <th>BILLING</th>
              <th style={{ textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '40px 20px', color: '#697586' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <Clock size={32} style={{ color: '#94A3B8' }} />
                    <div style={{ fontWeight: 600, color: '#1A1F36', fontSize: 15 }}>
                      No Timesheet Entries Found
                    </div>
                    <div style={{ fontSize: 13, maxWidth: 420 }}>
                      There are no logged timesheets matching the selected period and filters. Click "+ Log Timesheet" to create a new entry.
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              filteredEntries.map((rec) => {
                const initials = (rec.employeeName || '')
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'EM';

                return (
                  <tr key={rec.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
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
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{rec.employeeName}</div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Briefcase size={14} style={{ color: '#3B5BDB' }} />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{rec.projectName}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: '#1A1F36', maxWidth: 220 }}>
                      <div style={{ fontWeight: 500 }}>{rec.taskDescription}</div>
                      {rec.notes && <div style={{ fontSize: 11.5, color: '#697586' }}>{rec.notes}</div>}
                    </td>
                    <td style={{ fontSize: 12.5, color: '#697586' }}>{rec.date}</td>
                    <td style={{ fontSize: 12.5, color: '#697586' }}>
                      {rec.startTime} – {rec.endTime}
                    </td>
                    <td style={{ fontSize: 12.5, color: '#697586' }}>
                      {rec.breakDurationMinutes ? `${rec.breakDurationMinutes}m` : '0m'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13.5, color: '#1A1F36' }}>
                      {rec.totalHours} hrs
                    </td>
                    <td>
                      <span className={`badge ${rec.isBillable ? 'badge-green' : 'badge-gray'}`}>
                        {rec.isBillable ? 'Billable' : 'Non-Billable'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => handleOpenEditModal(rec)}
                        >
                          <Edit3 size={12} /> Edit
                        </button>
                        {rec.id && (
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
                            onClick={() => setEntryToDelete(rec)}
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
      </div>

      {/* Log / Edit Timesheet Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-box" style={{ width: 560, padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 16.5 }}>
                {editingEntry ? 'Edit Timesheet Entry' : 'Log New Timesheet Entry'}
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={handleCloseModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Employee Select */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Employee <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.employeeId ? '#EF4444' : undefined }}
                    value={form.employeeId}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, employeeId: e.target.value }));
                      if (errors.employeeId) setErrors((prev) => ({ ...prev, employeeId: '' }));
                    }}
                  >
                    {activeEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id || emp.employeeId}>
                        {emp.name}{emp.role ? ` (${emp.role})` : ''}
                      </option>
                    ))}
                  </select>
                  {errors.employeeId && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.employeeId}</div>
                  )}
                </div>

                {/* Project Select */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Project <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.projectId ? '#EF4444' : undefined }}
                    value={form.projectId}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, projectId: e.target.value }));
                      if (errors.projectId) setErrors((prev) => ({ ...prev, projectId: '' }));
                    }}
                  >
                    {projects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name} ({proj.clientName || 'Client'})
                      </option>
                    ))}
                  </select>
                  {errors.projectId && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.projectId}</div>
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
                    style={{ width: '100%', borderColor: errors.date ? '#EF4444' : undefined }}
                    value={form.date}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, date: e.target.value }));
                      if (errors.date) setErrors((prev) => ({ ...prev, date: '' }));
                    }}
                  />
                  {errors.date && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.date}</div>
                  )}
                </div>

                {/* Billing Status */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Billing Type <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={form.isBillable ? 'Billable' : 'Non-Billable'}
                    onChange={(e) => setForm((prev) => ({ ...prev, isBillable: e.target.value === 'Billable' }))}
                  >
                    <option value="Billable">Billable</option>
                    <option value="Non-Billable">Non-Billable</option>
                  </select>
                </div>

                {/* Start Time */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Start Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.startTime ? '#EF4444' : undefined }}
                    value={form.startTime}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, startTime: e.target.value }));
                      if (errors.startTime) setErrors((prev) => ({ ...prev, startTime: '' }));
                    }}
                  />
                  {errors.startTime && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.startTime}</div>
                  )}
                </div>

                {/* End Time */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    End Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.endTime ? '#EF4444' : undefined }}
                    value={form.endTime}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, endTime: e.target.value }));
                      if (errors.endTime) setErrors((prev) => ({ ...prev, endTime: '' }));
                    }}
                  />
                  {errors.endTime && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.endTime}</div>
                  )}
                </div>

                {/* Break Duration */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Break Duration (mins)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    className="input-base"
                    style={{ width: '100%' }}
                    value={form.breakDurationMinutes}
                    onChange={(e) => setForm((prev) => ({ ...prev, breakDurationMinutes: e.target.value }))}
                  />
                </div>

                {/* Calculated Duration Display */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#697586' }}>
                    Calculated Net Duration
                  </label>
                  <div
                    style={{
                      padding: '8px 12px',
                      background: computedFormHours > 0 ? '#EEF2FF' : '#FEF2F2',
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 700,
                      color: computedFormHours > 0 ? '#3B5BDB' : '#EF4444',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Clock size={16} />
                    {computedFormHours > 0 ? `${computedFormHours} worked hrs` : 'Invalid time range'}
                  </div>
                </div>

                {/* Task Description (Full Width) */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Task / Work Description <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    placeholder="e.g. Implemented authentication API and frontend validation"
                    style={{ width: '100%', borderColor: errors.taskDescription ? '#EF4444' : undefined }}
                    value={form.taskDescription}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, taskDescription: e.target.value }));
                      if (errors.taskDescription) setErrors((prev) => ({ ...prev, taskDescription: '' }));
                    }}
                  />
                  {errors.taskDescription && (
                    <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.taskDescription}</div>
                  )}
                </div>

                {/* Notes (Full Width) */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Additional Notes
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    placeholder="Optional notes or references"
                    style={{ width: '100%' }}
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={handleCloseModal} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : editingEntry ? 'Update Entry' : 'Save Timesheet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shared Delete Confirmation Modal */}
      {entryToDelete && (
        <DeleteConfirmationModal
          isOpen={!!entryToDelete}
          title="Delete Timesheet Entry"
          itemName={`${entryToDelete.employeeName} - ${entryToDelete.taskDescription}`}
          description={
            <>
              Are you sure you want to delete timesheet entry for <strong style={{ color: '#1A1F36' }}>{entryToDelete.employeeName}</strong> ({entryToDelete.totalHours} hrs on {entryToDelete.date})? This action will permanently remove the record from Firestore.
            </>
          }
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={() => setEntryToDelete(null)}
        />
      )}
    </div>
  );
}
