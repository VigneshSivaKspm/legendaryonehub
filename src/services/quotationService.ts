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
import { db, type Quotation } from '../db/database';

const COLLECTION_NAME = 'quotations';

export async function getAllQuotations(): Promise<Quotation[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as Quotation[];
  } catch (err) {
    console.warn('[QuotationService] Firestore fetch failed, using cache:', err);
    return await db.quotations.toArray();
  }
}

export async function addQuotation(data: Omit<Quotation, 'id'>): Promise<string> {
  const now = new Date().toISOString();
  const rawPayload: Record<string, any> = {
    ...data,
    createdAt: now,
  };

  const payload: Record<string, any> = {};
  Object.keys(rawPayload).forEach((key) => {
    if (rawPayload[key] !== undefined) {
      payload[key] = rawPayload[key];
    }
  });

  // Save to Firestore first (Source of Truth)
  const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), payload);
  const fullQuotation: Quotation = { ...payload, id: docRef.id } as Quotation;

  // Update local Dexie cache after Firestore write succeeds
  await db.quotations.put(fullQuotation);
  return docRef.id;
}

export async function updateQuotation(id: string | number, updates: Partial<Quotation>): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await updateDoc(docRef, updates);
  const existing = await db.quotations.get(id as any);
  if (existing) {
    await db.quotations.put({ ...existing, ...updates });
  }
}

export async function deleteQuotation(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);
  await db.quotations.delete(id as any);
}
