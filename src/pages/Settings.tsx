import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Shield,
  Lock,
  X,
  Check,
  RefreshCw,
  AlertCircle,
  Users,
  CreditCard,
  Receipt,
  Building,
  FileText,
  Save,
  CheckCircle2,
  DollarSign,
  Landmark,
  QrCode,
  Banknote,
  Info,
  HelpCircle,
  Sliders,
  Bell,
  Mail,
  Smartphone,
  MessageSquare,
  Globe,
  Clock,
  Moon,
  Sun,
  Calendar,
  Send,
  AlertTriangle,
  Filter,
  UserCheck,
  Zap,
  BellOff,
  Layers,
  Search,
  Plus,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { isOwnerOrAdminRole } from '../services/authService';
import { db, type RolePermissionConfig, type BillingSettings, type NotificationSettings, type RecipientRole } from '../db/database';
import {
  getAllRolePermissions,
  saveRolePermission,
  getDefaultRolePermissions,
  MODULE_PERMISSIONS_LIST,
} from '../services/roleService';
import {
  getBillingSettings,
  saveBillingSettings,
  getDefaultBillingSettings,
} from '../services/billingSettingsService';
import {
  getNotificationSettings,
  saveNotificationSettings,
  getDefaultNotificationSettings,
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
  requestAndStoreFcmToken,
  ALL_RECIPIENT_ROLES,
} from '../services/notificationSettingsService';
import { dispatchTestEmail } from '../services/emailNotificationService';
import LedgerImport from '../components/LedgerImport';
import CompanySetupWizard from '../components/CompanySetupWizard';
import ManageUsersModal from '../components/ManageUsersModal';
import logoDefault from '../assets/legendary-one-logo.png';

const sections = ['Company', 'Users & Roles', 'Billing', 'Notifications', 'Integrations', 'Security', 'Data Import'];

