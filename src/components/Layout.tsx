import { useState, useEffect, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { db } from '../db/database';
import { pendingRequests, isDueOn, isTaskDone, toLocalDate } from '../utils/attendanceTimes';
import logo from '../assets/legendary-one-logo.png';
import MobileShell, { type NavEntry } from './MobileShell';
import { useIsMobile } from '../hooks/useIsMobile';
import InstallAppButton from './InstallApp';

type NavScreen =
  | 'dashboard' | 'leads' | 'clients' | 'client-profile'
  | 'projects' | 'project-detail' | 'ongoing-detail' | 'tasks' | 'deliverables'
  | 'quotations' | 'invoices' | 'payments' | 'expenses'
  | 'employees' | 'attendance' | 'timesheets' | 'leave' | 'payroll'
  | 'services' | 'assets' | 'documents' | 'reports' | 'settings' | 'my-workspace' | 'my-attendance' | 'employee-expenses' | 'profile' | 'employee-profile'
  | 'ws:today' | 'ws:tasks' | 'ws:leave' | 'ws:salary';

interface Props {
  current: string;
  onNav: (s: NavScreen) => void;
  children: React.ReactNode;
}

const nav = [
  { key: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { key: 'my-workspace', label: 'My Workspace', icon: '☺' },
  { key: 'my-attendance', label: 'My Attendance', icon: '◷' },
  { section: 'CRM' },
  { key: 'leads', label: 'Leads', icon: '◈' },
  { key: 'clients', label: 'Clients', icon: '◉' },
  { section: 'Work' },
  { key: 'projects', label: 'Projects', icon: '◱' },
  { key: 'tasks', label: 'Tasks', icon: '✓' },
  { key: 'deliverables', label: 'Deliverables', icon: '⊡' },
  { section: 'Sales & Finance' },
  { key: 'quotations', label: 'Quotations', icon: '◫' },
  { key: 'invoices', label: 'Invoices', icon: '◪' },
  { key: 'payments', label: 'Payments', icon: '₹' },
  { key: 'expenses', label: 'Expenses', icon: '◳' },
  { section: 'Team' },
  { key: 'employees', label: 'Employees', icon: '◈' },
  { key: 'attendance', label: 'Attendance', icon: '◷' },
  { key: 'timesheets', label: 'Timesheets', icon: '◴' },
  { key: 'leave', label: 'Leave', icon: '◶' },
  { key: 'payroll', label: 'Payroll', icon: '◵' },
  { key: 'employee-expenses', label: 'Employee Expenses', icon: '₹' },
  { section: 'Business' },
  { key: 'services', label: 'Services', icon: '◇' },
  { key: 'assets', label: 'Assets', icon: '◆' },
  { key: 'documents', label: 'Documents', icon: '◰' },
  { key: 'reports', label: 'Reports', icon: '◈' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

export default function Layout({ current, onNav, children }: Props) {
  const { user, companyProfile, logout, canAccessScreen, myEmployee, isSelfService } = useAuth();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHeaderUserMenu, setShowHeaderUserMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  // Live query search targets
  const liveClients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const liveProjects = useLiveQuery(() => db.projects.toArray(), []) || [];
  // Employee attendance requests waiting on a manager (shown as a badge on Attendance)
  const pendingAttendanceCount =
    useLiveQuery(async () => (await db.attendance.toArray()).reduce((n, r) => n + pendingRequests(r).length, 0), []) || 0;
  const liveInvoices = useLiveQuery(() => db.invoices.toArray(), []) || [];
  const liveQuotations = useLiveQuery(() => db.quotations.toArray(), []) || [];
  const livePayments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const liveEmployees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const liveTasks = useLiveQuery(() => db.tasks.toArray(), []) || [];

  const todayStr = toLocalDate(new Date());
  const empId = myEmployee?.id !== undefined ? String(myEmployee.id) : '';
  const empName = myEmployee?.name || '';
  const myTodayTasks = useMemo(() => {
    if (!myEmployee) return [];
    return liveTasks.filter((t) => {
      const assigned =
        (t.assignedToId !== undefined && String(t.assignedToId) === empId) ||
        (!!empName && (t.assignedTo === empName || t.assignee === empName));
      return assigned && isDueOn(t, todayStr);
    });
  }, [liveTasks, myEmployee, empId, empName, todayStr]);

  const todayBadgeCount = useMemo(() => {
    const needingUpdate = myTodayTasks.filter((t) => !isTaskDone(t) && t.progressUpdatedOn !== todayStr).length;
    if (needingUpdate > 0) return needingUpdate;
    return myTodayTasks.filter((t) => !isTaskDone(t)).length || myTodayTasks.length;
  }, [myTodayTasks, todayStr]);

  // Ctrl+K Shortcut & Escape Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setShowQuickAdd(false);
        setShowUserMenu(false);
        setShowHeaderUserMenu(false);
        setShowNotifMenu(false);
        setSearchVal('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Compute Dynamic Financial Year Badge
  const getFYBadge = () => {
    const d = new Date();
    const m = d.getMonth(); // 0 = Jan, 3 = Apr
    const y = d.getFullYear();
    const startYr = m >= 3 ? y : y - 1;
    const endYrShort = (startYr + 1).toString().slice(-2);
    return `FY ${startYr}–${endYrShort}`;
  };

  // Quick Add Actions filtered by user permissions
  const rawQuickItems = [
    { label: 'New Lead', screen: 'leads' },
    { label: 'Add Client', screen: 'clients' },
    { label: 'Add Project', screen: 'projects' },
    { label: 'Add Task', screen: 'tasks' },
    { label: 'Create Quotation', screen: 'quotations' },
    { label: 'Create Invoice', screen: 'invoices' },
    { label: 'Add Payment', screen: 'payments' },
    { label: 'Add Expense', screen: 'expenses' },
    { label: 'Add Employee', screen: 'employees' },
  ];

  const quickItems = rawQuickItems.filter((item) => canAccessScreen(item.screen));

  // Global Search Results Generation
  const q = searchVal.trim().toLowerCase();
  const searchResults = q
    ? [
        ...liveClients
          .filter((c) => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q))
          .map((c) => ({ type: 'Client', title: c.name, sub: c.company, screen: 'clients' as NavScreen })),
        ...liveProjects
          .filter((p) => p.name.toLowerCase().includes(q))
          .map((p) => ({ type: 'Project', title: p.name, sub: p.clientName || 'Project', screen: 'projects' as NavScreen })),
        ...liveInvoices
          .filter((inv) => (inv.invoiceNumber || '').toLowerCase().includes(q) || (inv.clientName || '').toLowerCase().includes(q))
          .map((inv) => ({ type: 'Invoice', title: inv.invoiceNumber || `INV-${inv.id}`, sub: inv.clientName, screen: 'invoices' as NavScreen })),
        ...liveQuotations
          .filter((qt) => (qt.quotationNumber || '').toLowerCase().includes(q) || (qt.clientName || '').toLowerCase().includes(q))
          .map((qt) => ({ type: 'Quotation', title: qt.quotationNumber || `QT-${qt.id}`, sub: qt.clientName, screen: 'quotations' as NavScreen })),
        ...livePayments
          .filter((pm) => (pm.clientName || '').toLowerCase().includes(q))
          .map((pm) => ({ type: 'Payment', title: `₹${pm.amount.toLocaleString('en-IN')}`, sub: pm.clientName, screen: 'payments' as NavScreen })),
        ...liveEmployees
          .filter((emp) => emp.name.toLowerCase().includes(q) || emp.email.toLowerCase().includes(q))
          .map((emp) => ({ type: 'Employee', title: emp.name, sub: emp.role || emp.dept, screen: 'employees' as NavScreen })),
      ]
        .filter((res) => canAccessScreen(res.screen))
        .slice(0, 8)
    : [];

  /** Employee specific menu items when in self-service mode */
  const employeeNavItems: ({ section: string } | { key: NavScreen; label: string; icon: string; badge?: number })[] = [
    { section: 'My Workspace' },
    { key: 'dashboard', label: 'Overview', icon: '⊞' },
    { key: 'ws:today', label: "Today's Tasks", icon: '✓', badge: todayBadgeCount },
    { key: 'ws:tasks', label: 'All My Tasks', icon: '📋' },
    { key: 'ws:leave', label: 'My Leave', icon: '◶' },
    { key: 'ws:salary', label: 'My Salary', icon: '₹' },
    ...(myEmployee ? [{ key: 'my-attendance' as NavScreen, label: 'My Attendance', icon: '◷' }] : []),
  ];

  /** Same visibility rules as the desktop sidebar, flattened for the mobile drawer */
  const isNavItemVisible = (key: string) => {
    if (!canAccessScreen(key)) return false;
    if (key === 'my-workspace' && (isSelfService || !myEmployee)) return false;
    if (key === 'my-attendance' && !myEmployee) return false;
    return true;
  };
  const standardNavEntries: NavEntry[] = [];
  nav.forEach((item) => {
    if ('section' in item) {
      standardNavEntries.push({ section: item.section as string });
    } else if (isNavItemVisible(item.key!)) {
      standardNavEntries.push({ key: item.key!, label: item.key === 'dashboard' && isSelfService ? 'My Dashboard' : item.label! });
    }
  });

  const visibleNavEntries: NavEntry[] = isSelfService
    ? [
        { section: 'My Workspace' },
        { key: 'dashboard', label: 'Overview' },
        { key: 'ws:today', label: "Today's Tasks", badge: todayBadgeCount },
        { key: 'ws:tasks', label: 'All My Tasks' },
        { key: 'ws:leave', label: 'My Leave' },
        { key: 'ws:salary', label: 'My Salary' },
        ...(myEmployee ? [{ key: 'my-attendance', label: 'My Attendance' }] : []),
      ]
    : standardNavEntries.filter(
        (e, i) => !('section' in e) || (standardNavEntries[i + 1] !== undefined && !('section' in standardNavEntries[i + 1]))
      );

  if (isMobile) {
    return (
      <MobileShell
        current={current}
        onNav={(s) => onNav(s as NavScreen)}
        navEntries={visibleNavEntries}
        quickItems={quickItems}
        searchVal={searchVal}
        setSearchVal={setSearchVal}
        searchResults={searchResults}
        pendingAttendanceCount={pendingAttendanceCount}
        fyBadge={getFYBadge()}
      >
        {children}
      </MobileShell>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: '#1A1F36', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* Logo & Company Name */}
        <div style={{ padding: '18px 14px 16px', borderBottom: '1px solid #252D4A', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#0A0E1A', border: '1px solid #252D4A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            {companyProfile?.logoUrl ? (
              <img src={companyProfile.logoUrl} alt="Company Logo" style={{ width: 38, height: 38, objectFit: 'contain' }} />
            ) : (
              <img src={logo} alt="Legendary One Logo" style={{ width: 40, height: 40, objectFit: 'contain', mixBlendMode: 'screen' }} />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 14.5, color: '#FFFFFF', letterSpacing: '-0.3px', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {companyProfile?.companyName || 'Legendary One'}
            </div>
            <div style={{ fontSize: 9.5, color: '#94A3C4', fontWeight: 500, marginTop: 3, letterSpacing: '0.01em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {companyProfile?.tagline || 'Where Innovation Meets Excellence'}
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav style={{ padding: '10px 10px', flex: 1 }}>
          {(isSelfService ? employeeNavItems : nav).map((item, i) => {
            if ('section' in item) {
              if (isSelfService) {
                return <div key={`s-${i}`} className="sidebar-section">{item.section}</div>;
              }
              // Hide section headings that have no visible items under them
              const nextSection = nav.findIndex((n, j) => j > i && 'section' in n);
              const items = nav.slice(i + 1, nextSection === -1 ? undefined : nextSection);
              const anyVisible = items.some((n) => 'key' in n && n.key && canAccessScreen(n.key));
              return anyVisible ? <div key={i} className="sidebar-section">{item.section}</div> : null;
            }
            if (!isSelfService) {
              if (!canAccessScreen(item.key!)) {
                return null;
              }
              // Employees' Dashboard is already their workspace; others get it when linked to an employee
              if (item.key === 'my-workspace' && (isSelfService || !myEmployee)) {
                return null;
              }
              // Own check-in / attendance page for anyone linked to an employee record
              if (item.key === 'my-attendance' && !myEmployee) {
                return null;
              }
            }
            const label = item.key === 'dashboard' && isSelfService ? 'My Dashboard' : item.label;
            const activeKey =
              current === 'project-detail' || current === 'ongoing-detail'
                ? 'projects'
                : current === 'client-profile'
                ? 'clients'
                : current === 'employee-profile'
                ? 'employees'
                : current;
            return (
              <div
                key={item.key}
                className={`sidebar-item${activeKey === item.key ? ' active' : ''}`}
                onClick={() => onNav(item.key as NavScreen)}
              >
                <span style={{ fontSize: 14, width: 16, textAlign: 'center' }}>{item.icon}</span>
                {label}
                {item.key === 'attendance' && !isSelfService && pendingAttendanceCount > 0 && (
                  <span
                    title={`${pendingAttendanceCount} attendance request(s) waiting for approval`}
                    style={{ marginLeft: 'auto', background: '#F79009', color: '#fff', borderRadius: 10, fontSize: 10.5, fontWeight: 700, padding: '1px 7px' }}
                  >
                    {pendingAttendanceCount}
                  </span>
                )}
                {'badge' in item && typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    title={`${item.badge} task(s)`}
                    style={{ marginLeft: 'auto', background: '#F79009', color: '#fff', borderRadius: 10, fontSize: 10.5, fontWeight: 700, padding: '1px 7px' }}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom Sidebar User Menu */}
        <div style={{ padding: '10px 10px 16px', borderTop: '1px solid #252D4A', position: 'relative' }}>
          <div
            className="sidebar-item"
            style={{ fontSize: 12.5, justifyContent: 'space-between' }}
            onClick={() => setShowUserMenu((v) => !v)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#3B5BDB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                {user?.avatarInitials || (user?.name ? user.name.slice(0, 2).toUpperCase() : 'LO')}
              </span>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ color: '#E2E8F6', fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.name || 'User'}
                </div>
                <div style={{ color: '#94A3C4', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.role || 'Owner'}
                </div>
              </div>
            </div>
            <span style={{ color: '#697586', fontSize: 10 }}>▲</span>
          </div>

          {showUserMenu && (
            <div style={{ position: 'absolute', bottom: '100%', left: 10, right: 10, marginBottom: 8, background: '#252D4A', border: '1px solid #323C62', borderRadius: 10, padding: 6, zIndex: 100 }}>
              <div style={{ padding: '6px 10px', fontSize: 11, color: '#94A3C4', borderBottom: '1px solid #323C62', marginBottom: 4 }}>
                Logged in as <strong>{user?.email}</strong>
              </div>
              <button
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 'none', fontSize: 12.5, color: '#E2E8F6', cursor: 'pointer', borderRadius: 6, fontWeight: 600 }}
                onClick={() => { setShowUserMenu(false); onNav('profile'); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                👤 My Profile
              </button>
              <InstallAppButton variant="link" className="sidebar-install-link" label="Install as Windows app" />
              <button
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 'none', fontSize: 12.5, color: '#EF4444', cursor: 'pointer', borderRadius: 6, fontWeight: 600 }}
                onClick={() => { setShowUserMenu(false); logout(); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                🚪 Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Container */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Header */}
        <header style={{ background: '#fff', borderBottom: '1px solid #E5E9F2', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* Global Search Input */}
          <div style={{ flex: 1, maxWidth: 420, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 13 }}>🔍</span>
            <input
              ref={searchInputRef}
              className="input-base"
              style={{ paddingLeft: 32, paddingRight: 60, fontSize: 13, background: '#F8F9FC' }}
              placeholder="Search clients, projects, invoices... (Ctrl+K)"
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
            />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10.5, color: '#94A3C4', background: '#E5E9F2', padding: '2px 5px', borderRadius: 4, fontWeight: 600 }}>
              Ctrl+K
            </span>

            {/* Global Search Dropdown */}
            {searchVal.trim().length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: '#fff', border: '1px solid #E5E9F2', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.12)', zIndex: 110, padding: 6, maxHeight: 360, overflowY: 'auto' }}>
                <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  SEARCH RESULTS
                </div>
                {searchResults.length > 0 ? (
                  searchResults.map((res, idx) => (
                    <div
                      key={idx}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F8F9FC')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        onNav(res.screen);
                        setSearchVal('');
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>{res.title}</div>
                        <div style={{ fontSize: 11.5, color: '#697586' }}>{res.sub}</div>
                      </div>
                      <span className="badge badge-blue" style={{ fontSize: 10 }}>{res.type}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: 12.5, color: '#697586' }}>
                    No matching records found for "{searchVal}".
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            {/* Install as a desktop app (Chrome / Edge); hidden inside the installed app */}
            <InstallAppButton style={{ fontSize: 13, padding: '7px 12px' }} />

            {/* Quick Add Button & Dropdown */}
            <div style={{ position: 'relative' }}>
              <button className="btn-primary" style={{ fontSize: 13, padding: '7px 14px' }} onClick={() => setShowQuickAdd((v) => !v)}>
                + Quick Add
              </button>
              {showQuickAdd && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: '#fff', border: '1px solid #E5E9F2', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, minWidth: 200, padding: 6 }}>
                  {quickItems.map((qi) => (
                    <button
                      key={qi.label}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', borderRadius: 8, color: '#1A1F36', fontFamily: 'inherit' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F8F9FC')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        onNav(qi.screen as NavScreen);
                        setShowQuickAdd(false);
                      }}
                    >
                      {qi.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Role Badge */}
            <span className="badge badge-purple" style={{ fontSize: 11.5 }}>
              Role: {user?.role || 'Owner'}
            </span>

            {/* Dynamic FY Badge */}
            <span className="badge badge-blue" style={{ fontSize: 12 }}>
              {getFYBadge()}
            </span>

            {/* Notifications Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                style={{ background: '#F8F9FC', border: '1px solid #E5E9F2', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 15, position: 'relative' }}
                onClick={() => setShowNotifMenu((v) => !v)}
                title="Notifications"
              >
                🔔
              </button>

              {showNotifMenu && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 280, background: '#fff', border: '1px solid #E5E9F2', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.12)', zIndex: 100, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #E5E9F2' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1A1F36' }}>Notifications</div>
                    <span style={{ fontSize: 11, color: '#697586' }}>All caught up</span>
                  </div>
                  <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: 12.5, color: '#697586' }}>
                    🔔 No new notifications
                  </div>
                </div>
              )}
            </div>

            {/* Header User Avatar & Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: '#3B5BDB',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#fff',
                  cursor: 'pointer',
                  border: showHeaderUserMenu ? '2px solid #2563EB' : '2px solid transparent',
                  boxShadow: showHeaderUserMenu ? '0 0 0 3px rgba(59, 91, 219, 0.2)' : 'none',
                  transition: 'all 0.15s ease',
                  outline: 'none',
                  padding: 0,
                }}
                onClick={() => setShowHeaderUserMenu((v) => !v)}
                title={`Logged in as ${user?.name || 'User'} (${user?.role || 'User'})`}
              >
                {user?.avatarInitials || (user?.name ? user.name.slice(0, 2).toUpperCase() : 'LO')}
              </button>

              {showHeaderUserMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 8,
                    width: 240,
                    background: '#ffffff',
                    border: '1px solid #E5E9F2',
                    borderRadius: 12,
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
                    zIndex: 100,
                    overflow: 'hidden',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                  }}
                >
                  <div style={{ padding: '14px 16px', background: '#F8F9FC', borderBottom: '1px solid #E5E9F2' }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1A1F36', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user?.name || 'Authenticated User'}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#697586', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user?.email || ''}
                    </div>
                    <span className="badge badge-purple" style={{ fontSize: 10.5, padding: '3px 8px' }}>
                      {user?.role || 'Owner'}
                    </span>
                  </div>

                  <div style={{ padding: '6px' }}>
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 12px',
                        background: 'none',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#1A1F36',
                        cursor: 'pointer',
                        borderRadius: 8,
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F8F9FC')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        setShowHeaderUserMenu(false);
                        onNav('profile');
                      }}
                    >
                      <span style={{ fontSize: 14 }}>👤</span>
                      My Profile
                    </button>

                    {canAccessScreen('settings') && (
                      <button
                        type="button"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          textAlign: 'left',
                          padding: '9px 12px',
                          background: 'none',
                          border: 'none',
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#1A1F36',
                          cursor: 'pointer',
                          borderRadius: 8,
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#F8F9FC')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                        onClick={() => {
                          setShowHeaderUserMenu(false);
                          onNav('settings');
                        }}
                      >
                        <span style={{ fontSize: 14 }}>⚙️</span>
                        Settings
                      </button>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid #E5E9F2', padding: '6px' }}>
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 12px',
                        background: 'none',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#EF4444',
                        cursor: 'pointer',
                        borderRadius: 8,
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        setShowHeaderUserMenu(false);
                        logout();
                      }}
                    >
                      <span style={{ fontSize: 14 }}>🚪</span>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="app-main" style={{ flex: 1, overflow: 'auto', background: '#F8F9FC' }}>
          {children}
        </main>
      </div>

      {/* Overlay Backdrop for Dropdowns */}
      {(showQuickAdd || showUserMenu || showHeaderUserMenu || showNotifMenu) && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          onClick={() => {
            setShowQuickAdd(false);
            setShowUserMenu(false);
            setShowHeaderUserMenu(false);
            setShowNotifMenu(false);
          }}
        />
      )}
    </div>
  );
}
