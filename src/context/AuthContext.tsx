import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { useLiveQuery } from 'dexie-react-hooks';
import { auth } from '../config/firebase';
import { db, seedDatabaseIfEmpty, type Employee, type User } from '../db/database';
import {
  loginWithFirebase,
  logoutFirebase,
  syncUserProfile,
  isOwnerOrAdminRole,
  type AuthResponse,
} from '../services/authService';
import {
  getCompanyProfileResult,
  getLocalCachedCompanyProfile,
  type CompanyProfile,
} from '../services/companyService';
import { initFirestoreSync, stopFirestoreSync } from '../services/firestoreSyncService';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  companyProfile: CompanyProfile | null;
  isCompanySetupCompleted: boolean;
  isCheckingCompanySetup: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  refreshCompanyProfile: () => Promise<CompanyProfile | null>;
  canManageClients: boolean;
  canDeleteClients: boolean;
  canManageProjects: boolean;
  canManageServices: boolean;
  canAccessScreen: (screenKey: string) => boolean;
  /** Employee record linked to the signed-in user (by link or email), if any */
  myEmployee: Employee | null;
  /** Plain employees get a personal workspace instead of company-wide HR/finance pages */
  isSelfService: boolean;
}

/** Modules that show every employee's or the company's data; plain employees use My Workspace instead. */
const SELF_SERVICE_BLOCKED = new Set([
  'employees', 'attendance', 'leave', 'payroll', 'timesheets',
  'invoices', 'payments', 'expenses', 'quotations', 'reports',
  'services', 'settings', 'assets', 'leads', 'clients', 'client-profile',
]);

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(() => {
    return getLocalCachedCompanyProfile();
  });
  const [isCompanySetupCompleted, setIsCompanySetupCompleted] = useState<boolean>(() => {
    const cached = getLocalCachedCompanyProfile();
    return cached ? !!cached.setupCompleted : true;
  });
  const [isCheckingCompanySetup, setIsCheckingCompanySetup] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCompanyProfile = async (): Promise<CompanyProfile | null> => {
    setIsCheckingCompanySetup(true);
    try {
      if (firebaseUser) {
        const updatedUserProfile = await syncUserProfile(firebaseUser);
        if (updatedUserProfile) {
          setUser(updatedUserProfile);
        }
      }
      const res = await getCompanyProfileResult();
      if (res.status === 'FOUND') {
        setCompanyProfile(res.profile);
        setIsCompanySetupCompleted(!!res.profile?.setupCompleted);
        return res.profile;
      } else if (res.status === 'NOT_FOUND') {
        // ONLY trigger onboarding when Firestore explicitly confirms setup doc does NOT exist
        setCompanyProfile(null);
        setIsCompanySetupCompleted(false);
        return null;
      } else {
        // TIMEOUT_OR_ERROR:
        // Do NOT trigger onboarding. Use cached profile if available, or preserve workspace access.
        if (res.profile) {
          setCompanyProfile(res.profile);
          setIsCompanySetupCompleted(!!res.profile.setupCompleted);
          return res.profile;
        } else {
          console.warn('[AuthContext] Network or timeout error while checking setup. Preserving workspace access.');
          setIsCompanySetupCompleted(true);
          return null;
        }
      }
    } catch (err) {
      console.error('[AuthContext] Failed to refresh company profile:', err);
      return null;
    } finally {
      setIsCheckingCompanySetup(false);
    }
  };

  useEffect(() => {
    // Seed initial local database tables asynchronously without blocking auth state resolution
    seedDatabaseIfEmpty().catch((err) => {
      console.error('[AuthContext] Seed database warning:', err);
    });

    // Subscribe to real-time Firebase Auth state changes
    const unsubscribe = onAuthStateChanged(
      auth,
      async (fbUser) => {
        try {
          if (fbUser) {
            setFirebaseUser(fbUser);

            // 1. Sync Dexie user profile
            try {
              const profile = await syncUserProfile(fbUser);
              setUser(profile);
            } catch (syncErr: any) {
              if (syncErr?.message === 'ACCOUNT_DISABLED') {
                setFirebaseUser(null);
                setUser(null);
                return;
              }
              console.error('[AuthContext] syncUserProfile error:', syncErr);
            }

            // 2. Fetch Firestore Company Profile safely
            try {
              const res = await getCompanyProfileResult();
              if (res.status === 'FOUND') {
                setCompanyProfile(res.profile);
                setIsCompanySetupCompleted(!!res.profile?.setupCompleted);
              } else if (res.status === 'NOT_FOUND') {
                // ONLY trigger onboarding when Firestore explicitly confirms setup doc does NOT exist
                setCompanyProfile(null);
                setIsCompanySetupCompleted(false);
              } else {
                // TIMEOUT_OR_ERROR:
                // Do NOT trigger onboarding. Use cached profile if available, or preserve workspace access.
                if (res.profile) {
                  setCompanyProfile(res.profile);
                  setIsCompanySetupCompleted(!!res.profile.setupCompleted);
                } else {
                  console.warn('[AuthContext] Timeout or network error while checking company setup. Preserving workspace access.');
                  setIsCompanySetupCompleted(true);
                }
              }
            } catch (cErr) {
              console.error('[AuthContext] getCompanyProfile error:', cErr);
              // Do NOT trigger onboarding on error
            }

            // 3. Start real-time Firestore sync for all business entities
            initFirestoreSync();
          } else {
            stopFirestoreSync();
            setFirebaseUser(null);
            setUser(null);
            setCompanyProfile(null);
            setIsCompanySetupCompleted(false);
          }
        } catch (globalErr) {
          console.error('[AuthContext] Auth listener execution error:', globalErr);
        } finally {
          // ALWAYS resolve loading states to prevent deadlocks
          setIsCheckingCompanySetup(false);
          setIsLoading(false);
        }
      },
      (authError) => {
        console.error('[AuthContext] Firebase Auth listener error:', authError);
        setIsCheckingCompanySetup(false);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const login = async (
    email: string,
    password: string,
    rememberMe: boolean = false
  ): Promise<AuthResponse> => {
    return await loginWithFirebase(email, password, rememberMe);
  };

  const logout = async (): Promise<void> => {
    await logoutFirebase();
    setUser(null);
    setFirebaseUser(null);
    setCompanyProfile(null);
    setIsCompanySetupCompleted(false);
  };

  const liveRolePermissions = useLiveQuery(() => db.rolePermissions.toArray(), []) || [];
  const liveEmployees = useLiveQuery(() => db.employees.toArray(), []) || [];

  const role = user?.role || 'Guest';

  const myEmployee: Employee | null = user
    ? liveEmployees.find((e) => user.employeeId !== undefined && user.employeeId !== '' && String(e.id) === String(user.employeeId)) ||
      liveEmployees.find((e) => (e.email || '').trim().toLowerCase() === (user.email || '').toLowerCase()) ||
      null
    : null;

  const isSelfService = !!user && !isOwnerOrAdminRole(role) && role !== 'Project Manager' && role !== 'Accountant';

  // Role permissions matrix
  const canManageClients = isOwnerOrAdminRole(role) || role === 'Project Manager';
  const canDeleteClients = isOwnerOrAdminRole(role);
  const canManageProjects = isOwnerOrAdminRole(role) || role === 'Project Manager';
  const canManageServices = isOwnerOrAdminRole(role);

  const canAccessScreen = (screenKey: string): boolean => {
    if (!user) return false;
    if (isOwnerOrAdminRole(role)) return true;
    // Personal workspace: everyone with a linked employee record
    if (screenKey === 'my-workspace') return true;
    if (isSelfService && SELF_SERVICE_BLOCKED.has(screenKey)) return false;

    // Check custom role permissions if configured
    const cleanUserRole = role.toLowerCase().trim();
    const customRoleConfig = liveRolePermissions.find(
      (r) =>
        r.roleKey.toLowerCase().trim() === cleanUserRole ||
        r.roleName.toLowerCase().trim() === cleanUserRole
    );

    if (customRoleConfig && customRoleConfig.permissions) {
      let keyToLookup = screenKey;
      if (screenKey === 'client-profile') keyToLookup = 'clients';
      if (screenKey === 'project-detail') keyToLookup = 'projects';

      if (customRoleConfig.permissions[keyToLookup] !== undefined) {
        return Boolean(customRoleConfig.permissions[keyToLookup]);
      }
    }

    switch (screenKey) {
      case 'dashboard':
      case 'leads':
      case 'clients':
      case 'client-profile':
      case 'projects':
      case 'project-detail':
      case 'tasks':
      case 'deliverables':
      case 'reports':
        return true;
      case 'invoices':
      case 'payments':
      case 'expenses':
      case 'payroll':
      case 'quotations':
        return isOwnerOrAdminRole(role) || role === 'Accountant';
      case 'employees':
      case 'attendance':
      case 'timesheets':
      case 'leave':
        return isOwnerOrAdminRole(role) || role === 'Project Manager' || role === 'Employee';
      case 'services':
      case 'settings':
      case 'assets':
        return isOwnerOrAdminRole(role);
      default:
        return true;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        companyProfile,
        isCompanySetupCompleted,
        isCheckingCompanySetup,
        isAuthenticated: !!firebaseUser && !!user,
        isLoading,
        login,
        logout,
        refreshCompanyProfile,
        canManageClients,
        canDeleteClients,
        canManageProjects,
        canManageServices,
        canAccessScreen,
        myEmployee,
        isSelfService,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
