import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getToken, onMessage } from 'firebase/messaging';
import { serviceWorkerUrl } from '../pwa';
import { dbFirestore, getFirebaseMessaging, firebaseConfig } from '../config/firebase';
import {
  db,
  safeOpenDatabase,
  type NotificationSettings,
  type NotificationEventConfig,
  type RecipientRole,
} from '../db/database';

export const ALL_RECIPIENT_ROLES: RecipientRole[] = [
  'Owner',
  'Admin',
  'Project Manager',
  'Assigned Employee',
  'Accountant',
];

export function getDefaultNotificationSettings(): NotificationSettings {
  const events: NotificationEventConfig[] = [
    {
      eventId: 'new_lead',
      eventName: 'New Lead Created',
      category: 'CRM',
      description: 'Triggered when a new lead/prospect inquiry is captured.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Project Manager'],
    },
    {
      eventId: 'lead_status_change',
      eventName: 'Lead Status Changed',
      category: 'CRM',
      description: 'Triggered when a lead moves stages in sales pipeline.',
      enabled: true,
      channels: { inApp: true, email: false, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Project Manager'],
    },
    {
      eventId: 'new_client',
      eventName: 'New Client Registered',
      category: 'CRM',
      description: 'Triggered when a new client profile is onboarded.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Accountant'],
    },
    {
      eventId: 'project_created',
      eventName: 'Project Created',
      category: 'Work',
      description: 'Triggered when a new workspace project is launched.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Project Manager'],
    },
    {
      eventId: 'task_assigned',
      eventName: 'Task Assigned',
      category: 'Work',
      description: 'Triggered when a task is assigned to a team member.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Project Manager', 'Assigned Employee'],
    },
    {
      eventId: 'task_due_overdue',
      eventName: 'Task Due / Overdue',
      category: 'Work',
      description: 'Reminder when a task deadline is approaching or passed.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Project Manager', 'Assigned Employee'],
    },
    {
      eventId: 'deliverable_due',
      eventName: 'Deliverable Due Soon',
      category: 'Work',
      description: 'Alert when project deliverable milestone date approaches.',
      enabled: true,
      channels: { inApp: true, email: false, browser: true, sms: false, whatsapp: false },
      recipients: ['Project Manager', 'Assigned Employee'],
    },
    {
      eventId: 'invoice_created',
      eventName: 'Invoice Created',
      category: 'Finance',
      description: 'Triggered when a client billing invoice is generated.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Accountant'],
    },
    {
      eventId: 'invoice_due_soon',
      eventName: 'Invoice Due Soon',
      category: 'Finance',
      description: 'Reminder prior to client invoice due date.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Accountant'],
    },
    {
      eventId: 'invoice_overdue',
      eventName: 'Invoice Overdue',
      category: 'Finance',
      description: 'Critical alert when client payment passes due date.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Accountant'],
    },
    {
      eventId: 'payment_received',
      eventName: 'Payment Received',
      category: 'Finance',
      description: 'Triggered when a payment is logged against an invoice.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Accountant'],
    },
    {
      eventId: 'expense_added',
      eventName: 'Expense Added',
      category: 'Finance',
      description: 'Notice when an operational business expense is recorded.',
      enabled: true,
      channels: { inApp: true, email: false, browser: false, sms: false, whatsapp: false },
      recipients: ['Owner', 'Accountant'],
    },
    {
      eventId: 'leave_request',
      eventName: 'Leave Request Submitted',
      category: 'HR & Payroll',
      description: 'Triggered when an employee requests leave approval.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Project Manager'],
    },
    {
      eventId: 'leave_approved_rejected',
      eventName: 'Leave Approved / Rejected',
      category: 'HR & Payroll',
      description: 'Notification on leave request status update.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Assigned Employee'],
    },
    {
      eventId: 'attendance_exception',
      eventName: 'Attendance Exception',
      category: 'HR & Payroll',
      description: 'Alert for late arrivals, missed punches, or unexcused absence.',
      enabled: true,
      channels: { inApp: true, email: false, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Project Manager'],
    },
    {
      eventId: 'payroll_generated',
      eventName: 'Payroll Generated',
      category: 'HR & Payroll',
      description: 'Notice when monthly payroll processing is finalized.',
      enabled: true,
      channels: { inApp: true, email: true, browser: false, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin', 'Accountant'],
    },
    {
      eventId: 'payroll_marked_paid',
      eventName: 'Payroll Marked Paid',
      category: 'HR & Payroll',
      description: 'Confirmation when salary payments are marked disburse.',
      enabled: true,
      channels: { inApp: true, email: true, browser: false, sms: false, whatsapp: false },
      recipients: ['Accountant', 'Assigned Employee'],
    },
    {
      eventId: 'asset_assigned_returned',
      eventName: 'Asset Assigned / Returned',
      category: 'Assets & Docs',
      description: 'Triggered on company hardware/software asset transfer.',
      enabled: true,
      channels: { inApp: true, email: false, browser: true, sms: false, whatsapp: false },
      recipients: ['Admin', 'Assigned Employee'],
    },
    {
      eventId: 'document_expiry_reminder',
      eventName: 'Document Expiry Reminder',
      category: 'Assets & Docs',
      description: 'Alert prior to legal compliance or contract document expiry.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin'],
    },
    {
      eventId: 'system_security_alert',
      eventName: 'System / Security Alerts',
      category: 'System',
      description: 'Critical notifications regarding workspace security or login alerts.',
      enabled: true,
      channels: { inApp: true, email: true, browser: true, sms: false, whatsapp: false },
      recipients: ['Owner', 'Admin'],
    },
  ];

  return {
    id: 'default',
    channels: {
      inApp: true,
      email: false,
      browser: false,
      sms: false,
      whatsapp: false,
    },
    providers: {
      email: { configured: false, providerName: 'Gmail via EmailJS' },
      sms: { configured: false, providerName: 'Twilio / MSG91 Gateway (Not Linked)' },
      whatsapp: { configured: false, providerName: 'WhatsApp Business API (Not Linked)' },
    },
    events,
    reminderTiming: {
      enabled: true,
      defaultOffsetDays: 3,
      offsets: [
        { id: 'same_day', label: 'Same Day (0 Days)', offsetDays: 0, enabled: true },
        { id: '1_day', label: '1 Day Before', offsetDays: 1, enabled: true },
        { id: '3_days', label: '3 Days Before', offsetDays: 3, enabled: true },
        { id: '7_days', label: '7 Days Before', offsetDays: 7, enabled: true },
        { id: 'overdue', label: 'Overdue Follow-up', offsetDays: -1, enabled: true },
      ],
    },
    quietHours: {
      enabled: false,
      startTime: '22:00',
      endTime: '07:00',
      timezone: 'Asia/Kolkata',
    },
    dailyDigest: {
      enabled: false,
      digestTime: '09:00',
      recipients: ['Owner', 'Admin'],
    },
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Default',
  };
}

