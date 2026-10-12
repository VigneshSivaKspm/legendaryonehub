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
import { db, type CompanyService } from '../db/database';

const COLLECTION_NAME = 'services';

export async function getAllServices(): Promise<CompanyService[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as CompanyService[];

    if (list.length > 0) {
      await db.services.bulkPut(list);
    }
    return list;
  } catch (err) {
    console.warn('[ServiceService] Firestore fetch failed, falling back to cache:', err);
    return await db.services.toArray();
  }
}

export async function getServiceById(id: string | number): Promise<CompanyService | undefined> {
  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = { ...docSnap.data(), id: docSnap.id } as CompanyService;
      await db.services.put(data);
      return data;
    }
    return await db.services.get(id as any);
  } catch (err) {
    console.warn('[ServiceService] Firestore getById failed, falling back to cache:', err);
    return await db.services.get(id as any);
  }
}

export async function addService(serviceData: Omit<CompanyService, 'id'>): Promise<string> {
  const now = new Date().toISOString();

  const payload: Record<string, any> = {
    name: (serviceData.name || '').trim(),
    description: (serviceData.description || '').trim(),
    pricingType: serviceData.pricingType || 'Fixed Price',
    defaultPrice: Number(serviceData.defaultPrice) || 0,
    status: serviceData.status || 'Active',
    createdAt: now,
    updatedAt: now,
  };

  // Strip undefined fields
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([_, v]) => v !== undefined)
  );

  // 1. Write to Firestore first
  const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), cleanPayload);

  // 2. Cache in Dexie using actual Firestore document ID
  const fullService: CompanyService = {
    ...(cleanPayload as Omit<CompanyService, 'id'>),
    id: docRef.id,
  };

  await db.services.put(fullService);

  return docRef.id;
}

export async function updateService(id: string | number, updates: Partial<CompanyService>): Promise<void> {
  const now = new Date().toISOString();

  const payload: Record<string, any> = {
    ...updates,
    updatedAt: now,
  };

  if (updates.defaultPrice !== undefined) {
    payload.defaultPrice = Number(updates.defaultPrice) || 0;
  }
  if (updates.name !== undefined) {
    payload.name = updates.name.trim();
  }
  if (updates.description !== undefined) {
    payload.description = updates.description.trim();
  }

  // Strip undefined fields
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([_, v]) => v !== undefined)
  );

  // 1. Update in Firestore
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await updateDoc(docRef, cleanPayload);

  // 2. Update Dexie cache
  const existing = await db.services.get(id as any);
  if (existing) {
    await db.services.update(id as any, cleanPayload);
  } else {
    await db.services.put({ ...cleanPayload, id: String(id) } as CompanyService);
  }
}

export async function toggleServiceStatus(id: string | number): Promise<void> {
  const service = await db.services.get(id as any);
  const currentStatus = service?.status || 'Active';
  const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';

  await updateService(id, { status: newStatus });
}

export async function archiveService(id: string | number): Promise<void> {
  await updateService(id, { status: 'Archived' });
}

export async function deleteService(id: string | number): Promise<void> {
  // 1. Delete from Firestore
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);

  // 2. Delete from Dexie cache
  await db.services.delete(id as any);
}
