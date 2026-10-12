import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type User } from '../db/database';
import { isOwnerOrAdminRole } from './authService';

const COLLECTION_NAME = 'users';

function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Checks if a given role string represents an Owner / Super Admin
 */
export function isOwnerRole(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return r === 'owner' || r === 'super admin' || r === 'owner / super admin' || r.includes('owner') || r.includes('super admin');
}

/**
 * Counts total active Owner / Super Admin accounts persisted in Firestore/Dexie
 */
export async function countActiveOwners(): Promise<number> {
  await safeOpenDatabase();
  const allUsers = await db.users.toArray();
  const activeOwners = allUsers.filter(
    (u) => isOwnerRole(u.role) && (u.status || 'Active') === 'Active'
  );
  return Math.max(1, activeOwners.length);
}

/**
 * Fetches all persisted application users from Firestore with Dexie fallback
 */
export async function getAllUsers(): Promise<User[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        ...data,
        id: docSnap.id,
        email: (data.email || '').toLowerCase().trim(),
        status: data.status || 'Active',
      } as User;
    });

    if (list.length > 0) {
      await safeOpenDatabase();
      await db.users.bulkPut(list);
    }
    return list;
  } catch (err: any) {
    console.warn('[UserService] Firestore user fetch failed, using local cache:', err?.message || err);
    await safeOpenDatabase();
    return await db.users.toArray();
  }
}

export interface ProvisionUserInput {
  email: string;
  name: string;
  role: string;
  employeeId?: string | number;
  employeeName?: string;
  status?: 'Active' | 'Disabled';
}

/**
 * Provisions user access in Firestore.
 * Does NOT sign out the currently authenticated Owner because client-side auth session is untouched.
 * When the invited user logs in via Firebase Auth with this email, syncUserProfile automatically matches
 * their profile and assigns their role and employee link.
 */
export async function provisionUserAccess(
  input: ProvisionUserInput,
  currentUser?: User
): Promise<User> {
  const emailClean = cleanEmail(input.email);
  if (!emailClean || !emailClean.includes('@')) {
    throw new Error('Please enter a valid user email address.');
  }

  if (!input.name || !input.name.trim()) {
    throw new Error('Please enter a display name for the user.');
  }

  if (!input.role) {
    throw new Error('Please select a role for the user.');
  }

  await safeOpenDatabase();
  const existingLocal = await db.users.where('email').equalsIgnoreCase(emailClean).first();
  if (existingLocal) {
    throw new Error(`A user account profile with email "${emailClean}" already exists.`);
  }

  const now = new Date().toISOString();
  const docId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const avatarInitials = input.name.slice(0, 2).toUpperCase();

  const newUserPayload: User = {
    id: docId,
    email: emailClean,
    name: input.name.trim(),
    role: input.role,
    dept: isOwnerRole(input.role) ? 'Executive' : 'General',
    status: input.status || 'Active',
    employeeId: input.employeeId || '',
    employeeName: input.employeeName || '',
    avatarInitials,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, docId);
    await setDoc(docRef, newUserPayload, { merge: true });
    await db.users.put(newUserPayload);
    return newUserPayload;
  } catch (err: any) {
    console.warn('[UserService] Firestore user provision failed, saving local cache:', err?.message || err);
    await db.users.put(newUserPayload);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error('Firestore permission error: Security rules must be deployed.');
    }
    return newUserPayload;
  }
}

/**
 * Updates role, status, name, or employee link for an existing user account.
 * Enforces Owner Safety Protection to prevent workspace lockout.
 */
export async function updateUserAccessAndRole(
  userId: string,
  updates: {
    role?: string;
    status?: 'Active' | 'Disabled';
    employeeId?: string | number;
    employeeName?: string;
    name?: string;
  },
  currentUser?: User
): Promise<User> {
  await safeOpenDatabase();
  const existing = await db.users.get(String(userId));
  if (!existing) {
    throw new Error(`User account with ID "${userId}" not found.`);
  }

  const wasOwner = isOwnerRole(existing.role);
  const isDemotingOrDisablingOwner =
    wasOwner &&
    ((updates.role && !isOwnerRole(updates.role)) || (updates.status && updates.status === 'Disabled'));

  if (isDemotingOrDisablingOwner) {
    const activeOwnerCount = await countActiveOwners();
    if (activeOwnerCount <= 1) {
      throw new Error(
        'Owner Safety Protection: You cannot demote or disable the last active Owner / Super Admin. At least one active Owner account must remain to prevent workspace lockout.'
      );
    }
  }

  const now = new Date().toISOString();
  const updatedUserPayload: User = {
    ...existing,
    name: updates.name !== undefined ? updates.name.trim() : existing.name,
    role: updates.role || existing.role,
    status: updates.status || existing.status || 'Active',
    employeeId: updates.employeeId !== undefined ? updates.employeeId : existing.employeeId,
    employeeName: updates.employeeName !== undefined ? updates.employeeName : existing.employeeName,
    updatedAt: now,
  };

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(userId));
    await setDoc(docRef, updatedUserPayload, { merge: true });
    await db.users.put(updatedUserPayload);
    return updatedUserPayload;
  } catch (err: any) {
    console.warn('[UserService] Firestore user update notice:', err?.message || err);
    await db.users.put(updatedUserPayload);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error('Firestore permission error: Security rules must be deployed.');
    }
    return updatedUserPayload;
  }
}

/**
 * Permanently removes user account access doc from Firestore & Dexie.
 * Enforces Owner Safety Protection: Cannot delete sole Owner.
 * Does NOT delete the linked Employee record unless explicitly requested elsewhere.
 */
export async function removeUserAccess(userId: string, currentUser?: User): Promise<void> {
  await safeOpenDatabase();
  const existing = await db.users.get(String(userId));
  if (existing && isOwnerRole(existing.role)) {
    const activeOwnerCount = await countActiveOwners();
    if (activeOwnerCount <= 1) {
      throw new Error(
        'Owner Safety Protection: You cannot remove the last active Owner / Super Admin. At least one active Owner account must remain.'
      );
    }
  }

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(userId));
    await deleteDoc(docRef);
    await db.users.delete(String(userId));
  } catch (err: any) {
    console.warn('[UserService] Firestore user delete notice:', err?.message || err);
    await db.users.delete(String(userId));
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error('Firestore permission error: Security rules must be deployed.');
    }
  }
}
