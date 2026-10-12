import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';

/**
 * Client / project logins (Gmail, GitHub, hosting, social accounts…).
 * Stored in their own collection so Firestore rules can limit them to Owners/Admins,
 * and never cached in the browser's local database.
 */
export const CREDENTIALS_COL = 'projectCredentials';

export interface ProjectCredential {
  id?: string;
  clientId: string;
  projectId?: string;
  projectName?: string;
  label: string; // e.g. Gmail, GitHub, Hostinger, Instagram
  username: string;
  password: string;
  url?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export function subscribeCredentials(
  filter: { projectId?: string; clientId?: string },
  onData: (rows: ProjectCredential[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = filter.projectId
    ? query(collection(dbFirestore, CREDENTIALS_COL), where('projectId', '==', filter.projectId))
    : query(collection(dbFirestore, CREDENTIALS_COL), where('clientId', '==', filter.clientId || ''));
  return onSnapshot(
    q,
    (snap) =>
      onData(
        snap.docs
          .map((d) => ({ ...(d.data() as ProjectCredential), id: d.id }))
          .sort((a, b) => (a.projectName || '').localeCompare(b.projectName || '') || a.label.localeCompare(b.label))
      ),
    (err) => onError?.(err)
  );
}

const clean = (obj: Record<string, any>) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export async function addCredential(data: Omit<ProjectCredential, 'id'>, by?: string): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(dbFirestore, CREDENTIALS_COL), clean({ ...data, createdAt: now, updatedAt: now, updatedBy: by }));
  return ref.id;
}

export async function updateCredential(id: string, updates: Partial<ProjectCredential>, by?: string): Promise<void> {
  await updateDoc(doc(dbFirestore, CREDENTIALS_COL, id), clean({ ...updates, updatedAt: new Date().toISOString(), updatedBy: by }));
}

export async function deleteCredential(id: string): Promise<void> {
  await deleteDoc(doc(dbFirestore, CREDENTIALS_COL, id));
}
