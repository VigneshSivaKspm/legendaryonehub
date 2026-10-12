import { doc, getDoc, setDoc } from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';

/**
 * Google Drive storage for Documents, entirely in the browser (no Cloud Functions).
 *
 * The app signs in to the company Google account with Google Identity Services and calls
 * the Drive REST API directly. Files live in a "Legendary One Documents" folder that is
 * created automatically. One-time setup:
 *  1. Google Cloud Console (the Firebase project) → APIs & Services → enable "Google Drive API".
 *  2. OAuth consent screen → External → add the company Gmail under "Test users".
 *  3. Credentials → Create credentials → OAuth client ID → Web application → add your site
 *     URL(s) (e.g. https://your-app.web.app and http://localhost:5173) to
 *     "Authorised JavaScript origins".
 *  4. Put the client ID in VITE_GOOGLE_CLIENT_ID (.env) or paste it in Documents → Connect Google Drive.
 */

// Full Drive scope so "Fetch from Drive" can also see files added to the folder manually.
const SCOPE = 'https://www.googleapis.com/auth/drive';
const CONFIG_DOC = 'integrations/googleDrive';
const FOLDER_NAME = 'Legendary One Documents';
const TOKEN_KEY = 'lo_drive_token';
const API = 'https://www.googleapis.com/drive/v3';

export const MAX_DRIVE_FILE_BYTES = 25 * 1024 * 1024;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  createdTime?: string;
}

export interface DriveConfig {
  clientId?: string;
  folderId?: string;
  folderLink?: string;
  connectedEmail?: string;
}

declare global {
  interface Window {
    google?: any;
  }
}

// ---------------------------------------------------------------------------
// Config (stored in Firestore so every user's browser uses the same folder)
// ---------------------------------------------------------------------------
let configCache: DriveConfig | null = null;

export async function getDriveConfig(refresh = false): Promise<DriveConfig> {
  if (configCache && !refresh) return configCache;
  let stored: DriveConfig = {};
  try {
    const snap = await getDoc(doc(dbFirestore, CONFIG_DOC));
    stored = (snap.data() as DriveConfig) || {};
  } catch (err) {
    console.warn('[Drive] Could not read Drive settings:', err);
  }
  const envClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  configCache = { ...stored, clientId: envClientId || stored.clientId || '' };
  return configCache;
}

async function saveDriveConfig(updates: Partial<DriveConfig>): Promise<void> {
  await setDoc(doc(dbFirestore, CONFIG_DOC), { ...updates, updatedAt: new Date().toISOString() }, { merge: true });
  configCache = { ...(configCache || {}), ...updates };
}

/** Admin: store the OAuth client ID when it isn't provided through VITE_GOOGLE_CLIENT_ID. */
export async function saveDriveClientId(clientId: string): Promise<void> {
  await saveDriveConfig({ clientId: clientId.trim() });
}

// ---------------------------------------------------------------------------
// Google sign-in (access tokens last ~1 hour; kept for the browser session only)
// ---------------------------------------------------------------------------
let gisLoading: Promise<void> | null = null;

/** Loads the Google Identity Services script. Call early (e.g. on page mount). */
export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error('Could not load Google sign-in. Check your internet connection.'));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

function readToken(): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, expires } = JSON.parse(raw);
    return token && expires > Date.now() + 60_000 ? token : null;
  } catch {
    return null;
  }
}

function storeToken(token: string, expiresInSec: number) {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expires: Date.now() + expiresInSec * 1000 }));
  } catch {
    /* private mode: token just lives for this call */
  }
}

export function isDriveConnected(): boolean {
  return !!readToken();
}

export function disconnectDrive(): void {
  const token = readToken();
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
}

/**
 * Returns a valid access token, opening the Google consent popup when needed.
 * Call this directly from a click handler so the popup isn't blocked.
 */
