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
import { db, type Deliverable } from '../db/database';

const COLLECTION_NAME = 'deliverables';

export async function getAllDeliverables(): Promise<Deliverable[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as Deliverable[];
  } catch (err) {
    console.warn('[DeliverableService] Firestore fetch failed, using cache:', err);
    return await db.deliverables.toArray();
  }
}

export async function addDeliverable(deliverableData: Omit<Deliverable, 'id'>): Promise<string> {
  const qty = Number(deliverableData.qty) || 0;
  const rate = Number(deliverableData.rate) || 0;
  const amount = deliverableData.amount !== undefined ? Number(deliverableData.amount) : qty * rate;
  const now = new Date().toISOString();

  const rawPayload: Record<string, any> = {
    ...deliverableData,
    qty,
    rate,
    amount,
    status: deliverableData.status || 'Pending',
    createdAt: now,
    updatedAt: now,
  };

  // Strip all fields that are undefined so Firestore addDoc never receives unsupported undefined values
  const payload: Record<string, any> = {};
  Object.keys(rawPayload).forEach((key) => {
    if (rawPayload[key] !== undefined) {
      payload[key] = rawPayload[key];
    }
  });

  // Perform Firestore add first (Source of Truth)
  const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), payload);
  const fullDeliverable: Deliverable = { ...payload, id: docRef.id } as Deliverable;

  // Update local Dexie cache only after Firestore write succeeds
  await db.deliverables.put(fullDeliverable);
  return docRef.id;
}

export async function updateDeliverable(id: string | number, updates: Partial<Deliverable>): Promise<void> {
  const now = new Date().toISOString();
  const rawPayload: Record<string, any> = {
    ...updates,
    updatedAt: now,
  };

  const payload: Record<string, any> = {};
  Object.keys(rawPayload).forEach((key) => {
    if (rawPayload[key] !== undefined) {
      payload[key] = rawPayload[key];
    }
  });

  // Update Firestore first
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await updateDoc(docRef, payload);

  // Update Dexie cache after Firestore write succeeds
  const existing = await db.deliverables.get(id as any);
  if (existing) {
    await db.deliverables.put({ ...existing, ...payload });
  }
}

export async function deleteDeliverable(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);
  await db.deliverables.delete(id as any);
}
