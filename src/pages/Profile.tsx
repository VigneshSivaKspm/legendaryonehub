import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee } from '../db/database';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { sendFirebasePasswordReset } from '../services/authService';
import { useInstallPrompt } from '../pwa';
import InstallAppButton from '../components/InstallApp';
import { computeMonthPay, formatRate } from '../utils/salary';
import { formatTime12h, formatLunch, formatDuration, isDueOn, isTaskDone, toLocalDate } from '../utils/attendanceTimes';
import {
  Mail,
  Phone,
  CalendarDays,
  BadgeCheck,
  Briefcase,
  Hash,
  ShieldCheck,
  Clock,
  ListChecks,
  Plane,
  Wallet,
  KeyRound,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Smartphone,
} from 'lucide-react';

interface Props {
  /** Show this employee instead of the signed-in user (admins opening a profile from Employees) */
  employeeId?: string | number;
  onNav?: (screen: string) => void;
  onBack?: () => void;
}

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'LO';

function tenure(joining?: string): string {
  if (!joining) return '';
  const start = new Date(joining.length === 10 && joining.includes('/') ? joining.split('/').reverse().join('-') : joining);
  if (isNaN(start.getTime())) return '';
  const months = (new Date().getFullYear() - start.getFullYear()) * 12 + (new Date().getMonth() - start.getMonth());
  if (months < 1) return 'Joined this month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ');
}

