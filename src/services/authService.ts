import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type User } from '../db/database';

export interface AuthResponse {
  success: boolean;
  user?: User;
  firebaseUser?: FirebaseUser;
  message?: string;
  code?: string;
}

/**
 * Utility to check if a user role is Owner, Super Admin, or Admin (case-insensitive & supports all variants)
 */
export function isOwnerOrAdminRole(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return (
    r === 'owner' ||
    r === 'super admin' ||
    r === 'owner / super admin' ||
    r === 'admin' ||
    r.includes('owner') ||
    r.includes('super admin') ||
    r.includes('admin')
  );
}

/**
 * Maps Firebase Auth error codes to descriptive, actionable error messages
 */
export function getFirebaseErrorMessage(code: string, rawMessage?: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email address or password. Please check your credentials.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact your administrator.';
    case 'auth/too-many-requests':
      return 'Access to this account has been temporarily disabled due to many failed login attempts. Try resetting your password or wait a few minutes.';
    case 'auth/network-request-failed':
      return 'Network connection error. Please check your internet connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in Firebase Console. Go to Firebase Console > Authentication > Sign-in method and enable Email/Password.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid-please-pass-a-valid-api-key':
      return 'Invalid Firebase API Key. Please verify VITE_FIREBASE_API_KEY in your .env file.';
    case 'auth/app-not-authorized':
      return 'This domain is not authorized in Firebase Console. Add your domain under Firebase > Authentication > Settings > Authorized domains.';
    case 'auth/invalid-continue-uri':
      return 'The redirect URL provided in the password reset request is invalid.';
    case 'auth/unauthorized-continue-uri':
      return 'The domain for the password reset redirect URL is not authorized in Firebase Console.';
    case 'auth/missing-continue-uri':
      return 'A valid redirect URL is required for password reset.';
    default:
      if (code) {
        return `Request failed (${code}). ${rawMessage || 'Please verify your credentials and try again.'}`;
      }
      return rawMessage || 'Authentication failed. Please verify your credentials and try again.';
  }
}

/**
 * Syncs and retrieves user profile using Firestore as the primary source of truth.
 * Non-blocking: Local Dexie IndexedDB cache errors do NOT fail authentication.
 */
