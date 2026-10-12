import { collection, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase } from '../db/database';
import { autoCorrectInvoiceStatus } from './invoiceService';

let unsubscribers: Unsubscribe[] = [];
let isInitialized = false;

/**
 * Initializes real-time Firestore snapshot synchronization into local Dexie cache.
 * Firestore is the primary source of truth. Dexie acts as the reactive local view.
 */
export function initFirestoreSync(): () => void {
  if (isInitialized) {
    return stopFirestoreSync;
  }
  isInitialized = true;

  const collectionsToSync: Array<{ firestoreCol: string; syncToDexie: (docs: any[]) => Promise<void> }> = [
    {
      firestoreCol: 'clients',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.clients.clear();
        if (docs.length > 0) await db.clients.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'projects',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.projects.clear();
        if (docs.length > 0) await db.projects.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'invoices',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        const correctedDocs = await Promise.all(
          docs.map(async (d) => {
            return await autoCorrectInvoiceStatus(d);
          })
        );
        await db.invoices.clear();
        if (correctedDocs.length > 0) await db.invoices.bulkPut(correctedDocs);
      },
    },
    {
      firestoreCol: 'payments',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.payments.clear();
        if (docs.length > 0) await db.payments.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'expenses',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.expenses.clear();
        if (docs.length > 0) await db.expenses.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'tasks',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.tasks.clear();
        if (docs.length > 0) await db.tasks.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'employees',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.employees.clear();
        if (docs.length > 0) await db.employees.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'attendance',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.attendance.clear();
        if (docs.length > 0) await db.attendance.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'quotations',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.quotations.clear();
        if (docs.length > 0) await db.quotations.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'leads',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.leads.clear();
        if (docs.length > 0) await db.leads.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'services',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        if (docs.length > 0) {
          await db.services.clear();
          await db.services.bulkPut(docs);
        }
      },
    },
    {
      firestoreCol: 'projectActivity',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.projectActivity.clear();
        if (docs.length > 0) await db.projectActivity.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'projectMilestones',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.projectMilestones.clear();
        if (docs.length > 0) await db.projectMilestones.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'projectFiles',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.projectFiles.clear();
        if (docs.length > 0) await db.projectFiles.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'deliverables',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.deliverables.clear();
        if (docs.length > 0) await db.deliverables.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'leaveRequests',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.leaveRequests.clear();
        if (docs.length > 0) await db.leaveRequests.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'payroll',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.payroll.clear();
        if (docs.length > 0) await db.payroll.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'payrollAdjustments',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.payrollAdjustments.clear();
        if (docs.length > 0) await db.payrollAdjustments.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'timesheets',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.timesheets.clear();
        if (docs.length > 0) await db.timesheets.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'assets',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.assets.clear();
        if (docs.length > 0) await db.assets.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'documents',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.documents.clear();
        if (docs.length > 0) await db.documents.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'rolePermissions',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.rolePermissions.clear();
        if (docs.length > 0) await db.rolePermissions.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'users',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.users.clear();
        if (docs.length > 0) await db.users.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'billingSettings',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.billingSettings.clear();
        if (docs.length > 0) await db.billingSettings.bulkPut(docs);
      },
    },
    {
      firestoreCol: 'notificationSettings',
      syncToDexie: async (docs) => {
        await safeOpenDatabase();
        await db.notificationSettings.clear();
        if (docs.length > 0) await db.notificationSettings.bulkPut(docs);
      },
    },
  ];

  collectionsToSync.forEach(({ firestoreCol, syncToDexie }) => {
    try {
      const colRef = collection(dbFirestore, firestoreCol);
      const unsub = onSnapshot(
        colRef,
        (snapshot) => {
          const docs = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              ...data,
              id: doc.id,
            };
          });
          syncToDexie(docs).catch((err) =>
            console.warn(`[FirestoreSync] Non-blocking warning syncing ${firestoreCol} to Dexie:`, err?.message || err)
          );
        },
        (error) => {
          console.warn(`[FirestoreSync] Permission or listener warning for collection "${firestoreCol}":`, error?.message || error);
        }
      );
      unsubscribers.push(unsub);
    } catch (err) {
      console.warn(`[FirestoreSync] Failed to initialize listener for collection "${firestoreCol}":`, err);
    }
  });

  return stopFirestoreSync;
}

export function stopFirestoreSync(): void {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
  isInitialized = false;
}
