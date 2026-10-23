import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EMPLOYEE_ACCESS_ROLES, type Employee, type EmployeeAccessRole } from '../db/database';
import { newestFirst } from '../utils/sort';
import { addEmployee, updateEmployee, deleteEmployee } from '../services/employeeService';
import { createEmployeeLogin, syncEmployeeAccessRole } from '../services/employeeAccountService';
import { sendFirebasePasswordReset } from '../services/authService';
import { useToast } from '../context/ToastContext';
import { Trash2 } from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

interface EmployeeFormData {
  name: string;
  email: string;
  phone: string;
  joiningDate: string;
  role: string;
  salary: string | number;
  dailySalary: string | number;
  workingHours: string | number;
  employeeId: string;
  status: 'Active' | 'On Leave' | 'Inactive';
  accessRole: EmployeeAccessRole;
  createLogin: boolean;
  password: string;
}

const initialFormState: EmployeeFormData = {
  name: '',
  email: '',
  phone: '',
  joiningDate: new Date().toISOString().split('T')[0],
  role: '',
  salary: '',
  dailySalary: '',
  workingHours: '8',
  employeeId: '',
  status: 'Active',
  accessRole: 'Employee',
  createLogin: true,
  password: '',
};

const accessRoleBadge: Record<EmployeeAccessRole, string> = {
  Employee: 'badge-green',
  'Project Manager': 'badge-blue',
  Accountant: 'badge-purple',
  Admin: 'badge-amber',
};