function Row({ icon, label, value, href }: { icon: React.ReactNode; label: string; value?: string; href?: string }) {
  const content = (
    <div className="profile-row">
      <span className="profile-row-icon">{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1F36', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '—'}</div>
      </div>
      {href && <ChevronRight size={16} color="#94A3B8" />}
    </div>
  );
  return href && value ? (
    <a href={href} style={{ textDecoration: 'none' }}>
      {content}
    </a>
  ) : (
    content
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="profile-tile">
      <div style={{ fontSize: 11, fontWeight: 700, color: '#697586', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'Plus Jakarta Sans', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#697586' }}>{sub}</div>}
    </div>
  );
}

/** Personal profile for every signed-in user, and any employee's profile for managers. */
export default function Profile({ employeeId, onNav, onBack }: Props) {
  const { user, myEmployee, companyProfile, logout, isSelfService } = useAuth();
  const { showToast } = useToast();
  const installer = useInstallPrompt();
  const [sending, setSending] = useState(false);

  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];
  const attendance = useLiveQuery(() => db.attendance.toArray(), []) || [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const leaves = useLiveQuery(() => db.leaveRequests.toArray(), []) || [];

  const viewingOther = employeeId !== undefined && String(employeeId) !== String(myEmployee?.id ?? '');
  const emp: Employee | null | undefined = viewingOther ? employees.find((e) => String(e.id) === String(employeeId)) : myEmployee;
  const isSelf = !viewingOther;
  const canSeePay = isSelf || !isSelfService;

  const today = toLocalDate(new Date());
  const month = today.slice(0, 7);
  const empId = emp?.id !== undefined ? String(emp.id) : '';

  const data = useMemo(() => {
    if (!emp) return null;
    const myAtt = attendance.filter((a) => String(a.employeeId) === empId).sort((a, b) => b.date.localeCompare(a.date));
    const myTasks = tasks.filter(
      (t) => (t.assignedToId !== undefined && String(t.assignedToId) === empId) || t.assignedTo === emp.name || t.assignee === emp.name
    );
    const myLeaves = leaves.filter((l) => String(l.employeeId) === empId);
    const pay = computeMonthPay({
      month,
      salary: Number(emp.salary) || 0,
      workingWeekdays: companyProfile?.workingDays,
      attendance: myAtt,
      leaves: myLeaves,
      today,
    });
    return {
      todayRec: myAtt.find((a) => a.date === today),
      recent: myAtt.slice(0, 5),
      openTasks: myTasks.filter((t) => !isTaskDone(t)),
      dueToday: myTasks.filter((t) => isDueOn(t, today)),
      doneThisMonth: myTasks.filter((t) => isTaskDone(t) && String(t.updatedAt || '').startsWith(month)).length,
      leaveDays: myLeaves.filter((l) => l.status === 'Approved' && l.fromDate.startsWith(today.slice(0, 4))).reduce((s, l) => s + (Number(l.days) || 0), 0),
      pendingLeaves: myLeaves.filter((l) => l.status === 'Pending').length,
      lateDays: myAtt.filter((a) => a.date.startsWith(month) && a.status === 'Late').length,
      pay,
    };
  }, [emp, empId, attendance, tasks, leaves, month, today, companyProfile?.workingDays]);

  const displayName = emp?.name || (isSelf ? user?.name : '') || 'Employee';
  const designation = emp?.role || (isSelf ? user?.role : '') || '';

  const handleReset = async () => {
    if (!user?.email) return;
    setSending(true);
    try {
      const res = await sendFirebasePasswordReset(user.email);
      showToast(res.success ? `Password reset link sent to ${user.email}.` : res.message || 'Could not send the reset email.', res.success ? 'success' : 'error');
    } catch (err: any) {
      showToast(err?.message || 'Could not send the reset email.', 'error');
    } finally {
      setSending(false);
    }
  };

  if (viewingOther && !emp) {
    return (
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 32, textAlign: 'center', color: '#697586' }}>
          Employee not found.
          {onBack && (
            <div style={{ marginTop: 12 }}>
              <button className="btn-secondary" onClick={onBack}>
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page" style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {onBack && (
        <button className="btn-secondary" style={{ marginBottom: 14, fontSize: 13 }} onClick={onBack}>
          <ChevronLeft size={15} /> Back to Employees
        </button>
      )}

      {/* Hero */}
      <div className="profile-hero">
        <div className="profile-hero-glow" />
        <div className="profile-avatar">{initialsOf(displayName)}</div>
        <div style={{ minWidth: 0, position: 'relative' }}>
          <div className="profile-name">{displayName}</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.78)', marginTop: 2 }}>{designation}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {emp?.employeeId && <span className="profile-chip">{emp.employeeId}</span>}
            {emp?.status && <span className="profile-chip">{emp.status === 'Active' ? '● Active' : emp.status}</span>}
            <span className="profile-chip">{emp?.accessRole || user?.role || 'Member'}</span>
            {companyProfile?.companyName && <span className="profile-chip">{companyProfile.companyName}</span>}
          </div>
        </div>
      </div>

      {/* This month */}
      {emp && data && (
        <div className="profile-tiles">
          <Tile label="Present" value={String(data.pay.presentDays + data.pay.halfDays * 0.5)} sub={`${data.pay.workingDays} working days`} color="#12B76A" />
          <Tile label="Hours Worked" value={formatDuration(data.pay.workedMinutes)} sub={data.lateDays ? `${data.lateDays} late day(s)` : 'This month'} color="#3B5BDB" />
          <Tile label="Open Tasks" value={String(data.openTasks.length)} sub={`${data.dueToday.length} due today`} color="#7C3AED" />
          <Tile label="Leave Taken" value={`${data.leaveDays} d`} sub={data.pendingLeaves ? `${data.pendingLeaves} pending` : today.slice(0, 4)} color="#F59E0B" />
        </div>
      )}

      <div className="profile-grid">
        {/* Details */}
        <div className="card profile-card">
          <div className="profile-card-title">Details</div>
          <Row icon={<Mail size={16} />} label="Email" value={emp?.email || user?.email} href={`mailto:${emp?.email || user?.email}`} />
          <Row icon={<Phone size={16} />} label="Phone" value={emp?.phone} href={emp?.phone ? `tel:${emp.phone}` : undefined} />
          <Row icon={<Briefcase size={16} />} label="Job Title / Designation" value={designation} />
          <Row icon={<Hash size={16} />} label="Employee ID" value={emp?.employeeId} />
          <Row
            icon={<CalendarDays size={16} />}
            label="Joining Date"
            value={emp?.joiningDate ? `${emp.joiningDate}${tenure(emp.joiningDate) ? ` · ${tenure(emp.joiningDate)}` : ''}` : undefined}
          />
          <Row icon={<ShieldCheck size={16} />} label="App Access" value={`${emp?.accessRole || user?.role || '—'}${emp ? (emp.userId ? ' · login enabled' : ' · no login') : ''}`} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Today */}
          {emp && data && (
            <div className="card profile-card">
              <div className="profile-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Today</span>
                {isSelf && onNav && (
                  <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => onNav('my-attendance')}>
                    <Clock size={13} /> Attendance
                  </button>
                )}
              </div>
              {data.todayRec ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }} data-keep-grid>
                  {[
                    ['Check-in', formatTime12h(data.todayRec.checkIn)],
                    ['Lunch', data.todayRec.lunchOut ? formatLunch(data.todayRec).split(' (')[0] : '—'],
                    ['Check-out', formatTime12h(data.todayRec.checkOut)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: '#F8F9FC', borderRadius: 12, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: '#697586', fontWeight: 600 }}>{k}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1F36' }}>{v}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#697586' }}>Not checked in yet.</div>
              )}
              {data.dueToday.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ListChecks size={14} /> Due today
                  </div>
                  {data.dueToday.slice(0, 4).map((t) => {
                    const pct = isTaskDone(t) ? 100 : Number(t.progress) || 0;
                    return (
                      <div key={t.id} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.task}</span>
                          <span style={{ fontWeight: 700, color: pct === 100 ? '#12B76A' : '#3B5BDB' }}>{pct}%</span>
                        </div>
                        <div style={{ height: 5, background: '#E5E9F2', borderRadius: 3, marginTop: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#12B76A' : '#3B5BDB' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Salary */}
          {emp && data && canSeePay && Number(emp.salary) > 0 && (
            <div className="card profile-card">
              <div className="profile-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wallet size={16} color="#3B5BDB" /> Salary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }} data-keep-grid>
                {[
                  ['Monthly', inr(Number(emp.salary))],
                  ['Per day', formatRate(data.pay.rates.daily)],
                  ['Per hour', formatRate(data.pay.rates.hourly)],
                  ['Earned so far', inr(data.pay.earnedToDate)],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: '#F8F9FC', borderRadius: 12, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: '#697586', fontWeight: 600 }}>{k}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#1A1F36' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent attendance */}
      {emp && data && data.recent.length > 0 && (
        <div className="card profile-card" style={{ marginTop: 16 }}>
          <div className="profile-card-title">Recent days</div>
          {data.recent.map((a) => (
            <div key={a.id} className="profile-day">
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                  {new Date(a.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
                <div style={{ fontSize: 12, color: '#697586' }}>
                  {formatTime12h(a.checkIn)} → {formatTime12h(a.checkOut)}
                </div>
              </div>
              <span className={`badge ${a.status === 'Present' ? 'badge-green' : a.status === 'Late' ? 'badge-amber' : a.status === 'Absent' ? 'badge-red' : 'badge-blue'}`}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Account & app (own profile only) */}
      {isSelf && (
        <div className="card profile-card" style={{ marginTop: 16 }}>
          <div className="profile-card-title">Account & App</div>
          <Row icon={<BadgeCheck size={16} />} label="Signed in as" value={`${user?.email || ''} · ${user?.role || ''}`} />
          <div className="profile-actions">
            {isSelfService && onNav && (
              <>
                <button className="profile-action" onClick={() => onNav('my-attendance')}>
                  <Clock size={18} /> My Attendance
                </button>
                <button className="profile-action" onClick={() => onNav('dashboard')}>
                  <Plane size={18} /> Leave & Salary
                </button>
              </>
            )}
            <button className="profile-action" onClick={handleReset} disabled={sending}>
              <KeyRound size={18} /> {sending ? 'Sending…' : 'Change Password'}
            </button>
            <InstallAppButton className="profile-action profile-action-primary" label={installer.desktop ? 'Install as Windows App' : 'Install App'} />
            {installer.installed && (
              <div className="profile-action" style={{ cursor: 'default', color: '#12B76A' }}>
                <Smartphone size={18} /> Installed app
              </div>
            )}
            <button className="profile-action profile-action-danger" onClick={logout}>
              <LogOut size={18} /> Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
