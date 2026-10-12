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
  writeBatch,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, type AttendanceRecord } from '../db/database';
import { overtimeFor, type RequestKind } from '../utils/attendanceTimes';

const ATTENDANCE_COL = 'attendance';

/**
 * Fetch all attendance records from Firestore (with fallback to local Dexie cache)
 * and update local cache.
 */
export async function getAllAttendance(): Promise<AttendanceRecord[]> {
  try {
    const q = query(collection(dbFirestore, ATTENDANCE_COL), orderBy('date', 'desc'));
    const snapshot = await getDocs(q);
    const records = snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as AttendanceRecord[];

    // Sync to Dexie
    if (records.length > 0) {
      await db.attendance.clear();
      await db.attendance.bulkPut(records);
    }
    return records;
  } catch (err) {
    console.warn('[AttendanceService] Firestore fetch failed, using local cache:', err);
    return await db.attendance.toArray();
  }
}

/**
 * Fetch attendance for a specific date (YYYY-MM-DD).
 */
export async function getAttendanceByDate(dateStr: string): Promise<AttendanceRecord[]> {
  try {
    const q = query(collection(dbFirestore, ATTENDANCE_COL), where('date', '==', dateStr));
    const snapshot = await getDocs(q);
    const records = snapshot.docs.map((d) => ({
      ...d.data(),
      id: d.id,
    })) as AttendanceRecord[];

    // Sync records to Dexie
    for (const rec of records) {
      if (rec.id) {
        await db.attendance.put(rec);
      }
    }
    return records;
  } catch (err) {
    console.warn('[AttendanceService] Fetch by date failed, using cache:', err);
    return await db.attendance.where('date').equals(dateStr).toArray();
  }
}

/**
 * Add a new attendance record.
 * Writes to Firestore first, then updates Dexie cache.
 */
export async function addAttendance(recordData: Omit<AttendanceRecord, 'id'>): Promise<string> {
  const now = new Date().toISOString();
  const payload = {
    ...recordData,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Write to Firestore
  const docRef = await addDoc(collection(dbFirestore, ATTENDANCE_COL), payload);
  const fullRecord: AttendanceRecord = { ...payload, id: docRef.id };

  // 2. Update Dexie cache
  await db.attendance.put(fullRecord);
  return docRef.id;
}

/**
 * Update an existing attendance record.
 * Writes to Firestore first, then updates Dexie cache.
 */
export async function updateAttendance(
  id: string | number,
  updates: Partial<AttendanceRecord>
): Promise<void> {
  const docRef = doc(dbFirestore, ATTENDANCE_COL, String(id));
  const payload = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // 1. Write to Firestore
  await updateDoc(docRef, payload as any);

  // 2. Update Dexie cache
  await db.attendance.update(id as any, updates);
}

/**
 * Delete an attendance record.
 * Deletes from Firestore first, then deletes from Dexie cache.
 */
export async function deleteAttendance(id: string | number): Promise<void> {
  // 1. Delete from Firestore
  const docRef = doc(dbFirestore, ATTENDANCE_COL, String(id));
  await deleteDoc(docRef);

  // 2. Delete from Dexie cache
  await db.attendance.delete(id as any);
}

/**
 * Bulk save/update attendance records for a specific date.
 * Saves to Firestore batch first, then updates Dexie cache.
 */
export async function bulkSaveAttendance(
  records: Array<{
    existingId?: string | number;
    record: Omit<AttendanceRecord, 'id'>;
  }>
): Promise<void> {
  if (records.length === 0) return;

  const now = new Date().toISOString();
  const batch = writeBatch(dbFirestore);
  const dexiePuts: AttendanceRecord[] = [];
  const dexieUpdates: Array<{ id: string | number; changes: Partial<AttendanceRecord> }> = [];

  for (const item of records) {
    if (item.existingId) {
      // Update existing document
      const docRef = doc(dbFirestore, ATTENDANCE_COL, String(item.existingId));
      const payload = { ...item.record, updatedAt: now };
      batch.update(docRef, payload as any);
      // Merge so lunch / check-out / approval fields not in the payload survive
      dexieUpdates.push({ id: item.existingId, changes: payload });
    } else {
      // Create new document
      const docRef = doc(collection(dbFirestore, ATTENDANCE_COL));
      const payload = { ...item.record, createdAt: now, updatedAt: now };
      batch.set(docRef, payload);
      dexiePuts.push({ ...payload, id: docRef.id });
    }
  }

  // 1. Commit Firestore batch
  await batch.commit();

  // 2. Put into Dexie cache
  await db.attendance.bulkPut(dexiePuts);
  for (const u of dexieUpdates) await db.attendance.update(u.id as any, u.changes);
}

/**
 * Approve or reject an employee's pending attendance request.
 * - Late check-in: approved keeps them checked in as Late; rejected marks the day Absent.
 * - Long lunch: only the decision is recorded.
 * - Check-out: approved records the check-out at the time they asked; rejected keeps them checked in.
 */
export async function decideAttendanceRequest(
  rec: AttendanceRecord,
  kind: RequestKind,
  approve: boolean,
  decidedBy: string,
  adminRemarks = ''
): Promise<void> {
  const request = rec[kind];
  if (!rec.id || !request) return;
  const updates: Partial<AttendanceRecord> = {
    [kind]: {
      ...request,
      status: approve ? 'Approved' : 'Rejected',
      decidedAt: new Date().toISOString(),
      decidedBy,
      adminRemarks: adminRemarks.trim(),
    },
  };
  if (kind === 'checkInRequest') {
    updates.status = approve ? 'Late' : 'Absent';
    if (!approve) updates.checkIn = '';
  }
  if (kind === 'checkOutRequest' && approve) {
    updates.checkOut = request.time;
    updates.overtimeHours = overtimeFor(request.time);
  }
  await updateAttendance(rec.id, updates);
}
