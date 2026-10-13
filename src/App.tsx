import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { isOwnerOrAdminRole } from './services/authService';
import { ToastProvider } from './context/ToastContext';
import Login from './pages/Login';
import CompanySetupWizard from './components/CompanySetupWizard';
import CompanySetupPending from './components/CompanySetupPending';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import ClientProfile from './pages/ClientProfile';
import Leads from './pages/Leads';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Services from './pages/Services';
import Deliverables from './pages/Deliverables';
import Quotations from './pages/Quotations';
import Invoices from './pages/Invoices';
import Payments from './pages/Payments';
import Employees from './pages/Employees';
import Attendance from './pages/Attendance';
import Timesheets from './pages/Timesheets';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Tasks from './pages/Tasks';
import Leave from './pages/Leave';
import Payroll from './pages/Payroll';
import Assets from './pages/Assets';
import Documents from './pages/Documents';
import MyWorkspace, { type WorkspaceView } from './pages/MyWorkspace';
import MyAttendance from './pages/MyAttendance';
import EmployeeExpenses from './pages/EmployeeExpenses';
import Profile from './pages/Profile';
import OngoingProjectDetail from './pages/OngoingProjectDetail';
import { ensureScheduledTasks } from './services/ongoingWorkService';
import logo from './assets/legendary-one-logo.png';

type AppScreen =
  | 'login' | 'dashboard' | 'leads' | 'clients' | 'client-profile'
  | 'projects' | 'project-detail' | 'tasks' | 'deliverables'
  | 'quotations' | 'invoices' | 'payments' | 'expenses'
  | 'employees' | 'attendance' | 'timesheets' | 'leave' | 'payroll'
  | 'services' | 'assets' | 'documents' | 'reports' | 'settings' | 'my-workspace' | 'my-attendance' | 'employee-expenses' | 'profile' | 'employee-profile' | 'ongoing-detail'
  // Employee pages, each its own screen
  | 'ws:today' | 'ws:tasks' | 'ws:leave' | 'ws:salary';

