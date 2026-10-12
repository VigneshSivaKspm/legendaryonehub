import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LayoutDashboard,
  Sparkles,
  Fingerprint,
  Target,
  Users,
  FolderKanban,
  ListChecks,
  PackageCheck,
  FileText,
  Receipt,
  IndianRupee,
  Wallet,
  UserCog,
  CalendarCheck,
  Timer,
  Plane,
  Banknote,
  HandCoins,
  Layers,
  Monitor,
  FolderOpen,
  ChartColumn,
  Settings,
  CircleUserRound,
  Menu,
  Search,
  X,
  Plus,
  Download,
  LogOut,
  ChevronRight,
  LayoutGrid,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../db/database';
import { useInstallPrompt } from '../pwa';
import { formatTime12h, toLocalDate, isCheckedIn } from '../utils/attendanceTimes';
import logo from '../assets/legendary-one-logo.png';

export type NavEntry = { key: string; label: string } | { section: string };

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  'my-workspace': Sparkles,
  'my-attendance': Fingerprint,
  leads: Target,
  clients: Users,
  projects: FolderKanban,
  tasks: ListChecks,
  deliverables: PackageCheck,
  quotations: FileText,
  invoices: Receipt,
  payments: IndianRupee,
  expenses: Wallet,
  employees: UserCog,
  attendance: CalendarCheck,
  timesheets: Timer,
  leave: Plane,
  payroll: Banknote,
  'employee-expenses': HandCoins,
  services: Layers,
  assets: Monitor,
  documents: FolderOpen,
  reports: ChartColumn,
  settings: Settings,
  profile: CircleUserRound,
};

/** Screens shown under another tab (detail pages highlight their list). */
const PARENT: Record<string, string> = {
  'project-detail': 'projects',
  'client-profile': 'clients',
  'employee-profile': 'employees',
};

const EXTRA_TITLES: Record<string, string> = {
  profile: 'My Profile',
  'employee-profile': 'Employee Profile',
  'client-profile': 'Client',
  'project-detail': 'Project',
};

interface Props {
  current: string;
  onNav: (screen: string) => void;
  children: React.ReactNode;
  navEntries: NavEntry[];
  quickItems: { label: string; screen: string }[];
  searchVal: string;
  setSearchVal: (v: string) => void;
  searchResults: { type: string; title: string; sub?: string; screen: string }[];
  pendingAttendanceCount: number;
  fyBadge: string;
}