export default function Employees({ onViewProfile }: { onViewProfile?: (id: string | number) => void } = {}) {
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // Modal & Form state
  const [formData, setFormData] = useState<EmployeeFormData>(initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Live query from Dexie cache (synchronized real-time with Firestore)
  const employees = useLiveQuery(async () => newestFirst(await db.employees.toArray(), (e) => e.joiningDate), []) || [];

  // Derived Summary Metrics from real employee records
  const totalEmployees = employees.length;

  const activeEmployeesCount = useMemo(() => {
    return employees.filter((e) => e.status === 'Active').length;
  }, [employees]);

  const monthlyPayroll = useMemo(() => {
    return employees
      .filter((e) => e.status === 'Active')
      .reduce((sum, e) => sum + (Number(e.salary) || 0), 0);
  }, [employees]);

  const avgSalary = useMemo(() => {
    if (employees.length === 0) return 0;
    const totalSalary = employees.reduce((sum, e) => sum + (Number(e.salary) || 0), 0);
    return Math.round(totalSalary / employees.length);
  }, [employees]);

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const q = search.toLowerCase().trim();
      const name = (e.name || '').toLowerCase();
      const role = (e.role || '').toLowerCase();
      const email = (e.email || '').toLowerCase();
      const empId = (e.employeeId || e.id || '').toString().toLowerCase();

      const matchesSearch =
        !q ||
        name.includes(q) ||
        role.includes(q) ||
        email.includes(q) ||
        empId.includes(q);

      const matchesStatus = statusFilter === 'All' || e.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [employees, search, statusFilter]);

  const handleFieldChange = (field: keyof EmployeeFormData, value: string | boolean) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'dailySalary') {
        const d = Number(value);
        if (!isNaN(d) && d > 0) {
          next.salary = Math.round(d * 26);
        }
      } else if (field === 'salary') {
        const s = Number(value);
        if (!isNaN(s) && s > 0) {
          next.dailySalary = Math.round(s / 26);
        }
      }
      return next;
    });
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleOpenAddModal = () => {
    setEditingEmployee(null);
    // Next "LO-NNN" after the highest one in use, so a deleted employee's number isn't handed out twice
    const highest = employees.reduce((max, e) => {
      const m = /^LO-(\d+)$/i.exec(String(e.employeeId || '').trim());
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const nextEmpNum = `LO-${String(highest + 1).padStart(3, '0')}`;
    setFormData({
      ...initialFormState,
      employeeId: nextEmpNum,
    });
    setErrors({});
    setShowAdd(true);
  };

  const handleOpenEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormData({
      name: emp.name || '',
      email: emp.email || '',
      phone: emp.phone || '',
      joiningDate: emp.joiningDate || new Date().toISOString().split('T')[0],
      role: emp.role || '',
      salary: emp.salary ?? '',
      dailySalary: emp.dailySalary ?? (emp.salary ? Math.round(Number(emp.salary) / 26) : ''),
      workingHours: emp.workingHours ?? 8,
      employeeId: String(emp.employeeId || emp.id || ''),
      status: emp.status || 'Active',
      accessRole: emp.accessRole || 'Employee',
      createLogin: false,
      password: '',
    });
    setErrors({});
    setShowAdd(true);
  };

  const handleCloseAddModal = () => {
    setShowAdd(false);
    setEditingEmployee(null);
    setFormData(initialFormState);
    setErrors({});
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = 'Full Name is required.';
    
    if (!formData.email.trim()) {
      errs.email = 'Email address is required.';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email.trim())) {
        errs.email = 'Enter a valid email address.';
      }
    }

    if (!formData.phone.trim()) {
      errs.phone = 'Phone number is required.';
    } else {
      const phoneRegex = /^\+?[\d\s-]{7,15}$/;
      if (!phoneRegex.test(formData.phone.trim())) {
        errs.phone = 'Enter a valid phone number.';
      }
    }

    if (!formData.role.trim()) errs.role = 'Role is required.';
    
    const sal = Number(formData.salary);
    if (formData.salary === '' || formData.salary === null || formData.salary === undefined || !formData.salary.toString().trim()) {
      errs.salary = 'Monthly Salary is required.';
    } else if (isNaN(sal) || sal <= 0) {
      errs.salary = 'Salary must be a valid positive amount.';
    }

    if (!formData.employeeId.trim()) errs.employeeId = 'Employee ID is required.';

    if (formData.createLogin && formData.password.length < 6) {
      errs.password = 'Login password must be at least 6 characters.';
    }

    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validateForm();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      showToast('Please resolve all validation errors before submitting.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const salaryNum = Number(formData.salary);
      const dailySalaryNum = Number(formData.dailySalary) > 0 ? Number(formData.dailySalary) : (salaryNum > 0 ? Math.round(salaryNum / 26) : 0);
      const workingHoursNum = Number(formData.workingHours) > 0 ? Number(formData.workingHours) : 8;
      const payload = {
        employeeId: formData.employeeId.trim(),
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        joiningDate: formData.joiningDate.trim(),
        role: formData.role.trim(),
        salary: salaryNum,
        dailySalary: dailySalaryNum,
        workingHours: workingHoursNum,
        status: formData.status,
        accessRole: formData.accessRole,
      };

      let savedEmployee: Employee;
      if (editingEmployee && editingEmployee.id) {
        // Save to Firestore first, then Dexie cache
        await updateEmployee(editingEmployee.id, payload);
        savedEmployee = { ...editingEmployee, ...payload };
      } else {
        // Save to Firestore first, then Dexie cache
        const newId = await addEmployee(payload);
        savedEmployee = { ...payload, id: newId };
      }

      if (formData.createLogin) {
        try {
          const result = await createEmployeeLogin(savedEmployee, formData.password, formData.accessRole);
          if (result.uid) await updateEmployee(savedEmployee.id!, { userId: result.uid });
          showToast(`${editingEmployee ? 'Employee updated' : 'Employee added'}. ${result.message}`, 'success');
        } catch (loginErr: any) {
          showToast(`Employee saved, but the login could not be created: ${loginErr?.message || loginErr}`, 'error');
        }
      } else {
        // Keep any existing login profile's role and employee link in step
        try {
          await syncEmployeeAccessRole(savedEmployee);
        } catch (syncErr) {
          console.warn('[Employees] Access role sync warning:', syncErr);
        }
        showToast(editingEmployee ? 'Employee updated successfully!' : 'Employee added successfully!', 'success');
      }

      handleCloseAddModal();
    } catch (err: any) {
      console.error('Failed to save employee:', err);
      showToast(err?.message || 'Failed to save employee.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendPasswordReset = async () => {
    const res = await sendFirebasePasswordReset(formData.email);
    showToast(res.message || (res.success ? 'Password reset email sent.' : 'Could not send reset email.'), res.success ? 'success' : 'error');
  };

  const handleConfirmDelete = async () => {
    if (!employeeToDelete || !employeeToDelete.id) return;
    setIsDeleting(true);
    try {
      // Deletes from Firestore first, then Dexie
      await deleteEmployee(employeeToDelete.id);
      showToast('Employee deleted successfully', 'info');
      setEmployeeToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete employee:', err);
      showToast(err?.message || 'Failed to delete employee', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      showToast('No employee records available to export.', 'info');
      return;
    }

    const headers = ['Employee ID', 'Name', 'Email', 'Job Title / Designation', 'Phone', 'Joining Date', 'Daily Salary (₹)', 'Working Hours', 'Monthly Salary (₹)', 'Status'];
    const csvRows = [
      headers.join(','),
      ...filtered.map((e) =>
        [
          `"${e.employeeId || e.id || ''}"`,
          `"${e.name || ''}"`,
          `"${e.email || ''}"`,
          `"${e.role || ''}"`,
          `"${e.phone || ''}"`,
          `"${e.joiningDate || ''}"`,
          `"${e.dailySalary || (e.salary ? Math.round(Number(e.salary) / 26) : 0)}"`,
          `"${e.workingHours || 8}"`,
          `"${e.salary || 0}"`,
          `"${e.status || 'Active'}"`,
        ].join(',')
      ),
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `employees_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Employees exported to CSV', 'success');
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="page-title">Employees</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>Manage team members and their details</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={handleExportCSV}>
            ⬇ Export
          </button>
          <button className="btn-primary" onClick={handleOpenAddModal}>
            + Add Employee
          </button>
        </div>
      </div>

      {/* Summary Cards derived directly from real employee data */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Employees', value: totalEmployees.toString() },
          { label: 'Active', value: activeEmployeesCount.toString(), color: '#12B76A' },
          { label: 'Monthly Payroll', value: `₹${monthlyPayroll.toLocaleString('en-IN')}`, color: '#3B5BDB' },
          { label: 'Avg Salary', value: `₹${avgSalary.toLocaleString('en-IN')}` },
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color || '#1A1F36', fontFamily: 'Plus Jakarta Sans' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#697586', fontSize: 12 }}>🔍</span>
            <input
              className="input-base"
              style={{ paddingLeft: 30, fontSize: 13 }}
              placeholder="Search employees..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="select-base" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="On Leave">On Leave</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <table className="table-base">
          <thead>
            <tr>
              <th>EMPLOYEE</th>
              <th>EMPLOYEE ID</th>
              <th>JOB TITLE / DESIGNATION</th>
              <th>ACCESS</th>
              <th>PHONE</th>
              <th>JOINING DATE</th>
              <th style={{ textAlign: 'right' }}>SALARY</th>
              <th>STATUS</th>
              <th style={{ textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: '#697586' }}>
                  No employees found. Click "+ Add Employee" to create one.
                </td>
              </tr>
            ) : (
              filtered.map((e) => {
                const initials = (e.name || '')
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'EM';

                const statusBadge =
                  e.status === 'Active'
                    ? 'badge-green'
                    : e.status === 'On Leave'
                    ? 'badge-amber'
                    : 'badge-gray';

                return (
                  <tr key={e.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: '50%',
                            background: '#EEF2FF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#3B5BDB',
                            flexShrink: 0,
                          }}
                        >
                          {initials}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.name}</div>
                          <div style={{ fontSize: 11.5, color: '#697586' }}>{e.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5, color: '#3B5BDB', fontWeight: 600 }}>
                      {e.employeeId || e.id}
                    </td>
                    <td style={{ fontSize: 13 }}>{e.role}</td>
                    <td>
                      <span className={`badge ${accessRoleBadge[e.accessRole || 'Employee']}`}>{e.accessRole || 'Employee'}</span>
                      {e.userId && (
                        <div style={{ fontSize: 10.5, color: '#12B76A', marginTop: 3, fontWeight: 600 }}>● Login enabled</div>
                      )}
                    </td>
                    <td style={{ fontSize: 13, color: '#697586' }}>{e.phone}</td>
                    <td style={{ fontSize: 13, color: '#697586' }}>{e.joiningDate || '—'}</td>
                    <td style={{ textAlign: 'right', fontSize: 13 }}>
                      <div style={{ fontWeight: 600 }}>₹{(Number(e.salary) || 0).toLocaleString('en-IN')}<span style={{ fontSize: 11, fontWeight: 500, color: '#697586' }}>/mo</span></div>
                      <div style={{ fontSize: 11.5, color: '#697586', marginTop: 2 }}>
                        ₹{(Number(e.dailySalary) || (Number(e.salary) ? Math.round(Number(e.salary) / 26) : 0)).toLocaleString('en-IN')}/day · {e.workingHours || 8}h
                      </div>
                      <div style={{ fontSize: 10.5, color: '#3B5BDB', fontWeight: 600 }}>
                        ₹{(Math.round(((Number(e.dailySalary) || (Number(e.salary) ? Math.round(Number(e.salary) / 26) : 0)) / (e.workingHours || 8)) * 100) / 100).toFixed(0)}/hr
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${statusBadge}`}>{e.status || 'Active'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {onViewProfile && e.id !== undefined && (
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 8px' }}
                            onClick={() => onViewProfile(e.id!)}
                          >
                            Profile
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 8px' }}
                          onClick={() => handleOpenEditModal(e)}
                        >
                          Edit
                        </button>
                        {e.id && (
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                            onClick={() => setEmployeeToDelete(e)}
                          >
                            <Trash2 size={13} style={{ marginRight: 4 }} />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Employee Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={handleCloseAddModal}>
          <div className="modal-box" style={{ width: 560, padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17 }}>
                {editingEmployee ? 'Edit Employee' : 'Add New Employee'}
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }}
                onClick={handleCloseAddModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Full Name */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Full Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.name ? '#EF4444' : undefined }}
                    placeholder="e.g. Kavitha R"
                    value={formData.name}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                  />
                  {errors.name && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.name}</div>}
                </div>

                {/* Email */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Email <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    type="email"
                    style={{ width: '100%', borderColor: errors.email ? '#EF4444' : undefined }}
                    placeholder="e.g. kavitha@company.com"
                    value={formData.email}
                    onChange={(e) => handleFieldChange('email', e.target.value)}
                  />
                  {errors.email && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.email}</div>}
                </div>

                {/* Phone */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Phone <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.phone ? '#EF4444' : undefined }}
                    placeholder="e.g. 9876543210"
                    value={formData.phone}
                    onChange={(e) => handleFieldChange('phone', e.target.value)}
                  />
                  {errors.phone && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.phone}</div>}
                </div>

                {/* Joining Date */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Joining Date
                  </label>
                  <input
                    className="input-base"
                    type="date"
                    style={{ width: '100%' }}
                    value={formData.joiningDate}
                    onChange={(e) => handleFieldChange('joiningDate', e.target.value)}
                  />
                </div>

                {/* Role */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Job Title / Designation <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    style={{ width: '100%', borderColor: errors.role ? '#EF4444' : undefined }}
                    placeholder="e.g. Full Stack Developer"
                    value={formData.role}
                    onChange={(e) => handleFieldChange('role', e.target.value)}
                  />
                  {errors.role && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.role}</div>}
                </div>

                {/* Salary & Working Hours Configuration */}
                <div style={{ gridColumn: 'span 2', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1E293B', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Salary & Working Hours Schedule</span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#64748B' }}>Auto-synced</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                        Daily Salary (₹)
                      </label>
                      <input
                        className="input-base"
                        type="number"
                        min="0"
                        style={{ width: '100%' }}
                        placeholder="e.g. 1000"
                        value={formData.dailySalary}
                        onChange={(e) => handleFieldChange('dailySalary', e.target.value)}
                      />
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Per working day rate</div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                        Working Hours / Day
                      </label>
                      <input
                        className="input-base"
                        type="number"
                        min="1"
                        max="24"
                        step="0.5"
                        style={{ width: '100%' }}
                        placeholder="8"
                        value={formData.workingHours}
                        onChange={(e) => handleFieldChange('workingHours', e.target.value)}
                      />
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Shift hours (default 8h)</div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                        Monthly Salary (₹) <span style={{ color: '#EF4444' }}>*</span>
                      </label>
                      <input
                        className="input-base"
                        type="number"
                        min="1"
                        style={{ width: '100%', borderColor: errors.salary ? '#EF4444' : undefined }}
                        placeholder="e.g. 26000"
                        value={formData.salary}
                        onChange={(e) => handleFieldChange('salary', e.target.value)}
                      />
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>26 days basis</div>
                    </div>
                  </div>

                  {errors.salary && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 6 }}>{errors.salary}</div>}

                  {/* Rate breakdown card */}
                  {(() => {
                    const dSal = Number(formData.dailySalary) || (Number(formData.salary) ? Math.round(Number(formData.salary) / 26) : 0);
                    const wHrs = Number(formData.workingHours) || 8;
                    const hRate = wHrs > 0 ? dSal / wHrs : 0;
                    if (dSal <= 0) return null;
                    return (
                      <div style={{ marginTop: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#1E40AF', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          Hourly rate: <strong style={{ fontSize: 13, color: '#1D4ED8' }}>₹{hRate.toFixed(2)}/hr</strong>
                          <span style={{ color: '#3B82F6' }}> (₹{dSal.toLocaleString('en-IN')}/day ÷ {wHrs} hrs)</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#2563EB', fontWeight: 500 }}>
                          ✓ Calculates strictly on working hours less break & lunch
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Employee ID */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Employee ID <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    disabled={!!editingEmployee}
                    style={{
                      width: '100%',
                      borderColor: errors.employeeId ? '#EF4444' : undefined,
                      backgroundColor: editingEmployee ? '#F8FAFC' : undefined,
                      cursor: editingEmployee ? 'not-allowed' : undefined,
                    }}
                    placeholder="e.g. LO-001"
                    value={formData.employeeId}
                    onChange={(e) => handleFieldChange('employeeId', e.target.value)}
                  />
                  {errors.employeeId && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.employeeId}</div>}
                </div>

                {/* Status */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Status
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.status}
                    onChange={(e) => handleFieldChange('status', e.target.value as any)}
                  >
                    <option value="Active">Active</option>
                    <option value="On Leave">On Leave</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                {/* Access Role */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                    Access Role <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%' }}
                    value={formData.accessRole}
                    onChange={(e) => handleFieldChange('accessRole', e.target.value)}
                  >
                    {EMPLOYEE_ACCESS_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11.5, color: '#697586', marginTop: 4 }}>
                    Controls what this person sees after signing in. Project Managers are listed in the Project Manager dropdown on projects.
                  </div>
                </div>
              </div>

              {/* Login account */}
              <div style={{ marginTop: 16, padding: 14, border: '1px solid #E5E9F2', borderRadius: 10, background: '#F8F9FC' }}>
                {editingEmployee?.userId ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1F36' }}>Login enabled</div>
                      <div style={{ fontSize: 11.5, color: '#697586' }}>Signs in with {formData.email}. Role changes apply on next sign-in.</div>
                    </div>
                    <button type="button" className="btn-secondary" style={{ fontSize: 12 }} onClick={handleSendPasswordReset}>
                      Send Password Reset
                    </button>
                  </div>
                ) : (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#1A1F36', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.createLogin}
                        onChange={(e) => handleFieldChange('createLogin', e.target.checked)}
                      />
                      Create login for this employee
                    </label>
                    <div style={{ fontSize: 11.5, color: '#697586', margin: '4px 0 0 24px' }}>
                      They sign in with their email to see their own tasks, attendance, leave and salary.
                    </div>
                    {formData.createLogin && (
                      <div style={{ marginTop: 10 }}>
                        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>
                          Login Password <span style={{ color: '#EF4444' }}>*</span>
                        </label>
                        <input
                          className="input-base"
                          type="text"
                          autoComplete="new-password"
                          style={{ width: '100%', borderColor: errors.password ? '#EF4444' : undefined }}
                          placeholder="At least 6 characters (share it with the employee)"
                          value={formData.password}
                          onChange={(e) => handleFieldChange('password', e.target.value)}
                        />
                        {errors.password && <div style={{ color: '#EF4444', fontSize: 11.5, marginTop: 4 }}>{errors.password}</div>}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={handleCloseAddModal} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : editingEmployee ? 'Update Employee' : 'Add Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {employeeToDelete && (
        <DeleteConfirmationModal
          isOpen={!!employeeToDelete}
          title="Delete Employee"
          itemName={`${employeeToDelete.name} (${employeeToDelete.employeeId || employeeToDelete.id})`}
          description={
            <>
              Are you sure you want to delete employee <strong style={{ color: '#1A1F36' }}>"{employeeToDelete.name}"</strong>? This action will permanently remove the record from Firestore and cannot be undone.
            </>
          }
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={() => setEmployeeToDelete(null)}
        />
      )}
    </div>
  );
}
