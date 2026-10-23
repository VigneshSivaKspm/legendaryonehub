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
} from "firebase/firestore";
import { dbFirestore } from "../config/firebase";
import { db, safeOpenDatabase, type PayrollRecord } from "../db/database";
import { adjustmentsFor, sumAdjustments } from "./payrollAdjustmentService";
import { computeMonthPay, type MonthPay } from "../utils/salary";
import { notifyPayrollPaid } from "./emailNotificationService";

const PAYROLL_COL = "payroll";

/**
 * Returns total days in a month string "YYYY-MM" (e.g., "2026-10" -> 31).
 */
export function getDaysInMonth(monthStr: string): number {
  if (!monthStr || !monthStr.includes("-")) return 30;
  const [year, month] = monthStr.split("-").map(Number);
  if (!year || !month) return 30;
  return new Date(year, month, 0).getDate();
}

/**
 * Fetch all payroll records from Firestore with fallback to Dexie local cache.
 */
export async function getAllPayroll(): Promise<PayrollRecord[]> {
  try {
    const q = query(
      collection(dbFirestore, PAYROLL_COL),
      orderBy("month", "desc"),
    );
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
    console.warn(
      "[PayrollService] Firestore fetch failed, using local cache:",
      err?.message || err,
    );
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
  record: Omit<PayrollRecord, "id"> | PayrollRecord,
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

  const isPaid = (record.status || "Pending") === "Paid";
  const paymentDate = isPaid
    ? record.paymentDate || new Date().toISOString().split("T")[0]
    : "";
  const paymentReference = isPaid ? (record.paymentReference || "").trim() : "";

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
    status: record.status || "Pending",
    paymentDate,
    paymentReference,
    updatedAt: now,
  };

  await safeOpenDatabase();

  const recordWithId = record as PayrollRecord;
  if (recordWithId.id) {
    const before = await db.payroll.get(recordWithId.id as any);
    if (payload.status === "Paid" && before?.status !== "Paid")
      notifyPayrollPaid(payload);
    try {
      const docRef = doc(dbFirestore, PAYROLL_COL, String(recordWithId.id));
      await updateDoc(docRef, payload as any);
    } catch (err: any) {
      console.warn(
        "[PayrollService] Firestore update doc warning:",
        err?.message || err,
      );
    }
    await db.payroll.update(recordWithId.id as any, payload);
    return String(recordWithId.id);
  } else {
    let docId = `local_pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    try {
      const fullPayload = { ...payload, createdAt: now };
      const docRef = await addDoc(
        collection(dbFirestore, PAYROLL_COL),
        fullPayload,
      );
      docId = docRef.id;
    } catch (err: any) {
      console.warn(
        "[PayrollService] Firestore addDoc warning:",
        err?.message || err,
      );
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
/** Salary-rule fields shared by generated payroll records (see utils/salary.ts). */
export function payFieldsFrom(pay: MonthPay) {
  return {
    workingDays: pay.workingDays,
    dailySalary: Math.round(pay.rates.daily * 100) / 100,
    workingHours: pay.workingHours,
    hasAttendanceData: pay.hasAttendanceData,
    presentDays: pay.presentDays + pay.halfDays * 0.5,
    paidLeaveDays: pay.paidLeaveDays,
    unpaidLeaveDays: pay.unpaidLeaveDays,
    absentDays: pay.absentDays,
    unpaidLeaveDeduction: pay.unpaidLeaveDeduction,
    absentDeduction: pay.absentDeduction,
    shortMinutes: pay.shortMinutes,
    lateMinutes: pay.lateMinutes,
    earlyLeaveMinutes: pay.earlyLeaveMinutes,
    extraLunchMinutes: pay.extraLunchMinutes,
    shortTimeDeduction: pay.shortTimeDeduction,
    overtimeMinutes: pay.overtimeMinutes,
    dailyRate: Math.round(pay.rates.daily * 100) / 100,
    hourlyRate: Math.round(pay.rates.hourly * 100) / 100,
    perMinuteRate: Math.round(pay.rates.perMinute * 10000) / 10000,
    workedMinutes: pay.workedMinutes,
  };
}

/**
 * Builds (or rebuilds) the month's payroll for every active employee.
 * Fixed salary minus absent days, unpaid leave and short time (late / early / long lunch, per minute),
 * split over the company's working days. Overtime, bonus and incentives are only what an admin entered.
 */
export async function generateMonthlyPayroll(
  monthStr: string,
  workingWeekdays?: string[],
): Promise<number> {
  await safeOpenDatabase();

  const activeEmployees = await db.employees
    .where("status")
    .notEqual("Inactive")
    .toArray();
  if (activeEmployees.length === 0) {
    return 0;
  }

  const existingPayrolls = await db.payroll
    .where("month")
    .equals(monthStr)
    .toArray();
  const attendanceRecords = await db.attendance.toArray();
  const leaveRecords = await db.leaveRequests.toArray();
  const adjustments = await db.payrollAdjustments.toArray();

  let generatedCount = 0;

  for (const emp of activeEmployees) {
    if (!emp.id) continue;
    const empBaseSalary = Number(emp.salary) || 0;
    const empDailySalary = Number(emp.dailySalary) || 0;
    const empWorkingHours = Number(emp.workingHours) || 8;

    const pay = computeMonthPay({
      month: monthStr,
      salary: empBaseSalary,
      dailySalary: empDailySalary,
      workingHours: empWorkingHours,
      workingWeekdays,
      attendance: attendanceRecords.filter(
        (a) => String(a.employeeId) === String(emp.id),
      ),
      leaves: leaveRecords.filter(
        (l) => String(l.employeeId) === String(emp.id),
      ),
    });

    const existing = existingPayrolls.find(
      (p) => String(p.employeeId) === String(emp.id) && p.month === monthStr,
    );

    // Allowances & deductions come from the "Allowances & Deductions" tab when entries exist;
    // otherwise any amounts typed into the payroll record are kept.
    const empAdjustments = adjustmentsFor(adjustments, emp.id, monthStr);
    const adjTotals = sumAdjustments(empAdjustments);
    const hasAllowanceEntries = empAdjustments.some(
      (a) => a.type === "Allowance",
    );
    const hasDeductionEntries = empAdjustments.some(
      (a) => a.type === "Deduction",
    );
    const allowances = hasAllowanceEntries
      ? adjTotals.allowances
      : existing
        ? Number(existing.allowances) || 0
        : 0;
    const otherDeductions = hasDeductionEntries
      ? adjTotals.deductions
      : existing
        ? Number(existing.otherDeductions) || 0
        : 0;
    // Manual only: 0 unless an admin entered an amount
    const bonus = existing ? Number(existing.bonus) || 0 : 0;
    const overtime = existing ? Number(existing.overtime) || 0 : 0;

    // Only calculate for presented days and worked hours
    const earnedBase = pay.hasAttendanceData ? pay.earnedToDate : empBaseSalary;
    const unworkedDeduction = pay.hasAttendanceData
      ? Math.max(0, empBaseSalary - earnedBase)
      : 0;
    const totalDeductions = Math.round(unworkedDeduction + otherDeductions);
    const grossSalary = Math.round(
      empBaseSalary + allowances + bonus + overtime,
    );
    const netSalary = Math.max(
      0,
      Math.round(earnedBase + allowances + bonus + overtime - otherDeductions),
    );

    const isPaid = (existing?.status || "Pending") === "Paid";

    const payrollData: Omit<PayrollRecord, "id"> | PayrollRecord = {
      ...(existing?.id ? { id: existing.id } : {}),
      employeeId: emp.id,
      employeeName: emp.name,
      employeeCode: emp.employeeId || "",
      department: emp.dept || "",
      role: emp.role || "Staff",
      month: monthStr,
      baseSalary: empBaseSalary,
      ...payFieldsFrom(pay),
      allowances,
      bonus,
      overtime,
      otherDeductions,
      totalDeductions,
      grossSalary,
      netSalary,
      status: existing?.status || "Pending",
      paymentDate: isPaid ? existing?.paymentDate || "" : "",
      paymentMethod: existing?.paymentMethod || "",
      paymentReference: isPaid ? existing?.paymentReference || "" : "",
      notes: existing?.notes || "",
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
  status: "Pending" | "Paid",
  paymentDate?: string,
  paymentReference?: string,
  notes?: string,
): Promise<void> {
  const isPaid = status === "Paid";
  const payload = {
    status,
    paymentDate: isPaid
      ? paymentDate || new Date().toISOString().split("T")[0]
      : "",
    paymentReference: isPaid ? paymentReference?.trim() || "" : "",
    notes: notes?.trim() || "",
    updatedAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(dbFirestore, PAYROLL_COL, String(id));
    await updateDoc(docRef, payload as any);
  } catch (err: any) {
    console.warn(
      "[PayrollService] Firestore status update warning:",
      err?.message || err,
    );
  }

  await safeOpenDatabase();
  const before = await db.payroll.get(id as any);
  await db.payroll.update(id as any, payload);
  if (isPaid && before && before.status !== "Paid")
    notifyPayrollPaid({ ...before, ...payload });
}

/**
 * Deletes a payroll record from Firestore first, then Dexie.
 */
export async function deletePayrollRecord(id: string | number): Promise<void> {
  try {
    const docRef = doc(dbFirestore, PAYROLL_COL, String(id));
    await deleteDoc(docRef);
  } catch (err: any) {
    console.warn(
      "[PayrollService] Firestore deleteDoc warning:",
      err?.message || err,
    );
  }

  await safeOpenDatabase();
  await db.payroll.delete(id as any);
}
