import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, type TimesheetEntry } from '../db/database';

const TIMESHEETS_COL = 'timesheets';

/**
 * Fetch all timesheet records from Firestore with fallback to Dexie local cache.
 * Updates local Dexie cache on successful fetch.
 */
export async function getAllTimesheets(): Promise<TimesheetEntry[]> {
  try {
    const q = query(collection(dbFirestore, TIMESHEETS_COL), orderBy('date', 'desc'));
    const snapshot = await getDocs(q);
    const records = snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as TimesheetEntry[];

    // Sync to Dexie
    if (records.length > 0) {
      await db.timesheets.clear();
      await db.timesheets.bulkPut(records);
    }
    return records;
  } catch (err) {
    console.warn('[TimesheetService] Firestore fetch failed, using local cache:', err);
    return await db.timesheets.toArray();
  }
}

/**
 * Create a new timesheet entry.
 * Saves to Firestore first, then updates Dexie cache.
 */
export async function addTimesheet(
  entryData: Omit<TimesheetEntry, 'id'>
): Promise<string> {
  const now = new Date().toISOString();
  const payload = {
    ...entryData,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Write to Firestore
  const docRef = await addDoc(collection(dbFirestore, TIMESHEETS_COL), payload);
  const fullRecord: TimesheetEntry = { ...payload, id: docRef.id };

  // 2. Update Dexie cache
  await db.timesheets.put(fullRecord);
  return docRef.id;
}

/**
 * Update an existing timesheet entry.
 * Saves to Firestore first, then updates Dexie cache.
 */
export async function updateTimesheet(
  id: string | number,
  updates: Partial<TimesheetEntry>
): Promise<void> {
  const docRef = doc(dbFirestore, TIMESHEETS_COL, String(id));
  const payload = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // 1. Write to Firestore
  await updateDoc(docRef, payload as any);

  // 2. Update Dexie cache
  await db.timesheets.update(id as any, updates);
}

/**
 * Delete a timesheet entry.
 * Deletes from Firestore first, then deletes from Dexie cache.
 */
export async function deleteTimesheet(id: string | number): Promise<void> {
  // 1. Delete from Firestore
  const docRef = doc(dbFirestore, TIMESHEETS_COL, String(id));
  await deleteDoc(docRef);

  // 2. Delete from Dexie cache
  await db.timesheets.delete(id as any);
}
