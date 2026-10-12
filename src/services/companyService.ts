import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  limit,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import type { User } from '../db/database';
import { isOwnerOrAdminRole } from './authService';

export interface CompanyProfile {
  id?: string;
  // Step 1: Company Information
  companyName: string;
  logoUrl?: string;
  tagline?: string;
  businessType: string;
  businessEmail: string;
  phoneNumber: string;
  website?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;

  // Step 2: Business & Tax
  gstin?: string;
  pan?: string;
  udyamNumber?: string;
  financialYearStart: string;
  currency: string;

  // Step 3: Bank Details
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;

  // Step 4: Office Settings
  workingDays: string[];
  officeStartTime: string;
  officeEndTime: string;
  weeklyOff: string;
  defaultInvoicePrefix: string;
  defaultQuotationPrefix: string;

  // Meta
  setupCompleted: boolean;
  createdUserId?: string;
  createdUserEmail?: string;
  updatedByUid?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COMPANY_DOC_ID = 'default';
const COLLECTION_NAME = 'companyProfile';
const LOCAL_CACHE_KEY = 'company_profile_cache';

export interface UploadLogoResult {
  url?: string;
  error?: string;
  storageNotConfigured?: boolean;
}

export interface GetCompanyProfileResult {
  status: 'FOUND' | 'NOT_FOUND' | 'TIMEOUT_OR_ERROR';
  profile: CompanyProfile | null;
  error?: any;
  isFallback?: boolean;
}

/**
 * Retrieves local cached CompanyProfile from localStorage if available.
 */
export function getLocalCachedCompanyProfile(): CompanyProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as CompanyProfile;
      }
    }
  } catch (e) {
    console.warn('[CompanyService] Error reading local company profile cache:', e);
  }
  return null;
}

/**
 * Caches CompanyProfile locally in localStorage.
 */
export function setLocalCachedCompanyProfile(profile: CompanyProfile | null): void {
  try {
    if (profile) {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(profile));
    }
  } catch (e) {
    console.warn('[CompanyService] Error saving local company profile cache:', e);
  }
}

const LOGO_MAX_PX = 256;
const LOGO_MAX_CHARS = 300_000; // keeps the company profile doc well under Firestore's 1 MB limit

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format could not be read. Please use PNG, JPG, WEBP or SVG.'));
    };
    img.src = url;
  });
}

/**
 * Prepares the company logo for storage inside the Firestore company profile.
 * The image is shrunk to at most 256px in the browser and returned as a data URL,
 * so no Firebase Storage bucket is needed.
 */
export async function uploadCompanyLogo(file: File, _userUid?: string): Promise<UploadLogoResult> {
  try {
    const img = await loadImage(file);
    const w = img.naturalWidth || LOGO_MAX_PX;
    const h = img.naturalHeight || LOGO_MAX_PX;
    const scale = Math.min(1, LOGO_MAX_PX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is not supported in this browser.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // PNG keeps transparency; fall back to WEBP if the PNG is too large
    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > LOGO_MAX_CHARS) dataUrl = canvas.toDataURL('image/webp', 0.9);
    if (dataUrl.length > LOGO_MAX_CHARS) {
      return { error: 'The logo is too detailed to store. Please use a simpler or smaller image.' };
    }
    return { url: dataUrl };
  } catch (err: any) {
    console.error('[CompanyService] Logo processing error:', err);
    return { error: err?.message || 'Could not process the logo image.' };
  }
}

/**
 * Fetches Company Profile from Firestore with timeout resilience and local cache fallback.
 * Explicitly distinguishes between:
 *  - FOUND: Firestore returned existing company setup record.
 *  - NOT_FOUND: Firestore confirmed company setup record does NOT exist.
 *  - TIMEOUT_OR_ERROR: Network/Firestore stalled or errored out (does NOT mean setup is missing).
 */
