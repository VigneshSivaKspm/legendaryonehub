import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { dbFirestore, firebaseConfig } from '../config/firebase';
import { db, safeOpenDatabase, type Employee, type EmployeeAccessRole } from '../db/database';
import { isOwnerRole } from './userService';

const SECONDARY_APP_NAME = 'employee-provisioning';

/**
 * A second Firebase app instance lets us create Auth accounts for employees
 * without replacing the admin's own signed-in session on the primary app.
 */
function getProvisioningApp(): FirebaseApp {
  const existing = getApps().find((a) => a.name === SECONDARY_APP_NAME);
  return existing || initializeApp(firebaseConfig, SECONDARY_APP_NAME);
}

function initialsOf(name: string): string {
  return (
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'EM'
  );
}

async function findUserDocsForEmployee(employee: Employee) {
  const email = (employee.email || '').trim().toLowerCase();
  const found = new Map<string, Record<string, any>>();

  if (employee.id !== undefined) {
    const byEmp = await getDocs(query(collection(dbFirestore, 'users'), where('employeeId', '==', String(employee.id))));
    byEmp.docs.forEach((d) => found.set(d.id, d.data()));
  }
  if (email) {
    const byEmail = await getDocs(query(collection(dbFirestore, 'users'), where('email', '==', email)));
    byEmail.docs.forEach((d) => found.set(d.id, d.data()));
  }
  return found;
}

export interface EmployeeLoginResult {
  created: boolean;
  uid?: string;
  message: string;
}

/**
 * Creates (or links) the login for an employee.
 * - New email: creates a Firebase Auth account with the given password and a users/{uid} profile.
 * - Email already registered: updates/creates the users profile by email so the role and
 *   employee link apply the next time that person signs in.
 */
export async function createEmployeeLogin(
  employee: Employee,
  password: string,
  accessRole: EmployeeAccessRole
): Promise<EmployeeLoginResult> {
  const email = (employee.email || '').trim().toLowerCase();
  if (!email) throw new Error('Employee email is required to create a login.');
  if (!password || password.length < 6) throw new Error('Login password must be at least 6 characters.');

  const now = new Date().toISOString();
  const profile = {
    email,
    name: employee.name,
    role: accessRole,
    dept: employee.dept || 'General',
    status: 'Active',
    employeeId: String(employee.id ?? ''),
    employeeName: `${employee.name} (${employee.employeeId || employee.role})`,
    avatarInitials: initialsOf(employee.name),
    updatedAt: now,
  };

  const secondaryApp = getProvisioningApp();
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;

    // Written through the primary (admin) session
    await setDoc(doc(dbFirestore, 'users', uid), { ...profile, uid, id: uid, createdAt: now }, { merge: true });
    await safeOpenDatabase();
    await db.users.put({ ...profile, id: uid, createdAt: now } as any);

    return { created: true, uid, message: `Login created for ${email}.` };
  } catch (err: any) {
    if (err?.code === 'auth/email-already-in-use') {
      await syncEmployeeAccessRole({ ...employee, accessRole });
      return {
        created: false,
        message: `${email} already has a login. Their role was updated to ${accessRole}; they can sign in with their existing password or use "Forgot password".`,
      };
    }
    if (err?.code === 'auth/weak-password') throw new Error('Password is too weak. Use at least 6 characters.');
    if (err?.code === 'auth/invalid-email') throw new Error('Please enter a valid employee email address.');
    if (err?.code === 'auth/operation-not-allowed') {
      throw new Error('Email/Password sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.');
    }
    throw err;
  } finally {
    try {
      await signOut(secondaryAuth);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Keeps the login profile(s) linked to an employee in step with the employee record:
 * access role, name and employee link. Owner accounts are never demoted.
 * When no login profile exists yet, a pre-provisioned profile is created by email,
 * which syncUserProfile picks up the first time that person signs in.
 */
export async function syncEmployeeAccessRole(employee: Employee): Promise<void> {
  const email = (employee.email || '').trim().toLowerCase();
  if (!email || employee.id === undefined) return;

  const accessRole = employee.accessRole || 'Employee';
  const now = new Date().toISOString();
  const existing = await findUserDocsForEmployee(employee);

  const linkFields = {
    name: employee.name,
    dept: employee.dept || 'General',
    employeeId: String(employee.id),
    employeeName: `${employee.name} (${employee.employeeId || employee.role})`,
    updatedAt: now,
  };

  if (existing.size === 0) {
    const docId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const payload = {
      ...linkFields,
      id: docId,
      email,
      role: accessRole,
      status: employee.status === 'Inactive' ? 'Disabled' : 'Active',
      avatarInitials: initialsOf(employee.name),
      createdAt: now,
    };
    await setDoc(doc(dbFirestore, 'users', docId), payload, { merge: true });
    return;
  }

  for (const [docId, data] of existing) {
    const keepOwner = isOwnerRole(data.role);
    await setDoc(
      doc(dbFirestore, 'users', docId),
      {
        ...linkFields,
        ...(keepOwner ? {} : { role: accessRole }),
        ...(employee.status === 'Inactive' && !keepOwner ? { status: 'Disabled' } : {}),
      },
      { merge: true }
    );
  }
}
