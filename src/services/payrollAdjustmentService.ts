import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type PayrollAdjustment, type PayrollRecord } from '../db/database';

const COL = 'payrollAdjustments';

/** True when the adjustment applies to the given YYYY-MM month. */
export function adjustmentAppliesTo(adj: PayrollAdjustment, month: string): boolean {
  if (adj.recurring) {
    return adj.month <= month && (!adj.endMonth || adj.endMonth >= month);
  }
  return adj.month === month;
}

export function adjustmentsFor(
  all: PayrollAdjustment[],
  employeeId: string | number,
  month: string
): PayrollAdjustment[] {
  return all.filter((a) => String(a.employeeId) === String(employeeId) && adjustmentAppliesTo(a, month));
}

export function sumAdjustments(list: PayrollAdjustment[]): { allowances: number; deductions: number } {
  return list.reduce(
    (acc, a) => {
      const amt = Number(a.amount) || 0;
      if (a.type === 'Allowance') acc.allowances += amt;
      else acc.deductions += amt;
      return acc;
    },
    { allowances: 0, deductions: 0 }
  );
}

function clean<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out as T;
}

/**
 * Re-applies allowances/deductions to this employee's *pending* payroll records.
 * Paid records are left untouched so issued payslips never change.
 */
async function resyncPendingPayroll(employeeId: string | number): Promise<void> {
  await safeOpenDatabase();
  const [all, records] = await Promise.all([db.payrollAdjustments.toArray(), db.payroll.toArray()]);
  const pending = records.filter((r) => String(r.employeeId) === String(employeeId) && r.status !== 'Paid');

  for (const rec of pending) {
    const { allowances, deductions } = sumAdjustments(adjustmentsFor(all, employeeId, rec.month));
    const gross = Math.round((Number(rec.baseSalary) || 0) + allowances + (Number(rec.bonus) || 0) + (Number(rec.overtime) || 0));
    const attendanceDeductions =
      (Number(rec.unpaidLeaveDeduction) || 0) + (Number(rec.absentDeduction) || 0) + (Number(rec.shortTimeDeduction) || 0);
    const totalDeductions = Math.round(attendanceDeductions + deductions);
    const update: Partial<PayrollRecord> = {
      allowances,
      otherDeductions: deductions,
      grossSalary: gross,
      totalDeductions,
      netSalary: Math.max(0, gross - totalDeductions),
      updatedAt: new Date().toISOString(),
    };
    try {
      await updateDoc(doc(dbFirestore, 'payroll', String(rec.id)), update as any);
    } catch (err) {
      console.warn('[PayrollAdjustments] Payroll resync warning:', err);
    }
    await db.payroll.update(rec.id as any, update);
  }
}

export async function addPayrollAdjustment(input: Omit<PayrollAdjustment, 'id'>): Promise<string> {
  const now = new Date().toISOString();
  const payload = clean({ ...input, amount: Number(input.amount) || 0, createdAt: now, updatedAt: now });
  const ref = await addDoc(collection(dbFirestore, COL), payload);
  await safeOpenDatabase();
  await db.payrollAdjustments.put({ ...payload, id: ref.id });
  await resyncPendingPayroll(input.employeeId);
  return ref.id;
}

export async function updatePayrollAdjustment(id: string, updates: Partial<PayrollAdjustment>): Promise<void> {
  const existing = await db.payrollAdjustments.get(id);
  const payload = clean({ ...updates, updatedAt: new Date().toISOString() });
  await updateDoc(doc(dbFirestore, COL, id), payload as any);
  await db.payrollAdjustments.update(id, payload);
  if (existing) await resyncPendingPayroll(existing.employeeId);
  if (updates.employeeId !== undefined && String(updates.employeeId) !== String(existing?.employeeId)) {
    await resyncPendingPayroll(updates.employeeId);
  }
}

export async function deletePayrollAdjustment(id: string): Promise<void> {
  const existing = await db.payrollAdjustments.get(id);
  await deleteDoc(doc(dbFirestore, COL, id));
  await db.payrollAdjustments.delete(id);
  if (existing) await resyncPendingPayroll(existing.employeeId);
}