function MainApp() {
  const {
    isAuthenticated,
    isLoading,
    isCompanySetupCompleted,
    isCheckingCompanySetup,
    canAccessScreen,
    user,
    isSelfService,
    myEmployee,
  } = useAuth();
  const [screen, setScreen] = useState<AppScreen>('dashboard');
  const [selectedClientId, setSelectedClientId] = useState<number | string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<number | string>('');
  // Tab to open My Workspace on; `n` remounts it so the same tab can be requested again
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | string>('');

  // Posting schedules (e.g. a reel every day at 9 AM & 6 PM) become tasks. No server, so whoever is signed in
  // creates the missing ones: employees only their own, admins everyone's. Re-checked so new days roll over.
  const scheduleOwner = isSelfService ? myEmployee?.id : undefined;
  useEffect(() => {
    if (!isAuthenticated || !isCompanySetupCompleted) return;
    if (isSelfService && scheduleOwner === undefined) return;
    const run = () =>
      ensureScheduledTasks(isSelfService ? { employeeId: scheduleOwner } : {}).catch((err) => console.warn('[Schedules] Task generation failed:', err));
    const first = setTimeout(run, 4000); // give the first Firestore sync a moment
    const timer = setInterval(run, 10 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isAuthenticated, isCompanySetupCompleted, isSelfService, scheduleOwner]);

  // Screens live in browser history so the browser / Android back button moves between them
  useEffect(() => {
    // Installed-app shortcuts open a screen with ?screen=
    const start = new URLSearchParams(window.location.search).get('screen') as AppScreen | null;
    if (start) setScreen(start);
    window.history.replaceState({ screen: start || 'dashboard' }, '', window.location.pathname);

    const onPop = (e: PopStateEvent) => {
      const st = (e.state || {}) as { screen?: AppScreen; clientId?: string | number; projectId?: string | number; employeeId?: string | number };
      if (!st.screen) return;
      if (st.clientId !== undefined) setSelectedClientId(st.clientId);
      if (st.projectId !== undefined) setSelectedProjectId(st.projectId);
      if (st.employeeId !== undefined) setSelectedEmployeeId(st.employeeId);
      setScreen(st.screen);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (isLoading || (isAuthenticated && isCheckingCompanySetup)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1A1F36', color: '#fff', fontFamily: 'Plus Jakarta Sans', gap: 10 }}>
        <div style={{ width: 72, height: 72, borderRadius: 18, background: '#0A0E1A', border: '1px solid #252D4A', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
          <img src={logo} alt="Legendary One Logo" style={{ width: 64, height: 64, objectFit: 'contain', mixBlendMode: 'screen' }} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.3px' }}>Legendary One</div>
        <div style={{ fontSize: 13, color: '#94A3C4', fontWeight: 500 }}>Where Innovation Meets Excellence</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setScreen('dashboard')} />;
  }

  // REDIRECT FLOW: Check Firestore company setup status
  if (!isCompanySetupCompleted) {
    const isOwnerOrAdmin = isOwnerOrAdminRole(user?.role);
    if (isOwnerOrAdmin) {
      return <CompanySetupWizard onComplete={() => setScreen('dashboard')} />;
    } else {
      return <CompanySetupPending />;
    }
  }

  /** Open a screen and record it in history (extra = ids the screen needs when going back to it) */
  const go = (s: AppScreen, extra: Record<string, string | number> = {}) => {
    if (s === screen && Object.keys(extra).length === 0) return;
    setScreen(s);
    window.history.pushState({ screen: s, ...extra }, '');
  };
  const nav = (s: string) => {
    if (s === 'login') return;
    go(s as AppScreen);
  };
  /** Employee pages: overview on the dashboard, and Today's Tasks / All Tasks / Leave / Salary as their own screens */
  const workspacePage = (view: WorkspaceView) => <MyWorkspace key={view} view={view} onNav={nav} />;

  const renderScreen = () => {
    if (!canAccessScreen(screen)) {
      return (
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 20, color: '#1A1F36', marginBottom: 6 }}>
            Access Restricted
          </div>
          <div style={{ fontSize: 13.5, color: '#697586', marginBottom: 20, maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.5 }}>
            Your account role (<strong>{user?.role}</strong>) does not have authorization to access this module.
          </div>
          <button className="btn-primary" onClick={() => go('dashboard')}>
            Return to Dashboard
          </button>
        </div>
      );
    }
    switch (screen) {
      case 'my-workspace':
        return workspacePage('overview');
      case 'ws:today':
        return workspacePage('today');
      case 'ws:tasks':
        return workspacePage('tasks');
      case 'ws:leave':
        return workspacePage('leave');
      case 'ws:salary':
        return workspacePage('salary');
      case 'my-attendance':
        return (
          <MyAttendance
            onOpenTodayTasks={() => go('ws:today')}
          />
        );
      case 'dashboard':
        // Employees land on their personal dashboard
        if (isSelfService) return workspacePage('overview');
        return (
          <Dashboard
            onNav={nav}
            onViewClient={(id) => {
              setSelectedClientId(id);
              go('client-profile', { clientId: id });
            }}
            onViewProject={(id) => {
              setSelectedProjectId(id);
              go('project-detail', { projectId: id });
            }}
          />
        );
      case 'leads':
        return <Leads />;
      case 'clients':
        return <Clients onViewClient={(id) => { setSelectedClientId(id); go('client-profile', { clientId: id }); }} />;
      case 'client-profile':
        return (
          <ClientProfile
            clientId={selectedClientId}
            onBack={() => go('clients')}
            onViewProject={(id) => { setSelectedProjectId(id); go('project-detail', { projectId: id }); }}
          />
        );
      case 'projects':
        return (
          <Projects
            onViewProject={(id) => { setSelectedProjectId(id); go('project-detail', { projectId: id }); }}
            onViewOngoing={(id) => { setSelectedProjectId(id); go('ongoing-detail', { projectId: id }); }}
          />
        );
      case 'ongoing-detail':
        return <OngoingProjectDetail projectId={selectedProjectId} onBack={() => go('projects')} />;
      case 'project-detail':
        return <ProjectDetail projectId={selectedProjectId} onBack={() => go('projects')} />;
      case 'services':
        return <Services />;
      case 'tasks':
        return <Tasks />;
      case 'deliverables':
        return <Deliverables />;
      case 'quotations':
        return <Quotations />;
      case 'invoices':
        return <Invoices />;
      case 'payments':
        return <Payments />;
      case 'expenses':
        return <Expenses />;
      case 'employees':
        return (
          <Employees
            onViewProfile={(id) => {
              setSelectedEmployeeId(id);
              go('employee-profile', { employeeId: id });
            }}
          />
        );
      case 'profile':
        return <Profile onNav={nav} />;
      case 'employee-profile':
        return <Profile employeeId={selectedEmployeeId} onNav={nav} onBack={() => go('employees')} />;
      case 'attendance':
        return <Attendance />;
      case 'timesheets':
        return <Timesheets />;
      case 'leave':
        return <Leave />;
      case 'payroll':
        return <Payroll />;
      case 'employee-expenses':
        return <EmployeeExpenses />;
      case 'assets':
        return <Assets />;
      case 'documents':
        return <Documents />;
      case 'reports':
        return <Reports />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout current={screen} onNav={nav}>
      {renderScreen()}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <MainApp />
      </ToastProvider>
    </AuthProvider>
  );
}