const INSTALL_DISMISS_KEY = 'lo-install-dismissed';
const readDismissed = () => {
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

/** App-style shell for phones and portrait tablets: top bar, bottom tab bar, side drawer and sheets. */
export default function MobileShell(props: Props) {
  const { current, onNav, children, navEntries, quickItems, searchVal, setSearchVal, searchResults, pendingAttendanceCount, fyBadge } = props;
  const { user, myEmployee, companyProfile, logout, isSelfService, canAccessScreen } = useAuth();
  const installer = useInstallPrompt();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(readDismissed);
  const pendingNav = useRef<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);

  const today = toLocalDate(new Date());
  const todayRec = useLiveQuery(
    async () => (myEmployee?.id !== undefined ? (await db.attendance.where('date').equals(today).toArray()).find((a) => String(a.employeeId) === String(myEmployee.id)) : undefined),
    [myEmployee?.id, today]
  );

  const overlayOpen = drawerOpen || quickOpen || searchOpen;
  const activeKey = PARENT[current] || current;
  const visibleKeys = new Set(navEntries.filter((e): e is { key: string; label: string } => 'key' in e).map((e) => e.key));
  const labelFor = (key: string) =>
    EXTRA_TITLES[key] || (navEntries.find((e) => 'key' in e && e.key === key) as { label: string } | undefined)?.label || 'Legendary One';

  // Scroll to top whenever the screen changes
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [current]);

  // Android back button / browser back closes an open drawer or sheet first
  useEffect(() => {
    const onPop = () => {
      setDrawerOpen(false);
      setQuickOpen(false);
      setSearchOpen(false);
      if (pendingNav.current) {
        const target = pendingNav.current;
        pendingNav.current = null;
        setTimeout(() => onNav(target), 0); // after App restores the screen underneath
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onNav]);

  // Lock page scroll behind overlays
  useEffect(() => {
    document.body.style.overflow = overlayOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [overlayOpen]);

  const openOverlay = (which: 'drawer' | 'quick' | 'search') => {
    if (!overlayOpen) window.history.pushState({ ...(window.history.state || {}), overlay: true }, '');
    setDrawerOpen(which === 'drawer');
    setQuickOpen(which === 'quick');
    setSearchOpen(which === 'search');
  };

  const closeOverlays = () => {
    if (window.history.state?.overlay) {
      window.history.back(); // popstate handler closes everything
    } else {
      setDrawerOpen(false);
      setQuickOpen(false);
      setSearchOpen(false);
      if (pendingNav.current) {
        const t = pendingNav.current;
        pendingNav.current = null;
        onNav(t);
      }
    }
  };

  const go = (key: string) => {
    if (overlayOpen) {
      pendingNav.current = key;
      closeOverlays();
    } else {
      onNav(key);
    }
    setSearchVal('');
  };

  const dismissInstall = () => {
    setInstallDismissed(true);
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    } catch {
      // private mode: just hide for this session
    }
  };

  // ---------- bottom tabs ----------
  type Tab = { key: string; label: string; badge?: number };
  const pick = (...keys: string[]) => keys.find((k) => k === 'profile' || visibleKeys.has(k) || canAccessScreen(k));
  const left: Tab[] = [];
  const right: Tab[] = [];
  left.push({ key: 'dashboard', label: 'Home' });
  if (isSelfService) {
    left.push({ key: 'tasks', label: 'Tasks' });
    right.push({ key: 'profile', label: 'Profile' });
  } else {
    const second = pick('projects', 'clients', 'tasks');
    if (second) left.push({ key: second, label: labelFor(second) });
    const fourth = pick('attendance', 'my-attendance', 'tasks');
    if (fourth) right.push({ key: fourth, label: fourth === 'my-attendance' ? 'Attendance' : labelFor(fourth), badge: fourth === 'attendance' ? pendingAttendanceCount : 0 });
  }
  const fab = isSelfService
    ? { icon: Fingerprint, label: todayRec?.checkOut ? 'Attendance' : isCheckedIn(todayRec) ? 'Check Out' : 'Check In', action: () => go('my-attendance') }
    : quickItems.length
    ? { icon: Plus, label: 'Add', action: () => openOverlay('quick') }
    : null;

  const initials = user?.avatarInitials || (user?.name || 'LO').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const designation = myEmployee?.role || user?.role || '';

  const TabButton = ({ tab }: { tab: Tab }) => {
    const Icon = NAV_ICONS[tab.key] || LayoutGrid;
    const active = activeKey === tab.key || (tab.key === 'dashboard' && activeKey === 'my-workspace' && isSelfService);
    return (
      <button className={`m-tab${active ? ' active' : ''}`} onClick={() => go(tab.key)} aria-label={tab.label}>
        <span className="m-tab-icon">
          <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
          {!!tab.badge && <span className="m-badge">{tab.badge > 9 ? '9+' : tab.badge}</span>}
        </span>
        <span className="m-tab-label">{tab.label}</span>
      </button>
    );
  };

  const showInstallBanner = !installDismissed && (installer.canInstall || installer.needsIOSHelp);

  return (
    <div className="m-shell">
      {/* Top app bar */}
      <header className="m-topbar">
        <button className="m-icon-btn" onClick={() => openOverlay('drawer')} aria-label="Open menu">
          <Menu size={22} />
        </button>
        <div className="m-title-wrap">
          <div className="m-title">{current === 'dashboard' && isSelfService ? `Hi, ${(myEmployee?.name || user?.name || '').split(' ')[0]}` : labelFor(current)}</div>
          <div className="m-subtitle">{companyProfile?.companyName || 'Legendary One'}</div>
        </div>
        <button className="m-icon-btn" onClick={() => openOverlay('search')} aria-label="Search">
          <Search size={21} />
        </button>
        <button className="m-avatar-btn" onClick={() => go('profile')} aria-label="My profile">
          {initials}
        </button>
      </header>

      {/* Page */}
      <main ref={mainRef} className="m-main app-main">
        {children}
      </main>

      {/* Install banner */}
      {showInstallBanner && (
        <div className="m-install-banner">
          <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff' }}>Install Legendary One</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.75)' }}>
              {installer.canInstall ? 'Faster access, full screen, works offline' : 'Tap Share → Add to Home Screen'}
            </div>
          </div>
          {installer.canInstall && (
            <button className="m-install-btn" onClick={() => installer.install()}>
              Install
            </button>
          )}
          <button className="m-icon-btn" style={{ color: 'rgba(255,255,255,0.7)' }} onClick={dismissInstall} aria-label="Dismiss">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="m-bottomnav" aria-label="Main">
        {left.map((t) => (
          <TabButton key={t.key} tab={t} />
        ))}
        {fab && (
          <div className="m-fab-slot">
            <button className="m-fab" onClick={fab.action} aria-label={fab.label}>
              <fab.icon size={26} strokeWidth={2.3} />
            </button>
            <span className="m-tab-label" style={{ marginTop: 2 }}>
              {fab.label}
            </span>
          </div>
        )}
        {right.map((t) => (
          <TabButton key={t.key} tab={t} />
        ))}
        <button className={`m-tab${drawerOpen ? ' active' : ''}`} onClick={() => openOverlay('drawer')} aria-label="More">
          <span className="m-tab-icon">
            <LayoutGrid size={22} strokeWidth={1.9} />
          </span>
          <span className="m-tab-label">More</span>
        </button>
      </nav>

      {/* Drawer */}
      <div className={`m-backdrop${drawerOpen ? ' open' : ''}`} onClick={closeOverlays} />
      <aside
        className={`m-drawer${drawerOpen ? ' open' : ''}`}
        aria-hidden={!drawerOpen}
        onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchStartX.current !== null && touchStartX.current - e.changedTouches[0].clientX > 60) closeOverlays();
          touchStartX.current = null;
        }}
      >
        <div className="m-drawer-hero">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="m-drawer-logo">
                {companyProfile?.logoUrl ? (
                  <img src={companyProfile.logoUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
                ) : (
                  <img src={logo} alt="" style={{ width: 30, height: 30, objectFit: 'contain', mixBlendMode: 'screen' }} />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', fontFamily: 'Plus Jakarta Sans' }}>{companyProfile?.companyName || 'Legendary One'}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{fyBadge}</div>
              </div>
            </div>
            <button className="m-icon-btn" style={{ color: 'rgba(255,255,255,0.8)' }} onClick={closeOverlays} aria-label="Close menu">
              <X size={20} />
            </button>
          </div>

          <button className="m-profile-card" onClick={() => go('profile')}>
            <span className="m-profile-avatar">{initials}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 15, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {myEmployee?.name || user?.name || 'User'}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {designation}
                {myEmployee?.employeeId ? ` · ${myEmployee.employeeId}` : ''}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</span>
            </span>
            <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
          </button>

          {myEmployee && (
            <button className="m-today-pill" onClick={() => go('my-attendance')}>
              <span className={`m-dot ${todayRec?.checkOut ? 'done' : isCheckedIn(todayRec) ? 'on' : 'off'}`} />
              {todayRec?.checkOut
                ? `Checked out at ${formatTime12h(todayRec.checkOut)}`
                : isCheckedIn(todayRec)
                ? `Checked in at ${formatTime12h(todayRec?.checkIn)}`
                : todayRec?.checkInRequest?.status === 'Pending'
                ? 'Late check-in awaiting approval'
                : 'Not checked in yet'}
              <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
          )}
        </div>

        <nav className="m-drawer-nav">
          {navEntries.map((entry, i) =>
            'section' in entry ? (
              <div key={`s-${i}`} className="m-drawer-section">
                {entry.section}
              </div>
            ) : (
              (() => {
                const Icon = NAV_ICONS[entry.key] || LayoutGrid;
                const active = activeKey === entry.key;
                return (
                  <button key={entry.key} className={`m-drawer-item${active ? ' active' : ''}`} onClick={() => go(entry.key)}>
                    <span className="m-drawer-icon">
                      <Icon size={19} />
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>{entry.label}</span>
                    {entry.key === 'attendance' && !isSelfService && pendingAttendanceCount > 0 && <span className="m-pill-badge">{pendingAttendanceCount}</span>}
                  </button>
                );
              })()
            )
          )}
          <div className="m-drawer-section">Account</div>
          <button className={`m-drawer-item${activeKey === 'profile' ? ' active' : ''}`} onClick={() => go('profile')}>
            <span className="m-drawer-icon">
              <CircleUserRound size={19} />
            </span>
            <span style={{ flex: 1, textAlign: 'left' }}>My Profile</span>
          </button>
          {installer.canInstall && (
            <button className="m-drawer-item" onClick={() => installer.install()}>
              <span className="m-drawer-icon" style={{ background: '#EEF4FF', color: '#3B5BDB' }}>
                <Download size={19} />
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>Install App</span>
            </button>
          )}
          {installer.needsIOSHelp && (
            <div className="m-drawer-item" style={{ cursor: 'default' }}>
              <span className="m-drawer-icon">
                <Smartphone size={19} />
              </span>
              <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5 }}>Install: Share → Add to Home Screen</span>
            </div>
          )}
          <button className="m-drawer-item danger" onClick={() => { closeOverlays(); logout(); }}>
            <span className="m-drawer-icon">
              <LogOut size={19} />
            </span>
            <span style={{ flex: 1, textAlign: 'left' }}>Sign Out</span>
          </button>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#94A3B8', padding: '16px 0 8px' }}>
            Legendary One Business OS{installer.installed ? ' · App' : ''}
          </div>
        </nav>
      </aside>

      {/* Quick add sheet */}
      <div className={`m-backdrop${quickOpen ? ' open' : ''}`} onClick={closeOverlays} />
      <div className={`m-sheet${quickOpen ? ' open' : ''}`} aria-hidden={!quickOpen}>
        <div className="m-sheet-handle" />
        <div style={{ fontWeight: 800, fontSize: 16, color: '#1A1F36', fontFamily: 'Plus Jakarta Sans', marginBottom: 14 }}>Quick Add</div>
        <div className="m-quick-grid">
          {quickItems.map((qi) => {
            const Icon = NAV_ICONS[qi.screen] || Plus;
            return (
              <button key={qi.label} className="m-quick-item" onClick={() => go(qi.screen)}>
                <span className="m-quick-icon">
                  <Icon size={22} />
                </span>
                <span>{qi.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      {searchOpen && (
        <div className="m-search">
          <div className="m-search-bar">
            <Search size={19} color="#697586" />
            <input autoFocus placeholder="Search clients, projects, invoices..." value={searchVal} onChange={(e) => setSearchVal(e.target.value)} />
            <button className="m-icon-btn" onClick={() => { setSearchVal(''); closeOverlays(); }} aria-label="Close search">
              <X size={20} />
            </button>
          </div>
          <div className="m-search-results">
            {!searchVal.trim() ? (
              <div className="m-search-empty">Search across clients, projects, invoices, quotations, payments and employees.</div>
            ) : searchResults.length === 0 ? (
              <div className="m-search-empty">No results for "{searchVal}".</div>
            ) : (
              searchResults.map((r, i) => {
                const Icon = NAV_ICONS[r.screen] || Search;
                return (
                  <button key={i} className="m-search-item" onClick={() => go(r.screen)}>
                    <span className="m-drawer-icon">
                      <Icon size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: '#1A1F36', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                      <span style={{ display: 'block', fontSize: 12, color: '#697586' }}>{r.sub}</span>
                    </span>
                    <span className="badge badge-blue" style={{ fontSize: 10.5 }}>
                      {r.type}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