/**
 * Fetch workspace notification settings from Cloud Firestore with Dexie local cache fallback.
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  await safeOpenDatabase();
  const defaultSettings = getDefaultNotificationSettings();

  try {
    const docRef = doc(dbFirestore, 'notificationSettings', 'default');
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data() as Partial<NotificationSettings>;
      const merged: NotificationSettings = {
        ...defaultSettings,
        ...data,
        channels: { ...defaultSettings.channels, ...(data.channels || {}) },
        providers: { ...defaultSettings.providers, ...(data.providers || {}) },
        reminderTiming: { ...defaultSettings.reminderTiming, ...(data.reminderTiming || {}) },
        quietHours: { ...defaultSettings.quietHours, ...(data.quietHours || {}) },
        dailyDigest: { ...defaultSettings.dailyDigest, ...(data.dailyDigest || {}) },
        events: defaultSettings.events.map((defEvt) => {
          const found = (data.events || []).find((e) => e.eventId === defEvt.eventId);
          if (!found) return defEvt;
          return {
            ...defEvt,
            ...found,
            channels: { ...defEvt.channels, ...(found.channels || {}) },
            recipients: found.recipients && Array.isArray(found.recipients) ? found.recipients : defEvt.recipients,
          };
        }),
      };

      await db.notificationSettings.put(merged);
      return merged;
    }
  } catch (err) {
    console.warn('[NotificationSettings] Firestore fetch warning, reading from local Dexie cache:', err);
  }

  // Dexie Fallback
  try {
    const cached = await db.notificationSettings.get('default');
    if (cached) {
      return cached;
    }
  } catch (dexieErr) {
    console.warn('[NotificationSettings] Dexie read warning:', dexieErr);
  }

  // Initial seed put into Dexie
  try {
    await db.notificationSettings.put(defaultSettings);
  } catch (_) {}

  return defaultSettings;
}

/**
 * Save notification settings to Cloud Firestore and update local Dexie cache.
 */
