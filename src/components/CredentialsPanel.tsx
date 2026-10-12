import { useEffect, useState } from 'react';
import { Eye, EyeOff, Copy, Plus, Edit3, Trash2, ExternalLink, Lock, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { isOwnerOrAdminRole } from '../services/authService';
import {
  addCredential,
  deleteCredential,
  subscribeCredentials,
  updateCredential,
  type ProjectCredential,
} from '../services/credentialService';

interface Props {
  clientId: string;
  /** Project view: list and add logins for this project. Omit for the client-wide list. */
  projectId?: string;
  projectName?: string;
  /** Client view: projects the user can attach a new login to */
  projects?: { id: string; name: string }[];
}

const LABEL_SUGGESTIONS = ['Gmail / Google account', 'GitHub', 'Hostinger', 'Domain registrar', 'Website admin', 'Firebase', 'Facebook', 'Instagram', 'YouTube', 'Formspree'];

const emptyForm = { label: '', username: '', password: '', url: '', notes: '', projectId: '' };

/** Access & Credentials list (Owner/Admin only — also enforced by Firestore rules). */
export default function CredentialsPanel({ clientId, projectId, projectName, projects = [] }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isAdmin = isOwnerOrAdminRole(user?.role);
  const [rows, setRows] = useState<ProjectCredential[]>([]);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ProjectCredential | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [toDelete, setToDelete] = useState<ProjectCredential | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin || !clientId) return;
    return subscribeCredentials(projectId ? { projectId } : { clientId }, setRows, (err) => setError(err.message));
  }, [isAdmin, clientId, projectId]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#697586', fontSize: 13 }}>
        <Lock size={20} style={{ marginBottom: 6 }} />
        <div>Access & credentials are visible to Owners and Admins only.</div>
      </div>
    );
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${what} copied.`, 'success');
    } catch {
      showToast('Could not copy to clipboard.', 'error');
    }
  };

  const toggle = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, projectId: projectId || '' });
    setShowForm(true);
  };

  const openEdit = (c: ProjectCredential) => {
    setEditing(c);
    setForm({ label: c.label, username: c.username, password: c.password, url: c.url || '', notes: c.notes || '', projectId: c.projectId || '' });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label.trim() || (!form.username.trim() && !form.password.trim())) {
      showToast('Enter a label and at least a username or password.', 'error');
      return;
    }
    const proj = projectId ? { id: projectId, name: projectName || '' } : projects.find((p) => p.id === form.projectId);
    const payload = {
      clientId,
      projectId: proj?.id || '',
      projectName: proj?.name || '',
      label: form.label.trim(),
      username: form.username.trim(),
      password: form.password,
      url: form.url.trim(),
      notes: form.notes.trim(),
    };
    setBusy(true);
    try {
      if (editing?.id) await updateCredential(editing.id, payload, user?.name);
      else await addCredential(payload, user?.name);
      showToast(editing ? 'Login updated.' : 'Login saved.', 'success');
      setShowForm(false);
    } catch (err: any) {
      showToast(`Could not save: ${err?.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete?.id) return;
    setBusy(true);
    try {
      await deleteCredential(toDelete.id);
      showToast('Login removed.', 'info');
      setToDelete(null);
    } catch (err: any) {
      showToast(`Could not delete: ${err?.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1F36' }}>Access & Credentials ({rows.length})</div>
          <div style={{ fontSize: 12, color: '#697586' }}>
            <Lock size={11} style={{ verticalAlign: '-1px' }} /> Owners & Admins only. Passwords stay hidden until you reveal them.
          </div>
        </div>
        <button type="button" className="btn-primary" style={{ fontSize: 12.5 }} onClick={openAdd}>
          <Plus size={14} /> Add Login
        </button>
      </div>

      {error && <div style={{ fontSize: 12.5, color: '#EF4444', marginBottom: 10 }}>Could not load logins: {error}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table className="table-base">
          <thead>
            <tr>
              {!projectId && <th>PROJECT</th>}
              <th>ACCOUNT</th>
              <th>USERNAME / EMAIL</th>
              <th>PASSWORD</th>
              <th>NOTES</th>
              <th style={{ textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={projectId ? 5 : 6} style={{ textAlign: 'center', padding: 24, color: '#697586' }}>
                  No logins saved yet.
                </td>
              </tr>
            ) : (
              rows.map((c) => {
                const shown = revealed.has(c.id!);
                return (
                  <tr key={c.id}>
                    {!projectId && <td style={{ fontSize: 12.5, color: '#475569' }}>{c.projectName || 'General'}</td>}
                    <td style={{ fontWeight: 600 }}>
                      {c.label}
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, color: '#3B5BDB' }} title={c.url}>
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {c.username || '—'}
                      {c.username && (
                        <button type="button" className="btn-icon" title="Copy username" style={{ padding: 3, marginLeft: 4 }} onClick={() => copy(c.username, 'Username')}>
                          <Copy size={12} />
                        </button>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5, fontFamily: shown ? 'ui-monospace, monospace' : undefined }}>
                      {c.password ? (shown ? c.password : '••••••••') : '—'}
                      {c.password && (
                        <>
                          <button type="button" className="btn-icon" title={shown ? 'Hide' : 'Show'} style={{ padding: 3, marginLeft: 4 }} onClick={() => toggle(c.id!)}>
                            {shown ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                          <button type="button" className="btn-icon" title="Copy password" style={{ padding: 3 }} onClick={() => copy(c.password, 'Password')}>
                            <Copy size={12} />
                          </button>
                        </>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: '#697586', maxWidth: 220 }}>{c.notes || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn-icon" title="Edit" style={{ padding: 5 }} onClick={() => openEdit(c)}>
                        <Edit3 size={14} />
                      </button>
                      <button type="button" className="btn-icon" title="Delete" style={{ padding: 5, color: '#EF4444' }} onClick={() => setToDelete(c)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" style={{ width: 500, maxWidth: '100%', padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>{editing ? 'Edit Login' : 'Add Login'}</div>
              <button type="button" onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#697586', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {!projectId && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={labelStyle}>Project</label>
                    <select className="select-base" style={{ width: '100%' }} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                      <option value="">General (no project)</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Account *</label>
                  <input className="input-base" list="credential-labels" placeholder="e.g. Gmail / Google account" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  <datalist id="credential-labels">
                    {LABEL_SUGGESTIONS.map((l) => (
                      <option key={l} value={l} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label style={labelStyle}>Username / Email</label>
                  <input className="input-base" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input className="input-base" autoComplete="new-password" style={{ fontFamily: 'ui-monospace, monospace' }} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Login URL</label>
                  <input className="input-base" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Notes</label>
                  <input className="input-base" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save Login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toDelete && (
        <div className="modal-overlay" onClick={() => setToDelete(null)}>
          <div className="modal-box" style={{ width: 400, maxWidth: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1A1F36', marginBottom: 8 }}>Remove this login?</div>
            <div style={{ fontSize: 13, color: '#697586', marginBottom: 18 }}>
              {toDelete.label} · {toDelete.username || 'no username'}. This can't be undone.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setToDelete(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-primary" style={{ background: '#EF4444' }} onClick={handleDelete} disabled={busy}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
