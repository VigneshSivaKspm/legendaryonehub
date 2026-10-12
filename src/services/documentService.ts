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
import { ref, deleteObject } from 'firebase/storage';
import { dbFirestore, storage } from '../config/firebase';
import {
  uploadToDrive,
  downloadFromDrive,
  deleteFromDrive,
  listDriveFiles,
  MAX_DRIVE_FILE_BYTES,
} from './googleDriveService';
import {
  db,
  safeOpenDatabase,
  type DocumentRecord,
  type DocumentStatus,
  type DocumentType,
  type DocumentCategory,
  type DocumentRelatedTo,
  type User,
} from '../db/database';

const COLLECTION_NAME = 'documents';
export const MAX_FILE_SIZE_BYTES = MAX_DRIVE_FILE_BYTES; // 25 MB

/**
  Derived document status based on expiry date
 */
export function deriveDocumentStatus(expiryDate?: string | null): DocumentStatus {
  if (!expiryDate || !expiryDate.trim()) {
    return 'No Expiry';
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const expDate = new Date(expiryDate.trim());
  if (isNaN(expDate.getTime())) {
    return 'No Expiry';
  }

  const expStr = expiryDate.trim().split('T')[0];

  if (expStr < todayStr) {
    return 'Expired';
  }

  const thirtyDaysLater = new Date(today);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
  const thirtyDaysLaterStr = thirtyDaysLater.toISOString().split('T')[0];

  if (expStr <= thirtyDaysLaterStr) {
    return 'Expiring Soon';
  }

  return 'Active';
}

/**
  Formated human-readable file size (B, KB, MB, GB)
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${val.endsWith('.0') ? val.slice(0, -2) : val} ${units[i] || 'B'}`;
}

/**
  Validates uploaded file against allowed MIME types, extensions, and max size.
 */
export function validateDocumentFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'Please select a file to upload.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size (${formatFileSize(file.size)}) exceeds the maximum allowed limit of 25 MB.`,
    };
  }

  const fileNameLower = file.name.toLowerCase();
  const allowedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg', '.jpeg', '.png'];
  const hasValidExt = allowedExtensions.some((ext) => fileNameLower.endsWith(ext));

  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'image/jpeg',
    'image/jpg',
    'image/png',
  ];
  const hasValidMime = allowedMimeTypes.includes(file.type.toLowerCase()) || file.type === '';

  if (!hasValidExt && !hasValidMime) {
    return {
      valid: false,
      error:
        'Unsupported file type. Supported formats: PDF, DOC, DOCX, XLS, XLSX, CSV, JPG, JPEG, PNG.',
    };
  }

  return { valid: true };
}

/**
  Strips undefined properties before writing to Firestore
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

/**
  Fetches all documents from Firestore with fallback to local Dexie cache
 */
export async function getAllDocuments(): Promise<DocumentRecord[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      const status = deriveDocumentStatus(data.expiryDate);
      return {
        ...data,
        id: docSnap.id,
        status,
      } as DocumentRecord;
    });

    if (list.length > 0) {
      await safeOpenDatabase();
      await db.documents.bulkPut(list);
    }
    return list;
  } catch (err: any) {
    console.warn('[DocumentService] Firestore fetch failed, returning local Dexie cache:', err?.message || err);
    await safeOpenDatabase();
    const cached = await db.documents.toArray();
    return cached.map((d) => ({
      ...d,
      status: deriveDocumentStatus(d.expiryDate),
    }));
  }
}

/**
  Fetches document by ID
 */
export async function getDocumentById(id: string): Promise<DocumentRecord | undefined> {
  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      const record: DocumentRecord = {
        ...data,
        id: docSnap.id,
        status: deriveDocumentStatus(data.expiryDate),
      } as DocumentRecord;
      await safeOpenDatabase();
      await db.documents.put(record);
      return record;
    }
    await safeOpenDatabase();
    return await db.documents.get(String(id));
  } catch (err: any) {
    console.warn('[DocumentService] getDocumentById failed, using cache:', err?.message || err);
    await safeOpenDatabase();
    return await db.documents.get(String(id));
  }
}

export interface NewDocumentInput {
  title: string;
  type: DocumentType;
  category: DocumentCategory;
  relatedTo: DocumentRelatedTo;
  relatedRecordId?: string;
  relatedRecordName?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
}

/**
  Uploads file to Firebase Storage & saves metadata in Firestore
 */