export async function saveNotificationSettings(
  settings: NotificationSettings,
  currentUser?: { uid?: string; email?: string | null; role?: string }
): Promise<NotificationSettings> {
  // Validation
  if (settings.reminderTiming.enabled) {
    if (settings.reminderTiming.defaultOffsetDays === undefined || isNaN(settings.reminderTiming.defaultOffsetDays)) {
      throw new Error('Please specify a valid default reminder offset value.');
    }
    for (const offset of settings.reminderTiming.offsets) {
      if (!offset.label.trim()) {
        throw new Error('Reminder offset label cannot be empty.');
      }
    }
  }

  if (settings.quietHours.enabled) {
    if (!settings.quietHours.startTime || !settings.quietHours.endTime) {
      throw new Error('Please select both start time and end time for quiet hours.');
    }
  }

  const payload: NotificationSettings = {
    ...settings,
    id: 'default',
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser?.email || currentUser?.uid || 'Workspace Admin',
  };

  await safeOpenDatabase();

  // 1. Write to Firestore
  try {
    const docRef = doc(dbFirestore, 'notificationSettings', 'default');
    await setDoc(docRef, payload, { merge: true });
  } catch (err: any) {
    console.error('[NotificationSettings] Save to Firestore error:', err);
    throw new Error(`Failed to save notification settings to Cloud Firestore: ${err?.message || 'Permission or network error'}`);
  }

  // 2. Write to Dexie
  try {
    await db.notificationSettings.put(payload);
  } catch (dexieErr) {
    console.warn('[NotificationSettings] Dexie update warning:', dexieErr);
  }

  return payload;
}

/**
 * Check Browser Notification Permission status safely.
 */
export function getBrowserNotificationPermissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Request Browser Notification Permission safely upon user interaction.
 */
export async function requestBrowserNotificationPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch (err) {
    console.warn('Browser Notification Permission request error:', err);
    return Notification.permission;
  }
}

export interface FcmTokenResult {
  success: boolean;
  token?: string;
  permission: 'granted' | 'denied' | 'default' | 'unsupported';
  message?: string;
  vapidKeyMissing?: boolean;
}

/**
 * Registers service worker, requests FCM registration token using VAPID key,
 * and updates token for authenticated user in Firestore /users/{uid}.
 */
export async function requestAndStoreFcmToken(
  currentUser?: { uid?: string; id?: string | number; email?: string | null }
): Promise<FcmTokenResult> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return {
      success: false,
      permission: 'unsupported',
      message: 'Browser push notifications are not supported in this environment.',
    };
  }

  const permission = await requestBrowserNotificationPermission();
  if (permission !== 'granted') {
    return {
      success: false,
      permission,
      message: 'Browser notification permission was not granted.',
    };
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return {
      success: false,
      permission,
      message: 'Firebase Messaging is not supported or initialized.',
    };
  }

  // Register service worker with Firebase config parameters
  let swRegistration: ServiceWorkerRegistration | undefined;
  try {
    // Same worker as the installable app (public/sw.js), so push and offline support share scope "/"
    swRegistration = await navigator.serviceWorker.register(serviceWorkerUrl(), { scope: '/' });
  } catch (swErr) {
    console.warn('[FCM] Service worker registration notice:', swErr);
  }

  const vapidKey = (firebaseConfig.vapidKey || import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();

  try {
    const token = await getToken(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swRegistration,
    });

    if (token) {
      // Store token in Firestore for authenticated user if user UID is available
      const uid = currentUser?.uid || currentUser?.id;
      if (uid) {
        try {
          const userRef = doc(dbFirestore, 'users', String(uid));
          await setDoc(userRef, { fcmToken: token, fcmTokenUpdatedAt: new Date().toISOString() }, { merge: true });
        } catch (fsErr) {
          console.warn('[FCM] Could not store FCM token in Firestore /users doc:', fsErr);
        }
      }

      // Setup foreground push notification listener
      onMessage(messaging, (payload) => {
        console.log('[FCM] Foreground push message received:', payload);
        const title = payload.notification?.title || payload.data?.title || 'Workspace Alert';
        const body = payload.notification?.body || payload.data?.body || 'New notification received.';
        try {
          new Notification(title, { body, icon: '/legendary-one-logo.png' });
        } catch (_) {}
      });

      return {
        success: true,
        token,
        permission: 'granted',
        vapidKeyMissing: !vapidKey,
        message: vapidKey
          ? 'FCM Push registration token generated successfully!'
          : 'FCM Token generated with default web push credentials. (For custom VAPID certificates, set VITE_FIREBASE_VAPID_KEY in .env).',
      };
    } else {
      return {
        success: false,
        permission: 'granted',
        vapidKeyMissing: !vapidKey,
        message: 'No FCM registration token returned from Firebase.',
      };
    }
  } catch (tokenErr: any) {
    console.warn('[FCM] Error generating FCM registration token:', tokenErr);
    return {
      success: false,
      permission: 'granted',
      vapidKeyMissing: !vapidKey,
      message: `Token Generation Notice: ${tokenErr?.message || 'Requires Web Push VAPID certificate from Firebase Console.'}`,
    };
  }
}

