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
import { db, safeOpenDatabase, type LeaveRequest } from '../db/database';
import { notifyLeaveRequested, notifyLeaveDecision } from './emailNotificationService';

const LEAVE_COL = 'leaveRequests';

/**
 * Fetch all leave requests from Firestore with fallback to Dexie local cache.
 * Updates local Dexie cache on successful fetch.
 */
export async function getAllLeaveRequests(): Promise<LeaveRequest[]> {
  try {
    const q = query(collection(dbFirestore, LEAVE_COL), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const records = snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as LeaveRequest[];

    // Sync to Dexie
    await safeOpenDatabase();
    await db.leaveRequests.clear();
    if (records.length > 0) {
      await db.leaveRequests.bulkPut(records);
    }
    return records;
  } catch (err: any) {
    console.warn('[LeaveService] Firestore fetch failed, using local cache:', err?.message || err);
    await safeOpenDatabase();
    return await db.leaveRequests.toArray();
  }
}

/**
 * Create a new leave request.
 * Saves to Firestore first, then updates Dexie cache.
 * If Firestore permission fails, falls back to Dexie cache and provides detailed deployment instructions.
 */
export async function addLeaveRequest(
  requestData: Omit<LeaveRequest, 'id'>
): Promise<string> {
  const now = new Date().toISOString();
  const payload = {
    ...requestData,
    status: requestData.status || 'Pending',
    createdAt: now,
    updatedAt: now,
  };

  try {
    // 1. Write to Firestore
    const docRef = await addDoc(collection(dbFirestore, LEAVE_COL), payload);
    const fullRecord: LeaveRequest = { ...payload, id: docRef.id };

    // 2. Update Dexie cache
    await safeOpenDatabase();
    await db.leaveRequests.put(fullRecord);
    notifyLeaveRequested(fullRecord);
    return docRef.id;
  } catch (err: any) {
    console.warn('[LeaveService] Firestore addDoc warning:', err?.message || err);
    await safeOpenDatabase();
    const tempId = `local_leave_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const localRecord: LeaveRequest = { ...payload, id: tempId };
    await db.leaveRequests.put(localRecord);

    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error(
        'Firestore permissions error: Deploy security rules via "firebase deploy --only firestore:rules". Saved to local cache.'
      );
    }
    return tempId;
  }
}

/**
 * Update an existing leave request.
 * Saves to Firestore first, then updates Dexie cache.
 */
export async function updateLeaveRequest(
  id: string | number,
  updates: Partial<LeaveRequest>
): Promise<void> {
  const payload = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(dbFirestore, LEAVE_COL, String(id));
    await updateDoc(docRef, payload as any);
  } catch (err: any) {
    console.warn('[LeaveService] Firestore updateDoc warning:', err?.message || err);
    await safeOpenDatabase();
    await db.leaveRequests.update(id as any, payload);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error(
        'Firestore permissions error: Deploy security rules via "firebase deploy --only firestore:rules". Updated in local cache.'
      );
    }
    return;
  }

  // 2. Update Dexie cache
  await safeOpenDatabase();
  await db.leaveRequests.update(id as any, payload);
}

/**
 * Update leave request status with optional approval/rejection remarks.
 * Saves to Firestore first, then updates Dexie cache.
 */
export async function updateLeaveStatus(
  id: string | number,
  status: 'Pending' | 'Approved' | 'Rejected',
  adminRemarks: string = '',
  approvedBy: string = ''
): Promise<void> {
  const payload = {
    status,
    adminRemarks: adminRemarks.trim(),
    approvedBy: approvedBy.trim(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(dbFirestore, LEAVE_COL, String(id));
    await updateDoc(docRef, payload as any);
  } catch (err: any) {
    console.warn('[LeaveService] Firestore status update warning:', err?.message || err);
    await safeOpenDatabase();
    await db.leaveRequests.update(id as any, payload);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error(
        'Firestore permissions error: Deploy security rules via "firebase deploy --only firestore:rules". Updated in local cache.'
      );
    }
    return;
  }

  // 2. Update Dexie cache
  await safeOpenDatabase();
  const before = await db.leaveRequests.get(id as any);
  await db.leaveRequests.update(id as any, payload);
  if (before && before.status !== status) notifyLeaveDecision({ ...before, ...payload });
}

/**
 * Delete a leave request.
 * Deletes from Firestore first, then deletes from Dexie cache.
 */
export async function deleteLeaveRequest(id: string | number): Promise<void> {
  try {
    const docRef = doc(dbFirestore, LEAVE_COL, String(id));
    await deleteDoc(docRef);
  } catch (err: any) {
    console.warn('[LeaveService] Firestore deleteDoc warning:', err?.message || err);
    await safeOpenDatabase();
    await db.leaveRequests.delete(id as any);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error(
        'Firestore permissions error: Deploy security rules via "firebase deploy --only firestore:rules". Deleted from local cache.'
      );
    }
    return;
  }

  // 2. Delete from Dexie cache
  await safeOpenDatabase();
  await db.leaveRequests.delete(id as any);
}
