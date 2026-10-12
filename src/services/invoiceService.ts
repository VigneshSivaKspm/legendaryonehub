import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, type Invoice } from '../db/database';

const COLLECTION_NAME = 'invoices';

export async function getAllInvoices(): Promise<Invoice[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as Invoice[];
  } catch (err) {
    console.warn('[InvoiceService] Firestore fetch failed, using cache:', err);
    return await db.invoices.toArray();
  }
}

export async function autoCorrectInvoiceStatus(inv: Invoice): Promise<Invoice> {
  const tot = Number(inv.totalAmount) || 0;
  const pd = Number(inv.paidAmount) || 0;
  const bal = Math.max(0, tot - pd);

  let expectedStatus: Invoice['status'];
  const currentStatus = inv.status || 'Sent';

  if (tot > 0 && pd >= tot) {
    expectedStatus = 'Paid';
  } else if (pd > 0 && pd < tot) {
    expectedStatus = 'Partially Paid';
  } else if (pd === 0 && (currentStatus === 'Paid' || currentStatus === 'Partially Paid')) {
    expectedStatus = 'Sent';
  } else {
    expectedStatus = currentStatus;
  }

  if (inv.status !== expectedStatus || inv.balance !== bal) {
    const updatedInv = { ...inv, status: expectedStatus, balance: bal };
    if (inv.id) {
      try {
        const docRef = doc(dbFirestore, COLLECTION_NAME, String(inv.id));
        await updateDoc(docRef, { status: expectedStatus, balance: bal, updatedAt: new Date().toISOString() });
        await db.invoices.update(inv.id as any, { status: expectedStatus, balance: bal });
      } catch (err) {
        console.warn('[InvoiceService] Auto-correct status warning:', err);
      }
    }
    return updatedInv;
  }

  return inv;
}

export async function addInvoice(invoiceData: Omit<Invoice, 'id'>): Promise<string> {
  const tot = Number(invoiceData.totalAmount) || 0;
  const pd = Number(invoiceData.paidAmount) || 0;
  const bal = Math.max(0, tot - pd);
  const now = new Date().toISOString();

  let initialStatus: Invoice['status'] = invoiceData.status;
  if (!initialStatus) {
    if (tot > 0 && pd >= tot) {
      initialStatus = 'Paid';
    } else if (pd > 0 && pd < tot) {
      initialStatus = 'Partially Paid';
    } else {
      initialStatus = 'Sent';
    }
  } else if (tot > 0 && pd >= tot) {
    initialStatus = 'Paid';
  } else if (pd > 0 && pd < tot) {
    initialStatus = 'Partially Paid';
  }

  const rawPayload = {
    ...invoiceData,
    totalAmount: tot,
    paidAmount: pd,
    balance: bal,
    status: initialStatus,
    createdAt: now,
    updatedAt: now,
  };

  const payload: Record<string, any> = {};
  Object.keys(rawPayload).forEach((key) => {
    if ((rawPayload as any)[key] !== undefined) {
      payload[key] = (rawPayload as any)[key];
    }
  });

  const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), payload);
  const fullInvoice: Invoice = { ...payload, id: docRef.id } as Invoice;
  await db.invoices.put(fullInvoice);
  return docRef.id;
}

export async function updateInvoice(id: string | number, updates: Partial<Invoice>): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  const existingDoc = await getDoc(docRef);
  const existingFromFirestore = existingDoc.exists() ? (existingDoc.data() as Partial<Invoice>) : null;
  const existingFromDexie = await db.invoices.get(id as any);
  const existing = existingFromFirestore || existingFromDexie;

  const tot = updates.totalAmount !== undefined ? Number(updates.totalAmount) : Number(existing?.totalAmount || 0);
  const pd = updates.paidAmount !== undefined ? Number(updates.paidAmount) : Number(existing?.paidAmount || 0);
  const bal = Math.max(0, tot - pd);
  const now = new Date().toISOString();

  let newStatus: Invoice['status'];
  if (updates.status !== undefined && updates.paidAmount === undefined && updates.totalAmount === undefined) {
    // Explicit status update without payment changes
    newStatus = updates.status;
  } else {
    // Recalculate status strictly based on paidAmount vs totalAmount rules
    const currentStatus = updates.status || existing?.status || 'Sent';
    if (tot > 0 && pd >= tot) {
      newStatus = 'Paid';
    } else if (pd > 0 && pd < tot) {
      newStatus = 'Partially Paid';
    } else if (pd === 0 && (currentStatus === 'Paid' || currentStatus === 'Partially Paid')) {
      newStatus = 'Sent';
    } else {
      newStatus = currentStatus;
    }
  }

  const rawPayload = {
    ...updates,
    totalAmount: tot,
    paidAmount: pd,
    balance: bal,
    status: newStatus,
    updatedAt: now,
  };

  // Strip undefined values so Firestore updateDoc never receives unsupported undefined values
  const payload: Record<string, any> = {};
  Object.keys(rawPayload).forEach((key) => {
    if ((rawPayload as any)[key] !== undefined) {
      payload[key] = (rawPayload as any)[key];
    }
  });

  // Perform Firestore update first (Source of Truth)
  await updateDoc(docRef, payload as any);

  // Update local Dexie cache only after Firestore succeeds
  await db.invoices.update(id as any, payload);
}

export async function deleteInvoice(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);
  await db.invoices.delete(id as any);
}
