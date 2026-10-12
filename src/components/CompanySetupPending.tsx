import { useAuth } from '../context/AuthContext';
import logoBrand from '../assets/legendary-one-logo.png';

export default function CompanySetupPending() {
  const { user, logout, refreshCompanyProfile, isCheckingCompanySetup } = useAuth();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0F172A 0%, #1A1F36 60%, #1E293B 100%)',
        color: '#F8FAFC',
        fontFamily: 'Inter, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: '#FFFFFF',
          borderRadius: 24,
          color: '#1A1F36',
          padding: '40px 32px',
          textAlign: 'center',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: '#0F172A',
            border: '1px solid #334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <img
            src={logoBrand}
            alt="Legendary One"
            style={{ width: 56, height: 56, objectFit: 'contain', mixBlendMode: 'screen' }}
          />
        </div>

        <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>

        <h2
          style={{
            fontFamily: 'Plus Jakarta Sans',
            fontWeight: 800,
            fontSize: 22,
            color: '#0F172A',
            marginBottom: 8,
          }}
        >
          Company Setup Pending
        </h2>

        <p
          style={{
            fontSize: 14,
            color: '#64748B',
            lineHeight: 1.5,
            marginBottom: 24,
          }}
        >
          First-time company onboarding has not been completed for this workspace yet. An{' '}
          <strong>Owner or Super Admin</strong> must log in and complete the setup wizard before access
          to the Business OS Dashboard is unlocked.
        </p>

        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 24,
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Your Logged-in Account
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{user?.name}</div>
          <div style={{ fontSize: 12.5, color: '#64748B' }}>{user?.email}</div>
          <div style={{ marginTop: 8 }}>
            <span className="badge badge-amber" style={{ fontSize: 11.5 }}>
              Role: {user?.role}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => refreshCompanyProfile()}
            disabled={isCheckingCompanySetup}
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '10px 16px',
              fontWeight: 700,
              background: '#3B5BDB',
            }}
          >
            {isCheckingCompanySetup ? 'Checking Setup Status...' : '🔄 Re-check Setup Status'}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => logout()}
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontWeight: 600 }}
          >
            Sign Out & Switch Account
          </button>
        </div>
      </div>
    </div>
  );
}