export async function getCompanyProfileResult(): Promise<GetCompanyProfileResult> {
  const cachedProfile = getLocalCachedCompanyProfile();

  try {
    const fetchPromise = (async (): Promise<GetCompanyProfileResult> => {
      const docRef = doc(dbFirestore, COLLECTION_NAME, COMPANY_DOC_ID);
      const snapshot = await getDoc(docRef);

      if (snapshot.exists()) {
        const data = snapshot.data() as CompanyProfile;
        setLocalCachedCompanyProfile(data);
        return { status: 'FOUND', profile: data };
      }

      // Fallback search: check any document in companyProfile collection
      const q = query(collection(dbFirestore, COLLECTION_NAME), limit(1));
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        const data = querySnap.docs[0].data() as CompanyProfile;
        setLocalCachedCompanyProfile(data);
        return { status: 'FOUND', profile: data };
      }

      // Firestore successfully confirmed that NO document exists
      return { status: 'NOT_FOUND', profile: null };
    })();

    // Resilient 10-second timeout to avoid false onboarding redirects on slow network / cold starts
    const timeoutPromise = new Promise<GetCompanyProfileResult>((resolve) => {
      setTimeout(() => {
        console.warn(
          '[CompanyService] Firestore fetch timed out after 10s. Using cached setup/workspace fallback without resetting onboarding.'
        );
        resolve({
          status: 'TIMEOUT_OR_ERROR',
          profile: cachedProfile,
          isFallback: !!cachedProfile,
        });
      }, 10000);
    });

    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (err) {
    console.error('[CompanyService] Error fetching Company Profile from Firestore:', err);
    return {
      status: 'TIMEOUT_OR_ERROR',
      profile: cachedProfile,
      error: err,
      isFallback: !!cachedProfile,
    };
  }
}

/**
 * Backward-compatible helper for fetching CompanyProfile.
 * Returns CompanyProfile if found or cached, or null if NOT_FOUND or TIMEOUT_OR_ERROR without cache.
 */
export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const result = await getCompanyProfileResult();
  return result.profile;
}

/**
 * Saves or updates Company Profile in Firestore.
 * Requires authenticated Owner / Super Admin or Admin user.
 */
export async function saveCompanyProfile(
  profileData: Omit<CompanyProfile, 'setupCompleted' | 'createdAt' | 'updatedAt'>,
  currentUser: User,
  userUid: string
): Promise<{ success: boolean; profile?: CompanyProfile; message?: string }> {
  try {
    // SECURITY CHECK: Only Owner / Super Admin or Admin can save company setup
    const isOwnerOrAdmin = isOwnerOrAdminRole(currentUser?.role);
    if (!isOwnerOrAdmin) {
      return {
        success: false,
        message:
          'Security Error: Only authenticated Owner, Super Admin, or Admin users can complete or modify company setup.',
      };
    }

    const docRef = doc(dbFirestore, COLLECTION_NAME, COMPANY_DOC_ID);
    
    // Safely attempt fetching existing document data for timestamps
    let existingData: CompanyProfile | null = null;
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        existingData = existingSnap.data() as CompanyProfile;
      }
    } catch (e) {
      console.warn('[CompanyService] Could not read existing document during save:', e);
    }

    const now = new Date().toISOString();

    const fullProfile: CompanyProfile = {
      ...profileData,
      setupCompleted: true,
      createdUserId: existingData?.createdUserId || userUid,
      createdUserEmail: existingData?.createdUserEmail || currentUser.email,
      updatedByUid: userUid,
      createdAt: existingData?.createdAt || now,
      updatedAt: now,
    };

    await setDoc(docRef, fullProfile, { merge: true });
    setLocalCachedCompanyProfile(fullProfile);

    return {
      success: true,
      profile: fullProfile,
      message: 'Company profile successfully saved in Firestore.',
    };
  } catch (err: any) {
    console.error('Error saving Company Profile to Firestore:', err);
    return {
      success: false,
      message: `Firestore Save Error: ${err?.message || 'Failed to save company profile to Firestore.'}`,
    };
  }
}
