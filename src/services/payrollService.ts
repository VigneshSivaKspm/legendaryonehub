import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type PayrollRecord } from '../db/database';
import { adjustmentsFor, sumAdjustments } from './payrollAdjustmentService';
import { STANDARD_DAY_HOURS } from '../utils/attendanceTimes';
import { notifyPayrollPaid } from './emailNotificationService';

const PAYROLL_COL = 'payroll';

/**
 * Returns total days in a month string "YYYY-MM" (e.g., "2026-10" -> 31).
 */
export function getDaysInMonth(monthStr: string): number {
  if (!monthStr || !monthStr.includes('-')) return 30;
  const [year, month] = monthStr.split('-').map(Number);
  if (!year || !month) return 30;
  return new Date(year, month, 0).getDate();
}

/**
 * Fetch all payroll records from Firestore with fallback to Dexie local cache.
 */
export async function getAllPayroll(): Promise<PayrollRecord[]> {
  try {
    const q = query(collection(dbFirestore, PAYROLL_COL), orderBy('month', 'desc'));
    const snapshot = await getDocs(q);
    const records = snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as PayrollRecord[];

    await safeOpenDatabase();
    await db.payroll.clear();
    if (records.length > 0) {
      await db.payroll.bulkPut(records);
    }
    return records;
  } catch (err: any) {
    console.warn('[PayrollService] Firestore fetch failed, using local cache:', err?.message || err);
    await safeOpenDatabase();
    return await db.payroll.toArray();
  }
}

/**
 * Create or update a single payroll record in Firestore and Dexie local cache.
 */
/**
 * Create or update a single payroll record in Firestore and Dexie local cache.
 */
