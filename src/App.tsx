import { useState } from 'react';
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
import MyWorkspace from './pages/MyWorkspace';
import logo from './assets/legendary-one-logo.png';

type AppScreen =
  | 'login' | 'dashboard' | 'leads' | 'clients' | 'client-profile'
  | 'projects' | 'project-detail' | 'tasks' | 'deliverables'
  | 'quotations' | 'invoices' | 'payments' | 'expenses'
  | 'employees' | 'attendance' | 'timesheets' | 'leave' | 'payroll'
  | 'services' | 'assets' | 'documents' | 'reports' | 'settings' | 'my-workspace';

function MainApp() {
  const {
    isAuthenticated,
    isLoading,
    isCompanySetupCompleted,
    isCheckingCompanySetup,
    canAccessScreen,
    user,
    isSelfService,
  } = useAuth();
  const [screen, setScreen] = useState<AppScreen>('dashboard');
  const [selectedClientId, setSelectedClientId] = useState<number | string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<number | string>('');

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

  const nav = (s: string) => { if (s !== 'login') setScreen(s as AppScreen); };

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
          <button className="btn-primary" onClick={() => setScreen('dashboard')}>
            Return to Dashboard
          </button>
        </div>
      );
    }
    switch (screen) {
      case 'my-workspace':
        return <MyWorkspace />;
      case 'dashboard':
        // Employees land on their personal dashboard
        if (isSelfService) return <MyWorkspace />;
        return (
          <Dashboard
            onNav={nav}
            onViewClient={(id) => {
              setSelectedClientId(id);
              setScreen('client-profile');
            }}
            onViewProject={(id) => {
              setSelectedProjectId(id);
              setScreen('project-detail');
            }}
          />
        );
      case 'leads':
        return <Leads />;
      case 'clients':
        return <Clients onViewClient={(id) => { setSelectedClientId(id); setScreen('client-profile'); }} />;
      case 'client-profile':
        return (
          <ClientProfile
            clientId={selectedClientId}
            onBack={() => setScreen('clients')}
            onViewProject={(id) => { setSelectedProjectId(id); setScreen('project-detail'); }}
          />
        );
      case 'projects':
        return <Projects onViewProject={(id) => { setSelectedProjectId(id); setScreen('project-detail'); }} />;
      case 'project-detail':
        return <ProjectDetail projectId={selectedProjectId} onBack={() => setScreen('projects')} />;
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
        return <Employees />;
      case 'attendance':
        return <Attendance />;
      case 'timesheets':
        return <Timesheets />;
      case 'leave':
        return <Leave />;
      case 'payroll':
        return <Payroll />;
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