export async function getDriveToken(interactive = true): Promise<string> {
  const cached = readToken();
  if (cached) return cached;
  if (!interactive) throw new Error('Google Drive is not connected.');

  const cfg = await getDriveConfig();
  if (!cfg.clientId) throw new Error('DRIVE_NOT_CONFIGURED');
  await loadGoogleIdentity();

  const token = await new Promise<string>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPE,
      login_hint: cfg.connectedEmail || undefined,
      hint: cfg.connectedEmail || undefined,
      callback: (resp: any) => {
        if (resp?.error || !resp?.access_token) {
          reject(new Error(resp?.error_description || resp?.error || 'Google sign-in was cancelled.'));
          return;
        }
        storeToken(resp.access_token, Number(resp.expires_in) || 3600);
        resolve(resp.access_token);
      },
      error_callback: (err: any) => reject(new Error(err?.message || err?.type || 'Google sign-in was closed.')),
    });
    client.requestAccessToken({ prompt: '' });
  });

  // Keep everyone on the same company account so files land in one Drive
  const about = await driveJson(`${API}/about?fields=user(emailAddress)`, {}, token);
  const email = (about?.user?.emailAddress || '').toLowerCase();
  if (cfg.connectedEmail && email && email !== cfg.connectedEmail.toLowerCase()) {
    disconnectDrive();
    throw new Error(`Please sign in with the company Google account (${cfg.connectedEmail}). You chose ${email}.`);
  }
  if (!cfg.connectedEmail && email) await saveDriveConfig({ connectedEmail: email });
  return token;
}

async function driveFetch(url: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const accessToken = token || (await getDriveToken());
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    throw new Error('Google Drive session expired. Click the action again to reconnect.');
  }
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Google Drive request failed (${res.status}).`);
  }
  return res;
}

async function driveJson(url: string, init: RequestInit = {}, token?: string): Promise<any> {
  const res = await driveFetch(url, init, token);
  return res.status === 404 ? null : res.json();
}

/** The app's Drive folder, created on first use and shared by all users through Firestore. */
async function ensureFolder(): Promise<string> {
  const cfg = await getDriveConfig();
  if (cfg.folderId) {
    const meta = await driveJson(`${API}/files/${cfg.folderId}?fields=id,trashed`);
    if (meta && !meta.trashed) return cfg.folderId;
  }
  const folder = await driveJson(`${API}/files?fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  await saveDriveConfig({ folderId: folder.id, folderLink: folder.webViewLink || '' });
  return folder.id;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------
export async function uploadToDrive(file: File): Promise<{ fileId: string; webViewLink: string }> {
  if (file.size > MAX_DRIVE_FILE_BYTES) throw new Error('Files are limited to 25 MB.');
  const parent = await ensureFolder();
  const boundary = `lo_${Date.now().toString(36)}`;
  const metadata = { name: file.name, parents: [parent] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ]);
  const created = await driveJson('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return { fileId: created.id, webViewLink: created.webViewLink || '' };
}

export async function downloadFromDrive(fileId: string): Promise<Blob> {
  const res = await driveFetch(`${API}/files/${fileId}?alt=media`);
  if (res.status === 404) throw new Error('This file no longer exists in Google Drive.');
  return res.blob();
}

/** Moves the file to Drive trash (recoverable for 30 days). */
export async function deleteFromDrive(fileId: string): Promise<void> {
  await driveFetch(`${API}/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

export async function listDriveFiles(): Promise<{ folderLink: string; files: DriveFile[] }> {
  const parent = await ensureFolder();
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${parent}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
    const json = await driveJson(
      `${API}/files?q=${q}&pageSize=200&fields=nextPageToken,files(id,name,mimeType,size,webViewLink,createdTime)${
        pageToken ? `&pageToken=${pageToken}` : ''
      }`
    );
    files.push(...(json?.files || []));
    pageToken = json?.nextPageToken || '';
  } while (pageToken && files.length < 1000);
  return { folderLink: (await getDriveConfig()).folderLink || '', files };
}