export async function uploadAndAddDocument(
  file: File,
  input: NewDocumentInput,
  currentUser?: User
): Promise<DocumentRecord> {
  const valRes = validateDocumentFile(file);
  if (!valRes.valid) {
    throw new Error(valRes.error || 'Invalid document file.');
  }

  if (!input.title || !input.title.trim()) {
    throw new Error('Document Title is required.');
  }
  if (!input.type) {
    throw new Error('Document Type is required.');
  }
  if (!input.category) {
    throw new Error('Category is required.');
  }

  const now = new Date().toISOString();
  const stored = await storeFile(file);

  const status = deriveDocumentStatus(input.expiryDate);

  const payload: Omit<DocumentRecord, 'id'> = {
    title: input.title.trim(),
    type: input.type,
    category: input.category,
    relatedTo: input.relatedTo || 'Other',
    relatedRecordId: input.relatedRecordId || '',
    relatedRecordName: input.relatedRecordName || '',
    issueDate: input.issueDate || '',
    expiryDate: input.expiryDate || '',
    notes: (input.notes || '').trim(),
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || file.name.split('.').pop() || 'unknown',
    fileUrl: stored.fileUrl,
    storagePath: stored.storagePath,
    storageProvider: stored.storageProvider,
    driveFileId: stored.driveFileId,
    status,
    uploadedByUid: currentUser?.id ? String(currentUser.id) : '',
    uploadedByName: currentUser?.name || 'User',
    createdAt: now,
    updatedAt: now,
  };

  const cleaned = cleanPayload(payload);

  try {
    const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), cleaned);
    const record: DocumentRecord = {
      ...(cleaned as Omit<DocumentRecord, 'id'>),
      id: docRef.id,
    };
    await safeOpenDatabase();
    await db.documents.put(record);
    return record;
  } catch (err: any) {
    console.error('[DocumentService] Firestore addDoc failed:', err);
    await removeStoredFile(stored);
    throw new Error(`Firestore save failed: ${err?.message || err}`);
  }
}

interface StoredFile {
  storageProvider: 'google-drive' | 'firebase';
  fileUrl: string;
  storagePath: string;
  driveFileId?: string;
}

/** Saves the file to the company Google Drive folder (browser upload, no server). */
async function storeFile(file: File): Promise<StoredFile> {
  try {
    const { fileId, webViewLink } = await uploadToDrive(file);
    return { storageProvider: 'google-drive', fileUrl: webViewLink, storagePath: `drive:${fileId}`, driveFileId: fileId };
  } catch (err: any) {
    if (err?.message === 'DRIVE_NOT_CONFIGURED') {
      throw new Error('Google Drive is not set up yet. Click "Connect Google Drive" and add the OAuth Client ID.');
    }
    console.error('[DocumentService] Google Drive upload failed:', err);
    throw new Error(`Google Drive upload failed: ${err?.message || err}`);
  }
}

async function removeStoredFile(stored: { driveFileId?: string; storagePath?: string }): Promise<void> {
  try {
    if (stored.driveFileId) {
      await deleteFromDrive(stored.driveFileId);
    } else if (stored.storagePath && !stored.storagePath.startsWith('drive:')) {
      await deleteObject(ref(storage, stored.storagePath));
    }
  } catch (err: any) {
    console.warn('[DocumentService] File cleanup notice (non-blocking):', err?.message || err);
  }
}

/** Fetches a document's file (from Google Drive or Firebase Storage) as a Blob. */
export async function fetchDocumentBlob(record: DocumentRecord): Promise<Blob> {
  if (record.driveFileId) return downloadFromDrive(record.driveFileId);
  const response = await fetch(record.fileUrl, { mode: 'cors' });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  return response.blob();
}

/** Opens a document in a new tab (preview) or saves it to disk. */
export async function openDocumentFile(record: DocumentRecord, mode: 'view' | 'download'): Promise<void> {
  // Open the tab synchronously so pop-up blockers allow it, then fill it once the file arrives
  const tab = mode === 'view' ? window.open('', '_blank') : null;
  try {
    const blob = await fetchDocumentBlob(record);
    const url = URL.createObjectURL(blob);
    if (mode === 'view' && tab) {
      tab.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = record.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    if (!record.driveFileId && record.fileUrl) {
      await triggerFileDownload(record.fileUrl, record.fileName);
      return;
    }
    throw err;
  }
}

/**
 * Imports files that exist in the company Drive folder but aren't in the catalog yet
 * (e.g. added directly in Google Drive). Returns how many were imported.
 */
export async function syncDocumentsFromDrive(currentUser?: User): Promise<{ imported: number; folderLink: string }> {
  const { files, folderLink } = await listDriveFiles();
  await safeOpenDatabase();
  const known = new Set((await db.documents.toArray()).map((d) => d.driveFileId).filter(Boolean));
  const now = new Date().toISOString();
  let imported = 0;

  for (const f of files) {
    if (known.has(f.id)) continue;
    const payload = cleanPayload<Omit<DocumentRecord, 'id'>>({
      title: f.name.replace(/\.[^.]+$/, ''),
      type: 'Other',
      category: 'Other',
      relatedTo: 'Business',
      fileName: f.name,
      fileSize: Number(f.size) || 0,
      fileType: f.mimeType,
      fileUrl: f.webViewLink || '',
      storagePath: `drive:${f.id}`,
      storageProvider: 'google-drive',
      driveFileId: f.id,
      status: 'No Expiry',
      notes: 'Imported from Google Drive',
      uploadedByUid: currentUser?.id ? String(currentUser.id) : '',
      uploadedByName: currentUser?.name || 'Google Drive',
      createdAt: f.createdTime || now,
      updatedAt: now,
    });
    const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), payload);
    await db.documents.put({ ...(payload as Omit<DocumentRecord, 'id'>), id: docRef.id });
    imported++;
  }
  return { imported, folderLink };
}

