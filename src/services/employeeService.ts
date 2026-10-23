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
import { db, type Employee, type AttendanceRecord } from '../db/database';

const EMPLOYEES_COL = 'employees';
const ATTENDANCE_COL = 'attendance';

export async function getAllEmployees(): Promise<Employee[]> {
  try {
    const q = query(collection(dbFirestore, EMPLOYEES_COL), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as Employee[];
  } catch (err) {
    console.warn('[EmployeeService] Firestore fetch failed, using cache:', err);
    return await db.employees.toArray();
  }
}

export async function addEmployee(employeeData: Omit<Employee, 'id'>): Promise<string> {
  const salary = Number(employeeData.salary) || 0;
  const workingHours = Number(employeeData.workingHours) > 0 ? Number(employeeData.workingHours) : 8;
  const dailySalary = Number(employeeData.dailySalary) > 0
    ? Number(employeeData.dailySalary)
    : (salary > 0 ? Math.round(salary / 26) : 0);
  const now = new Date().toISOString();

  const payload = {
    ...employeeData,
    salary,
    dailySalary,
    workingHours,
    status: employeeData.status || 'Active',
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await addDoc(collection(dbFirestore, EMPLOYEES_COL), payload);
  const fullEmp: Employee = { ...payload, id: docRef.id };
  await db.employees.put(fullEmp);
  return docRef.id;
}

export async function updateEmployee(id: string | number, updates: Partial<Employee>): Promise<void> {
  const docRef = doc(dbFirestore, EMPLOYEES_COL, String(id));
  const cleanUpdates: Partial<Employee> = { ...updates };
  if (cleanUpdates.salary !== undefined) cleanUpdates.salary = Number(cleanUpdates.salary) || 0;
  if (cleanUpdates.dailySalary !== undefined) cleanUpdates.dailySalary = Number(cleanUpdates.dailySalary) || 0;
  if (cleanUpdates.workingHours !== undefined) cleanUpdates.workingHours = Number(cleanUpdates.workingHours) || 8;
  const payload = { ...cleanUpdates, updatedAt: new Date().toISOString() };
  await updateDoc(docRef, payload as any);
  await db.employees.update(id as any, cleanUpdates);
}

export async function deleteEmployee(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, EMPLOYEES_COL, String(id));
  await deleteDoc(docRef);
  await db.employees.delete(id as any);
}

// Attendance
export async function getAttendanceByDate(dateStr: string): Promise<AttendanceRecord[]> {
  try {
    const q = query(collection(dbFirestore, ATTENDANCE_COL), where('date', '==', dateStr));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as AttendanceRecord[];
  } catch (err) {
    return await db.attendance.where('date').equals(dateStr).toArray();
  }
}

export async function recordAttendance(record: Omit<AttendanceRecord, 'id'>): Promise<string> {
  const now = new Date().toISOString();
  const rawPayload = {
    ...record,
    dept: record.dept || '',
    employeeCode: record.employeeCode || (record.employeeId ? String(record.employeeId) : ''),
    notes: record.notes || '',
    createdAt: now,
  };
  const clean = Object.fromEntries(
    Object.entries(rawPayload).filter(([, v]) => v !== undefined)
  );
  const docRef = await addDoc(collection(dbFirestore, ATTENDANCE_COL), clean);
  await db.attendance.put({ ...(clean as any), id: docRef.id });
  return docRef.id;
}
