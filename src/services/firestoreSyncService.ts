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

async function syncTableAtomic(table: any, docs: any[]): Promise<void> {
  await safeOpenDatabase();
  await db.transaction('rw', table, async () => {
    await table.clear();
    if (docs.length > 0) await table.bulkPut(docs);
  });
}

  const collectionsToSync: Array<{ firestoreCol: string; syncToDexie: (docs: any[]) => Promise<void> }> = [
    {
      firestoreCol: 'clients',
      syncToDexie: (docs) => syncTableAtomic(db.clients, docs),
    },
    {
      firestoreCol: 'projects',
      syncToDexie: (docs) => syncTableAtomic(db.projects, docs),
    },
    {
      firestoreCol: 'invoices',
      syncToDexie: async (docs) => {
        const correctedDocs = await Promise.all(
          docs.map(async (d) => {
            return await autoCorrectInvoiceStatus(d);
          })
        );
        await syncTableAtomic(db.invoices, correctedDocs);
      },
    },
    {
      firestoreCol: 'payments',
      syncToDexie: (docs) => syncTableAtomic(db.payments, docs),
    },
    {
      firestoreCol: 'expenses',
      syncToDexie: (docs) => syncTableAtomic(db.expenses, docs),
    },
    {
      firestoreCol: 'tasks',
      syncToDexie: (docs) => syncTableAtomic(db.tasks, docs),
    },
    {
      firestoreCol: 'employees',
      syncToDexie: (docs) => syncTableAtomic(db.employees, docs),
    },
    {
      firestoreCol: 'attendance',
      syncToDexie: (docs) => syncTableAtomic(db.attendance, docs),
    },
    {
      firestoreCol: 'quotations',
      syncToDexie: (docs) => syncTableAtomic(db.quotations, docs),
    },
    {
      firestoreCol: 'leads',
      syncToDexie: (docs) => syncTableAtomic(db.leads, docs),
    },
    {
      firestoreCol: 'services',
      syncToDexie: async (docs) => {
        if (docs.length > 0) {
          await syncTableAtomic(db.services, docs);
        }
      },
    },
    {
      firestoreCol: 'projectActivity',
      syncToDexie: (docs) => syncTableAtomic(db.projectActivity, docs),
    },
    {
      firestoreCol: 'projectMilestones',
      syncToDexie: (docs) => syncTableAtomic(db.projectMilestones, docs),
    },
    {
      firestoreCol: 'projectFiles',
      syncToDexie: (docs) => syncTableAtomic(db.projectFiles, docs),
    },
    {
      firestoreCol: 'deliverables',
      syncToDexie: (docs) => syncTableAtomic(db.deliverables, docs),
    },
    {
      firestoreCol: 'leaveRequests',
      syncToDexie: (docs) => syncTableAtomic(db.leaveRequests, docs),
    },
    {
      firestoreCol: 'payroll',
      syncToDexie: (docs) => syncTableAtomic(db.payroll, docs),
    },
    {
      firestoreCol: 'payrollAdjustments',
      syncToDexie: (docs) => syncTableAtomic(db.payrollAdjustments, docs),
    },
    {
      firestoreCol: 'timesheets',
      syncToDexie: (docs) => syncTableAtomic(db.timesheets, docs),
    },
    {
      firestoreCol: 'assets',
      syncToDexie: (docs) => syncTableAtomic(db.assets, docs),
    },
    {
      firestoreCol: 'documents',
      syncToDexie: (docs) => syncTableAtomic(db.documents, docs),
    },
    {
      firestoreCol: 'rolePermissions',
      syncToDexie: (docs) => syncTableAtomic(db.rolePermissions, docs),
    },
    {
      firestoreCol: 'users',
      syncToDexie: (docs) => syncTableAtomic(db.users, docs),
    },
    {
      firestoreCol: 'billingSettings',
      syncToDexie: (docs) => syncTableAtomic(db.billingSettings, docs),
    },
    {
      firestoreCol: 'notificationSettings',
      syncToDexie: (docs) => syncTableAtomic(db.notificationSettings, docs),
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