export default function Settings() {
  const { companyProfile, user, refreshCompanyProfile } = useAuth();
  const { showToast } = useToast();

  const [active, setActive] = useState('Company');
  const [isEditingWizard, setIsEditingWizard] = useState(false);
  const [showManageUsersModal, setShowManageUsersModal] = useState(false);

  // Live query for real database users, employees, role permission configurations, billing settings, and notification settings
  const liveUsers = useLiveQuery(() => db.users.toArray(), []) || [];
  const liveEmployees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const liveRolePermissions = useLiveQuery(() => db.rolePermissions.toArray(), []) || [];
  const liveBillingSettings = useLiveQuery(() => db.billingSettings.toArray(), []) || [];
  const liveNotificationSettings = useLiveQuery(() => db.notificationSettings.toArray(), []) || [];

  // Modal states for role permission configure
  const [selectedRoleConfig, setSelectedRoleConfig] = useState<RolePermissionConfig | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<Record<string, boolean>>({});
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [saveRoleErrorMsg, setSaveRoleErrorMsg] = useState<string>('');

  // Billing Settings Form state
  const [billingData, setBillingData] = useState<BillingSettings>(() => getDefaultBillingSettings());
  const [isSavingBilling, setIsSavingBilling] = useState(false);
  const [billingErrorMsg, setBillingErrorMsg] = useState<string>('');

  // Notification Settings Form state
  const [notifData, setNotifData] = useState<NotificationSettings>(() => getDefaultNotificationSettings());
  const [isSavingNotif, setIsSavingNotif] = useState(false);
  const [notifErrorMsg, setNotifErrorMsg] = useState<string>('');
  const [browserPerm, setBrowserPerm] = useState<'granted' | 'denied' | 'default' | 'unsupported'>(() =>
    getBrowserNotificationPermissionState()
  );
  const [notifCategoryFilter, setNotifCategoryFilter] = useState<string>('All');
  const [notifSearchQuery, setNotifSearchQuery] = useState<string>('');
  const [customOffsetInput, setCustomOffsetInput] = useState<string>('');
  const [customOffsetLabel, setCustomOffsetLabel] = useState<string>('');
  const [showAddOffsetModal, setShowAddOffsetModal] = useState<boolean>(false);

  const isOwnerOrAdmin = isOwnerOrAdminRole(user?.role);

  // Load role permissions, billing settings & notification settings on mount
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        await getAllRolePermissions();
        const bData = await getBillingSettings();
        if (mounted && bData) {
          setBillingData(bData);
        }
        const nData = await getNotificationSettings();
        if (mounted && nData) {
          setNotifData(nData);
        }
      } catch (err) {
        console.warn('Initial settings load notice:', err);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Sync billing data when live Dexie query updates
  useEffect(() => {
    if (liveBillingSettings.length > 0) {
      setBillingData(liveBillingSettings[0]);
    }
  }, [liveBillingSettings]);

  // Sync notification settings when live Dexie query updates
  useEffect(() => {
    if (liveNotificationSettings.length > 0) {
      setNotifData(liveNotificationSettings[0]);
    }
  }, [liveNotificationSettings]);

  // Compute list of 5 standard roles merged with live permissions and real assigned users
  const roleList = useMemo(() => {
    const defaults = getDefaultRolePermissions();

    return defaults.map((def) => {
      const match = liveRolePermissions.find(
        (r) =>
          r.roleKey.toLowerCase().trim() === def.roleKey.toLowerCase().trim() ||
          r.roleName.toLowerCase().trim() === def.roleName.toLowerCase().trim()
      );

      const effectiveConfig: RolePermissionConfig = match ? { ...def, ...match } : def;

      const keyLower = def.roleKey.toLowerCase().trim();
      const realUserNames = new Set<string>();

      liveUsers.forEach((u) => {
        const uRole = (u.role || '').toLowerCase().trim();
        if (
          uRole === keyLower ||
          (keyLower.includes('owner') && uRole.includes('owner')) ||
          (keyLower.includes('admin') && uRole.includes('admin') && !uRole.includes('owner')) ||
          (keyLower.includes('project manager') && uRole.includes('project manager')) ||
          (keyLower.includes('employee') && uRole.includes('employee')) ||
          (keyLower.includes('accountant') && uRole.includes('accountant'))
        ) {
          if (u.name) realUserNames.add(u.name.trim());
        }
      });

      liveEmployees.forEach((emp) => {
        const eRole = (emp.role || '').toLowerCase().trim();
        if (
          eRole === keyLower ||
          (keyLower.includes('owner') && eRole.includes('owner')) ||
          (keyLower.includes('admin') && eRole.includes('admin') && !eRole.includes('owner')) ||
          (keyLower.includes('project manager') && eRole.includes('project manager')) ||
          (keyLower.includes('employee') && eRole.includes('employee')) ||
          (keyLower.includes('accountant') && eRole.includes('accountant'))
        ) {
          if (emp.name) realUserNames.add(emp.name.trim());
        }
      });

      return {
        config: effectiveConfig,
        assignedUsers: Array.from(realUserNames),
      };
    });
  }, [liveRolePermissions, liveUsers, liveEmployees]);

  // Open Configure Modal for a selected role
  const handleOpenConfigureModal = (config: RolePermissionConfig) => {
    setSelectedRoleConfig(config);
    setDraftPermissions({ ...config.permissions });
    setSaveRoleErrorMsg('');
  };

  // Close Configure Modal
  const handleCloseModal = () => {
    setSelectedRoleConfig(null);
    setDraftPermissions({});
    setSaveRoleErrorMsg('');
  };

  // Save Role Permission changes to Firestore
  const handleSaveRolePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoleConfig) return;

    try {
      setIsSavingRole(true);
      setSaveRoleErrorMsg('');

      const updated = await saveRolePermission(
        selectedRoleConfig.roleKey,
        draftPermissions,
        user || undefined
      );

      showToast(`Permissions for role "${updated.roleName}" updated successfully!`, 'success');
      handleCloseModal();
    } catch (err: any) {
      console.error('Failed to save role permissions:', err);
      const msg = err?.message || 'Failed to save role permissions to Firestore.';
      setSaveRoleErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setIsSavingRole(false);
    }
  };

  // Save Billing Settings to Firestore
  const handleSaveBillingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnerOrAdmin) {
      showToast('Only Owner, Super Admin, or Admin can save billing settings.', 'error');
      return;
    }

    try {
      setIsSavingBilling(true);
      setBillingErrorMsg('');

      const updated = await saveBillingSettings(billingData, user || undefined);
      setBillingData(updated);
      showToast('Workspace billing settings saved successfully to Cloud Firestore!', 'success');
    } catch (err: any) {
      console.error('Failed to save billing settings:', err);
      const msg = err?.message || 'Failed to save billing settings.';
      setBillingErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setIsSavingBilling(false);
    }
  };

  // Save Notification Settings to Firestore
  const handleSaveNotificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnerOrAdmin) {
      showToast('Only workspace Owner or Super Admin can edit notification settings.', 'error');
      return;
    }

    try {
      setIsSavingNotif(true);
      setNotifErrorMsg('');

      const updated = await saveNotificationSettings(notifData, user || undefined);
      setNotifData(updated);
      showToast('Workspace notification settings saved successfully to Cloud Firestore!', 'success');
    } catch (err: any) {
      console.error('Failed to save notification settings:', err);
      const msg = err?.message || 'Failed to save notification settings.';
      setNotifErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setIsSavingNotif(false);
    }
  };

  const handleEnableBrowserNotifications = async () => {
    const res = await requestAndStoreFcmToken(user || undefined);
    setBrowserPerm(res.permission);
    if (res.permission === 'granted') {
      showToast(res.message || 'Browser push notifications enabled & FCM registration token stored!', 'success');
      setNotifData((prev) => ({
        ...prev,
        channels: { ...prev.channels, browser: true },
      }));
    } else if (res.permission === 'denied') {
      showToast('Browser notifications permission was denied in your browser settings.', 'error');
    } else if (res.permission === 'unsupported') {
      showToast('Browser notifications are not supported in this browser.', 'error');
    }
  };

  const handleSendTestNotification = async (channel: 'inApp' | 'browser' | 'email' | 'sms' | 'whatsapp') => {
    if (channel === 'inApp') {
      showToast('🔔 TEST NOTIFICATION: In-App workspace notification channel is active & ready!', 'info');
      if (getBrowserNotificationPermissionState() === 'granted') {
        try {
          new Notification('Legendary One Test Notification', {
            body: 'This is a test notification from your workspace Notification Settings.',
          });
        } catch (_) { }
      }
    } else if (channel === 'browser') {
      if (browserPerm !== 'granted') {
        showToast('Please request browser notification permission first.', 'error');
        return;
      }
      try {
        new Notification('Legendary One Push Test', {
          body: 'Browser desktop push notification test successful!',
        });
        showToast('Test browser push notification triggered!', 'success');
      } catch (err) {
        showToast('Failed to trigger browser push notification.', 'error');
      }
    } else if (channel === 'email') {
      showToast('Sending test email...', 'info');
      const res = await dispatchTestEmail(user?.email || undefined, notifData.emailjs);
      if (res.success) {
        showToast(res.message, 'success');
      } else {
        showToast(res.message, 'error');
      }
    } else {
      const providerInfo = notifData.providers[channel];
      showToast(
        `[Configuration Only] ${channel.toUpperCase()} channel test disabled: Provider (${providerInfo.providerName}) is not connected.`,
        'error'
      );
    }
  };

  const handleAddCustomOffset = () => {
    const offsetNum = parseInt(customOffsetInput.trim(), 10);
    if (isNaN(offsetNum)) {
      showToast('Please enter a valid numeric offset (days before).', 'error');
      return;
    }
    if (offsetNum < -1) {
      showToast('Offset days cannot be less than -1.', 'error');
      return;
    }
    const label = customOffsetLabel.trim() || `${offsetNum === 0 ? 'Same Day' : offsetNum === -1 ? 'Overdue Follow-up' : `${offsetNum} Days Before`}`;
    const id = `custom_${Date.now()}`;

    setNotifData((prev) => ({
      ...prev,
      reminderTiming: {
        ...prev.reminderTiming,
        offsets: [...prev.reminderTiming.offsets, { id, label, offsetDays: offsetNum, enabled: true }],
      },
    }));

    setCustomOffsetInput('');
    setCustomOffsetLabel('');
    setShowAddOffsetModal(false);
    showToast(`Added reminder offset "${label}"`, 'success');
  };

  if (isEditingWizard && companyProfile) {
    return (
      <div style={{ position: 'relative' }}>
        <div
          style={{
            padding: '16px 24px',
            background: '#1A1F36',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15 }}>Editing Firestore Company Profile</div>
          <button
            className="btn-secondary"
            onClick={() => setIsEditingWizard(false)}
            style={{ fontSize: 13, background: '#FFF', color: '#1A1F36' }}
          >
            ← Cancel & Return to Settings
          </button>
        </div>
        <CompanySetupWizard
          initialData={companyProfile}
          isEditMode={true}
          onComplete={async () => {
            await refreshCompanyProfile();
            setIsEditingWizard(false);
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1300, margin: '0 auto', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="page-title">Settings</div>
        <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
          Manage application configuration, company profile, user permissions, and billing defaults
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        {/* Navigation Sidebar */}
        <div className="card" style={{ padding: 10, height: 'fit-content' }}>
          {sections.map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                borderRadius: 8,
                border: 'none',
                fontSize: 13,
                cursor: 'pointer',
                background: active === s ? '#EEF2FF' : 'transparent',
                color: active === s ? '#3B5BDB' : '#697586',
                fontWeight: active === s ? 600 : 400,
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div>
          {active === 'Data Import' && <LedgerImport />}
          {/* TAB 1: COMPANY */}
          {active === 'Company' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Header card */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36' }}>
                      {companyProfile?.companyName || 'Legendary One Business'}
                    </div>
                    <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>
                      {companyProfile?.tagline || 'Official Registered Company Profile (Firestore Sync)'}
                    </div>
                  </div>
                  {isOwnerOrAdmin && (
                    <button
                      className="btn-primary"
                      onClick={() => setIsEditingWizard(true)}
                      style={{ fontSize: 13, padding: '8px 16px', background: '#3B5BDB' }}
                    >
                      ✏️ Edit Setup Wizard
                    </button>
                  )}
                </div>

                {/* Logo Banner */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    marginBottom: 20,
                    padding: 16,
                    background: '#F8F9FC',
                    borderRadius: 12,
                    border: '1px solid #E5E9F2',
                  }}
                >
                  <img
                    src={companyProfile?.logoUrl || logoDefault}
                    alt="Company Logo"
                    style={{ height: 48, maxWidth: 180, objectFit: 'contain' }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1A1F36' }}>
                      {companyProfile?.companyName} Logo
                    </div>
                    <div style={{ fontSize: 12, color: '#697586' }}>
                      {companyProfile?.logoUrl ? 'Persistent Logo URL' : 'Default Logo Asset'}
                    </div>
                  </div>
                </div>

                {/* Company Information Overview */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Business Type</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.businessType || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Business Email</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.businessEmail || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Phone Number</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.phoneNumber || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Website</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.website || 'N/A'}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Registered Address</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.addressLine1}
                      {companyProfile?.addressLine2 ? `, ${companyProfile.addressLine2}` : ''}, {companyProfile?.city},{' '}
                      {companyProfile?.state} - {companyProfile?.pincode}, {companyProfile?.country}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tax & Banking Overview Card */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
                  Taxation & Primary Bank Account
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>GSTIN</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.gstin || 'Not Provided'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>PAN</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.pan || 'Not Provided'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>UDYAM / MSME</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.udyamNumber || 'Not Provided'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Financial Year Start</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.financialYearStart || 'April 1st'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Currency</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.currency || 'INR (₹)'}
                    </div>
                  </div>

                  <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #F1F5F9', paddingTop: 14, marginTop: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1A1F36', marginBottom: 10 }}>Bank Account Details</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#697586' }}>Bank Name</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{companyProfile?.bankName}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#697586' }}>Account Holder</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{companyProfile?.accountHolderName}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#697586' }}>Account Number</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{companyProfile?.accountNumber ? `••••${companyProfile.accountNumber.slice(-4)}` : ''}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#697586' }}>IFSC Code</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{companyProfile?.ifscCode}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#697586' }}>Branch</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{companyProfile?.branchName}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Office Settings Overview Card */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
                  Office Schedule & Document Prefixes
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Working Days</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.workingDays?.join(', ')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Office Hours</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      {companyProfile?.officeStartTime} to {companyProfile?.officeEndTime} ({companyProfile?.weeklyOff} off)
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Invoice Prefix</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      <span className="badge badge-blue">{companyProfile?.defaultInvoicePrefix}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#697586', textTransform: 'uppercase' }}>Quotation Prefix</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36', marginTop: 3 }}>
                      <span className="badge badge-cyan">{companyProfile?.defaultQuotationPrefix}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: USERS & ROLES */}
          {active === 'Users & Roles' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '18px 24px', borderBottom: '1px solid #E5E9F2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FAFAFC' }}>
                <div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 16, color: '#1E293B' }}>
                    User Roles & Access Permissions
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
                    Manage module access matrices persisted in Cloud Firestore. Click Configure on any role to customize permissions.
                  </div>
                </div>
                <button
                  className="btn-primary"
                  style={{ fontSize: 13, gap: 6 }}
                  onClick={() => setShowManageUsersModal(true)}
                >
                  <Users size={15} />
                  Manage Users
                </button>
              </div>

              {roleList.map(({ config, assignedUsers }) => (
                <div key={config.roleKey} style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', transition: 'background 0.15s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 280 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: config.color, display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontWeight: 800, fontSize: 15, color: '#0F172A' }}>{config.roleName}</span>
                        {config.roleKey.toLowerCase().includes('owner') && (
                          <span className="badge badge-red" style={{ fontSize: 10, padding: '2px 8px', gap: 4 }}>
                            <Shield size={11} />
                            System Safety Lock
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 13, color: '#64748B', marginBottom: 10, lineHeight: 1.4 }}>
                        {config.accessDescription}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Assigned Users:
                        </span>
                        {assignedUsers.length > 0 ? (
                          assignedUsers.map((name) => (
                            <span key={name} className="badge badge-gray" style={{ fontSize: 11.5, padding: '4px 10px', background: '#F1F5F9', color: '#334155', fontWeight: 600 }}>
                              {name}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>No users assigned</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleOpenConfigureModal(config)}
                      style={{ fontSize: 13, padding: '7px 14px', fontWeight: 600, borderColor: '#CBD5E1' }}
                    >
                      Configure
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: BILLING */}
          {active === 'Billing' && (
            <form onSubmit={handleSaveBillingSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Header Banner */}
              <div className="card" style={{ padding: '20px 24px', background: '#FFFFFF', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Receipt size={20} />
                    </div>
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>
                        Workspace Billing & Invoices Configuration
                      </h2>
                      <p style={{ fontSize: 12.5, color: '#64748B', margin: 0 }}>
                        Configure default payment terms, GST/TDS tax rules, accepted payment methods, and invoice formatting.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSavingBilling || !isOwnerOrAdmin}
                  style={{ fontSize: 13, gap: 6 }}
                >
                  {isSavingBilling ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Saving to Firestore...
                    </>
                  ) : (
                    <>
                      <Save size={15} />
                      Save Billing Settings
                    </>
                  )}
                </button>
              </div>

              {/* Error Alert */}
              {billingErrorMsg && (
                <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '14px 18px', borderRadius: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AlertCircle size={18} style={{ flexShrink: 0 }} />
                  <div>{billingErrorMsg}</div>
                </div>
              )}

              {/* CARD 1: Payment Terms, Tax & Currency Defaults */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
                  <Sliders size={18} style={{ color: '#2563EB' }} />
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 15, color: '#0F172A' }}>
                    Payment Terms, Tax & Currency Defaults
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 18 }}>
                  {/* Default Payment Terms */}
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Default Payment Terms
                    </label>
                    <select
                      className="input-base"
                      value={billingData.defaultPaymentTerms}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, defaultPaymentTerms: e.target.value as any }))}
                    >
                      <option value="Due on Receipt">Due on Receipt</option>
                      <option value="7 Days">Net 7 Days</option>
                      <option value="15 Days">Net 15 Days</option>
                      <option value="30 Days">Net 30 Days</option>
                      <option value="45 Days">Net 45 Days</option>
                      <option value="60 Days">Net 60 Days</option>
                    </select>
                  </div>

                  {/* Default Tax Mode */}
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Default Invoice Tax Mode
                    </label>
                    <select
                      className="input-base"
                      value={billingData.defaultTaxMode}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, defaultTaxMode: e.target.value as any }))}
                    >
                      <option value="Exclusive">Tax Exclusive (Added to total)</option>
                      <option value="Inclusive">Tax Inclusive (Included in prices)</option>
                      <option value="None">No Tax</option>
                    </select>
                  </div>

                  {/* Currency Display (From Company Profile) */}
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Currency (From Company Setup)
                    </label>
                    <input
                      type="text"
                      className="input-base"
                      value={companyProfile?.currency || billingData.currency || 'INR (₹)'}
                      readOnly
                      style={{ background: '#F8FAFC', color: '#64748B', fontWeight: 600 }}
                    />
                  </div>

                  {/* Default Due Date Offset Days */}
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Default Due Date Offset (Days)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      className="input-base"
                      value={billingData.defaultDueDateOffsetDays}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, defaultDueDateOffsetDays: Math.max(0, parseInt(e.target.value) || 0) }))}
                    />
                  </div>
                </div>

                {/* GST & TDS Toggles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
                  {/* GST */}
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>GST Taxation</div>
                      <input
                        type="checkbox"
                        checked={billingData.isGstEnabled}
                        onChange={(e) => setBillingData((prev) => ({ ...prev, isGstEnabled: e.target.checked }))}
                        style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                      />
                    </div>
                    {billingData.isGstEnabled ? (
                      <div>
                        <label className="form-label" style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginBottom: 4 }}>
                          Default GST Percentage (%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={28}
                          className="input-base"
                          value={billingData.defaultGstRate}
                          onChange={(e) => setBillingData((prev) => ({ ...prev, defaultGstRate: Math.min(28, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#94A3B8' }}>GST calculations disabled for invoices</div>
                    )}
                  </div>

                  {/* TDS */}
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>TDS Deduction</div>
                      <input
                        type="checkbox"
                        checked={billingData.isTdsEnabled}
                        onChange={(e) => setBillingData((prev) => ({ ...prev, isTdsEnabled: e.target.checked }))}
                        style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                      />
                    </div>
                    {billingData.isTdsEnabled ? (
                      <div>
                        <label className="form-label" style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginBottom: 4 }}>
                          Default TDS Percentage (%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          className="input-base"
                          value={billingData.defaultTdsRate}
                          onChange={(e) => setBillingData((prev) => ({ ...prev, defaultTdsRate: Math.min(30, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#94A3B8' }}>TDS tracking disabled by default</div>
                    )}
                  </div>

                  {/* Late Fee Reminders */}
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>Late Payment Reminders</div>
                      <input
                        type="checkbox"
                        checked={billingData.enableLateReminders}
                        onChange={(e) => setBillingData((prev) => ({ ...prev, enableLateReminders: e.target.checked }))}
                        style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                      />
                    </div>
                    {billingData.enableLateReminders ? (
                      <div>
                        <label className="form-label" style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginBottom: 4 }}>
                          Late Fee Interest % (Optional)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={50}
                          className="input-base"
                          value={billingData.lateFeePercentage}
                          onChange={(e) => setBillingData((prev) => ({ ...prev, lateFeePercentage: Math.min(50, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#94A3B8' }}>Automatic reminders disabled</div>
                    )}
                  </div>
                </div>
              </div>

              {/* CARD 2: Accepted Business Payment Methods */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
                  <CreditCard size={18} style={{ color: '#2563EB' }} />
                  <div>
                    <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 15, color: '#0F172A' }}>
                      Accepted Payment Methods
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      Select which payment options your business accepts from clients. Sensitive card credentials are never stored.
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  {[
                    { key: 'bankTransfer', label: 'Bank Transfer (NEFT/RTGS/IMPS)', icon: <Landmark size={18} style={{ color: '#2563EB' }} /> },
                    { key: 'upi', label: 'UPI / VPA Payment', icon: <QrCode size={18} style={{ color: '#10B981' }} /> },
                    { key: 'cash', label: 'Cash', icon: <Banknote size={18} style={{ color: '#D97706' }} /> },
                    { key: 'cheque', label: 'Cheque', icon: <FileText size={18} style={{ color: '#8B5CF6' }} /> },
                    { key: 'cardOnline', label: 'Card / Online Payment', icon: <CreditCard size={18} style={{ color: '#EC4899' }} /> },
                  ].map((method) => {
                    const isChecked = Boolean(billingData.acceptedPaymentMethods?.[method.key as keyof typeof billingData.acceptedPaymentMethods]);

                    return (
                      <label
                        key={method.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: isChecked ? '#EFF6FF' : '#F8FAFC',
                          border: isChecked ? '1px solid #93C5FD' : '1px solid #E2E8F0',
                          borderRadius: 10,
                          padding: '12px 14px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {method.icon}
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: isChecked ? '#1E40AF' : '#475569' }}>
                            {method.label}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const updated = {
                              ...billingData.acceptedPaymentMethods,
                              [method.key]: e.target.checked,
                            };
                            setBillingData((prev) => ({ ...prev, acceptedPaymentMethods: updated }));
                          }}
                          style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* CARD 3: Payment Account & UPI Display Settings */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
                  <Building size={18} style={{ color: '#2563EB' }} />
                  <div>
                    <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 15, color: '#0F172A' }}>
                      Payment Account Details & UPI Settings
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      Reuses Company Bank Details from setup. Configure UPI ID and payment display preferences.
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 16 }}>
                  {/* UPI ID */}
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Business UPI ID / Virtual Payment Address (VPA)
                    </label>
                    <input
                      type="text"
                      className="input-base"
                      placeholder="e.g. companyname@okaxis"
                      value={billingData.upiId || ''}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, upiId: e.target.value }))}
                    />
                  </div>

                  {/* Bank Display Preference */}
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Bank Details Display Preference
                    </label>
                    <select
                      className="input-base"
                      value={billingData.bankDisplayPreference}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, bankDisplayPreference: e.target.value as any }))}
                    >
                      <option value="Show Primary Bank Account">Show Primary Bank Account</option>
                      <option value="Show Secondary Bank">Show Secondary Bank</option>
                      <option value="Hide Bank Info">Hide Bank Info on Invoices</option>
                    </select>
                  </div>
                </div>

                {/* Company Bank Account Overview (Reused from companyProfile) */}
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Landmark size={15} style={{ color: '#2563EB' }} />
                      Registered Primary Bank Account
                    </div>
                    <span className="badge badge-blue" style={{ fontSize: 11 }}>Reused from Company Profile</span>
                  </div>

                  {companyProfile?.bankName ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 12.5 }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>Bank Name</div>
                        <div style={{ fontWeight: 700, color: '#1E293B' }}>{companyProfile.bankName}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>Account Holder</div>
                        <div style={{ fontWeight: 700, color: '#1E293B' }}>{companyProfile.accountHolderName}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>Account Number</div>
                        <div style={{ fontWeight: 700, color: '#1E293B' }}>
                          {companyProfile.accountNumber ? `••••${companyProfile.accountNumber.slice(-4)}` : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>IFSC Code</div>
                        <div style={{ fontWeight: 700, color: '#1E293B' }}>{companyProfile.ifscCode}</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: '#94A3B8' }}>
                      No bank details registered in Company Setup Wizard yet.
                    </div>
                  )}
                </div>

                {/* Payment Instructions */}
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Payment Instructions for Clients
                  </label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="e.g. Please send payment confirmation screenshot to billing@company.com..."
                    value={billingData.paymentInstructions || ''}
                    onChange={(e) => setBillingData((prev) => ({ ...prev, paymentInstructions: e.target.value }))}
                  />
                </div>
              </div>

              {/* CARD 4: Invoice Field Visibility & Default Notes */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
                  <FileText size={18} style={{ color: '#2563EB' }} />
                  <div>
                    <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 15, color: '#0F172A' }}>
                      Invoice Display & Default Notes Customization
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      Customize default field visibility, notes, and terms & conditions printed on customer invoices.
                    </div>
                  </div>
                </div>

                {/* Field Visibility Toggles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 18 }}>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>Show GST Breakdown on Invoices</span>
                    <input
                      type="checkbox"
                      checked={billingData.showGstOnInvoices}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, showGstOnInvoices: e.target.checked }))}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                    />
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>Show Bank Account Details</span>
                    <input
                      type="checkbox"
                      checked={billingData.showBankDetailsOnInvoices}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, showBankDetailsOnInvoices: e.target.checked }))}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                    />
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>Show Payment Instructions</span>
                    <input
                      type="checkbox"
                      checked={billingData.showPaymentInstructionsOnInvoices}
                      onChange={(e) => setBillingData((prev) => ({ ...prev, showPaymentInstructionsOnInvoices: e.target.checked }))}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                    />
                  </label>
                </div>

                {/* Default Invoice Notes */}
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Default Invoice Footer Notes
                  </label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="Thank you for your business!"
                    value={billingData.defaultInvoiceNotes || ''}
                    onChange={(e) => setBillingData((prev) => ({ ...prev, defaultInvoiceNotes: e.target.value }))}
                  />
                </div>

                {/* Default Terms & Conditions */}
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Default Invoice Terms & Conditions
                  </label>
                  <textarea
                    className="input-base"
                    rows={3}
                    placeholder="Payment is due within payment terms. Late payments are subject to interest..."
                    value={billingData.defaultTermsAndConditions || ''}
                    onChange={(e) => setBillingData((prev) => ({ ...prev, defaultTermsAndConditions: e.target.value }))}
                  />
                </div>
              </div>

              {/* Bottom Action Bar */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setBillingData(liveBillingSettings[0] || getDefaultBillingSettings())}
                  disabled={isSavingBilling}
                >
                  Reset Changes
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSavingBilling || !isOwnerOrAdmin}
                  style={{ fontSize: 13, gap: 6 }}
                >
                  {isSavingBilling ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Saving Configuration...
                    </>
                  ) : (
                    <>
                      <Save size={15} />
                      Save Billing Settings
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: NOTIFICATIONS */}
          {active === 'Notifications' && (
            <form onSubmit={handleSaveNotificationSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Header Overview Card */}
              <div className="card" style={{ padding: 24, background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <div style={{ background: '#EEF2FF', padding: 8, borderRadius: 10, color: '#3B5BDB' }}>
                        <Bell size={22} />
                      </div>
                      <div>
                        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Plus Jakarta Sans' }}>
                          Workspace Notification Settings
                        </h2>
                        <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
                          Configure real-time alerts, channel routing, role recipient targeting, reminder offsets, and quiet hours.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setNotifData(liveNotificationSettings[0] || getDefaultNotificationSettings())}
                      disabled={isSavingNotif}
                      style={{ fontSize: 13 }}
                    >
                      Reset
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={isSavingNotif || !isOwnerOrAdmin}
                      style={{ fontSize: 13, gap: 6, background: '#3B5BDB' }}
                    >
                      {isSavingNotif ? (
                        <>
                          <RefreshCw size={15} className="animate-spin" />
                          Saving to Firestore...
                        </>
                      ) : (
                        <>
                          <Save size={15} />
                          Save Notification Settings
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Error Banner */}
                {notifErrorMsg && (
                  <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '12px 16px', borderRadius: 10, fontSize: 13, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <AlertCircle size={18} style={{ flexShrink: 0 }} />
                    <div>{notifErrorMsg}</div>
                  </div>
                )}
              </div>

              {/* SECTION 1: NOTIFICATION DELIVERY CHANNELS */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ marginBottom: 18 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', margin: '0 0 4px 0', fontFamily: 'Plus Jakarta Sans' }}>
                    1. Delivery Channels & Connection Status
                  </h3>
                  <p style={{ fontSize: 12.5, color: '#64748B', margin: 0 }}>
                    Enable workspace delivery channels. Provider-dependent channels (Email, SMS, WhatsApp) display explicit configuration status.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                  {/* In-App Channel */}
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, background: '#FFFFFF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ background: '#EEF2FF', color: '#3B5BDB', padding: 8, borderRadius: 8 }}>
                          <Bell size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>In-App Notifications</div>
                          <div style={{ fontSize: 11.5, color: '#64748B' }}>Built-in workspace header alerts</div>
                        </div>
                      </div>
                      <span className="badge badge-green" style={{ fontSize: 11 }}>
                        Configured & Active
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F1F5F9', paddingTop: 12, marginTop: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={notifData.channels.inApp}
                          onChange={(e) => setNotifData((prev) => ({ ...prev, channels: { ...prev.channels, inApp: e.target.checked } }))}
                          style={{ width: 16, height: 16, accentColor: '#2563EB', cursor: 'pointer' }}
                        />
                        Channel Enabled
                      </label>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleSendTestNotification('inApp')}
                        style={{ fontSize: 11.5, padding: '4px 10px', gap: 4 }}
                      >
                        <Zap size={13} style={{ color: '#EAB308' }} />
                        Test In-App
                      </button>
                    </div>
                  </div>

                  {/* Browser Channel */}
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, background: '#FFFFFF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ background: '#F0FDF4', color: '#16A34A', padding: 8, borderRadius: 8 }}>
                          <Globe size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Browser / Desktop Push</div>
                          <div style={{ fontSize: 11.5, color: '#64748B' }}>Native web push notifications</div>
                        </div>
                      </div>
                      {browserPerm === 'granted' ? (
                        <span className="badge badge-green" style={{ fontSize: 11 }}>
                          Permission Granted
                        </span>
                      ) : browserPerm === 'denied' ? (
                        <span className="badge badge-red" style={{ fontSize: 11 }}>
                          Blocked by Browser
                        </span>
                      ) : (
                        <span className="badge badge-yellow" style={{ fontSize: 11 }}>
                          Permission Required
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F1F5F9', paddingTop: 12, marginTop: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={notifData.channels.browser && browserPerm === 'granted'}
                          disabled={browserPerm !== 'granted'}
                          onChange={(e) => setNotifData((prev) => ({ ...prev, channels: { ...prev.channels, browser: e.target.checked } }))}
                          style={{ width: 16, height: 16, accentColor: '#2563EB', cursor: browserPerm === 'granted' ? 'pointer' : 'not-allowed' }}
                        />
                        Channel Enabled
                      </label>

                      {browserPerm !== 'granted' ? (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleEnableBrowserNotifications}
                          style={{ fontSize: 11.5, padding: '4px 10px', background: '#16A34A' }}
                        >
                          Enable Push
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleSendTestNotification('browser')}
                          style={{ fontSize: 11.5, padding: '4px 10px', gap: 4 }}
                        >
                          <Zap size={13} style={{ color: '#EAB308' }} />
                          Test Push
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Email Channel */}
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, background: '#FAF5FF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ background: '#F3E8FF', color: '#9333EA', padding: 8, borderRadius: 8 }}>
                          <Mail size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Email Notifications</div>
                          <div style={{ fontSize: 11.5, color: '#64748B' }}>Gmail via EmailJS (no server needed)</div>
                        </div>
                      </div>
                      <span className="badge badge-purple" style={{ fontSize: 10.5 }}>
                        {notifData.emailjs?.serviceId && notifData.emailjs?.templateId && notifData.emailjs?.publicKey ? 'Connected' : 'Not set up'}
                      </span>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#6B21A8', background: '#F5F3FF', padding: '8px 10px', borderRadius: 6, marginBottom: 12, lineHeight: 1.5 }}>
                      In <strong>emailjs.com</strong>: add a Gmail service (or Personal SMTP: smtp.gmail.com, port 465, your Gmail +
                      App Password), then a template with To Email <code>{'{{to_email}}'}</code>, Subject <code>{'{{subject}}'}</code> and
                      HTML content <code>{'{{{message_html}}}'}</code>. Paste the IDs below and save. Task, leave and payroll emails are sent automatically.
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                      {([
                        ['serviceId', 'Service ID', 'service_xxxxxxx'],
                        ['templateId', 'Template ID', 'template_xxxxxxx'],
                        ['publicKey', 'Public Key', 'Account → General'],
                        ['fromName', 'Sender Name', 'e.g. Legendary One'],
                      ] as const).map(([key, label, ph]) => (
                        <div key={key}>
                          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#334155', marginBottom: 3 }}>{label}</label>
                          <input
                            className="input-base"
                            style={{ fontSize: 12.5, padding: '6px 10px' }}
                            placeholder={ph}
                            value={notifData.emailjs?.[key] || ''}
                            onChange={(e) =>
                              setNotifData((prev) => ({
                                ...prev,
                                emailjs: {
                                  serviceId: prev.emailjs?.serviceId || '',
                                  templateId: prev.emailjs?.templateId || '',
                                  publicKey: prev.emailjs?.publicKey || '',
                                  fromName: prev.emailjs?.fromName || '',
                                  [key]: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #E9D5FF', paddingTop: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={notifData.channels.email}
                          onChange={(e) => setNotifData((prev) => ({ ...prev, channels: { ...prev.channels, email: e.target.checked } }))}
                          style={{ width: 16, height: 16, accentColor: '#9333EA', cursor: 'pointer' }}
                        />
                        Channel Enabled
                      </label>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleSendTestNotification('email')}
                        style={{ fontSize: 11.5, padding: '4px 10px' }}
                      >
                        Test Email
                      </button>
                    </div>
                  </div>

                  {/* SMS Channel */}
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, background: '#FFFBEB' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ background: '#FEF3C7', color: '#D97706', padding: 8, borderRadius: 8 }}>
                          <Smartphone size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>SMS Notifications</div>
                          <div style={{ fontSize: 11.5, color: '#64748B' }}>Twilio / MSG91 SMS Gateway</div>
                        </div>
                      </div>
                      <span className="badge badge-gray" style={{ fontSize: 10.5, background: '#F3F4F6', color: '#4B5563' }}>
                        Config Only (No Gateway)
                      </span>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#92400E', background: '#FEF3C7', padding: '6px 10px', borderRadius: 6, marginBottom: 12 }}>
                      Status: <strong>{notifData.providers.sms.providerName}</strong>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #FDE68A', paddingTop: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={notifData.channels.sms}
                          onChange={(e) => setNotifData((prev) => ({ ...prev, channels: { ...prev.channels, sms: e.target.checked } }))}
                          style={{ width: 16, height: 16, accentColor: '#D97706', cursor: 'pointer' }}
                        />
                        Channel Enabled
                      </label>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleSendTestNotification('sms')}
                        disabled={!notifData.providers.sms.configured}
                        title="No SMS gateway connected"
                        style={{ fontSize: 11.5, padding: '4px 10px', opacity: 0.7 }}
                      >
                        Test SMS
                      </button>
                    </div>
                  </div>

                  {/* WhatsApp Channel */}
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, background: '#F0FDF4' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ background: '#DCFCE7', color: '#16A34A', padding: 8, borderRadius: 8 }}>
                          <MessageSquare size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>WhatsApp Notifications</div>
                          <div style={{ fontSize: 11.5, color: '#64748B' }}>Meta WhatsApp Cloud API</div>
                        </div>
                      </div>
                      <span className="badge badge-gray" style={{ fontSize: 10.5, background: '#F3F4F6', color: '#4B5563' }}>
                        Config Only (No API)
                      </span>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#166534', background: '#DCFCE7', padding: '6px 10px', borderRadius: 6, marginBottom: 12 }}>
                      Status: <strong>{notifData.providers.whatsapp.providerName}</strong>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #BBF7D0', paddingTop: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={notifData.channels.whatsapp}
                          onChange={(e) => setNotifData((prev) => ({ ...prev, channels: { ...prev.channels, whatsapp: e.target.checked } }))}
                          style={{ width: 16, height: 16, accentColor: '#16A34A', cursor: 'pointer' }}
                        />
                        Channel Enabled
                      </label>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleSendTestNotification('whatsapp')}
                        disabled={!notifData.providers.whatsapp.configured}
                        title="No WhatsApp Business API connected"
                        style={{ fontSize: 11.5, padding: '4px 10px', opacity: 0.7 }}
                      >
                        Test WhatsApp
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: EVENT SETTINGS & RECIPIENT TARGETING */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', margin: '0 0 4px 0', fontFamily: 'Plus Jakarta Sans' }}>
                      2. Event Notification Matrix & Recipient Targeting ({notifData.events.length} Events)
                    </h3>
                    <p style={{ fontSize: 12.5, color: '#64748B', margin: 0 }}>
                      Configure per-event notification triggers, active delivery channels, and target recipient roles.
                    </p>
                  </div>

                  {/* Search input */}
                  <div style={{ position: 'relative', width: 240 }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                    <input
                      type="text"
                      className="input-base"
                      placeholder="Search 20 event triggers..."
                      value={notifSearchQuery}
                      onChange={(e) => setNotifSearchQuery(e.target.value)}
                      style={{ paddingLeft: 30, fontSize: 12.5, height: 34 }}
                    />
                  </div>
                </div>

                {/* Category Filter Pills */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18, borderBottom: '1px solid #F1F5F9', paddingBottom: 14 }}>
                  {['All', 'CRM', 'Work', 'Finance', 'HR & Payroll', 'Assets & Docs', 'System'].map((cat) => {
                    const count = cat === 'All' ? notifData.events.length : notifData.events.filter((e) => e.category === cat).length;
                    const isActive = notifCategoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setNotifCategoryFilter(cat)}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 600,
                          border: isActive ? '1px solid #3B5BDB' : '1px solid #E2E8F0',
                          background: isActive ? '#EEF2FF' : '#FFFFFF',
                          color: isActive ? '#3B5BDB' : '#64748B',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Event Rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {notifData.events
                    .filter((evt) => {
                      const matchesCat = notifCategoryFilter === 'All' || evt.category === notifCategoryFilter;
                      const matchesSearch =
                        !notifSearchQuery.trim() ||
                        evt.eventName.toLowerCase().includes(notifSearchQuery.toLowerCase()) ||
                        evt.description.toLowerCase().includes(notifSearchQuery.toLowerCase());
                      return matchesCat && matchesSearch;
                    })
                    .map((evt) => {
                      return (
                        <div
                          key={evt.eventId}
                          style={{
                            border: '1px solid #E2E8F0',
                            borderRadius: 12,
                            padding: 16,
                            background: evt.enabled ? '#FFFFFF' : '#F8FAFC',
                            opacity: evt.enabled ? 1 : 0.7,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                            {/* Left: Checkbox & Event Title */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 260 }}>
                              <input
                                type="checkbox"
                                checked={evt.enabled}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setNotifData((prev) => ({
                                    ...prev,
                                    events: prev.events.map((item) =>
                                      item.eventId === evt.eventId ? { ...item, enabled: checked } : item
                                    ),
                                  }));
                                }}
                                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB', marginTop: 2 }}
                              />
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A' }}>
                                    {evt.eventName}
                                  </span>
                                  <span
                                    className="badge"
                                    style={{
                                      fontSize: 10.5,
                                      background:
                                        evt.category === 'CRM'
                                          ? '#EFF6FF'
                                          : evt.category === 'Work'
                                            ? '#F0FDF4'
                                            : evt.category === 'Finance'
                                              ? '#FEF3C7'
                                              : evt.category === 'HR & Payroll'
                                                ? '#F3E8FF'
                                                : evt.category === 'Assets & Docs'
                                                  ? '#ECFDF5'
                                                  : '#F1F5F9',
                                      color:
                                        evt.category === 'CRM'
                                          ? '#1E40AF'
                                          : evt.category === 'Work'
                                            ? '#166534'
                                            : evt.category === 'Finance'
                                              ? '#92400E'
                                              : evt.category === 'HR & Payroll'
                                                ? '#6B21A8'
                                                : evt.category === 'Assets & Docs'
                                                  ? '#065F46'
                                                  : '#475569',
                                    }}
                                  >
                                    {evt.category}
                                  </span>
                                </div>
                                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{evt.description}</div>
                              </div>
                            </div>

                            {/* Middle: Channel Toggles for this event */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8, border: '1px solid #F1F5F9' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Channels:</span>
                              {/* In-App */}
                              <label title="In-App Notification" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
                                <input
                                  type="checkbox"
                                  checked={evt.channels.inApp}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setNotifData((prev) => ({
                                      ...prev,
                                      events: prev.events.map((item) =>
                                        item.eventId === evt.eventId
                                          ? { ...item, channels: { ...item.channels, inApp: val } }
                                          : item
                                      ),
                                    }));
                                  }}
                                  style={{ accentColor: '#2563EB' }}
                                />
                                <Bell size={13} style={{ color: '#2563EB' }} />
                              </label>

                              {/* Email */}
                              <label title="Email Notification" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
                                <input
                                  type="checkbox"
                                  checked={evt.channels.email}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setNotifData((prev) => ({
                                      ...prev,
                                      events: prev.events.map((item) =>
                                        item.eventId === evt.eventId
                                          ? { ...item, channels: { ...item.channels, email: val } }
                                          : item
                                      ),
                                    }));
                                  }}
                                  style={{ accentColor: '#9333EA' }}
                                />
                                <Mail size={13} style={{ color: '#9333EA' }} />
                              </label>

                              {/* Browser */}
                              <label title="Browser Push Notification" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
                                <input
                                  type="checkbox"
                                  checked={evt.channels.browser}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setNotifData((prev) => ({
                                      ...prev,
                                      events: prev.events.map((item) =>
                                        item.eventId === evt.eventId
                                          ? { ...item, channels: { ...item.channels, browser: val } }
                                          : item
                                      ),
                                    }));
                                  }}
                                  style={{ accentColor: '#16A34A' }}
                                />
                                <Globe size={13} style={{ color: '#16A34A' }} />
                              </label>

                              {/* SMS */}
                              <label title="SMS Text Alert" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
                                <input
                                  type="checkbox"
                                  checked={evt.channels.sms}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setNotifData((prev) => ({
                                      ...prev,
                                      events: prev.events.map((item) =>
                                        item.eventId === evt.eventId
                                          ? { ...item, channels: { ...item.channels, sms: val } }
                                          : item
                                      ),
                                    }));
                                  }}
                                  style={{ accentColor: '#D97706' }}
                                />
                                <Smartphone size={13} style={{ color: '#D97706' }} />
                              </label>

                              {/* WhatsApp */}
                              <label title="WhatsApp Message" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
                                <input
                                  type="checkbox"
                                  checked={evt.channels.whatsapp}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setNotifData((prev) => ({
                                      ...prev,
                                      events: prev.events.map((item) =>
                                        item.eventId === evt.eventId
                                          ? { ...item, channels: { ...item.channels, whatsapp: val } }
                                          : item
                                      ),
                                    }));
                                  }}
                                  style={{ accentColor: '#16A34A' }}
                                />
                                <MessageSquare size={13} style={{ color: '#16A34A' }} />
                              </label>
                            </div>
                          </div>

                          {/* Bottom: Target Recipients selector */}
                          <div style={{ borderTop: '1px dashed #E2E8F0', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <UserCheck size={13} /> Recipients:
                            </span>

                            {ALL_RECIPIENT_ROLES.map((role) => {
                              const isSelected = evt.recipients.includes(role);
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => {
                                    setNotifData((prev) => ({
                                      ...prev,
                                      events: prev.events.map((item) => {
                                        if (item.eventId !== evt.eventId) return item;
                                        const updatedRecipients = isSelected
                                          ? item.recipients.filter((r) => r !== role)
                                          : [...item.recipients, role];
                                        return { ...item, recipients: updatedRecipients };
                                      }),
                                    }));
                                  }}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: '3px 9px',
                                    borderRadius: 14,
                                    border: isSelected ? '1px solid #3B5BDB' : '1px solid #CBD5E1',
                                    background: isSelected ? '#3B5BDB' : '#FFFFFF',
                                    color: isSelected ? '#FFFFFF' : '#64748B',
                                    cursor: 'pointer',
                                    transition: 'all 0.12s ease',
                                  }}
                                >
                                  {isSelected ? `✓ ${role}` : `+ ${role}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* SECTION 3: AUTOMATED REMINDER TIMING */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', margin: '0 0 4px 0', fontFamily: 'Plus Jakarta Sans' }}>
                      3. Automated Reminder Timing & Offsets
                    </h3>
                    <p style={{ fontSize: 12.5, color: '#64748B', margin: 0 }}>
                      Configure dispatch lead times for upcoming tasks, deliverable deadlines, invoice due dates, and document expiry.
                    </p>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                    <input
                      type="checkbox"
                      checked={notifData.reminderTiming.enabled}
                      onChange={(e) => setNotifData((prev) => ({ ...prev, reminderTiming: { ...prev.reminderTiming, enabled: e.target.checked } }))}
                      style={{ width: 18, height: 18, accentColor: '#2563EB', cursor: 'pointer' }}
                    />
                    Reminder Timing Active
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, alignItems: 'flex-start' }}>
                  {/* Default Offset Days Select */}
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Default Workspace Lead Time Offset
                    </label>
                    <select
                      className="input-base"
                      value={notifData.reminderTiming.defaultOffsetDays}
                      onChange={(e) =>
                        setNotifData((prev) => ({
                          ...prev,
                          reminderTiming: {
                            ...prev.reminderTiming,
                            defaultOffsetDays: parseInt(e.target.value, 10),
                          },
                        }))
                      }
                      style={{ fontSize: 13 }}
                    >
                      <option value={0}>Same Day (0 Days Lead Time)</option>
                      <option value={1}>1 Day Before Deadline</option>
                      <option value={3}>3 Days Before Deadline</option>
                      <option value={7}>7 Days Before Deadline</option>
                      <option value={14}>14 Days Before Deadline</option>
                    </select>
                  </div>

                  {/* Active Reminder Offsets Chips */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label className="form-label" style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', margin: 0 }}>
                        Configured Dispatch Offsets
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowAddOffsetModal(true)}
                        style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <Plus size={14} /> Add Custom Offset
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {notifData.reminderTiming.offsets.map((off) => (
                        <div
                          key={off.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 12px',
                            background: '#F8FAFC',
                            border: '1px solid #E2E8F0',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#1E293B',
                          }}
                        >
                          <Clock size={13} style={{ color: '#64748B' }} />
                          <span>{off.label}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setNotifData((prev) => ({
                                ...prev,
                                reminderTiming: {
                                  ...prev.reminderTiming,
                                  offsets: prev.reminderTiming.offsets.filter((o) => o.id !== off.id),
                                },
                              }));
                            }}
                            style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                            title="Remove offset"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 4: QUIET HOURS & DAILY DIGEST */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
                {/* Quiet Hours Card */}
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ background: '#F1F5F9', color: '#475569', padding: 8, borderRadius: 8 }}>
                        <Moon size={18} />
                      </div>
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Plus Jakarta Sans' }}>
                          Quiet Hours
                        </h4>
                        <div style={{ fontSize: 11.5, color: '#64748B' }}>Silence non-urgent notifications</div>
                      </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                      <input
                        type="checkbox"
                        checked={notifData.quietHours.enabled}
                        onChange={(e) => setNotifData((prev) => ({ ...prev, quietHours: { ...prev.quietHours, enabled: e.target.checked } }))}
                        style={{ width: 16, height: 16, accentColor: '#2563EB', cursor: 'pointer' }}
                      />
                      Enabled
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, opacity: notifData.quietHours.enabled ? 1 : 0.6 }}>
                    <div>
                      <label className="form-label" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                        Start Time
                      </label>
                      <input
                        type="time"
                        className="input-base"
                        value={notifData.quietHours.startTime}
                        disabled={!notifData.quietHours.enabled}
                        onChange={(e) => setNotifData((prev) => ({ ...prev, quietHours: { ...prev.quietHours, startTime: e.target.value } }))}
                        style={{ fontSize: 13 }}
                      />
                    </div>

                    <div>
                      <label className="form-label" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                        End Time
                      </label>
                      <input
                        type="time"
                        className="input-base"
                        value={notifData.quietHours.endTime}
                        disabled={!notifData.quietHours.enabled}
                        onChange={(e) => setNotifData((prev) => ({ ...prev, quietHours: { ...prev.quietHours, endTime: e.target.value } }))}
                        style={{ fontSize: 13 }}
                      />
                    </div>
                  </div>

                  <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 12, lineHeight: 1.4 }}>
                    🌙 During quiet hours, non-critical push & email notifications are queued until quiet hours end.
                  </div>
                </div>

                {/* Daily Digest Summary Card */}
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ background: '#EFF6FF', color: '#2563EB', padding: 8, borderRadius: 8 }}>
                        <Sun size={18} />
                      </div>
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Plus Jakarta Sans' }}>
                          Daily Digest Summary
                        </h4>
                        <div style={{ fontSize: 11.5, color: '#64748B' }}>Consolidated daily workspace briefing</div>
                      </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                      <input
                        type="checkbox"
                        checked={notifData.dailyDigest.enabled}
                        onChange={(e) => setNotifData((prev) => ({ ...prev, dailyDigest: { ...prev.dailyDigest, enabled: e.target.checked } }))}
                        style={{ width: 16, height: 16, accentColor: '#2563EB', cursor: 'pointer' }}
                      />
                      Enabled
                    </label>
                  </div>

                  <div style={{ opacity: notifData.dailyDigest.enabled ? 1 : 0.6 }}>
                    <div style={{ marginBottom: 12 }}>
                      <label className="form-label" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                        Scheduled Dispatch Time
                      </label>
                      <input
                        type="time"
                        className="input-base"
                        value={notifData.dailyDigest.digestTime}
                        disabled={!notifData.dailyDigest.enabled}
                        onChange={(e) => setNotifData((prev) => ({ ...prev, dailyDigest: { ...prev.dailyDigest, digestTime: e.target.value } }))}
                        style={{ fontSize: 13 }}
                      />
                    </div>

                    <div>
                      <label className="form-label" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                        Digest Target Recipients
                      </label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {ALL_RECIPIENT_ROLES.map((role) => {
                          const isSelected = notifData.dailyDigest.recipients.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              disabled={!notifData.dailyDigest.enabled}
                              onClick={() => {
                                setNotifData((prev) => ({
                                  ...prev,
                                  dailyDigest: {
                                    ...prev.dailyDigest,
                                    recipients: isSelected
                                      ? prev.dailyDigest.recipients.filter((r) => r !== role)
                                      : [...prev.dailyDigest.recipients, role],
                                  },
                                }));
                              }}
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '3px 8px',
                                borderRadius: 12,
                                border: isSelected ? '1px solid #2563EB' : '1px solid #CBD5E1',
                                background: isSelected ? '#EFF6FF' : '#FFFFFF',
                                color: isSelected ? '#1E40AF' : '#64748B',
                                cursor: notifData.dailyDigest.enabled ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {isSelected ? `✓ ${role}` : `+ ${role}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Sticky Action Bar */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid #E2E8F0' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setNotifData(liveNotificationSettings[0] || getDefaultNotificationSettings())}
                  disabled={isSavingNotif}
                >
                  Reset Changes
                </button>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSavingNotif || !isOwnerOrAdmin}
                  style={{ fontSize: 13, gap: 6, background: '#3B5BDB' }}
                >
                  {isSavingNotif ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Saving to Firestore...
                    </>
                  ) : (
                    <>
                      <Save size={15} />
                      Save Notification Settings
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* OTHER TABS PLACEHOLDER (Integrations, Security) */}
          {!['Company', 'Users & Roles', 'Billing', 'Notifications'].includes(active) && (
            <div className="card" style={{ padding: '60px', textAlign: 'center', color: '#697586' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⚙️</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{active} Settings</div>
              <div style={{ fontSize: 13 }}>Configure {active.toLowerCase()} settings for your workspace.</div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CUSTOM REMINDER OFFSET MODAL */}
      {/* ========================================================================= */}
      {showAddOffsetModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setShowAddOffsetModal(false)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 440,
              background: '#FFFFFF',
              borderRadius: 16,
              padding: 24,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Plus Jakarta Sans' }}>
                Add Custom Reminder Offset
              </h3>
              <button type="button" className="btn-icon" onClick={() => setShowAddOffsetModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Offset Days *
                </label>
                <input
                  type="number"
                  className="input-base"
                  placeholder="e.g. 5 (for 5 days before)"
                  value={customOffsetInput}
                  onChange={(e) => setCustomOffsetInput(e.target.value)}
                />
                <span style={{ fontSize: 11, color: '#64748B', marginTop: 2, display: 'block' }}>
                  Use positive integers for lead time (e.g. 5 days before), 0 for same day, or -1 for overdue follow-up. Negative entries below -1 are prevented.
                </span>
              </div>

              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Display Label (Optional)
                </label>
                <input
                  type="text"
                  className="input-base"
                  placeholder="e.g. 5 Days Before Deadline"
                  value={customOffsetLabel}
                  onChange={(e) => setCustomOffsetLabel(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddOffsetModal(false)}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handleAddCustomOffset} style={{ background: '#3B5BDB' }}>
                  Add Offset
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ROLE PERMISSIONS CONFIGURE MODAL */}
      {/* ========================================================================= */}
      {selectedRoleConfig && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={handleCloseModal}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 720,
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#FFFFFF',
              borderRadius: 16,
              padding: 28,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, borderBottom: '1px solid #E2E8F0', paddingBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: selectedRoleConfig.color, display: 'inline-block' }} />
                  <h2 style={{ fontSize: 19, fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Plus Jakarta Sans' }}>
                    Configure Permissions: {selectedRoleConfig.roleName}
                  </h2>
                </div>
                <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                  Customize module visibility and action rights for users assigned to this role.
                </p>
              </div>

              <button type="button" className="btn-icon" onClick={handleCloseModal}>
                <X size={18} />
              </button>
            </div>

            {/* Error Feedback Banner */}
            {saveRoleErrorMsg && (
              <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '12px 16px', borderRadius: 10, fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <div>{saveRoleErrorMsg}</div>
              </div>
            )}

            {/* Owner Safety Lock Notice */}
            {selectedRoleConfig.roleKey.toLowerCase().includes('owner') && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 14, marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Lock size={18} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12.5, color: '#991B1B', lineHeight: 1.5 }}>
                  <strong>Safety Lock Active:</strong> Owner / Super Admin accounts must retain access to System Settings, Dashboard, Documents, and Employee management to prevent accidental workspace lockouts.
                </div>
              </div>
            )}

            <form onSubmit={handleSaveRolePermissions}>
              {/* Permission Toggles Grouped by Domain */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 }}>
                {['General', 'CRM', 'Work', 'Sales & Finance', 'Team', 'Business', 'System'].map((category) => {
                  const categoryModules = MODULE_PERMISSIONS_LIST.filter((m) => m.category === category);
                  if (categoryModules.length === 0) return null;

                  return (
                    <div key={category} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                        {category} MODULES
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                        {categoryModules.map((module) => {
                          const isChecked = Boolean(draftPermissions[module.key]);
                          const isOwnerRole = selectedRoleConfig.roleKey.toLowerCase().includes('owner');
                          const isLocked = isOwnerRole && ['settings', 'dashboard', 'documents', 'employees'].includes(module.key);

                          return (
                            <label
                              key={module.key}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: isChecked ? '#FFFFFF' : '#F1F5F9',
                                border: isChecked ? '1px solid #CBD5E1' : '1px solid #E2E8F0',
                                borderRadius: 8,
                                padding: '10px 14px',
                                cursor: isLocked ? 'not-allowed' : 'pointer',
                                opacity: isLocked ? 0.8 : 1,
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: isChecked ? '#0F172A' : '#64748B' }}>
                                  {module.label}
                                </span>
                                {isLocked && (
                                  <Lock size={12} style={{ color: '#DC2626' }} title="Protected system permission" />
                                )}
                              </div>

                              <input
                                type="checkbox"
                                checked={isLocked ? true : isChecked}
                                disabled={isLocked}
                                onChange={(e) => {
                                  if (isLocked) return;
                                  setDraftPermissions((prev) => ({
                                    ...prev,
                                    [module.key]: e.target.checked,
                                  }));
                                }}
                                style={{ width: 16, height: 16, cursor: isLocked ? 'not-allowed' : 'pointer', accentColor: '#2563EB' }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #E2E8F0', paddingTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={handleCloseModal} disabled={isSavingRole}>
                  Cancel
                </button>

                <button type="submit" className="btn-primary" disabled={isSavingRole} style={{ gap: 6, background: selectedRoleConfig.color, borderColor: selectedRoleConfig.color }}>
                  {isSavingRole ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Saving to Firestore...
                    </>
                  ) : (
                    <>
                      <Check size={16} strokeWidth={2.5} />
                      Save Role Permissions
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MANAGE USERS MODAL */}
      {/* ========================================================================= */}
      <ManageUsersModal
        isOpen={showManageUsersModal}
        onClose={() => setShowManageUsersModal(false)}
      />
    </div>
  );
}
