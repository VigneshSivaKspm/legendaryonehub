import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee, type PayrollRecord } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  getAllPayroll,
  generateMonthlyPayroll,
  savePayrollRecord,
  updatePayrollStatus,
  deletePayrollRecord,
  getDaysInMonth,
} from '../services/payrollService';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import SalaryProgress from '../components/SalaryProgress';
import {
  DollarSign,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  Users,
  Plus,
  Search,
  Filter,
  Edit3,
  Trash2,
  FileText,
  Download,
  Printer,
  RefreshCw,
  Building2,
  Check,
  X,
  CreditCard,
  AlertCircle,
  TrendingUp,
  Receipt,
  CheckSquare,
} from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import PayrollAdjustments from '../components/PayrollAdjustments';
import { adjustmentsFor } from '../services/payrollAdjustmentService';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default function Payroll() {
  const { companyProfile } = useAuth();
  const { showToast } = useToast();

  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Selected Month & Filters
  const [activeTab, setActiveTab] = useState<'register' | 'salary' | 'adjustments'>('register');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [search, setSearch] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  // Modals
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPayslipModal, setShowPayslipModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [payrollToDelete, setPayrollToDelete] = useState<PayrollRecord | null>(null);

  const [activePayroll, setActivePayroll] = useState<PayrollRecord | null>(null);
  const [selectedPayslip, setSelectedPayslip] = useState<PayrollRecord | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Edit Form State
  const [editForm, setEditForm] = useState<{
    baseSalary: string | number;
    dailySalary: string | number;
    workingHours: string | number;
    workingDays: string | number;
    presentDays: string | number;
    paidLeaveDays: string | number;
    unpaidLeaveDays: string | number;
    absentDays: string | number;
    allowances: string | number;
    bonus: string | number;
    overtime: string | number;
    otherDeductions: string | number;
    status: 'Pending' | 'Paid';
    paymentDate: string;
    paymentMethod: string;
    paymentReference: string;
    notes: string;
  }>({
    baseSalary: 0,
    dailySalary: 0,
    workingHours: 8,
    workingDays: 30,
    presentDays: 30,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    allowances: 0,
    bonus: 0,
    overtime: 0,
    otherDeductions: 0,
    status: 'Pending',
    paymentDate: todayStr,
    paymentMethod: 'Bank Transfer',
    paymentReference: '',
    notes: '',
  });

  // Status Modal Form State
  const [statusForm, setStatusForm] = useState<{
    status: 'Pending' | 'Paid';
    paymentDate: string;
    paymentReference: string;
    notes: string;
  }>({
    status: 'Paid',
    paymentDate: todayStr,
    paymentReference: '',
    notes: '',
  });

  // Synchronize from Firestore on mount
  useEffect(() => {
    getAllPayroll().catch((err) => {
      console.warn('[Payroll] Firestore sync warning:', err);
    });
  }, []);

  // Live queries from Dexie cache
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const payrollRecords = useLiveQuery(async () => newestFirst(await db.payroll.toArray(), (p) => p.month), []) || [];
  const allAdjustments = useLiveQuery(() => db.payrollAdjustments.toArray(), []) || [];

  // Allowance / deduction entries that apply to the record being edited
  const editAdjustments = activePayroll ? adjustmentsFor(allAdjustments, activePayroll.employeeId, activePayroll.month) : [];
  const editHasAllowanceEntries = editAdjustments.some((a) => a.type === 'Allowance');
  const editHasDeductionEntries = editAdjustments.some((a) => a.type === 'Deduction');

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => e.status !== 'Inactive');
  }, [employees]);

  // Monthly Payroll Records (unfiltered by employee/dept/status search)
  const monthPayrollRecords = useMemo(() => {
    return payrollRecords.filter((p) => p.month === selectedMonth);
  }, [payrollRecords, selectedMonth]);

  // Calculated Summary Cards (Strictly for selected month)
  const summary = useMemo(() => {
    let grossPayroll = 0;
    let totalAllowances = 0;
    let totalDeductions = 0;
    let netPayroll = 0;
    let paidTotal = 0;
    let pendingTotal = 0;
    let paidCount = 0;
    let pendingCount = 0;

    monthPayrollRecords.forEach((p) => {
      grossPayroll += Number(p.grossSalary) || 0;
      totalAllowances += (Number(p.allowances) || 0) + (Number(p.bonus) || 0) + (Number(p.overtime) || 0);
      totalDeductions += Number(p.totalDeductions) || 0;
      netPayroll += Number(p.netSalary) || 0;

      if (p.status === 'Paid') {
        paidTotal += Number(p.netSalary) || 0;
        paidCount++;
      } else {
        pendingTotal += Number(p.netSalary) || 0;
        pendingCount++;
      }
    });

    return {
      totalEmployees: monthPayrollRecords.length,
      grossPayroll,
      totalAllowances,
      totalDeductions,
      netPayroll,
      paidTotal,
      pendingTotal,
      paidCount,
      pendingCount,
    };
  }, [monthPayrollRecords]);

  // Filtered Payroll Records for Table view
  const filteredRecords = useMemo(() => {
    return monthPayrollRecords
      .filter((p) => {
        if (employeeFilter !== 'All' && String(p.employeeId) !== String(employeeFilter)) {
          return false;
        }
        if (statusFilter !== 'All' && p.status !== statusFilter) {
          return false;
        }
        if (search.trim()) {
          const q = search.toLowerCase();
          const nameMatch = (p.employeeName || '').toLowerCase().includes(q);
          const codeMatch = (p.employeeCode || '').toLowerCase().includes(q);
          const refMatch = (p.paymentReference || '').toLowerCase().includes(q);
          const notesMatch = (p.notes || '').toLowerCase().includes(q);
          if (!nameMatch && !codeMatch && !refMatch && !notesMatch) {
            return false;
          }
        }
        return true;
      });
  }, [monthPayrollRecords, employeeFilter, statusFilter, search]);

  // Calculated Real-time Edit Modal Totals
  const computedEditTotals = useMemo(() => {
    const base = Number(editForm.baseSalary) || 0;
    const allow = Number(editForm.allowances) || 0;
    const bon = Number(editForm.bonus) || 0;
    const ot = Number(editForm.overtime) || 0;
    const workDays = Number(editForm.workingDays) || 30;
    const unpaidDays = Number(editForm.unpaidLeaveDays) || 0;
    const absentDays = Number(editForm.absentDays) || 0;
    const otherDed = Number(editForm.otherDeductions) || 0;
    const shortTimeDeduction = Number(activePayroll?.shortTimeDeduction) || 0;

    const dailyRate = Number(editForm.dailySalary) > 0 ? Number(editForm.dailySalary) : (workDays > 0 ? base / workDays : 0);
    const workingHours = Number(editForm.workingHours) > 0 ? Number(editForm.workingHours) : 8;
    const hourlyRate = workingHours > 0 ? dailyRate / workingHours : 0;

    const unpaidDeduction = Math.round(dailyRate * unpaidDays);
    const absentDeduction = Math.round(dailyRate * absentDays);
    const gross = Math.round(base + allow + bon + ot);
    const totalDed = Math.round(unpaidDeduction + absentDeduction + shortTimeDeduction + otherDed);
    const net = Math.max(0, Math.round(gross - totalDed));

    return {
      dailyRate,
      workingHours,
      hourlyRate,
      unpaidDeduction,
      absentDeduction,
      shortTimeDeduction,
      gross,
      totalDed,
      net,
    };
  }, [
    editForm.baseSalary,
    editForm.dailySalary,
    editForm.workingHours,
    editForm.allowances,
    editForm.bonus,
    editForm.overtime,
    editForm.workingDays,
    editForm.unpaidLeaveDays,
    editForm.absentDays,
    editForm.otherDeductions,
    activePayroll,
  ]);

  // HANDLERS
  const handleGeneratePayroll = async () => {
    if (activeEmployees.length === 0) {
      showToast('No active employees found. Please add employees first.', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const count = await generateMonthlyPayroll(selectedMonth, companyProfile?.workingDays);
      showToast(
        `Payroll generated successfully for ${count} employee${count === 1 ? '' : 's'} for ${selectedMonth}.`,
        'success'
      );
    } catch (err: any) {
      console.error('Failed to generate payroll:', err);
      showToast(err?.message || 'Failed to generate payroll. Please try again.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenEditModal = (rec: PayrollRecord) => {
    setActivePayroll(rec);
    const isPaid = rec.status === 'Paid';
    const baseSal = rec.baseSalary || 0;
    const wDays = rec.workingDays || getDaysInMonth(rec.month);
    const dSal = rec.dailySalary || rec.dailyRate || (wDays > 0 ? Math.round(baseSal / wDays) : 0);
    const wHours = rec.workingHours || 8;
    setEditForm({
      baseSalary: baseSal,
      dailySalary: dSal,
      workingHours: wHours,
      workingDays: wDays,
      presentDays: rec.presentDays || 0,
      paidLeaveDays: rec.paidLeaveDays || 0,
      unpaidLeaveDays: rec.unpaidLeaveDays || 0,
      absentDays: rec.absentDays || 0,
      allowances: rec.allowances || 0,
      bonus: rec.bonus || 0,
      overtime: rec.overtime || 0,
      otherDeductions: rec.otherDeductions || 0,
      status: rec.status || 'Pending',
      paymentDate: isPaid ? rec.paymentDate || todayStr : '',
      paymentMethod: rec.paymentMethod || 'Bank Transfer',
      paymentReference: isPaid ? rec.paymentReference || '' : '',
      notes: rec.notes || '',
    });
    setShowEditModal(true);
  };

  const handleSaveEditPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePayroll) return;

    setIsSubmitting(true);
    try {
      const isPaid = editForm.status === 'Paid';
      await savePayrollRecord({
        ...activePayroll,
        baseSalary: Number(editForm.baseSalary) || 0,
        dailySalary: computedEditTotals.dailyRate,
        dailyRate: computedEditTotals.dailyRate,
        workingHours: computedEditTotals.workingHours,
        hourlyRate: Math.round(computedEditTotals.hourlyRate * 100) / 100,
        workingDays: Number(editForm.workingDays) || 30,
        presentDays: Number(editForm.presentDays) || 0,
        paidLeaveDays: Number(editForm.paidLeaveDays) || 0,
        unpaidLeaveDays: Number(editForm.unpaidLeaveDays) || 0,
        absentDays: Number(editForm.absentDays) || 0,
        absentDeduction: computedEditTotals.absentDeduction,
        allowances: Number(editForm.allowances) || 0,
        bonus: Number(editForm.bonus) || 0,
        overtime: Number(editForm.overtime) || 0,
        unpaidLeaveDeduction: computedEditTotals.unpaidDeduction,
        otherDeductions: Number(editForm.otherDeductions) || 0,
        totalDeductions: computedEditTotals.totalDed,
        grossSalary: computedEditTotals.gross,
        netSalary: computedEditTotals.net,
        status: editForm.status,
        paymentDate: isPaid ? editForm.paymentDate || todayStr : '',
        paymentMethod: editForm.paymentMethod,
        paymentReference: isPaid ? editForm.paymentReference.trim() : '',
        notes: editForm.notes.trim(),
      });

      showToast(`Payroll for ${activePayroll.employeeName} updated successfully.`, 'success');
      setShowEditModal(false);
    } catch (err: any) {
      console.error('Failed to save payroll edit:', err);
      showToast(err?.message || 'Failed to update payroll.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenStatusModal = (rec: PayrollRecord) => {
    setActivePayroll(rec);
    const targetStatus = rec.status === 'Paid' ? 'Pending' : 'Paid';
    setStatusForm({
      status: targetStatus,
      paymentDate: targetStatus === 'Paid' ? rec.paymentDate || todayStr : '',
      paymentReference: targetStatus === 'Paid' ? rec.paymentReference || '' : '',
      notes: rec.notes || '',
    });
    setShowStatusModal(true);
  };

  const handleSaveStatus = async () => {
    if (!activePayroll || !activePayroll.id) return;
    setIsUpdatingStatus(true);
    try {
      await updatePayrollStatus(
        activePayroll.id,
        statusForm.status,
        statusForm.paymentDate,
        statusForm.paymentReference,
        statusForm.notes
      );

      showToast(
        `Payment status for ${activePayroll.employeeName} updated to ${statusForm.status}.`,
        'success'
      );
      setShowStatusModal(false);
    } catch (err: any) {
      console.error('Failed to update status:', err);
      showToast(err?.message || 'Failed to update status.', 'error');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!payrollToDelete || !payrollToDelete.id) return;
    setIsDeleting(true);
    try {
      await deletePayrollRecord(payrollToDelete.id);
      showToast('Payroll record deleted permanently.', 'success');
      setPayrollToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete payroll record:', err);
      showToast(err?.message || 'Failed to delete payroll record.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // CSV EXPORT FUNCTION
  const handleExportCSV = () => {
    if (filteredRecords.length === 0) {
      showToast('No payroll records to export.', 'error');
      return;
    }

    const headers = [
      'Employee Name',
      'Employee ID',
      'Designation',
      'Role',
      'Month',
      'Base Salary',
      'Working Days',
      'Present Days',
      'Paid Leave Days',
      'Unpaid Leave Days',
      'Allowances',
      'Bonus',
      'Overtime',
      'Unpaid Leave Deduction',
      'Absent Deduction',
      'Short Time (min)',
      'Short Time Deduction',
      'Other Deductions',
      'Gross Salary',
      'Net Salary',
      'Status',
      'Payment Date',
      'Payment Reference',
    ];

    const rows = filteredRecords.map((r) => [
      `"${(r.employeeName || '').replace(/"/g, '""')}"`,
      `"${r.employeeCode || ''}"`,
      `"${r.role || ''}"`,
      `"${r.role || ''}"`,
      `"${r.month}"`,
      r.baseSalary,
      r.workingDays,
      r.presentDays,
      r.paidLeaveDays,
      r.unpaidLeaveDays,
      r.allowances,
      r.bonus,
      r.overtime,
      r.unpaidLeaveDeduction,
      r.absentDeduction || 0,
      r.shortMinutes || 0,
      r.shortTimeDeduction || 0,
      r.otherDeductions,
      r.grossSalary,
      r.netSalary,
      `"${r.status}"`,
      `"${r.paymentDate || ''}"`,
      `"${(r.paymentReference || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `payroll_export_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Exported ${filteredRecords.length} payroll record(s) to CSV.`, 'success');
  };

  // PAYSLIP PRINT / DOWNLOAD FUNCTION
  const handleDownloadPayslipFile = (p: PayrollRecord) => {
    const text = `====================================================
               LEGENDARY ONE BUSINESS OS
                    SALARY PAYSLIP
====================================================
Employee Name  : ${p.employeeName}
Employee ID    : ${p.employeeCode || 'N/A'}
Designation    : ${p.role || 'Staff'}
Role           : ${p.role || 'Staff'}
Payroll Month  : ${p.month}
Daily Salary   : ${formatCurrency(p.dailySalary || p.dailyRate || Math.round(p.baseSalary / (p.workingDays || 26)))}
Working Hours  : ${p.workingHours || 8} hrs/day
Hourly Rate    : ${formatCurrency(p.hourlyRate || Math.round((p.dailySalary || p.dailyRate || Math.round(p.baseSalary / (p.workingDays || 26))) / (p.workingHours || 8)))}/hr
Hours Worked   : ${p.workedMinutes ? `${Math.floor(p.workedMinutes / 60)}h ${Math.round(p.workedMinutes % 60)}m` : 'N/A'}

WORKING DAYS SUMMARY:
Working Days   : ${p.workingDays} Days
Present Days   : ${p.presentDays} Days
Paid Leave     : ${p.paidLeaveDays} Days
Unpaid Leave   : ${p.unpaidLeaveDays} Days
Absent         : ${p.absentDays} Days

EARNINGS BREAKDOWN:
Base Salary    : ${formatCurrency(p.baseSalary)}
Allowances     : ${formatCurrency(p.allowances)}
Bonus/Incentive: ${formatCurrency(p.bonus)}
Overtime       : ${formatCurrency(p.overtime)}
----------------------------------------------------
GROSS SALARY   : ${formatCurrency(p.grossSalary)}

DEDUCTIONS BREAKDOWN:
Unpaid Leave   : ${formatCurrency(p.unpaidLeaveDeduction)}
Absent Days    : ${formatCurrency(p.absentDeduction || 0)}
Short Time     : ${formatCurrency(p.shortTimeDeduction || 0)} (${p.shortMinutes || 0} min)
Other Deductions: ${formatCurrency(p.otherDeductions)}
----------------------------------------------------
TOTAL DEDUCT   : ${formatCurrency(p.totalDeductions)}

====================================================
NET PAYABLE    : ${formatCurrency(p.netSalary)}
====================================================
Payment Status : ${p.status}
Payment Date   : ${p.paymentDate || 'N/A'}
Reference      : ${p.paymentReference || 'N/A'}
====================================================`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payslip_${p.employeeName.replace(/\s+/g, '_')}_${p.month}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast('Payslip text file generated and downloaded.', 'success');
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
              background: '#ECFDF5',
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Receipt size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>
              Payroll Management
            </h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: '2px 0 0 0' }}>
              Monthly salary calculations, allowances, deductions & payslips
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Month Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={16} color="#64748B" />
            <input
              type="month"
              className="input-field"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ fontSize: 13, height: 38, width: 150 }}
            />
          </div>

          {/* Export CSV */}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportCSV}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 38,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Download size={16} /> Export CSV
          </button>

          {/* Generate / Recalculate Payroll */}
          <button
            type="button"
            className="btn-primary"
            onClick={handleGeneratePayroll}
            disabled={isGenerating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 16px',
              height: 38,
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={16} className={isGenerating ? 'spin' : ''} />
            {isGenerating
              ? 'Generating...'
              : monthPayrollRecords.length > 0
              ? 'Recalculate Payroll'
              : 'Generate Payroll'}
          </button>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #E5E9F2' }}>
        {[
          { key: 'register' as const, label: 'Payroll Register' },
          { key: 'salary' as const, label: 'Salary & Daily Progress' },
          { key: 'adjustments' as const, label: 'Incentives, Allowances & Deductions' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-btn${activeTab === t.key ? ' active' : ''}`}
            style={{ borderRadius: '8px 8px 0 0', padding: '10px 16px' }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'adjustments' && <PayrollAdjustments selectedMonth={selectedMonth} />}

      {activeTab === 'salary' && <SalaryProgress selectedMonth={selectedMonth} />}

      {activeTab === 'register' && (
      <>
      {/* SUMMARY CARDS (Real values for selected month) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        {/* Total Employees */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Employees</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#EEF2FF',
                color: '#4F46E5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Users size={16} />
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginTop: 8 }}>
            {summary.totalEmployees}
          </div>
        </div>

        {/* Gross Payroll */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Gross Payroll</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#EFF6FF',
                color: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={16} />
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#2563EB', marginTop: 8 }}>
            {formatCurrency(summary.grossPayroll)}
          </div>
        </div>

        {/* Allowances */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Allowances</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#F0FDF4',
                color: '#16A34A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <DollarSign size={16} />
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#16A34A', marginTop: 8 }}>
            {formatCurrency(summary.totalAllowances)}
          </div>
        </div>

        {/* Deductions */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Deductions</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#FEF2F2',
                color: '#DC2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertCircle size={16} />
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#DC2626', marginTop: 8 }}>
            {formatCurrency(summary.totalDeductions)}
          </div>
        </div>

        {/* Net Payroll */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Net Payroll</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#ECFDF5',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Receipt size={16} />
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#059669', marginTop: 8 }}>
            {formatCurrency(summary.netPayroll)}
          </div>
        </div>

        {/* Paid */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>
              Paid ({summary.paidCount})
            </span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#D1FAE5',
                color: '#047857',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#047857', marginTop: 8 }}>
            {formatCurrency(summary.paidTotal)}
          </div>
        </div>

        {/* Pending */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>
              Pending ({summary.pendingCount})
            </span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#FEF3C7',
                color: '#D97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={16} />
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#D97706', marginTop: 8 }}>
            {formatCurrency(summary.pendingTotal)}
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
            No Employees Found
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
            Before generating monthly payroll, active employees must be added to the system.
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
                placeholder="Search employee, ID..."
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
                <option value="Paid">Paid</option>
              </select>
            </div>

            {/* Reset Filters button */}
            {(search || employeeFilter !== 'All' || statusFilter !== 'All') && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSearch('');
                  setEmployeeFilter('All');
                  setStatusFilter('All');
                }}
                style={{ fontSize: 12.5, height: 38, padding: '0 12px' }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* TABLE OR ZERO STATE */}
          {monthPayrollRecords.length === 0 ? (
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
                <Receipt size={28} strokeWidth={1.8} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                Payroll Not Generated for {selectedMonth}
              </h3>
              <p style={{ fontSize: 13, color: '#64748B', margin: '0 auto 18px auto', maxWidth: 400 }}>
                Monthly salary records have not been calculated yet for {selectedMonth}. Click below to generate payroll for all active employees.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={handleGeneratePayroll}
                disabled={isGenerating}
                style={{ fontSize: 13.5, padding: '10px 18px' }}
              >
                <RefreshCw size={16} style={{ marginRight: 6 }} className={isGenerating ? 'spin' : ''} />
                Generate Payroll for {selectedMonth}
              </button>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: 40,
                textAlign: 'center',
                border: '1px solid #E2E8F0',
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
                No Matching Records Found
              </h3>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                No payroll records match your current filter criteria.
              </p>
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
                      <th style={{ padding: '14px 12px' }}>Designation</th>
                      <th style={{ padding: '14px 12px', textAlign: 'right' }}>Base Salary</th>
                      <th style={{ padding: '14px 12px', textAlign: 'center' }}>Days</th>
                      <th style={{ padding: '14px 12px', textAlign: 'right' }}>Allowances</th>
                      <th style={{ padding: '14px 12px', textAlign: 'right' }}>Deductions</th>
                      <th style={{ padding: '14px 12px', textAlign: 'right' }}>Gross Salary</th>
                      <th style={{ padding: '14px 12px', textAlign: 'right' }}>Net Salary</th>
                      <th style={{ padding: '14px 12px' }}>Status</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((rec, idx) => {
                      const totalAllowances =
                        (Number(rec.allowances) || 0) + (Number(rec.bonus) || 0) + (Number(rec.overtime) || 0);

                      return (
                        <tr
                          key={rec.id || idx}
                          style={{
                            borderBottom: '1px solid #F1F5F9',
                            transition: 'background 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {/* Employee Name */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: '50%',
                                  background: '#ECFDF5',
                                  color: '#059669',
                                  fontWeight: 700,
                                  fontSize: 12,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {rec.employeeName ? rec.employeeName.substring(0, 2) : 'EM'}
                              </div>
                              <div style={{ fontWeight: 700, color: '#0F172A' }}>
                                {rec.employeeName}
                              </div>
                            </div>
                          </td>

                          {/* EMP ID */}
                          <td style={{ padding: '14px 12px', color: '#64748B', fontWeight: 600 }}>
                            {rec.employeeCode || '-'}
                          </td>

                          {/* Designation */}
                          <td style={{ padding: '14px 12px', fontWeight: 600, color: '#334155' }}>
                            {rec.role || 'Staff'}
                          </td>

                          {/* Base Salary */}
                          <td style={{ padding: '14px 12px', textAlign: 'right', color: '#475569' }}>
                            <div style={{ fontWeight: 600, color: '#0F172A' }}>{formatCurrency(rec.baseSalary)}</div>
                            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                              ₹{(rec.dailySalary || rec.dailyRate || Math.round(rec.baseSalary / (rec.workingDays || 26))).toLocaleString('en-IN')}/day · {rec.workingHours || 8}h
                            </div>
                            <div style={{ fontSize: 10.5, color: '#3B82F6', fontWeight: 600 }}>
                              ₹{(rec.hourlyRate || Math.round((rec.dailySalary || rec.dailyRate || Math.round(rec.baseSalary / (rec.workingDays || 26))) / (rec.workingHours || 8))).toLocaleString('en-IN')}/hr
                            </div>
                          </td>

                          {/* Days Breakdown */}
                          <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                            {rec.hasAttendanceData === false ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  background: '#FEF3C7',
                                  color: '#D97706',
                                  fontWeight: 600,
                                  fontSize: 11,
                                }}
                                title="No attendance records logged for this employee in this month"
                              >
                                Attendance Not Available
                              </span>
                            ) : (
                              <div>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    background: '#F1F5F9',
                                    color: '#334155',
                                    fontWeight: 600,
                                    fontSize: 12,
                                  }}
                                  title={`Present: ${rec.presentDays} | Paid Leave: ${rec.paidLeaveDays} | Unpaid Leave: ${rec.unpaidLeaveDays} | Absent: ${rec.absentDays}`}
                                >
                                  {rec.presentDays + rec.paidLeaveDays}/{rec.workingDays} Days
                                </span>
                                {rec.workedMinutes != null && rec.workedMinutes > 0 && (
                                  <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginTop: 2 }}>
                                    {Math.floor(rec.workedMinutes / 60)}h {Math.round(rec.workedMinutes % 60)}m worked
                                  </div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Allowances */}
                          <td style={{ padding: '14px 12px', textAlign: 'right', color: '#16A34A', fontWeight: 600 }}>
                            +{formatCurrency(totalAllowances)}
                          </td>

                          {/* Deductions */}
                          <td style={{ padding: '14px 12px', textAlign: 'right', color: '#DC2626', fontWeight: 600 }}>
                            -{formatCurrency(rec.totalDeductions)}
                          </td>

                          {/* Gross Salary */}
                          <td style={{ padding: '14px 12px', textAlign: 'right', color: '#334155', fontWeight: 600 }}>
                            {formatCurrency(rec.grossSalary)}
                          </td>

                          {/* Net Salary */}
                          <td style={{ padding: '14px 12px', textAlign: 'right', color: '#0F172A', fontWeight: 800, fontSize: 14 }}>
                            {formatCurrency(rec.netSalary)}
                          </td>

                          {/* Status */}
                          <td style={{ padding: '14px 12px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 10px',
                                borderRadius: 20,
                                fontSize: 12,
                                fontWeight: 700,
                                background: rec.status === 'Paid' ? '#ECFDF5' : '#FFFBEB',
                                color: rec.status === 'Paid' ? '#059669' : '#D97706',
                                border: `1px solid ${rec.status === 'Paid' ? '#A7F3D0' : '#FDE68A'}`,
                              }}
                            >
                              {rec.status === 'Paid' ? (
                                <CheckCircle2 size={13} strokeWidth={2.5} />
                              ) : (
                                <Clock size={13} strokeWidth={2.5} />
                              )}
                              {rec.status}
                            </span>
                          </td>

                          {/* Actions */}
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {/* Mark Paid / Change Status */}
                              <button
                                type="button"
                                onClick={() => handleOpenStatusModal(rec)}
                                style={{
                                  border: `1px solid ${rec.status === 'Paid' ? '#CBD5E1' : '#A7F3D0'}`,
                                  background: rec.status === 'Paid' ? '#FFFFFF' : '#ECFDF5',
                                  color: rec.status === 'Paid' ? '#475569' : '#059669',
                                  borderRadius: 6,
                                  padding: '5px 9px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                                title="Update Payment Status"
                              >
                                {rec.status === 'Paid' ? 'Mark Pending' : 'Mark Paid'}
                              </button>

                              {/* Edit Payroll */}
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(rec)}
                                style={{
                                  border: '1px solid #CBD5E1',
                                  background: '#FFFFFF',
                                  color: '#475569',
                                  borderRadius: 6,
                                  padding: 6,
                                  cursor: 'pointer',
                                }}
                                title="Edit Payroll Record"
                              >
                                <Edit3 size={14} />
                              </button>

                              {/* View Payslip */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPayslip(rec);
                                  setShowPayslipModal(true);
                                }}
                                style={{
                                  border: '1px solid #C7D2FE',
                                  background: '#EEF2FF',
                                  color: '#4338CA',
                                  borderRadius: 6,
                                  padding: 6,
                                  cursor: 'pointer',
                                }}
                                title="View & Print Payslip"
                              >
                                <FileText size={14} />
                              </button>

                              {/* Delete button */}
                              <button
                                type="button"
                                onClick={() => setPayrollToDelete(rec)}
                                style={{
                                  border: '1px solid #FEE2E2',
                                  background: '#FEF2F2',
                                  color: '#DC2626',
                                  borderRadius: 6,
                                  padding: 6,
                                  cursor: 'pointer',
                                }}
                                title="Delete Payroll Record"
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
      </>
      )}

      {/* EDIT PAYROLL MODAL */}
      {showEditModal && activePayroll && (
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
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 580,
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
              <div>
                <h2 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 17, fontWeight: 700, color: '#1A1F36', margin: 0 }}>
                  Edit Payroll Record
                </h2>
                <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
                  {activePayroll.employeeName} ({activePayroll.employeeCode || 'N/A'}) - {activePayroll.month}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEditPayroll}>
              {/* Base Salary, Daily Rate, Working Hours & Working Days */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12, background: '#F8FAFC', padding: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Daily Salary Rate (₹)
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    value={editForm.dailySalary}
                    onChange={(e) => {
                      const d = Number(e.target.value);
                      const w = Number(editForm.workingDays) || 26;
                      setEditForm({
                        ...editForm,
                        dailySalary: e.target.value,
                        baseSalary: !isNaN(d) && d > 0 ? Math.round(d * w) : editForm.baseSalary,
                      });
                    }}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Working Hours / Day
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="0.5"
                    className="input-field"
                    value={editForm.workingHours}
                    onChange={(e) => setEditForm({ ...editForm, workingHours: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Monthly Base Salary (₹)
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    value={editForm.baseSalary}
                    onChange={(e) => {
                      const b = Number(e.target.value);
                      const w = Number(editForm.workingDays) || 26;
                      setEditForm({
                        ...editForm,
                        baseSalary: e.target.value,
                        dailySalary: !isNaN(b) && b > 0 && w > 0 ? Math.round(b / w) : editForm.dailySalary,
                      });
                    }}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Working Days in Month
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    value={editForm.workingDays}
                    onChange={(e) => setEditForm({ ...editForm, workingDays: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '6px 10px', fontSize: 11.5, color: '#1E40AF', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <div>
                    Hourly rate: <strong>₹{computedEditTotals.hourlyRate.toFixed(2)}/hr</strong>
                    <span style={{ color: '#3B82F6' }}> (Daily ₹{Math.round(computedEditTotals.dailyRate).toLocaleString('en-IN')} ÷ {computedEditTotals.workingHours} hrs)</span>
                  </div>
                  <div style={{ color: '#2563EB', fontWeight: 500 }}>
                    Strictly calculates on actual working hours less lunch & break
                  </div>
                </div>
              </div>

              {/* Present, Unpaid Leave & Absent Days */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Present / Paid Days
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="input-field"
                    value={editForm.presentDays}
                    onChange={(e) => setEditForm({ ...editForm, presentDays: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Unpaid Leave Days
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="input-field"
                    value={editForm.unpaidLeaveDays}
                    onChange={(e) => setEditForm({ ...editForm, unpaidLeaveDays: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Absent Days
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="input-field"
                    value={editForm.absentDays}
                    onChange={(e) => setEditForm({ ...editForm, absentDays: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              {computedEditTotals.shortTimeDeduction > 0 && (
                <div style={{ fontSize: 11.5, color: '#697586', marginTop: -8, marginBottom: 16 }}>
                  Includes short-time deduction of {formatCurrency(computedEditTotals.shortTimeDeduction)} ({activePayroll?.shortMinutes || 0} min late /
                  early / long lunch) from attendance.
                </div>
              )}

              {/* Allowances, Bonus, Overtime */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Allowances (₹)
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    value={editForm.allowances}
                    disabled={editHasAllowanceEntries}
                    title={editHasAllowanceEntries ? 'Managed in the Allowances & Deductions tab' : undefined}
                    onChange={(e) => setEditForm({ ...editForm, allowances: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Bonus (₹)
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    value={editForm.bonus}
                    onChange={(e) => setEditForm({ ...editForm, bonus: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Overtime (₹)
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    value={editForm.overtime}
                    onChange={(e) => setEditForm({ ...editForm, overtime: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Deductions */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Other Deductions (₹)
                </label>
                <input
                  type="number"
                  className="input-field"
                  value={editForm.otherDeductions}
                  disabled={editHasDeductionEntries}
                  onChange={(e) => setEditForm({ ...editForm, otherDeductions: e.target.value })}
                  placeholder="Additional deductions, advance repayment..."
                  style={{ width: '100%' }}
                />
                {(editHasAllowanceEntries || editHasDeductionEntries) && (
                  <div style={{ fontSize: 11.5, color: '#697586', marginTop: 6 }}>
                    {editAdjustments.map((a) => `${a.component} ${a.type === 'Allowance' ? '+' : '−'}₹${a.amount.toLocaleString('en-IN')}`).join(' · ')}
                    {' '}— edit these in the Allowances &amp; Deductions tab.
                  </div>
                )}
              </div>

              {/* Real-time Calculation Summary Banner */}
              <div
                style={{
                  background: '#F8FAFC',
                  borderRadius: 12,
                  padding: 14,
                  border: '1px solid #E2E8F0',
                  marginBottom: 16,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 12,
                  textAlign: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>GROSS SALARY</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#2563EB', marginTop: 2 }}>
                    {formatCurrency(computedEditTotals.gross)}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>TOTAL DEDUCTIONS</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#DC2626', marginTop: 2 }}>
                    {formatCurrency(computedEditTotals.totalDed)}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>NET PAYABLE</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#059669', marginTop: 2 }}>
                    {formatCurrency(computedEditTotals.net)}
                  </div>
                </div>
              </div>

              {/* Payment Status & Reference */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Payment Status
                  </label>
                  <select
                    className="input-field"
                    value={editForm.status}
                    onChange={(e) => {
                      const newStatus = e.target.value as 'Pending' | 'Paid';
                      setEditForm((prev) => ({
                        ...prev,
                        status: newStatus,
                        paymentDate: newStatus === 'Paid' ? (prev.paymentDate || todayStr) : '',
                        paymentReference: newStatus === 'Paid' ? prev.paymentReference : '',
                      }));
                    }}
                    style={{ width: '100%' }}
                  >
                    <option value="Pending">Pending</option>
                    <option value="Paid">Paid</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Payment Date
                  </label>
                  <input
                    type="date"
                    className="input-field"
                    value={editForm.paymentDate}
                    onChange={(e) => setEditForm({ ...editForm, paymentDate: e.target.value })}
                    disabled={editForm.status === 'Pending'}
                    style={{ width: '100%', opacity: editForm.status === 'Pending' ? 0.6 : 1 }}
                  />
                </div>
              </div>

              {/* Reference & Notes */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Payment Reference / Transaction ID
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder={editForm.status === 'Pending' ? 'Available when Paid' : 'UPI Ref / Bank Transfer UTR Number'}
                  value={editForm.paymentReference}
                  onChange={(e) => setEditForm({ ...editForm, paymentReference: e.target.value })}
                  disabled={editForm.status === 'Pending'}
                  style={{ width: '100%', opacity: editForm.status === 'Pending' ? 0.6 : 1 }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Notes / Remarks
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Internal notes..."
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Payroll Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STATUS UPDATE MODAL */}
      {showStatusModal && activePayroll && (
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
          onClick={() => setShowStatusModal(false)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 440,
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
                  background: statusForm.status === 'Paid' ? '#ECFDF5' : '#FFFBEB',
                  color: statusForm.status === 'Paid' ? '#059669' : '#D97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px auto',
                }}
              >
                {statusForm.status === 'Paid' ? <CheckCircle2 size={26} /> : <Clock size={26} />}
              </div>

              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: '0 0 6px 0' }}>
                Mark Payroll as {statusForm.status}
              </h3>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                {activePayroll.employeeName} - Net Payable:{' '}
                <strong>{formatCurrency(activePayroll.netSalary)}</strong> ({activePayroll.month})
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                Payment Date
              </label>
              <input
                type="date"
                className="input-field"
                value={statusForm.paymentDate}
                onChange={(e) => setStatusForm({ ...statusForm, paymentDate: e.target.value })}
                disabled={statusForm.status === 'Pending'}
                style={{ width: '100%', opacity: statusForm.status === 'Pending' ? 0.6 : 1 }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                Transaction / Reference ID
              </label>
              <input
                type="text"
                className="input-field"
                placeholder={statusForm.status === 'Pending' ? 'Available when Paid' : 'UPI UTR Number / Bank Reference'}
                value={statusForm.paymentReference}
                onChange={(e) => setStatusForm({ ...statusForm, paymentReference: e.target.value })}
                disabled={statusForm.status === 'Pending'}
                style={{ width: '100%', opacity: statusForm.status === 'Pending' ? 0.6 : 1 }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                Notes / Remarks
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="Optional notes..."
                value={statusForm.notes}
                onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setShowStatusModal(false)}
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
                  background: statusForm.status === 'Paid' ? '#059669' : '#D97706',
                  border: 'none',
                }}
                disabled={isUpdatingStatus}
                onClick={handleSaveStatus}
              >
                {isUpdatingStatus ? 'Saving...' : `Confirm ${statusForm.status}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROFESSIONAL PAYSLIP MODAL */}
      {showPayslipModal && selectedPayslip && (
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
          onClick={() => setShowPayslipModal(false)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 640,
              padding: 32,
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* PAYSLIP CONTENT CONTAINER */}
            <div id="payslip-printable-area">
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  borderBottom: '2px solid #E2E8F0',
                  paddingBottom: 16,
                  marginBottom: 20,
                }}
              >
                <div>
                  <h2 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 17, fontWeight: 700, color: '#1A1F36', margin: 0 }}>
                    Legendary One Business OS
                  </h2>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    Official Employee Salary Payslip
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#2563EB' }}>
                    PAYSLIP - {selectedPayslip.month}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                    Generated Date: {todayStr}
                  </div>
                </div>
              </div>

              {/* Employee Summary Box */}
              <div
                style={{
                  background: '#F8FAFC',
                  borderRadius: 12,
                  padding: 16,
                  border: '1px solid #E2E8F0',
                  marginBottom: 20,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  fontSize: 13,
                }}
              >
                <div>
                  <div style={{ color: '#64748B', fontSize: 11 }}>EMPLOYEE NAME</div>
                  <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                    {selectedPayslip.employeeName}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 11 }}>EMPLOYEE ID</div>
                  <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                    {selectedPayslip.employeeCode || 'N/A'}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 11 }}>DESIGNATION</div>
                  <div style={{ fontWeight: 600, color: '#334155', marginTop: 2 }}>
                    {selectedPayslip.role || 'Staff'}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 11 }}>DAILY RATE & SHIFT</div>
                  <div style={{ fontWeight: 600, color: '#334155', marginTop: 2 }}>
                    ₹{(selectedPayslip.dailySalary || selectedPayslip.dailyRate || Math.round(selectedPayslip.baseSalary / (selectedPayslip.workingDays || 26))).toLocaleString('en-IN')}/day
                    <span style={{ fontSize: 11, color: '#64748B' }}> · {selectedPayslip.workingHours || 8}h (₹{(selectedPayslip.hourlyRate || Math.round((selectedPayslip.dailySalary || selectedPayslip.dailyRate || Math.round(selectedPayslip.baseSalary / (selectedPayslip.workingDays || 26))) / (selectedPayslip.workingHours || 8))).toLocaleString('en-IN')}/hr)</span>
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 11 }}>WORKING DAYS</div>
                  <div style={{ fontWeight: 600, color: '#334155', marginTop: 2 }}>
                    {selectedPayslip.workingDays} Days
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 11 }}>PAYABLE / WORKED</div>
                  <div
                    style={{
                      fontWeight: 600,
                      color: selectedPayslip.hasAttendanceData === false ? '#D97706' : '#059669',
                      marginTop: 2,
                    }}
                  >
                    {selectedPayslip.hasAttendanceData === false
                      ? 'Attendance Not Available'
                      : `${selectedPayslip.presentDays + selectedPayslip.paidLeaveDays} Days ${selectedPayslip.workedMinutes ? `(${Math.floor(selectedPayslip.workedMinutes / 60)}h ${Math.round(selectedPayslip.workedMinutes % 60)}m)` : ''}`}
                  </div>
                </div>
              </div>

              {/* Earnings & Deductions Table */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {/* Earnings */}
                <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    style={{
                      background: '#F0FDF4',
                      padding: '10px 12px',
                      color: '#166534',
                      fontWeight: 700,
                      fontSize: 12,
                      borderBottom: '1px solid #DCFCE7',
                    }}
                  >
                    EARNINGS
                  </div>
                  <div style={{ padding: 12, fontSize: 12.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#475569' }}>Base Salary</span>
                      <span style={{ fontWeight: 600, color: '#0F172A' }}>
                        {formatCurrency(selectedPayslip.baseSalary)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#475569' }}>Allowances</span>
                      <span style={{ fontWeight: 600, color: '#0F172A' }}>
                        {formatCurrency(selectedPayslip.allowances)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#475569' }}>Bonus / Incentive</span>
                      <span style={{ fontWeight: 600, color: '#0F172A' }}>
                        {formatCurrency(selectedPayslip.bonus)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#475569' }}>Overtime</span>
                      <span style={{ fontWeight: 600, color: '#0F172A' }}>
                        {formatCurrency(selectedPayslip.overtime)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        paddingTop: 8,
                        borderTop: '1px solid #E2E8F0',
                        fontWeight: 700,
                        color: '#16A34A',
                      }}
                    >
                      <span>Gross Earnings</span>
                      <span>{formatCurrency(selectedPayslip.grossSalary)}</span>
                    </div>
                  </div>
                </div>

                {/* Deductions */}
                <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    style={{
                      background: '#FEF2F2',
                      padding: '10px 12px',
                      color: '#991B1B',
                      fontWeight: 700,
                      fontSize: 12,
                      borderBottom: '1px solid #FEE2E2',
                    }}
                  >
                    DEDUCTIONS
                  </div>
                  <div style={{ padding: 12, fontSize: 12.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#475569' }}>
                        Unpaid Leave ({selectedPayslip.unpaidLeaveDays} d)
                      </span>
                      <span style={{ fontWeight: 600, color: '#DC2626' }}>
                        {formatCurrency(selectedPayslip.unpaidLeaveDeduction)}
                      </span>
                    </div>
                    {(selectedPayslip.absentDeduction || 0) > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ color: '#475569' }}>Absent ({selectedPayslip.absentDays} d)</span>
                        <span style={{ fontWeight: 600, color: '#DC2626' }}>{formatCurrency(selectedPayslip.absentDeduction || 0)}</span>
                      </div>
                    )}
                    {(selectedPayslip.shortTimeDeduction || 0) > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ color: '#475569' }}>Short time ({selectedPayslip.shortMinutes} min)</span>
                        <span style={{ fontWeight: 600, color: '#DC2626' }}>{formatCurrency(selectedPayslip.shortTimeDeduction || 0)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#475569' }}>Other Deductions</span>
                      <span style={{ fontWeight: 600, color: '#DC2626' }}>
                        {formatCurrency(selectedPayslip.otherDeductions)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        paddingTop: 8,
                        marginTop: 32,
                        borderTop: '1px solid #E2E8F0',
                        fontWeight: 700,
                        color: '#DC2626',
                      }}
                    >
                      <span>Total Deductions</span>
                      <span>{formatCurrency(selectedPayslip.totalDeductions)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Net Payable Banner */}
              <div
                style={{
                  background: '#EEF2FF',
                  border: '1.5px solid #C7D2FE',
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 20,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4338CA', letterSpacing: '0.04em' }}>
                    NET SALARY PAYABLE
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#312E81', marginTop: 2 }}>
                    {formatCurrency(selectedPayslip.netSalary)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 700,
                      background: selectedPayslip.status === 'Paid' ? '#ECFDF5' : '#FFFBEB',
                      color: selectedPayslip.status === 'Paid' ? '#059669' : '#D97706',
                      border: `1px solid ${selectedPayslip.status === 'Paid' ? '#A7F3D0' : '#FDE68A'}`,
                    }}
                  >
                    STATUS: {selectedPayslip.status.toUpperCase()}
                  </span>
                  {selectedPayslip.paymentDate && (
                    <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                      Paid Date: {selectedPayslip.paymentDate}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Payslip Action Buttons */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowPayslipModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleDownloadPayslipFile(selectedPayslip)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={16} /> Download File
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => window.print()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Printer size={16} /> Print Payslip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHARED DELETE CONFIRMATION MODAL */}
      <DeleteConfirmationModal
        isOpen={Boolean(payrollToDelete)}
        title="Delete Payroll Record"
        itemName={
          payrollToDelete
            ? `${payrollToDelete.employeeName} (${payrollToDelete.month} - Net: ${formatCurrency(
                payrollToDelete.netSalary
              )})`
            : ''
        }
        isDeleting={isDeleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setPayrollToDelete(null)}
      />
    </div>
  );
}
