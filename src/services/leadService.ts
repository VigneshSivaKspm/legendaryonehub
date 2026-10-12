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
import { db, type Lead } from '../db/database';

const COLLECTION_NAME = 'leads';

export function normalizeIndianPhone(phone: string): string | null {
  const trimmed = (phone || '').trim();
  if (!trimmed) return null;
  let cleaned = trimmed.replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export function validateEmail(email: string): boolean {
  const trimmed = (email || '').trim();
  if (!trimmed) return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(trimmed);
}

export async function getAllLeads(): Promise<Lead[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as Lead[];
  } catch (err) {
    return await db.leads.toArray();
  }
}

export async function addLead(data: Omit<Lead, 'id'>): Promise<string> {
  const normalizedPhone = normalizeIndianPhone(data.phone);
  if (!normalizedPhone) {
    throw new Error(`Invalid Indian phone number: "${data.phone}". Must be a valid 10-digit Indian mobile number (starts with 6-9).`);
  }
  const trimmedEmail = (data.email || '').trim();
  if (trimmedEmail && !validateEmail(trimmedEmail)) {
    throw new Error(`Invalid email address: "${data.email}".`);
  }

  const now = new Date().toISOString();
  const payload = {
    ...data,
    phone: normalizedPhone,
    email: trimmedEmail,
    createdAt: now,
  };
  const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), payload);
  await db.leads.put({ ...payload, id: docRef.id });
  return docRef.id;
}

export async function updateLead(id: string | number, updates: Partial<Lead>): Promise<void> {
  const payloadUpdates: Partial<Lead> = { ...updates };
  if (updates.phone !== undefined) {
    const normalizedPhone = normalizeIndianPhone(updates.phone);
    if (!normalizedPhone) {
      throw new Error(`Invalid Indian phone number: "${updates.phone}".`);
    }
    payloadUpdates.phone = normalizedPhone;
  }
  if (updates.email !== undefined) {
    const trimmedEmail = (updates.email || '').trim();
    if (trimmedEmail && !validateEmail(trimmedEmail)) {
      throw new Error(`Invalid email address: "${updates.email}".`);
    }
    payloadUpdates.email = trimmedEmail;
  }

  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await updateDoc(docRef, payloadUpdates as any);
  await db.leads.update(id as any, payloadUpdates);
}

export async function deleteLead(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);
  await db.leads.delete(id as any);
}
