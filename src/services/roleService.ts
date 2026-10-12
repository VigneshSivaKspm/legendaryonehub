import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type RolePermissionConfig, type User } from '../db/database';

const COLLECTION_NAME = 'rolePermissions';

export const MODULE_PERMISSIONS_LIST = [
  { key: 'dashboard', label: 'Dashboard', category: 'General' },
  { key: 'leads', label: 'CRM Leads', category: 'CRM' },
  { key: 'clients', label: 'CRM Clients', category: 'CRM' },
  { key: 'projects', label: 'Projects', category: 'Work' },
  { key: 'tasks', label: 'Tasks', category: 'Work' },
  { key: 'deliverables', label: 'Deliverables', category: 'Work' },
  { key: 'quotations', label: 'Quotations', category: 'Sales & Finance' },
  { key: 'invoices', label: 'Invoices', category: 'Sales & Finance' },
  { key: 'payments', label: 'Payments', category: 'Sales & Finance' },
  { key: 'expenses', label: 'Expenses', category: 'Sales & Finance' },
  { key: 'employees', label: 'Employees', category: 'Team' },
  { key: 'attendance', label: 'Attendance', category: 'Team' },
  { key: 'timesheets', label: 'Timesheets', category: 'Team' },
  { key: 'leave', label: 'Leave', category: 'Team' },
  { key: 'payroll', label: 'Payroll', category: 'Team' },
  { key: 'services', label: 'Services', category: 'Business' },
  { key: 'assets', label: 'Assets', category: 'Business' },
  { key: 'documents', label: 'Documents', category: 'Business' },
  { key: 'reports', label: 'Reports', category: 'Business' },
  { key: 'settings', label: 'Settings & Security', category: 'System' },
];

/**
 * Returns clean doc ID for a given role name
 */
export function getRoleDocId(roleKey: string): string {
  return roleKey.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
  Default Role Permission Configurations
 */
export function getDefaultRolePermissions(): RolePermissionConfig[] {
  return [
    {
      roleKey: 'Owner / Super Admin',
      roleName: 'Owner / Super Admin',
      color: '#EF4444',
      accessDescription: 'Full unrestricted access to all modules and system security',
      permissions: {
        dashboard: true,
        leads: true,
        clients: true,
        projects: true,
        tasks: true,
        deliverables: true,
        quotations: true,
        invoices: true,
        payments: true,
        expenses: true,
        employees: true,
        attendance: true,
        timesheets: true,
        leave: true,
        payroll: true,
        services: true,
        assets: true,
        documents: true,
        reports: true,
        settings: true,
      },
    },
    {
      roleKey: 'Admin',
      roleName: 'Admin',
      color: '#F59E0B',
      accessDescription: 'All operational modules excluding super owner system overrides',
      permissions: {
        dashboard: true,
        leads: true,
        clients: true,
        projects: true,
        tasks: true,
        deliverables: true,
        quotations: true,
        invoices: true,
        payments: true,
        expenses: true,
        employees: true,
        attendance: true,
        timesheets: true,
        leave: true,
        payroll: true,
        services: true,
        assets: true,
        documents: true,
        reports: true,
        settings: true,
      },
    },
    {
      roleKey: 'Project Manager',
      roleName: 'Project Manager',
      color: '#3B5BDB',
      accessDescription: 'Projects, Tasks, Deliverables, Clients, Employees, and Reports',
      permissions: {
        dashboard: true,
        leads: true,
        clients: true,
        projects: true,
        tasks: true,
        deliverables: true,
        quotations: false,
        invoices: false,
        payments: false,
        expenses: false,
        employees: true,
        attendance: true,
        timesheets: true,
        leave: true,
        payroll: false,
        services: false,
        assets: true,
        documents: true,
        reports: true,
        settings: false,
      },
    },
    {
      roleKey: 'Employee',
      roleName: 'Employee',
      color: '#12B76A',
      accessDescription: 'Assigned tasks, timesheets, attendance, and leave management',
      permissions: {
        dashboard: true,
        leads: false,
        clients: false,
        projects: true,
        tasks: true,
        deliverables: false,
        quotations: false,
        invoices: false,
        payments: false,
        expenses: false,
        employees: true,
        attendance: true,
        timesheets: true,
        leave: true,
        payroll: false,
        services: false,
        assets: false,
        documents: true,
        reports: false,
        settings: false,
      },
    },
    {
      roleKey: 'Accountant',
      roleName: 'Accountant',
      color: '#8B5CF6',
      accessDescription: 'Invoices, Payments, Expenses, Payroll, Quotations, and Financial Reports',
      permissions: {
        dashboard: true,
        leads: false,
        clients: true,
        projects: false,
        tasks: false,
        deliverables: false,
        quotations: true,
        invoices: true,
        payments: true,
        expenses: true,
        employees: true,
        attendance: false,
        timesheets: false,
        leave: false,
        payroll: true,
        services: true,
        assets: false,
        documents: true,
        reports: true,
        settings: false,
      },
    },
  ];
}

/**
 * Fetches all role permission configurations from Firestore (with Dexie cache fallback).
 * Automatically seeds defaults if collection is uninitialized.
 */
export async function getAllRolePermissions(): Promise<RolePermissionConfig[]> {
  try {
    const snapshot = await getDocs(collection(dbFirestore, COLLECTION_NAME));
    if (!snapshot.empty) {
      const list = snapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: docSnap.id,
      })) as RolePermissionConfig[];

      await safeOpenDatabase();
      await db.rolePermissions.bulkPut(list);
      return list;
    }

    // Seed defaults to Firestore if empty
    const defaults = getDefaultRolePermissions();
    for (const item of defaults) {
      const docId = getRoleDocId(item.roleKey);
      const payload = {
        ...item,
        id: docId,
        updatedAt: new Date().toISOString(),
      };
      try {
        await setDoc(doc(dbFirestore, COLLECTION_NAME, docId), payload, { merge: true });
      } catch (e) {
        console.warn(`[RoleService] Seed Firestore role error for ${item.roleKey}:`, e);
      }
    }

    await safeOpenDatabase();
    await db.rolePermissions.bulkPut(defaults.map((d) => ({ ...d, id: getRoleDocId(d.roleKey) })));
    return defaults;
  } catch (err: any) {
    console.warn('[RoleService] Firestore fetch failed, reading from Dexie cache:', err?.message || err);
    await safeOpenDatabase();
    const cached = await db.rolePermissions.toArray();
    if (cached.length > 0) return cached;
    return getDefaultRolePermissions();
  }
}

