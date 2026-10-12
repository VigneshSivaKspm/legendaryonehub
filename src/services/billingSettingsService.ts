import { doc, getDoc, setDoc } from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type BillingSettings, type User } from '../db/database';

const COLLECTION_NAME = 'billingSettings';
const BILLING_DOC_ID = 'default';

/**
 * Returns default initial workspace billing configuration.
 */
export function getDefaultBillingSettings(): BillingSettings {
  return {
    id: BILLING_DOC_ID,
    defaultPaymentTerms: '15 Days',
    defaultTaxMode: 'Exclusive',
    isGstEnabled: true,
    defaultGstRate: 18,
    isTdsEnabled: false,
    defaultTdsRate: 10,
    currency: 'INR (₹)',
    defaultDueDateOffsetDays: 15,
    enableLateReminders: true,
    lateFeePercentage: 0,
    acceptedPaymentMethods: {
      bankTransfer: true,
      upi: true,
      cash: true,
      cheque: true,
      cardOnline: false,
    },
    upiId: '',
    bankDisplayPreference: 'Show Primary Bank Account',
    paymentInstructions: 'Please specify the invoice number on your payment reference.',
    showGstOnInvoices: true,
    showBankDetailsOnInvoices: true,
    showPaymentInstructionsOnInvoices: true,
    defaultInvoiceNotes: 'Thank you for your business!',
    defaultTermsAndConditions: 'Payment is due within the stipulated payment terms. Late payments may attract interest.',
  };
}

/**
 * Validates workspace billing settings inputs prior to saving.
 */
export function validateBillingSettings(settings: Partial<BillingSettings>): { valid: boolean; error?: string } {
  if (settings.defaultGstRate !== undefined) {
    const gst = Number(settings.defaultGstRate);
    if (isNaN(gst) || gst < 0 || gst > 28) {
      return { valid: false, error: 'Default GST percentage must be between 0% and 28%.' };
    }
  }

  if (settings.defaultTdsRate !== undefined) {
    const tds = Number(settings.defaultTdsRate);
    if (isNaN(tds) || tds < 0 || tds > 30) {
      return { valid: false, error: 'Default TDS percentage must be between 0% and 30%.' };
    }
  }

  if (settings.defaultDueDateOffsetDays !== undefined) {
    const days = Number(settings.defaultDueDateOffsetDays);
    if (isNaN(days) || days < 0 || days > 365) {
      return { valid: false, error: 'Default due date offset must be between 0 and 365 days.' };
    }
  }

  if (settings.lateFeePercentage !== undefined) {
    const late = Number(settings.lateFeePercentage);
    if (isNaN(late) || late < 0 || late > 50) {
      return { valid: false, error: 'Late fee percentage must be between 0% and 50%.' };
    }
  }

  if (settings.upiId && settings.upiId.trim() !== '') {
    const cleanUpi = settings.upiId.trim();
    if (!cleanUpi.includes('@') || cleanUpi.length < 5) {
      return { valid: false, error: 'Invalid UPI ID format. Please enter a valid UPI ID (e.g. company@upi).' };
    }
  }

  return { valid: true };
}

/**
 * Fetches workspace billing settings from Firestore with local Dexie cache fallback.
 */
export async function getBillingSettings(): Promise<BillingSettings> {
  const defaults = getDefaultBillingSettings();

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, BILLING_DOC_ID);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data() as BillingSettings;
      const merged: BillingSettings = {
        ...defaults,
        ...data,
        id: BILLING_DOC_ID,
        acceptedPaymentMethods: {
          ...defaults.acceptedPaymentMethods,
          ...(data.acceptedPaymentMethods || {}),
        },
      };

      await safeOpenDatabase();
      await db.billingSettings.put(merged);
      return merged;
    }

    // First time load: Save defaults to Firestore & Dexie
    try {
      await setDoc(docRef, defaults, { merge: true });
    } catch (e) {
      console.warn('[BillingService] Seed Firestore defaults notice:', e);
    }

    await safeOpenDatabase();
    await db.billingSettings.put(defaults);
    return defaults;
  } catch (err: any) {
    console.warn('[BillingService] Firestore get billing settings failed, using Dexie cache:', err?.message || err);
    await safeOpenDatabase();
    const cached = await db.billingSettings.get(BILLING_DOC_ID);
    if (cached) return cached;
    return defaults;
  }
}

/**
 * Saves or updates workspace billing settings in Firestore & Dexie.
 */
export async function saveBillingSettings(
  updates: Partial<BillingSettings>,
  currentUser?: User
): Promise<BillingSettings> {
  const valRes = validateBillingSettings(updates);
  if (!valRes.valid) {
    throw new Error(valRes.error || 'Invalid billing configuration.');
  }

  const existing = await getBillingSettings();
  const now = new Date().toISOString();

  const fullPayload: BillingSettings = {
    ...existing,
    ...updates,
    id: BILLING_DOC_ID,
    upiId: updates.upiId !== undefined ? updates.upiId.trim() : existing.upiId,
    paymentInstructions: updates.paymentInstructions !== undefined ? updates.paymentInstructions.trim() : existing.paymentInstructions,
    defaultInvoiceNotes: updates.defaultInvoiceNotes !== undefined ? updates.defaultInvoiceNotes.trim() : existing.defaultInvoiceNotes,
    defaultTermsAndConditions: updates.defaultTermsAndConditions !== undefined ? updates.defaultTermsAndConditions.trim() : existing.defaultTermsAndConditions,
    updatedAt: now,
    updatedBy: currentUser?.name || currentUser?.email || 'Admin',
  };

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, BILLING_DOC_ID);
    await setDoc(docRef, fullPayload, { merge: true });

    await safeOpenDatabase();
    await db.billingSettings.put(fullPayload);
    return fullPayload;
  } catch (err: any) {
    console.warn('[BillingService] Firestore setDoc failed, writing to Dexie cache:', err?.message || err);
    await safeOpenDatabase();
    await db.billingSettings.put(fullPayload);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error('Firestore permission error: Security rules must be deployed for billingSettings.');
    }
    return fullPayload;
  }
}
