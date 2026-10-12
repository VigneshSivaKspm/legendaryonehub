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
import { db, type Client } from '../db/database';

const COLLECTION_NAME = 'clients';

export async function getAllClients(): Promise<Client[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as Client[];
  } catch (err) {
    console.warn('[ClientService] Firestore fetch failed, falling back to cache:', err);
    return await db.clients.toArray();
  }
}

export async function getClientById(id: string | number): Promise<Client | undefined> {
  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { ...docSnap.data(), id: docSnap.id } as Client;
    }
    return await db.clients.get(id as any);
  } catch (err) {
    console.warn('[ClientService] Firestore getById failed, falling back to cache:', err);
    return await db.clients.get(id as any);
  }
}

export async function addClient(clientData: Omit<Client, 'id'>): Promise<string> {
  const totalVal = Number(clientData.totalValue) || 0;
  const paidVal = Number(clientData.paid) || 0;
  const pendingVal = Math.max(0, totalVal - paidVal);
  const now = new Date().toISOString();

  const newClientData = {
    ...clientData,
    pricing: Number(clientData.pricing) || totalVal,
    totalValue: totalVal,
    paid: paidVal,
    pending: pendingVal,
    projects: Number(clientData.projects) || 0,
    status: clientData.status || 'Active',
    joinDate: clientData.joinDate || new Date().toLocaleDateString('en-GB'),
    createdAt: now,
    updatedAt: now,
  };

  // Add document to Firestore root collection 'clients'
  const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), newClientData);
  const fullClient: Client = { ...newClientData, id: docRef.id };

  // Optimistic local cache update
  await db.clients.put(fullClient);
  return docRef.id;
}

export async function updateClient(id: string | number, updates: Partial<Client>): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  const existing = await getClientById(id);

  const updatedTotal = updates.totalValue !== undefined ? Number(updates.totalValue) : (existing?.totalValue || 0);
  const updatedPaid = updates.paid !== undefined ? Number(updates.paid) : (existing?.paid || 0);
  const calculatedPending = Math.max(0, updatedTotal - updatedPaid);
  const now = new Date().toISOString();

  const payload: Partial<Client> = {
    ...updates,
    totalValue: updatedTotal,
    paid: updatedPaid,
    pending: calculatedPending,
    updatedAt: now,
  };

  // Update in Firestore
  await updateDoc(docRef, payload as any);

  // Optimistic local cache update
  await db.clients.update(id as any, payload);
}

export async function archiveClient(id: string | number): Promise<void> {
  await updateClient(id, { status: 'Archived' });
}

export async function deleteClient(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);
  await db.clients.delete(id as any);
}