/**
 * Saves updated permission configuration for a role in Firestore and Dexie.
 * Enforces critical system safety lock for Owner / Super Admin role so owner cannot lock out Settings/Security.
 */
export async function saveRolePermission(
  roleKey: string,
  newPermissions: Record<string, boolean>,
  currentUser?: User
): Promise<RolePermissionConfig> {
  const defaults = getDefaultRolePermissions();
  const existingDefault = defaults.find((d) => d.roleKey === roleKey);

  const docId = getRoleDocId(roleKey);
  const now = new Date().toISOString();

  // Safety Lock Enforcement: Owner / Super Admin must ALWAYS retain critical system access
  const isOwner = roleKey.toLowerCase().includes('owner') || roleKey.toLowerCase().includes('super admin');
  const safePermissions = { ...newPermissions };

  if (isOwner) {
    safePermissions.settings = true;
    safePermissions.dashboard = true;
    safePermissions.documents = true;
    safePermissions.employees = true;
  }

  const payload: RolePermissionConfig = {
    id: docId,
    roleKey,
    roleName: existingDefault?.roleName || roleKey,
    color: existingDefault?.color || '#3B5BDB',
    accessDescription: existingDefault?.accessDescription || 'Custom role permissions',
    permissions: safePermissions,
    updatedAt: now,
    updatedBy: currentUser?.name || currentUser?.email || 'Admin',
  };

  try {
    const docRef = doc(dbFirestore, COLLECTION_NAME, docId);
    await setDoc(docRef, payload, { merge: true });

    await safeOpenDatabase();
    await db.rolePermissions.put(payload);
    return payload;
  } catch (err: any) {
    console.warn('[RoleService] Firestore setDoc failed, saving to local cache:', err?.message || err);
    await safeOpenDatabase();
    await db.rolePermissions.put(payload);
    if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
      throw new Error('Firestore permission error: Security rules must be deployed to Cloud Firestore.');
    }
    return payload;
  }
}
