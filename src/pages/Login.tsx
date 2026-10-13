import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import InstallAppButton from '../components/InstallApp';
import { validateEmail } from '../utils/validation';
import { sendFirebasePasswordReset } from '../services/authService';
import logo from '../assets/legendary-one-logo.png';

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const { login } = useAuth();

  // Form State - Respects Remember Me preference on mount
  const [email, setEmail] = useState(() => {
    const isRemembered = localStorage.getItem('remember_me') === 'true';
    const savedEmail = localStorage.getItem('remembered_email');
    return isRemembered && savedEmail ? savedEmail : '';
  });
  const [password, setPassword] = useState(''); // Always clear password on mount & after logout
  const [rememberMe, setRememberMe] = useState(() => {
    return localStorage.getItem('remember_me') === 'true';
  });
  const [showPassword, setShowPassword] = useState(false);

  // Status & Feedback State
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Forgot Password Modal State
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  // Ensure password is always cleared, and un-remembered email is cleared on logout / component mount
  useEffect(() => {
    setPassword('');
    const isRemembered = localStorage.getItem('remember_me') === 'true';
    if (!isRemembered) {
      setEmail('');
      setRememberMe(false);
    }
  }, []);

  // Handle Login Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Form Validation
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setError('Please enter a valid email address (e.g. name@domain.com).');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login(cleanEmail, password, rememberMe);
      if (result.success) {
        if (rememberMe) {
          localStorage.setItem('remember_me', 'true');
          localStorage.setItem('remembered_email', cleanEmail);
        } else {
          localStorage.removeItem('remember_me');
          localStorage.removeItem('remembered_email');
        }
        setPassword('');
        onLogin();
      } else {
        setPassword('');
        setError(result.message || 'Invalid email address or password.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setPassword('');
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Forgot Password Modal
  const handleOpenForgot = () => {
    setForgotEmail(email);
    setForgotError(null);
    setForgotSuccess(null);
    setShowForgotModal(true);
  };

  // Request Password Reset via Firebase Auth
  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotSuccess(null);

    const cleanEmail = forgotEmail.trim();
    if (!cleanEmail) {
      setForgotError('Please enter your email address.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setForgotError('Please enter a valid email address.');
      return;
    }

    setIsResetting(true);
    try {
      const res = await sendFirebasePasswordReset(cleanEmail);
      if (res.success) {
        setForgotSuccess(res.message || `Password reset instructions sent to ${cleanEmail}.`);
      } else {
        setForgotError(res.message || 'Failed to send password reset email.');
      }
    } catch (err) {
      console.error('Password reset error:', err);
      setForgotError('Failed to process password reset request.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="login-container">
      {/* Background decoration */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', background: 'rgba(59,91,219,0.12)', top: -100, right: -80, filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'rgba(14,165,233,0.08)', bottom: -60, left: -60, filter: 'blur(50px)' }} />
      </div>

      <div className="login-card-wrapper">
        {/* Main Login Card */}
        <div className="login-card">
          {/* Official Branding Header */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 18, background: '#0A0E1A', border: '1px solid #1E293B', marginBottom: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
              <img
                src={logo}
                alt="Legendary One Logo"
                style={{ width: 64, height: 64, objectFit: 'contain', mixBlendMode: 'screen' }}
              />
            </div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 22, color: '#1A1F36', letterSpacing: '-0.3px' }}>
              Legendary One
            </div>
            <div style={{ fontSize: 13, color: '#697586', marginTop: 4, fontWeight: 500 }}>
              Where Innovation Meets Excellence
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 14px', borderRadius: 10, fontSize: 12.5, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠️</span>
              <span style={{ flex: 1, lineHeight: 1.3 }}>{error}</span>
            </div>
          )}

          {/* Firebase Login Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1A1F36', marginBottom: 6 }}>Email Address</label>
              <input
                className="input-base"
                type="email"
                placeholder="e.g. owner@legendaryone.in"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                disabled={isSubmitting}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>Password</label>
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  style={{ background: 'none', border: 'none', color: '#3B5BDB', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                className="input-base"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                disabled={isSubmitting}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: '#697586', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRememberMe(checked);
                    if (!checked) {
                      localStorage.removeItem('remember_me');
                      localStorage.removeItem('remembered_email');
                    }
                  }}
                  disabled={isSubmitting}
                />
                Remember Me
              </label>
              <button
                type="button"
                onClick={handleOpenForgot}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#3B5BDB', textDecoration: 'none', fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: 14.5, opacity: isSubmitting ? 0.75 : 1, cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Authenticating with Firebase...' : 'Sign In to Business OS'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <InstallAppButton variant="link" className="login-install-link" label="Install the app on this device" />
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
          © 2026 Legendary One. All rights reserved.
        </div>
      </div>

      {/* Firebase Password Reset Modal */}
      {showForgotModal && (
        <div className="modal-overlay" onClick={() => setShowForgotModal(false)}>
          <div className="modal-box" style={{ width: 440, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>Firebase Password Reset</div>
                <div style={{ fontSize: 12, color: '#697586', marginTop: 2 }}>We will send a password reset link to your email</div>
              </div>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={() => setShowForgotModal(false)}
              >
                ×
              </button>
            </div>

            {forgotError && (
              <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
                ⚠️ {forgotError}
              </div>
            )}

            {forgotSuccess && (
              <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
                ✓ {forgotSuccess}
              </div>
            )}

            <form onSubmit={handleRequestReset}>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>Registered Email Address</label>
                <input
                  className="input-base"
                  type="email"
                  placeholder="e.g. owner@legendaryone.in"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  disabled={isResetting}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowForgotModal(false)}>
                  Close
                </button>
                <button type="submit" className="btn-primary" disabled={isResetting}>
                  {isResetting ? 'Sending Email...' : 'Send Reset Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
