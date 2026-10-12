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
import { db, safeOpenDatabase, type AssetRecord, type AssetStatus, type AssetHistoryEntry } from '../db/database';

const COLLECTION_NAME = 'assets';

/**
 * Strips undefined properties from an object prior to Firestore/Dexie writes.
 */
function cleanPayload<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

export async function getAllAssets(): Promise<AssetRecord[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as AssetRecord[];

    if (list.length > 0) {
      await safeOpenDatabase();
      await db.assets.bulkPut(list);
    }
    return list;
  } catch (err: any) {
    console.warn('[AssetService] Firestore fetch failed, using local cache:', err?.message || err);
    await safeOpenDatabase();
    return await db.assets.toArray();
  }
}

export async function getAssetById(id: string): Promise<AssetRecord | undefined> {
  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = { ...docSnap.data(), id: docSnap.id } as AssetRecord;
      await safeOpenDatabase();
      await db.assets.put(data);
      return data;
    }
    await safeOpenDatabase();
    return await db.assets.get(String(id));
  } catch (err: any) {
    console.warn('[AssetService] Firestore getById failed, using cache:', err?.message || err);
    await safeOpenDatabase();
    return await db.assets.get(String(id));
  }
}

export async function addAsset(
  assetData: Omit<AssetRecord, 'id' | 'createdAt' | 'updatedAt' | 'history'>,
  performedBy: string = 'Admin'
): Promise<string> {
  await safeOpenDatabase();
  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];

  // Prevent duplicate asset code
  const existingCodeMatch = await db.assets
    .filter((a) => a.assetCode.toLowerCase().trim() === assetData.assetCode.toLowerCase().trim())
    .first();

  if (existingCodeMatch) {
    throw new Error(`Asset Code "${assetData.assetCode}" already exists. Please use a unique Asset ID/Code.`);
  }

  const initialHistory: AssetHistoryEntry[] = [
    {
      action: 'Created',
      date: todayDate,
      performedBy,
      notes: 'Asset created in catalog',
    },
  ];

  if (assetData.status === 'Assigned' && assetData.assignedEmployeeName) {
    initialHistory.push({
      action: 'Assigned',
      date: todayDate,
      performedBy,
      notes: `Initial assignment to ${assetData.assignedEmployeeName}`,
      assignedToEmployeeId: assetData.assignedEmployeeId,
      assignedToEmployeeName: assetData.assignedEmployeeName,
    });
  }

  const payload: Omit<AssetRecord, 'id'> = {
    assetName: assetData.assetName.trim(),
    assetCode: assetData.assetCode.trim().toUpperCase(),
    category: assetData.category,
    brand: (assetData.brand || '').trim(),
    model: (assetData.model || '').trim(),
    serialNumber: (assetData.serialNumber || '').trim(),
    purchaseDate: assetData.purchaseDate || todayDate,
    purchaseCost: Math.max(0, Number(assetData.purchaseCost) || 0),
    warrantyExpiry: assetData.warrantyExpiry || '',
    status: assetData.status || 'Available',
    assignedEmployeeId: assetData.assignedEmployeeId || '',
    assignedEmployeeName: assetData.assignedEmployeeName || '',
    locationDepartment: (assetData.locationDepartment || '').trim(),
    vendorSupplier: (assetData.vendorSupplier || '').trim(),
    notes: (assetData.notes || '').trim(),
    history: initialHistory,
    createdAt: now,
    updatedAt: now,
  };

  const cleaned = cleanPayload(payload);

  try {
    // 1. Write to Firestore first
    const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), cleaned);
    const fullRecord: AssetRecord = {
      ...(cleaned as Omit<AssetRecord, 'id'>),
      id: docRef.id,
    };

    // 2. Cache saved record in Dexie
    await db.assets.put(fullRecord);
    return docRef.id;
  } catch (err: any) {
    console.warn('[AssetService] Firestore addDoc warning:', err?.message || err);

    // Save to local cache as fallback so user data is not lost
    const tempId = `local_asset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const localRecord: AssetRecord = {
      ...(cleaned as Omit<AssetRecord, 'id'>),
      id: tempId,
    };
    await db.assets.put(localRecord);

    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error(
        'Firestore permission error: Security rules must be deployed to Cloud Firestore via "firebase deploy --only firestore:rules". Record saved to local cache.'
      );
    }
    return tempId;
  }
}

export async function updateAsset(
  id: string,
  updates: Partial<AssetRecord>,
  performedBy: string = 'Admin'
): Promise<void> {
  await safeOpenDatabase();
  const existing = await getAssetById(id);
  if (!existing) {
    throw new Error(`Asset with ID "${id}" not found.`);
  }

  // Check code uniqueness if assetCode changed
  if (updates.assetCode && updates.assetCode.toLowerCase().trim() !== existing.assetCode.toLowerCase().trim()) {
    const codeMatch = await db.assets
      .filter((a) => a.id !== id && a.assetCode.toLowerCase().trim() === updates.assetCode!.toLowerCase().trim())
      .first();
    if (codeMatch) {
      throw new Error(`Asset Code "${updates.assetCode}" is already in use by another asset.`);
    }
  }

  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];
  const history: AssetHistoryEntry[] = [...(existing.history || [])];

  if (updates.status && updates.status !== existing.status) {
    let actionType: AssetHistoryEntry['action'] = 'Updated';
    if (updates.status === 'Assigned') actionType = 'Assigned';
    else if (updates.status === 'Available' && existing.status === 'Assigned') actionType = 'Returned';
    else if (updates.status === 'Under Maintenance') actionType = 'Under Maintenance';
    else if (updates.status === 'Retired') actionType = 'Retired';

    history.push({
      action: actionType,
      date: todayDate,
      performedBy,
      notes: `Status changed from ${existing.status} to ${updates.status}`,
      assignedToEmployeeId: updates.assignedEmployeeId ?? existing.assignedEmployeeId,
      assignedToEmployeeName: updates.assignedEmployeeName ?? existing.assignedEmployeeName,
    });
  } else if (
    updates.assignedEmployeeId !== undefined &&
    updates.assignedEmployeeId !== existing.assignedEmployeeId
  ) {
    const isReassign = Boolean(existing.assignedEmployeeId);
    history.push({
      action: isReassign ? 'Reassigned' : 'Assigned',
      date: todayDate,
      performedBy,
      notes: updates.assignedEmployeeName
        ? `Asset ${isReassign ? 'reassigned' : 'assigned'} to ${updates.assignedEmployeeName}`
        : 'Asset assignment updated',
      assignedToEmployeeId: updates.assignedEmployeeId,
      assignedToEmployeeName: updates.assignedEmployeeName,
    });
  }

  const payload: Partial<AssetRecord> = {
    ...updates,
    assetCode: updates.assetCode ? updates.assetCode.trim().toUpperCase() : existing.assetCode,
    purchaseCost: updates.purchaseCost !== undefined ? Math.max(0, Number(updates.purchaseCost) || 0) : existing.purchaseCost,
    history,
    updatedAt: now,
  };

  const cleaned = cleanPayload(payload);

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    await updateDoc(docRef, cleaned as any);
    await db.assets.update(String(id), cleaned);
  } catch (err: any) {
    console.warn('[AssetService] Firestore updateDoc warning:', err?.message || err);
    await db.assets.update(String(id), cleaned);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error(
        'Firestore permission error: Security rules must be deployed to Cloud Firestore via "firebase deploy --only firestore:rules". Updated local cache.'
      );
    }
  }
}

export async function assignAsset(
  id: string,
  employeeId: string | number,
  employeeName: string,
  notes?: string,
  performedBy: string = 'Admin'
): Promise<void> {
  const existing = await getAssetById(id);
  if (!existing) throw new Error(`Asset with ID "${id}" not found.`);

  const isReassignment = Boolean(existing.assignedEmployeeId);
  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];

  const history: AssetHistoryEntry[] = [...(existing.history || [])];
  history.push({
    action: isReassignment ? 'Reassigned' : 'Assigned',
    date: todayDate,
    performedBy,
    notes: notes?.trim() || `Asset ${isReassignment ? 'reassigned' : 'assigned'} to ${employeeName}`,
    assignedToEmployeeId: employeeId,
    assignedToEmployeeName: employeeName,
  });

  const payload: Partial<AssetRecord> = {
    status: 'Assigned',
    assignedEmployeeId: employeeId,
    assignedEmployeeName: employeeName,
    history,
    updatedAt: now,
  };

  await updateAsset(id, payload, performedBy);
}

export async function unassignAsset(
  id: string,
  newStatus: AssetStatus = 'Available',
  notes?: string,
  performedBy: string = 'Admin'
): Promise<void> {
  const existing = await getAssetById(id);
  if (!existing) throw new Error(`Asset with ID "${id}" not found.`);

  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];

  const history: AssetHistoryEntry[] = [...(existing.history || [])];
  history.push({
    action: 'Returned',
    date: todayDate,
    performedBy,
    notes: notes?.trim() || `Asset returned. Status set to ${newStatus}`,
    assignedToEmployeeId: '',
    assignedToEmployeeName: '',
  });

  const payload: Partial<AssetRecord> = {
    status: newStatus,
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    history,
    updatedAt: now,
  };

  await updateAsset(id, payload, performedBy);
}

export async function deleteAsset(id: string): Promise<void> {
  await safeOpenDatabase();
  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    await deleteDoc(docRef);
    await db.assets.delete(String(id));
  } catch (err: any) {
    console.warn('[AssetService] Firestore deleteDoc warning:', err?.message || err);
    await db.assets.delete(String(id));
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error(
        'Firestore permission error: Security rules must be deployed to Cloud Firestore via "firebase deploy --only firestore:rules". Deleted from local cache.'
      );
    }
  }
}
