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
  const now = new Date().toISOString();

  const payload = {
    ...employeeData,
    salary,
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
  const payload = { ...updates, updatedAt: new Date().toISOString() };
  await updateDoc(docRef, payload as any);
  await db.employees.update(id as any, updates);
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
  const payload = { ...record, createdAt: now };
  const docRef = await addDoc(collection(dbFirestore, ATTENDANCE_COL), payload);
  await db.attendance.put({ ...payload, id: docRef.id });
  return docRef.id;
}
