import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee, type Project, type TimesheetEntry, type AttendanceRecord, type ProjectTask, type Deliverable } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  getAllTimesheets,
  addTimesheet,
  updateTimesheet,
  deleteTimesheet,
} from '../services/timesheetService';
import { getAllAttendance } from '../services/attendanceService';
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
  ChevronLeft,
  ChevronRight,
  Download,
  BarChart2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { workedMinutes, lunchMinutes, toHHMM } from '../utils/attendanceTimes';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

type PeriodMode = 'daily' | 'weekly' | 'monthly';

export interface UnifiedWorkEntry {
  id: string;
  employeeId: string | number;
  employeeName: string;
  employeeCode?: string;
  projectId: string | number;
  projectName: string;
  date: string;
  taskDescription: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes: number;
  totalHours: number;
  isBillable: boolean;
  status: string;
  source: 'manual' | 'attendance' | 'task';
  rawTimesheet?: TimesheetEntry;
  rawAttendance?: AttendanceRecord;
}

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

  const [periodMode, setPeriodMode] = useState<PeriodMode>('weekly');
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

  // Synchronize from Firestore on mount: both manual timesheets and employee attendance records
  useEffect(() => {
    getAllTimesheets().catch((err) => {
      console.warn('Initial timesheets fetch error:', err);
    });
    getAllAttendance().catch((err) => {
      console.warn('Initial attendance fetch error:', err);
    });
  }, []);

  // Live queries from Dexie cache
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const attendanceRecords = useLiveQuery(() => db.attendance.toArray(), []) || [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const deliverables = useLiveQuery(() => db.deliverables.toArray(), []) || [];
  const timesheetRecords = useLiveQuery(async () => newestFirst(await db.timesheets.toArray(), (t) => t.date), []) || [];

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => e.status !== 'Inactive');
  }, [employees]);

  // Calculate Monday to Sunday week range & day objects for the selectedDate
  const weekBounds = useMemo(() => {
    const target = new Date(selectedDate);
    const validTarget = isNaN(target.getTime()) ? new Date() : target;
    const day = validTarget.getDay(); // 0 is Sun, 1 is Mon...
    const diffToMon = validTarget.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(validTarget);
    monday.setDate(diffToMon);

    const days: { dateStr: string; dayName: string; dayShort: string; isToday: boolean }[] = [];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    for (let i = 0; i < 7; i++) {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      const iso = cur.toISOString().split('T')[0];
      days.push({
        dateStr: iso,
        dayName: dayNames[i],
        dayShort: `${dayNames[i]} ${cur.getDate()}/${cur.getMonth() + 1}`,
        isToday: iso === todayStr,
      });
    }

    const monStr = days[0].dateStr;
    const sunStr = days[6].dateStr;
    const formattedRange = `${new Date(monStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(sunStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    return { monStr, sunStr, days, formattedRange };
  }, [selectedDate, todayStr]);

  // Unified work entries: combines manually logged timesheets with attendance work logs & task activity
  const unifiedEntries = useMemo(() => {
    const list: UnifiedWorkEntry[] = [];
    const manualKeys = new Set<string>();

    // 1. Include manually logged timesheets from db.timesheets
    timesheetRecords.forEach((t) => {
      const key = `${t.employeeId}_${t.date}`;
      manualKeys.add(key);
      list.push({
        id: `TS-${t.id}`,
        employeeId: t.employeeId,
        employeeName: t.employeeName,
        projectId: t.projectId,
        projectName: t.projectName,
        date: t.date,
        taskDescription: t.taskDescription || 'Logged Project Work',
        startTime: t.startTime || '09:00',
        endTime: t.endTime || '17:30',
        breakDurationMinutes: t.breakDurationMinutes ?? 30,
        totalHours: Number(t.totalHours) || 0,
        isBillable: t.isBillable ?? true,
        status: 'Logged',
        source: 'manual',
        rawTimesheet: t,
      });
    });

    // 2. Synthesize work entries from employee attendance records (without needing manual log)
    attendanceRecords.forEach((att) => {
      // Exclude absent or on-leave
      if (att.status === 'Absent' || att.status === 'On Leave') return;

      let attDate = (att.date || '').trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(attDate)) {
        attDate = attDate.split('/').reverse().join('-');
      }
      if (!attDate) return;

      const emp = activeEmployees.find(
        (e) =>
          (att.employeeId && String(e.id) === String(att.employeeId)) ||
          (att.employeeCode && String(e.employeeId) === String(att.employeeCode)) ||
          (att.employeeName && e.name.toLowerCase() === att.employeeName.toLowerCase())
      );
      const resolvedEmpId = emp?.id || emp?.employeeId || att.employeeId || att.employeeCode || '';
      const resolvedEmpName = emp?.name || att.employeeName || 'Employee';

      const key = `${resolvedEmpId}_${attDate}`;
      if (manualKeys.has(key)) {
        // Manual timesheet already logged for this employee on this date
        return;
      }

      const start = att.checkIn || '09:00';
      const isToday = attDate === todayStr;
      const end = att.checkOut || (isToday ? toHHMM(new Date()) : '18:00');
      const lunchBreak = lunchMinutes(att) ?? (att.lunchOut && att.lunchIn ? 60 : 45);

      let workedHrs = 0;
      const wm = workedMinutes(att, isToday ? toHHMM(new Date()) : undefined);
      if (wm != null && wm > 0) {
        workedHrs = Math.round((wm / 60) * 10) / 10;
      } else {
        workedHrs = calculateDurationHours(start, end, lunchBreak);
        if (workedHrs <= 0) {
          workedHrs = att.status === 'Half Day' ? 4.5 : 8.0;
        }
      }

      // Check tasks assigned to this employee on this date or currently in progress
      const empTasks = tasks.filter((t) => {
        const isAssigned =
          (t.assignedTo && t.assignedTo.toLowerCase() === resolvedEmpName.toLowerCase()) ||
          (t.assignee && t.assignee.toLowerCase() === resolvedEmpName.toLowerCase()) ||
          (t.assignedToId && String(t.assignedToId) === String(resolvedEmpId));

        if (!isAssigned) return false;
        const tDate = t.dueDate || t.deadline || t.start;
        return tDate === attDate || (!t.dueDate && t.status !== 'Completed');
      });

      // Check deliverables
      const empDeliverables = deliverables.filter((d) => {
        const isOwner =
          (d.employeeName && d.employeeName.toLowerCase() === resolvedEmpName.toLowerCase()) ||
          (d.employeeId && String(d.employeeId) === String(resolvedEmpId));
        return isOwner && (d.date === attDate || d.period === attDate.slice(0, 7));
      });

      const assignedProject = projects.find((p) => {
        if (empTasks.length > 0 && empTasks[0].projectId) {
          return String(p.id) === String(empTasks[0].projectId);
        }
        return (p.team || []).some((m) => m.toLowerCase() === resolvedEmpName.toLowerCase()) || p.manager === resolvedEmpName;
      });

      let taskDesc = '';
      if (empTasks.length > 0) {
        taskDesc = empTasks.map((t) => `${t.title || t.task || 'Task'} (${t.status || 'Active'})`).join(', ');
      } else if (empDeliverables.length > 0) {
        taskDesc = empDeliverables.map((d) => `${d.type || 'Deliverable'} × ${d.qty || 1}`).join(', ');
      } else {
        taskDesc = `Daily Attendance & Operations · ${att.status}${att.notes ? ` · ${att.notes}` : ''}`;
      }

      const projName = assignedProject?.name || empTasks[0]?.projectName || 'General Operations';
      const projId = assignedProject?.id || empTasks[0]?.projectId || 'general';

      list.push({
        id: `ATT-${att.id || `${resolvedEmpId}-${attDate}`}`,
        employeeId: resolvedEmpId,
        employeeName: resolvedEmpName,
        employeeCode: emp?.employeeId || att.employeeCode,
        projectId: projId,
        projectName: projName,
        date: attDate,
        taskDescription: taskDesc,
        startTime: start,
        endTime: end,
        breakDurationMinutes: lunchBreak,
        totalHours: workedHrs,
        isBillable: projId !== 'general',
        status: att.status,
        source: 'attendance',
        rawAttendance: att,
      });
    });

    return list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  }, [timesheetRecords, attendanceRecords, activeEmployees, tasks, deliverables, projects, todayStr]);

  // Filter entries based on PeriodMode and selected date/month/week
  const periodFilteredEntries = useMemo(() => {
    return unifiedEntries.filter((rec) => {
      if (periodMode === 'daily') {
        return rec.date === selectedDate;
      } else if (periodMode === 'monthly') {
        return rec.date.startsWith(selectedMonth);
      } else if (periodMode === 'weekly') {
        return rec.date >= weekBounds.monStr && rec.date <= weekBounds.sunStr;
      }
      return true;
    });
  }, [unifiedEntries, periodMode, selectedDate, selectedMonth, weekBounds]);

  // Apply search, employee, project, and billable dropdown filters
  const filteredEntries = useMemo(() => {
    return periodFilteredEntries.filter((rec) => {
      const q = search.toLowerCase().trim();
      const empMatch = !q || (rec.employeeName || '').toLowerCase().includes(q);
      const projMatch = !q || (rec.projectName || '').toLowerCase().includes(q);
      const taskMatch = !q || (rec.taskDescription || '').toLowerCase().includes(q);
      const matchesSearch = empMatch || projMatch || taskMatch;

      const matchesEmp =
        employeeFilter === 'All' ||
        String(rec.employeeId) === String(employeeFilter) ||
        (rec.employeeName && rec.employeeName.toLowerCase() === employeeFilter.toLowerCase());

      const matchesProj =
        projectFilter === 'All' || String(rec.projectId) === String(projectFilter) || rec.projectName === projectFilter;

      const matchesBillable =
        billableFilter === 'All' ||
        (billableFilter === 'Billable' && rec.isBillable) ||
        (billableFilter === 'Non-Billable' && !rec.isBillable);

      return matchesSearch && matchesEmp && matchesProj && matchesBillable;
    });
  }, [periodFilteredEntries, search, employeeFilter, projectFilter, billableFilter]);

  // Weekly Employee Matrix: per-employee day-by-day hours Mon-Sun, total weekly hours, tasks, projects
  const weeklyEmployeeMatrix = useMemo(() => {
    const list = activeEmployees.filter((emp) => {
      if (employeeFilter !== 'All') {
        return (
          String(emp.id) === String(employeeFilter) ||
          String(emp.employeeId) === String(employeeFilter) ||
          emp.name.toLowerCase() === employeeFilter.toLowerCase()
        );
      }
      return true;
    });

    return list.map((emp) => {
      const empIdStr = String(emp.id || emp.employeeId);
      const empEntries = periodFilteredEntries.filter(
        (rec) =>
          String(rec.employeeId) === empIdStr ||
          rec.employeeName.toLowerCase() === emp.name.toLowerCase()
      );

      const dayHours: Record<string, number> = {};
      const dayTasks: Record<string, string[]> = {};

      weekBounds.days.forEach((d) => {
        const forDay = empEntries.filter((e) => e.date === d.dateStr);
        const hrs = forDay.reduce((sum, e) => sum + e.totalHours, 0);
        dayHours[d.dateStr] = Math.round(hrs * 10) / 10;
        dayTasks[d.dateStr] = forDay.map((e) => e.projectName);
      });

      const totalWeekHours = Math.round(empEntries.reduce((sum, e) => sum + e.totalHours, 0) * 10) / 10;
      const billableHours = Math.round(empEntries.filter((e) => e.isBillable).reduce((sum, e) => sum + e.totalHours, 0) * 10) / 10;
      const daysPresent = Object.values(dayHours).filter((h) => h > 0).length;

      const projectsWorked = Array.from(new Set(empEntries.map((e) => e.projectName).filter(Boolean)));

      const weekTasks = tasks.filter((t) => {
        const assigned =
          (t.assignedTo && t.assignedTo.toLowerCase() === emp.name.toLowerCase()) ||
          (t.assignee && t.assignee.toLowerCase() === emp.name.toLowerCase()) ||
          (t.assignedToId && String(t.assignedToId) === empIdStr);
        const tDate = t.dueDate || t.deadline || t.start;
        return assigned && tDate && tDate >= weekBounds.monStr && tDate <= weekBounds.sunStr;
      });

      return {
        employee: emp,
        empIdStr,
        dayHours,
        dayTasks,
        totalWeekHours,
        billableHours,
        nonBillableHours: Math.round((totalWeekHours - billableHours) * 10) / 10,
        daysPresent,
        projectsWorked,
        tasksCount: weekTasks.length,
        completedTasksCount: weekTasks.filter((t) => t.status === 'Completed' || t.status === 'Done').length,
      };
    });
  }, [activeEmployees, employeeFilter, periodFilteredEntries, weekBounds, tasks]);

  // Monthly Employee Summary: monthly hours, days present, billable %, deliverables, avg hours
  const monthlyEmployeeSummary = useMemo(() => {
    const list = activeEmployees.filter((emp) => {
      if (employeeFilter !== 'All') {
        return (
          String(emp.id) === String(employeeFilter) ||
          String(emp.employeeId) === String(employeeFilter) ||
          emp.name.toLowerCase() === employeeFilter.toLowerCase()
        );
      }
      return true;
    });

    return list.map((emp) => {
      const empIdStr = String(emp.id || emp.employeeId);
      const empEntries = periodFilteredEntries.filter(
        (rec) =>
          String(rec.employeeId) === empIdStr ||
          rec.employeeName.toLowerCase() === emp.name.toLowerCase()
      );

      const totalMonthHours = Math.round(empEntries.reduce((sum, e) => sum + e.totalHours, 0) * 10) / 10;
      const billableHours = Math.round(empEntries.filter((e) => e.isBillable).reduce((sum, e) => sum + e.totalHours, 0) * 10) / 10;
      const uniqueDates = new Set(empEntries.filter((e) => e.totalHours > 0).map((e) => e.date)).size;
      const avgDaily = uniqueDates > 0 ? Math.round((totalMonthHours / uniqueDates) * 10) / 10 : 0;
      const projectsWorked = Array.from(new Set(empEntries.map((e) => e.projectName).filter(Boolean)));

      const empDeliverables = deliverables.filter((d) => {
        const isOwner =
          (d.employeeName && d.employeeName.toLowerCase() === emp.name.toLowerCase()) ||
          (d.employeeId && String(d.employeeId) === empIdStr);
        return isOwner && ((d.period && d.period === selectedMonth) || (d.date && d.date.startsWith(selectedMonth)));
      });

      const totalDeliverablesCount = empDeliverables.reduce((s, d) => s + (Number(d.qty) || 1), 0);

      return {
        employee: emp,
        empIdStr,
        totalMonthHours,
        billableHours,
        nonBillableHours: Math.round((totalMonthHours - billableHours) * 10) / 10,
        daysPresent: uniqueDates,
        avgDaily,
        projectsWorked,
        deliverablesCount: totalDeliverablesCount,
      };
    });
  }, [activeEmployees, employeeFilter, periodFilteredEntries, selectedMonth, deliverables]);

  // Summary Metrics calculated dynamically from active entries
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

  // Quick action to log / adjust an entry in the modal
  const handleOpenLogForEntry = (entry: UnifiedWorkEntry) => {
    if (entry.rawTimesheet) {
      handleOpenEditModal(entry.rawTimesheet);
      return;
    }
    setEditingEntry(null);
    const matchedProj = projects.find((p) => String(p.id) === String(entry.projectId) || p.name === entry.projectName);
    setForm({
      employeeId: entry.employeeId,
      projectId: matchedProj?.id || projects[0]?.id || '',
      date: entry.date,
      taskDescription: entry.taskDescription,
      startTime: entry.startTime,
      endTime: entry.endTime,
      breakDurationMinutes: entry.breakDurationMinutes,
      isBillable: entry.isBillable,
      notes: `Logged from ${entry.source === 'attendance' ? 'attendance' : 'task'} log`,
    });
    setErrors({});
    setShowModal(true);
  };

  // Export CSV handler
  const handleExportCSV = () => {
    if (filteredEntries.length === 0) {
      showToast('No timesheet records to export.', 'info');
      return;
    }
    const headers = ['Employee Name', 'Employee Code', 'Project Name', 'Task / Description', 'Date', 'Start Time', 'End Time', 'Break (Mins)', 'Hours Worked', 'Billing Status', 'Source'];
    const rows = filteredEntries.map((rec) => [
      `"${rec.employeeName}"`,
      `"${rec.employeeCode || ''}"`,
      `"${rec.projectName}"`,
      `"${rec.taskDescription.replace(/"/g, '""')}"`,
      `"${rec.date}"`,
      `"${rec.startTime}"`,
      `"${rec.endTime}"`,
      rec.breakDurationMinutes,
      rec.totalHours,
      rec.isBillable ? '"Billable"' : '"Non-Billable"',
      `"${rec.source}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `timesheets_${periodMode}_${selectedDate || selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${filteredEntries.length} timesheet records.`, 'success');
  };

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