export async function syncUserProfile(fbUser: FirebaseUser): Promise<User | null> {
  try {
    if (!fbUser.email) return null;

    const cleanEmail = fbUser.email.trim().toLowerCase();
    const userDocRef = doc(dbFirestore, 'users', fbUser.uid);

    let fsRole: User['role'] = 'Employee';
    let formattedName = cleanEmail.split('@')[0].replace('.', ' ');
    formattedName = formattedName.charAt(0).toUpperCase() + formattedName.slice(1);
    let dept = 'General';
    let userStatus: 'Active' | 'Disabled' = 'Active';
    let empId: string | number | undefined = undefined;
    let empName: string | undefined = undefined;

    // Fetch profile from Firestore (Primary Source of Truth)
    let fsSnap;
    try {
      fsSnap = await getDoc(userDocRef);
    } catch (fsErr) {
      console.warn('[AuthService] Firestore user profile fetch warning:', fsErr);
    }

    if (fsSnap && fsSnap.exists()) {
      const fsData = fsSnap.data();
      fsRole = (fsData.role as User['role']) || 'Employee';
      formattedName = fsData.name || formattedName;
      dept = fsData.dept || (isOwnerOrAdminRole(fsRole) ? 'Executive' : 'General');
      userStatus = fsData.status || 'Active';
      empId = fsData.employeeId;
      empName = fsData.employeeName;
    } else {
      // Check if a pre-provisioned user document exists matching the email
      let preProvisionedDoc = null;
      try {
        const { query, collection, where, getDocs, limit } = await import('firebase/firestore');
        const q = query(collection(dbFirestore, 'users'), where('email', '==', cleanEmail), limit(1));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          preProvisionedDoc = qSnap.docs[0];
        }
      } catch (e) {
        console.warn('[AuthService] Pre-provisioned user query notice:', e);
      }

      if (preProvisionedDoc) {
        const fsData = preProvisionedDoc.data();
        fsRole = (fsData.role as User['role']) || 'Employee';
        formattedName = fsData.name || formattedName;
        dept = fsData.dept || (isOwnerOrAdminRole(fsRole) ? 'Executive' : 'General');
        userStatus = fsData.status || 'Active';
        empId = fsData.employeeId;
        empName = fsData.employeeName;

        // Link UID to pre-provisioned document
        try {
          await setDoc(
            userDocRef,
            { ...fsData, uid: fbUser.uid, id: fbUser.uid, provisionedFrom: preProvisionedDoc.id, updatedAt: new Date().toISOString() },
            { merge: true }
          );
          // The uid-keyed profile replaces the placeholder, so drop it to avoid duplicate users
          if (preProvisionedDoc.id !== fbUser.uid) {
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(preProvisionedDoc.ref);
          }
        } catch (e) {
          console.warn('[AuthService] Pre-provisioned UID link notice:', e);
        }
      } else {
        // First-time profile creation in Firestore for new users (Default: Employee)
        fsRole = 'Employee';
        dept = 'General';
        userStatus = 'Active';

        const newUserData = {
          uid: fbUser.uid,
          id: fbUser.uid,
          email: cleanEmail,
          name: formattedName,
          role: fsRole,
          dept,
          status: 'Active',
          avatarInitials: formattedName.slice(0, 2).toUpperCase(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        try {
          await setDoc(userDocRef, newUserData, { merge: true });
        } catch (err) {
          console.warn('[AuthService] Could not write new user to Firestore:', err);
        }
      }
    }

    // Link the login to its employee record by email when no link exists yet
    if (!empId) {
      try {
        const { query, collection, where, getDocs, limit } = await import('firebase/firestore');
        const empSnap = await getDocs(
          query(collection(dbFirestore, 'employees'), where('email', '==', cleanEmail), limit(1))
        );
        if (!empSnap.empty) {
          const empDoc = empSnap.docs[0];
          const emp = empDoc.data();
          empId = empDoc.id;
          empName = `${emp.name} (${emp.employeeId || emp.role || 'Employee'})`;
          // Role changes are admin-only (see firestore.rules); only the link is written here
          await setDoc(
            userDocRef,
            { employeeId: empId, employeeName: empName, updatedAt: new Date().toISOString() },
            { merge: true }
          );
          await setDoc(doc(dbFirestore, 'employees', empDoc.id), { userId: fbUser.uid }, { merge: true });
        }
      } catch (e) {
        console.warn('[AuthService] Employee link lookup notice:', e);
      }
    }

    if (userStatus === 'Disabled') {
      await signOut(auth);
      throw new Error('ACCOUNT_DISABLED');
    }

    const avatarInitials = formattedName.slice(0, 2).toUpperCase();
    const firestoreUserProfile: User = {
      id: fbUser.uid,
      email: cleanEmail,
      name: formattedName,
      role: fsRole,
      dept,
      status: userStatus,
      employeeId: empId,
      employeeName: empName,
      avatarInitials,
    };

    // Isolated local Dexie cache sync (Safe: Never blocks Auth on cache error)
    try {
      await safeOpenDatabase();
      let localProfile = await db.users.where('email').equalsIgnoreCase(cleanEmail).first();

      if (!localProfile) {
        await db.users.put(firestoreUserProfile);
      } else if (localProfile.role !== fsRole || localProfile.name !== formattedName) {
        await db.users.update(localProfile.id!, {
          role: fsRole,
          dept,
          name: formattedName,
          avatarInitials,
        });
      }
    } catch (dexieErr) {
      console.warn('[AuthService] Local Dexie cache sync warning (non-blocking):', dexieErr);
    }

    return firestoreUserProfile;
  } catch (err: any) {
    if (err?.message === 'ACCOUNT_DISABLED') throw err;
    console.error('Error in syncUserProfile:', err);
    if (fbUser.email) {
      const cleanEmail = fbUser.email.toLowerCase();
      let formattedName = cleanEmail.split('@')[0].replace('.', ' ');
      formattedName = formattedName.charAt(0).toUpperCase() + formattedName.slice(1);
      return {
        id: fbUser.uid,
        email: cleanEmail,
        name: formattedName,
        role: 'Employee',
        dept: 'General',
        avatarInitials: formattedName.slice(0, 2).toUpperCase(),
      };
    }
    return null;
  }
}

/**
 * Authenticates user via real Firebase Email/Password Auth
 */
export async function loginWithFirebase(
  email: string,
  password: string,
  rememberMe: boolean = false
): Promise<AuthResponse> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      return { success: false, message: 'Email address is required.' };
    }
    if (!password) {
      return { success: false, message: 'Password is required.' };
    }

    // Set persistence mode according to Remember Me checkbox
    const persistenceMode = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistenceMode);

    // Perform Firebase Authentication
    const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const fbUser = userCredential.user;

    // Fetch or sync user profile using Firestore as source of truth
    let userProfile: User | null;
    try {
      userProfile = await syncUserProfile(fbUser);
    } catch (syncErr: any) {
      if (syncErr?.message === 'ACCOUNT_DISABLED') {
        return { success: false, code: 'auth/user-disabled', message: getFirebaseErrorMessage('auth/user-disabled') };
      }
      throw syncErr;
    }

    return {
      success: true,
      firebaseUser: fbUser,
      user: userProfile || undefined,
    };
  } catch (err: any) {
    const errorCode = err?.code || '';
    const rawMsg = err?.message || '';
    console.error('Firebase Auth error code:', errorCode, 'message:', rawMsg);

    const message = getFirebaseErrorMessage(errorCode, rawMsg);
    return { success: false, message, code: errorCode };
  }
}

/**
 * Logs out user from Firebase Auth
 */
export async function logoutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Error logging out from Firebase:', err);
  }
}

/**
 * Sends a password reset email via Firebase Authentication
 */
export async function sendFirebasePasswordReset(email: string): Promise<AuthResponse> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      return { success: false, message: 'Please enter your email address.' };
    }

    const actionCodeSettings = {
      url: `${window.location.origin}/`,
      handleCodeInApp: false,
    };

    await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings);

    return {
      success: true,
      message: `Password reset request accepted by Firebase for ${cleanEmail}. Check your inbox, spam, and promotions folders.`,
    };
  } catch (err: any) {
    const errorCode = err?.code || '';
    const rawMsg = err?.message || '';
    console.error('[Firebase Auth] Password Reset error code:', errorCode, 'message:', rawMsg, err);

    const message = getFirebaseErrorMessage(errorCode, rawMsg);
    return { success: false, message, code: errorCode };
  }
}
