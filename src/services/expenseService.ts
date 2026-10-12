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
import { db, type Expense } from '../db/database';
import { syncProjectFinancials } from './projectService';

const COLLECTION_NAME = 'expenses';

export async function getAllExpenses(): Promise<Expense[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as Expense[];
  } catch (err) {
    console.warn('[ExpenseService] Firestore fetch failed, using cache:', err);
    return await db.expenses.toArray();
  }
}

export async function addExpense(expenseData: Omit<Expense, 'id'>): Promise<string> {
  const amount = Number(expenseData.amount) || 0;
  const now = new Date().toISOString();

  const rawPayload: Record<string, any> = {
    ...expenseData,
    amount,
    createdAt: now,
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
  const fullExpense: Expense = { ...payload, id: docRef.id } as Expense;

  // Update local Dexie cache only after Firestore write succeeds
  await db.expenses.put(fullExpense);
  await syncProjectFinancials(fullExpense.projectId);
  return docRef.id;
}

export async function deleteExpense(id: string | number): Promise<void> {
  const existing = await db.expenses.get(id as any);
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);
  await db.expenses.delete(id as any);
  await syncProjectFinancials(existing?.projectId);
}
