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
import { db, type Payment } from '../db/database';
import { updateInvoice } from './invoiceService';
import { syncProjectFinancials } from './projectService';

const COLLECTION_NAME = 'payments';

export async function getAllPayments(): Promise<Payment[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as Payment[];
  } catch (err) {
    console.warn('[PaymentService] Firestore fetch failed, using cache:', err);
    return await db.payments.toArray();
  }
}

export async function addPayment(paymentData: Omit<Payment, 'id'>): Promise<string> {
  const amount = Number(paymentData.amount) || 0;
  const now = new Date().toISOString();

  // Inherit the project from the invoice when the caller didn't pass one
  let projectId = paymentData.projectId;
  let projectName = paymentData.projectName;
  if ((projectId === undefined || projectId === '') && paymentData.invoiceId !== undefined) {
    const inv = await db.invoices.get(paymentData.invoiceId as any);
    if (inv?.projectId !== undefined) {
      projectId = inv.projectId;
      projectName = projectName || inv.projectName;
    }
  }

  const rawPayload: Record<string, any> = {
    ...paymentData,
    projectId,
    projectName,
    amount,
    status: paymentData.status || 'Confirmed',
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
  const fullPayment: Payment = { ...payload, id: docRef.id } as Payment;

  // Update local Dexie cache only after Firestore write succeeds
  await db.payments.put(fullPayment);

  // Automatically update invoice paid amount if invoiceId or invoiceNumber is attached
  if (paymentData.invoiceId || paymentData.invoiceNumber) {
    try {
      let invDoc = paymentData.invoiceId ? await db.invoices.get(paymentData.invoiceId as any) : null;
      if (!invDoc && paymentData.invoiceNumber) {
        invDoc = await db.invoices.where('invoiceNumber').equals(paymentData.invoiceNumber).first();
      }
      if (invDoc && invDoc.id && fullPayment.status === 'Confirmed') {
        const newPaid = (invDoc.paidAmount || 0) + amount;
        await updateInvoice(invDoc.id, { paidAmount: newPaid });
      }
    } catch (e) {
      console.warn('[PaymentService] Invoice balance update warning:', e);
    }
  }

  await syncProjectFinancials(projectId);

  return docRef.id;
}

export async function deletePayment(id: string | number): Promise<void> {
  const existingPayment = await db.payments.get(id as any);
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);
  await db.payments.delete(id as any);

  if (existingPayment && existingPayment.invoiceId) {
    try {
      const invDoc = await db.invoices.get(existingPayment.invoiceId as any);
      if (invDoc && existingPayment.status === 'Confirmed') {
        const remainingPaid = Math.max(0, (invDoc.paidAmount || 0) - (existingPayment.amount || 0));
        await updateInvoice(invDoc.id!, { paidAmount: remainingPaid });
      }
    } catch (e) {
      console.warn('[PaymentService] Invoice balance recalculation on delete warning:', e);
    }
  }

  if (existingPayment) {
    let projectId = existingPayment.projectId;
    if (projectId === undefined && existingPayment.invoiceId !== undefined) {
      projectId = (await db.invoices.get(existingPayment.invoiceId as any))?.projectId;
    }
    await syncProjectFinancials(projectId);
  }
}

/**
 * Edit a payment (amount, date, method, reference, status, notes).
 * Keeps a linked invoice's paid amount right and re-syncs the project's received total.
 */
export async function updatePayment(id: string | number, updates: Partial<Payment>): Promise<void> {
  const existing = await db.payments.get(id as any);
  const payload: Record<string, any> = {};
  Object.entries({ ...updates, updatedAt: new Date().toISOString() }).forEach(([k, v]) => {
    if (v !== undefined) payload[k] = k === 'amount' ? Number(v) || 0 : v;
  });

  await updateDoc(doc(dbFirestore, COLLECTION_NAME, String(id)), payload);
  await db.payments.update(id as any, payload);

  if (existing?.invoiceId !== undefined) {
    try {
      const inv = await db.invoices.get(existing.invoiceId as any);
      if (inv?.id !== undefined) {
        const before = existing.status === 'Confirmed' ? Number(existing.amount) || 0 : 0;
        const nextStatus = payload.status ?? existing.status;
        const nextAmount = payload.amount ?? existing.amount;
        const after = nextStatus === 'Confirmed' ? Number(nextAmount) || 0 : 0;
        if (after !== before) await updateInvoice(inv.id, { paidAmount: Math.max(0, (inv.paidAmount || 0) - before + after) });
      }
    } catch (e) {
      console.warn('[PaymentService] Invoice balance update on edit warning:', e);
    }
  }

  let projectId = existing?.projectId;
  if (projectId === undefined && existing?.invoiceId !== undefined) {
    projectId = (await db.invoices.get(existing.invoiceId as any))?.projectId;
  }
  await syncProjectFinancials(projectId);
}