export async function savePayrollRecord(
  record: Omit<PayrollRecord, 'id'> | PayrollRecord
): Promise<string> {
  const now = new Date().toISOString();
  const baseSalary = Number(record.baseSalary) || 0;
  const allowances = Number(record.allowances) || 0;
  const bonus = Number(record.bonus) || 0;
  const overtime = Number(record.overtime) || 0;
  const unpaidDeduction = Number(record.unpaidLeaveDeduction) || 0;
  const otherDeductions = Number(record.otherDeductions) || 0;

  const totalDeductions = Math.round(unpaidDeduction + otherDeductions);
  const grossSalary = Math.round(baseSalary + allowances + bonus + overtime);
  const netSalary = Math.max(0, Math.round(grossSalary - totalDeductions));

  const isPaid = (record.status || 'Pending') === 'Paid';
  const paymentDate = isPaid
    ? record.paymentDate || new Date().toISOString().split('T')[0]
    : '';
  const paymentReference = isPaid ? (record.paymentReference || '').trim() : '';

  const payload = {
    ...record,
    baseSalary,
    allowances,
    bonus,
    overtime,
    unpaidLeaveDeduction: unpaidDeduction,
    otherDeductions,
    totalDeductions,
    grossSalary,
    netSalary,
    status: record.status || 'Pending',
    paymentDate,
    paymentReference,
    updatedAt: now,
  };

  await safeOpenDatabase();

  const recordWithId = record as PayrollRecord;
  if (recordWithId.id) {
    const before = await db.payroll.get(recordWithId.id as any);
    if (payload.status === 'Paid' && before?.status !== 'Paid') notifyPayrollPaid(payload);
    try {
      const docRef = doc(dbFirestore, PAYROLL_COL, String(recordWithId.id));
      await updateDoc(docRef, payload as any);
    } catch (err: any) {
      console.warn('[PayrollService] Firestore update doc warning:', err?.message || err);
    }
    await db.payroll.update(recordWithId.id as any, payload);
    return String(recordWithId.id);
  } else {
    let docId = `local_pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    try {
      const fullPayload = { ...payload, createdAt: now };
      const docRef = await addDoc(collection(dbFirestore, PAYROLL_COL), fullPayload);
      docId = docRef.id;
    } catch (err: any) {
      console.warn('[PayrollService] Firestore addDoc warning:', err?.message || err);
    }
    const fullRecord: PayrollRecord = { ...payload, id: docId, createdAt: now };
    await db.payroll.put(fullRecord);
    return docId;
  }
}

/**
 * Generates monthly payroll records for all active employees for the selected month.
 * Safely integrates attendance & leave without overwriting external data.
 * Updates existing payroll if already generated for employee + month.
 */
export async function generateMonthlyPayroll(monthStr: string): Promise<number> {
  await safeOpenDatabase();

  const activeEmployees = await db.employees.where('status').notEqual('Inactive').toArray();
  if (activeEmployees.length === 0) {
    return 0;
  }

  const workingDays = getDaysInMonth(monthStr);
  const existingPayrolls = await db.payroll.where('month').equals(monthStr).toArray();

  // Read attendance & leave for integration
  const attendanceRecords = await db.attendance.toArray();
  const leaveRecords = await db.leaveRequests.toArray();
  const adjustments = await db.payrollAdjustments.toArray();

  let generatedCount = 0;

  for (const emp of activeEmployees) {
    if (!emp.id) continue;
    const empBaseSalary = Number(emp.salary) || 0;

    // Filter attendance for employee & month
    const empAttendance = attendanceRecords.filter(
      (a) => String(a.employeeId) === String(emp.id) && a.date.startsWith(monthStr)
    );

    // Filter approved leave for employee & month
    const empLeave = leaveRecords.filter(
      (l) =>
        String(l.employeeId) === String(emp.id) &&
        l.status === 'Approved' &&
        (l.fromDate.startsWith(monthStr) || l.toDate.startsWith(monthStr))
    );

    const hasAttendanceData = empAttendance.length > 0;
    let presentDays = 0;
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;

    if (hasAttendanceData) {
      empAttendance.forEach((a) => {
        if (a.status === 'Present') presentDays++;
        else if (a.status === 'Half Day') presentDays += 0.5;
        else if (a.status === 'On Leave') paidLeaveDays++;
      });
    }

    empLeave.forEach((l) => {
      if (l.leaveType === 'Unpaid Leave') {
        unpaidLeaveDays += Number(l.days) || 0;
      } else {
        if (!hasAttendanceData) {
          paidLeaveDays += Number(l.days) || 0;
        }
      }
    });

    const absentDays = hasAttendanceData
      ? Math.max(0, workingDays - (presentDays + paidLeaveDays + unpaidLeaveDays))
      : 0;

    // Daily rate calculation for unpaid leave deduction
    const dailyRate = workingDays > 0 ? empBaseSalary / workingDays : 0;
    const unpaidLeaveDeduction = Math.round(dailyRate * unpaidLeaveDays);

    // Find existing payroll record for employee + month
    const existing = existingPayrolls.find(
      (p) => String(p.employeeId) === String(emp.id) && p.month === monthStr
    );

    // Allowances & deductions come from the "Allowances & Deductions" tab when entries exist;
    // otherwise any amounts typed into the payroll record are kept.
    const empAdjustments = adjustmentsFor(adjustments, emp.id, monthStr);
    const adjTotals = sumAdjustments(empAdjustments);
    const hasAllowanceEntries = empAdjustments.some((a) => a.type === 'Allowance');
    const hasDeductionEntries = empAdjustments.some((a) => a.type === 'Deduction');
    const allowances = hasAllowanceEntries ? adjTotals.allowances : existing ? Number(existing.allowances) || 0 : 0;
    const otherDeductions = hasDeductionEntries ? adjTotals.deductions : existing ? Number(existing.otherDeductions) || 0 : 0;
    const bonus = existing ? Number(existing.bonus) || 0 : 0;

    // Overtime pay from attendance overtime hours at the employee's hourly rate
    const overtimeHours = empAttendance.reduce((s, a) => s + (Number(a.overtimeHours) || 0), 0);
    const hourlyRate = workingDays > 0 ? empBaseSalary / (workingDays * STANDARD_DAY_HOURS) : 0;
    const overtime =
      overtimeHours > 0 ? Math.round(overtimeHours * hourlyRate) : existing ? Number(existing.overtime) || 0 : 0;

    const totalDeductions = Math.round(unpaidLeaveDeduction + otherDeductions);
    const grossSalary = Math.round(empBaseSalary + allowances + bonus + overtime);
    const netSalary = Math.max(0, Math.round(grossSalary - totalDeductions));

    const isPaid = (existing?.status || 'Pending') === 'Paid';

    const payrollData: Omit<PayrollRecord, 'id'> | PayrollRecord = {
      ...(existing?.id ? { id: existing.id } : {}),
      employeeId: emp.id,
      employeeName: emp.name,
      employeeCode: emp.employeeId || '',
      department: emp.dept || 'General',
      role: emp.role || 'Staff',
      month: monthStr,
      baseSalary: empBaseSalary,
      workingDays,
      hasAttendanceData,
      presentDays,
      paidLeaveDays,
      unpaidLeaveDays,
      absentDays,
      allowances,
      bonus,
      overtime,
      unpaidLeaveDeduction,
      otherDeductions,
      totalDeductions,
      grossSalary,
      netSalary,
      status: existing?.status || 'Pending',
      paymentDate: isPaid ? existing?.paymentDate || '' : '',
      paymentMethod: existing?.paymentMethod || '',
      paymentReference: isPaid ? existing?.paymentReference || '' : '',
      notes: existing?.notes || '',
    };

    await savePayrollRecord(payrollData);
    generatedCount++;
  }

  return generatedCount;
}

/**
 * Updates payment status for a payroll record.
 */
export async function updatePayrollStatus(
  id: string | number,
  status: 'Pending' | 'Paid',
  paymentDate?: string,
  paymentReference?: string,
  notes?: string
): Promise<void> {
  const isPaid = status === 'Paid';
  const payload = {
    status,
    paymentDate: isPaid ? paymentDate || new Date().toISOString().split('T')[0] : '',
    paymentReference: isPaid ? paymentReference?.trim() || '' : '',
    notes: notes?.trim() || '',
    updatedAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(dbFirestore, PAYROLL_COL, String(id));
    await updateDoc(docRef, payload as any);
  } catch (err: any) {
    console.warn('[PayrollService] Firestore status update warning:', err?.message || err);
  }

  await safeOpenDatabase();
  const before = await db.payroll.get(id as any);
  await db.payroll.update(id as any, payload);
  if (isPaid && before && before.status !== 'Paid') notifyPayrollPaid({ ...before, ...payload });
}

/**
 * Deletes a payroll record from Firestore first, then Dexie.
 */
export async function deletePayrollRecord(id: string | number): Promise<void> {
  try {
    const docRef = doc(dbFirestore, PAYROLL_COL, String(id));
    await deleteDoc(docRef);
  } catch (err: any) {
    console.warn('[PayrollService] Firestore deleteDoc warning:', err?.message || err);
  }

  await safeOpenDatabase();
  await db.payroll.delete(id as any);
}