/**
  Updates document metadata (does NOT replace underlying file)
 */
export async function updateDocumentMetadata(
  id: string,
  updates: Partial<DocumentRecord>
): Promise<void> {
  await safeOpenDatabase();
  const existing = await getDocumentById(id);
  if (!existing) {
    throw new Error(`Document with ID "${id}" not found.`);
  }

  const now = new Date().toISOString();
  const newExpiry = updates.expiryDate !== undefined ? updates.expiryDate : existing.expiryDate;
  const newStatus = deriveDocumentStatus(newExpiry);

  const payload: Partial<DocumentRecord> = {
    ...updates,
    title: updates.title ? updates.title.trim() : existing.title,
    notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
    status: newStatus,
    updatedAt: now,
  };

  const cleaned = cleanPayload(payload);

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    await updateDoc(docRef, cleaned as any);
    await db.documents.update(String(id), cleaned);
  } catch (err: any) {
    console.warn('[DocumentService] Firestore updateDoc failed, updating local cache:', err?.message || err);
    await db.documents.update(String(id), cleaned);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error('Firestore permission error: Security rules must be deployed.');
    }
  }
}

/**
  Replaces underlying document file in Firebase Storage & updates metadata.
  Deletes old Storage file ONLY after upload & metadata update succeeds.
 */
export async function replaceDocumentFile(
  id: string,
  newFile: File,
  updates?: Partial<DocumentRecord>,
  currentUser?: User
): Promise<void> {
  const existing = await getDocumentById(id);
  if (!existing) {
    throw new Error(`Document with ID "${id}" not found.`);
  }

  const valRes = validateDocumentFile(newFile);
  if (!valRes.valid) {
    throw new Error(valRes.error || 'Invalid replacement file.');
  }

  // 1. Upload the new file (Google Drive, or Firebase Storage during setup)
  const stored = await storeFile(newFile);

  const now = new Date().toISOString();
  const newExpiry = updates?.expiryDate !== undefined ? updates.expiryDate : existing.expiryDate;
  const newStatus = deriveDocumentStatus(newExpiry);

  const payload: Partial<DocumentRecord> = {
    ...updates,
    fileName: newFile.name,
    fileSize: newFile.size,
    fileType: newFile.type || newFile.name.split('.').pop() || 'unknown',
    fileUrl: stored.fileUrl,
    storagePath: stored.storagePath,
    storageProvider: stored.storageProvider,
    driveFileId: stored.driveFileId || '',
    status: newStatus,
    uploadedByUid: currentUser?.id ? String(currentUser.id) : existing.uploadedByUid,
    uploadedByName: currentUser?.name || existing.uploadedByName,
    updatedAt: now,
  };

  const cleaned = cleanPayload(payload);

  // 2. Update Firestore metadata first
  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    await updateDoc(docRef, cleaned as any);
    await safeOpenDatabase();
    await db.documents.update(String(id), cleaned);
  } catch (err: any) {
    console.error('[DocumentService] Firestore update during replacement failed:', err);
    // Cleanup newly uploaded file if Firestore update fails
    await removeStoredFile(stored);
    throw new Error(`Metadata update failed: ${err?.message || err}`);
  }

  // 3. Remove the old file ONLY after replacement succeeds
  if (existing.storagePath !== stored.storagePath) {
    await removeStoredFile(existing);
  }
}

/**
  Deletes document file from Storage, metadata from Firestore, and item from Dexie cache.
 */
export async function deleteDocument(id: string): Promise<void> {
  const existing = await getDocumentById(id);

  // 1. Delete the file (Drive files go to Drive trash, recoverable for 30 days)
  if (existing) {
    await removeStoredFile(existing);
  }

  // 2. Delete metadata doc from Firestore
  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
    await deleteDoc(docRef);
  } catch (err: any) {
    console.warn('[DocumentService] Firestore deleteDoc warning:', err?.message || err);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error('Firestore permission error: Security rules must be deployed to Cloud Firestore.');
    }
  }

  // 3. Delete from local Dexie cache
  await safeOpenDatabase();
  await db.documents.delete(String(id));
}

/**
  Triggers a real browser file download for cross-origin Firebase Storage URLs
 */
export async function triggerFileDownload(url: string, fileName: string): Promise<void> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.warn('[DocumentService] Blob fetch download failed, fallback to direct download anchor:', err);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.download = fileName;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
