import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Users,
  Plus,
  Search,
  UserCheck,
  UserX,
  Edit3,
  Trash2,
  X,
  Shield,
  Link as LinkIcon,
  RefreshCw,
  Info,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { db, type User, type Employee } from '../db/database';
import { newestFirst } from '../utils/sort';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import {
  getAllUsers,
  provisionUserAccess,
  updateUserAccessAndRole,
  removeUserAccess,
  isOwnerRole,
} from '../services/userService';

interface ManageUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ROLES_LIST = [
  'Owner / Super Admin',
  'Admin',
  'Project Manager',
  'Employee',
  'Accountant',
];

export default function ManageUsersModal({ isOpen, onClose }: ManageUsersModalProps) {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();

  // Reactive Dexie Queries
  const liveUsers = useLiveQuery(async () => newestFirst(await db.users.toArray()), []) || [];
  const liveEmployees = useLiveQuery(() => db.employees.toArray(), []) || [];

  // Local Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Sub-Modal States
  const [showProvisionModal, setShowProvisionModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);

  // Selected User State
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Provision Form States
  const [provName, setProvName] = useState<string>('');
  const [provEmail, setProvEmail] = useState<string>('');
  const [provRole, setProvRole] = useState<string>('Employee');
  const [provEmployeeId, setProvEmployeeId] = useState<string>('');
  const [provStatus, setProvStatus] = useState<'Active' | 'Disabled'>('Active');
  const [isProvisioning, setIsProvisioning] = useState<boolean>(false);

  // Edit Form States
  const [editName, setEditName] = useState<string>('');
  const [editRole, setEditRole] = useState<string>('Employee');
  const [editEmployeeId, setEditEmployeeId] = useState<string>('');
  const [editStatus, setEditStatus] = useState<'Active' | 'Disabled'>('Active');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Delete State
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  if (!isOpen) return null;

  // Refresh Users list from Firestore
  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await getAllUsers();
      showToast('Users list synchronized from Cloud Firestore.', 'info');
    } catch (err: any) {
      showToast(`Refresh error: ${err?.message || err}`, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter Users
  const filteredUsers = liveUsers.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q) ||
      (u.employeeName || '').toLowerCase().includes(q)
    );
  });

  // Open Provision Modal
  const openProvisionModal = () => {
    setProvName('');
    setProvEmail('');
    setProvRole('Employee');
    setProvEmployeeId('');
    setProvStatus('Active');
    setShowProvisionModal(true);
  };

  // Submit Provision User
  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provName.trim()) {
      showToast('User name is required.', 'error');
      return;
    }
    if (!provEmail.trim() || !provEmail.includes('@')) {
      showToast('Valid user email is required.', 'error');
      return;
    }

    const matchedEmp = liveEmployees.find((emp) => String(emp.id) === provEmployeeId || String(emp.employeeId) === provEmployeeId);

    try {
      setIsProvisioning(true);
      await provisionUserAccess(
        {
          name: provName,
          email: provEmail,
          role: provRole,
          employeeId: provEmployeeId,
          employeeName: matchedEmp ? `${matchedEmp.name} (${matchedEmp.employeeId || matchedEmp.role})` : '',
          status: provStatus,
        },
        currentUser || undefined
      );

      showToast(`User access profile for ${provEmail} provisioned in Firestore!`, 'success');
      setShowProvisionModal(false);
    } catch (err: any) {
      showToast(`Provision error: ${err?.message || err}`, 'error');
    } finally {
      setIsProvisioning(false);
    }
  };

  // Open Edit User Modal
  const openEditModal = (u: User) => {
    setSelectedUser(u);
    setEditName(u.name || '');
    setEditRole(u.role || 'Employee');
    setEditEmployeeId(u.employeeId ? String(u.employeeId) : '');
    setEditStatus((u.status as any) === 'Disabled' ? 'Disabled' : 'Active');
    setShowEditModal(true);
  };

  // Submit Edit User
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser?.id) return;

    const matchedEmp = liveEmployees.find((emp) => String(emp.id) === editEmployeeId || String(emp.employeeId) === editEmployeeId);

    try {
      setIsSavingEdit(true);
      await updateUserAccessAndRole(
        String(selectedUser.id),
        {
          name: editName,
          role: editRole,
          status: editStatus,
          employeeId: editEmployeeId,
          employeeName: matchedEmp ? `${matchedEmp.name} (${matchedEmp.employeeId || matchedEmp.role})` : '',
        },
        currentUser || undefined
      );

      showToast(`User account updated successfully for ${selectedUser.email}.`, 'success');
      setShowEditModal(false);
      setSelectedUser(null);
    } catch (err: any) {
      showToast(`Update error: ${err?.message || err}`, 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Quick Status Toggle
  const handleToggleStatus = async (u: User) => {
    if (!u.id) return;
    const newStatus: 'Active' | 'Disabled' = (u.status as any) === 'Disabled' ? 'Active' : 'Disabled';

    try {
      await updateUserAccessAndRole(
        String(u.id),
        { status: newStatus },
        currentUser || undefined
      );
      showToast(`User status for ${u.name} set to ${newStatus}.`, 'success');
    } catch (err: any) {
      showToast(`Status update failed: ${err?.message || err}`, 'error');
    }
  };

  // Open Delete Confirmation Modal
  const openDeleteModal = (u: User) => {
    setSelectedUser(u);
    setShowDeleteModal(true);
  };

  // Execute Remove User Access
  const handleConfirmDelete = async () => {
    if (!selectedUser?.id) return;
    try {
      setIsDeleting(true);
      await removeUserAccess(String(selectedUser.id), currentUser || undefined);
      showToast(`User access removed for ${selectedUser.email}.`, 'success');
      setShowDeleteModal(false);
      setSelectedUser(null);
    } catch (err: any) {
      showToast(`Remove error: ${err?.message || err}`, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Role Badge Renderer
  const renderRoleBadge = (roleName: string) => {
    const isOwn = isOwnerRole(roleName);
    if (isOwn) {
      return (
        <span className="badge badge-red" style={{ fontSize: 11, gap: 4 }}>
          <Shield size={11} />
          {roleName}
        </span>
      );
    }
    if (roleName === 'Admin') {
      return <span className="badge badge-yellow" style={{ fontSize: 11 }}>Admin</span>;
    }
    if (roleName === 'Project Manager') {
      return <span className="badge badge-blue" style={{ fontSize: 11 }}>Project Manager</span>;
    }
    if (roleName === 'Accountant') {
      return <span className="badge badge-purple" style={{ fontSize: 11 }}>Accountant</span>;
    }
    return <span className="badge badge-green" style={{ fontSize: 11 }}>Employee</span>;
  };

  return (
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
      onClick={onClose}
    >
      <div
        className="modal-box"
        style={{
          width: '100%',
          maxWidth: 960,
          maxHeight: '92vh',
          overflowY: 'auto',
          background: '#FFFFFF',
          borderRadius: 16,
          padding: 28,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, borderBottom: '1px solid #E2E8F0', paddingBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={20} />
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Plus Jakarta Sans' }}>
                Application Users & Access Control
              </h2>
            </div>
            <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
              Persisted user accounts in Cloud Firestore. Link users to Employee records and control access roles safely.
            </p>
          </div>

          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              type="text"
              className="input-base"
              placeholder="Search users by name, email, role, or linked employee..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 36, fontSize: 13, background: '#F8FAFC' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-secondary" onClick={handleRefresh} disabled={isRefreshing} style={{ fontSize: 13, gap: 6 }}>
              <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
              Refresh
            </button>

            <button type="button" className="btn-primary" onClick={openProvisionModal} style={{ fontSize: 13, gap: 6 }}>
              <Plus size={16} strokeWidth={2.5} />
              Provision User Access
            </button>
          </div>
        </div>

        {/* Users Table */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
          {filteredUsers.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#64748B' }}>
              <Users size={32} style={{ margin: '0 auto 12px auto', color: '#94A3B8' }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', marginBottom: 4 }}>No User Profiles Found</div>
              <div style={{ fontSize: 13 }}>Provision user access or search with different keywords.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table-base" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>User Account</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Role</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Linked Employee</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Last Updated</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const initials = u.avatarInitials || (u.name ? u.name.slice(0, 2).toUpperCase() : 'LO');
                    const isDisabled = (u.status as any) === 'Disabled';

                    return (
                      <tr key={u.id || u.email} style={{ borderBottom: '1px solid #F1F5F9', background: isDisabled ? '#FAF5F5' : 'none' }}>
                        {/* User Info */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#3B5BDB', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                              {initials}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13.5 }}>{u.name}</div>
                              <div style={{ fontSize: 11.5, color: '#64748B' }}>{u.email}</div>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          {renderRoleBadge(u.role)}
                        </td>

                        {/* Linked Employee */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          {u.employeeName || u.employeeId ? (
                            <span className="badge badge-gray" style={{ fontSize: 11.5, gap: 4, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
                              <LinkIcon size={12} />
                              {u.employeeName || `EMP #${u.employeeId}`}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>-- Unlinked --</span>
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          {isDisabled ? (
                            <span className="badge badge-red" style={{ fontSize: 11 }}>Disabled</span>
                          ) : (
                            <span className="badge badge-green" style={{ fontSize: 11 }}>Active</span>
                          )}
                        </td>

                        {/* Updated */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle', color: '#64748B', fontSize: 12 }}>
                          {u.updatedAt ? u.updatedAt.split('T')[0] : 'N/A'}
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle', textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            {/* Toggle Active / Disabled */}
                            <button
                              type="button"
                              className="btn-icon"
                              title={isDisabled ? 'Enable User Access' : 'Disable User Access'}
                              onClick={() => handleToggleStatus(u)}
                              style={{ padding: 6, color: isDisabled ? '#10B981' : '#F59E0B' }}
                            >
                              {isDisabled ? <UserCheck size={16} /> : <UserX size={16} />}
                            </button>

                            {/* Edit Role & Link */}
                            <button
                              type="button"
                              className="btn-icon"
                              title="Edit User Role & Employee Link"
                              onClick={() => openEditModal(u)}
                              style={{ padding: 6, color: '#475569' }}
                            >
                              <Edit3 size={16} />
                            </button>

                            {/* Delete User Access */}
                            <button
                              type="button"
                              className="btn-icon"
                              title="Remove User Access"
                              onClick={() => openDeleteModal(u)}
                              style={{ padding: 6, color: '#EF4444' }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Close Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {/* ========================================================================= */}
        {/* SUB-MODAL 1: PROVISION USER ACCESS */}
        {/* ========================================================================= */}
        {showProvisionModal && (
          <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 }}>
            <div className="modal-box" style={{ width: '100%', maxWidth: 520, background: '#FFFFFF', borderRadius: 16, padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: 0 }}>Provision User Access</h3>
                <button type="button" className="btn-icon" onClick={() => setShowProvisionModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: '#1E40AF', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Secure In-App Provisioning:</strong> This creates a user profile document in Firestore. When this user logs in via Firebase Auth using this email address, their role and employee link will automatically take effect without interrupting your active owner session.
                </div>
              </div>

              <form onSubmit={handleProvisionSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Full Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    placeholder="e.g. Ramesh Kumar"
                    value={provName}
                    onChange={(e) => setProvName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Firebase Auth Email Address <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="email"
                    className="input-base"
                    placeholder="ramesh@company.com"
                    value={provEmail}
                    onChange={(e) => setProvEmail(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Role <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <select className="input-base" value={provRole} onChange={(e) => setProvRole(e.target.value)} required>
                      {ROLES_LIST.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Status
                    </label>
                    <select className="input-base" value={provStatus} onChange={(e) => setProvStatus(e.target.value as any)}>
                      <option value="Active">Active</option>
                      <option value="Disabled">Disabled</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Link to Employee Record (Optional)
                  </label>
                  <select className="input-base" value={provEmployeeId} onChange={(e) => setProvEmployeeId(e.target.value)}>
                    <option value="">-- No Employee Link --</option>
                    {liveEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} - {emp.role}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowProvisionModal(false)} disabled={isProvisioning}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isProvisioning}>
                    {isProvisioning ? 'Provisioning...' : 'Provision User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUB-MODAL 2: EDIT USER ROLE & LINK */}
        {/* ========================================================================= */}
        {showEditModal && selectedUser && (
          <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 }}>
            <div className="modal-box" style={{ width: '100%', maxWidth: 520, background: '#FFFFFF', borderRadius: 16, padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: 0 }}>Edit User Account</h3>
                  <div style={{ fontSize: 12, color: '#64748B' }}>{selectedUser.email}</div>
                </div>
                <button type="button" className="btn-icon" onClick={() => setShowEditModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Display Name
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Assigned Role
                    </label>
                    <select className="input-base" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                      {ROLES_LIST.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Status
                    </label>
                    <select className="input-base" value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                      <option value="Active">Active</option>
                      <option value="Disabled">Disabled</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Linked Employee Record
                  </label>
                  <select className="input-base" value={editEmployeeId} onChange={(e) => setEditEmployeeId(e.target.value)}>
                    <option value="">-- No Employee Link --</option>
                    {liveEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} - {emp.role}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)} disabled={isSavingEdit}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSavingEdit}>
                    {isSavingEdit ? 'Saving...' : 'Save User Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUB-MODAL 3: DELETE CONFIRMATION */}
        {/* ========================================================================= */}
        <DeleteConfirmationModal
          isOpen={showDeleteModal}
          title="Remove User Access"
          itemName={selectedUser?.name || selectedUser?.email}
          description={
            selectedUser ? (
              <>
                Are you sure you want to remove user application access for <strong>"{selectedUser.name}"</strong> ({selectedUser.email})?
                <br />
                This will delete their user profile document from Firestore.
                <br />
                <span style={{ fontSize: 11.5, color: '#16A34A', display: 'block', marginTop: 8 }}>
                  ✓ The linked Employee record will remain safely in the Employees directory.
                </span>
              </>
            ) : undefined
          }
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedUser(null);
          }}
        />
      </div>
    </div>
  );
}
