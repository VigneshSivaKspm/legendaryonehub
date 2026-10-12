import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AssetRecord, type AssetCategory, type AssetStatus, type Employee } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  getAllAssets,
  addAsset,
  updateAsset,
  assignAsset,
  unassignAsset,
  deleteAsset,
} from '../services/assetService';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import {
  Box,
  Plus,
  Search,
  Filter,
  Download,
  RefreshCw,
  Edit3,
  Trash2,
  FileText,
  UserCheck,
  UserX,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Users,
  DollarSign,
  Building2,
  Tag,
  ShieldCheck,
  History,
  X,
  Laptop,
  Smartphone,
  Monitor,
  Printer,
  Wifi,
  Armchair,
  HelpCircle,
  Calendar,
} from 'lucide-react';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

const CATEGORIES: AssetCategory[] = [
  'Laptop',
  'Desktop',
  'Mobile',
  'Monitor',
  'Printer',
  'Networking',
  'Furniture',
  'Other',
];

const STATUSES: AssetStatus[] = ['Available', 'Assigned', 'Under Maintenance', 'Retired'];

function getCategoryIcon(cat: AssetCategory) {
  switch (cat) {
    case 'Laptop':
      return <Laptop size={16} />;
    case 'Desktop':
      return <Monitor size={16} />;
    case 'Mobile':
      return <Smartphone size={16} />;
    case 'Monitor':
      return <Monitor size={16} />;
    case 'Printer':
      return <Printer size={16} />;
    case 'Networking':
      return <Wifi size={16} />;
    case 'Furniture':
      return <Armchair size={16} />;
    default:
      return <Box size={16} />;
  }
}

function getStatusBadge(status: AssetStatus) {
  switch (status) {
    case 'Available':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 700,
            background: '#ECFDF5',
            color: '#059669',
            border: '1px solid #A7F3D0',
          }}
        >
          <CheckCircle2 size={13} /> Available
        </span>
      );
    case 'Assigned':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 700,
            background: '#EFF6FF',
            color: '#2563EB',
            border: '1px solid #BFDBFE',
          }}
        >
          <UserCheck size={13} /> Assigned
        </span>
      );
    case 'Under Maintenance':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 700,
            background: '#FFFBEB',
            color: '#D97706',
            border: '1px solid #FDE68A',
          }}
        >
          <AlertTriangle size={13} /> Maintenance
        </span>
      );
    case 'Retired':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 700,
            background: '#F1F5F9',
            color: '#64748B',
            border: '1px solid #CBD5E1',
          }}
        >
          <XCircle size={13} /> Retired
        </span>
      );
  }
}

export default function Assets() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const userName = user?.name || user?.email || 'Admin';

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Filter States
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');

  // Modals
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [viewingAsset, setViewingAsset] = useState<AssetRecord | null>(null);
  const [assigningAsset, setAssigningAsset] = useState<AssetRecord | null>(null);
  const [returningAsset, setReturningAsset] = useState<AssetRecord | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<AssetRecord | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Form State
  const [formState, setFormState] = useState<{
    assetName: string;
    assetCode: string;
    category: AssetCategory;
    brand: string;
    model: string;
    serialNumber: string;
    purchaseDate: string;
    purchaseCost: string | number;
    warrantyExpiry: string;
    status: AssetStatus;
    assignedEmployeeId: string;
    locationDepartment: string;
    vendorSupplier: string;
    notes: string;
  }>({
    assetName: '',
    assetCode: '',
    category: 'Laptop',
    brand: '',
    model: '',
    serialNumber: '',
    purchaseDate: todayStr,
    purchaseCost: 0,
    warrantyExpiry: '',
    status: 'Available',
    assignedEmployeeId: '',
    locationDepartment: '',
    vendorSupplier: '',
    notes: '',
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Assignment Modal Form
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [assignError, setAssignError] = useState('');

  // Return Modal Form
  const [returnStatus, setReturnStatus] = useState<AssetStatus>('Available');
  const [returnNotes, setReturnNotes] = useState('');

  // Firestore Sync on Mount
  useEffect(() => {
    getAllAssets().catch((err) => {
      console.warn('[Assets] Firestore initial fetch warning:', err);
    });
  }, []);

  // Live queries from Dexie DB
  const assets = useLiveQuery(async () => newestFirst(await db.assets.toArray(), (a) => a.purchaseDate), []) || [];
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => e.status !== 'Inactive');
  }, [employees]);

  // Unique Location/Departments for filter
  const locations = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a) => {
      if (a.locationDepartment) set.add(a.locationDepartment);
    });
    return Array.from(set).sort();
  }, [assets]);

  // Calculated Summary KPI Values
  const summary = useMemo(() => {
    let totalValue = 0;
    let assignedCount = 0;
    let availableCount = 0;
    let maintenanceCount = 0;
    let retiredCount = 0;

    assets.forEach((a) => {
      totalValue += Number(a.purchaseCost) || 0;
      if (a.status === 'Assigned') assignedCount++;
      else if (a.status === 'Available') availableCount++;
      else if (a.status === 'Under Maintenance') maintenanceCount++;
      else if (a.status === 'Retired') retiredCount++;
    });

    return {
      totalAssets: assets.length,
      assignedAssets: assignedCount,
      availableAssets: availableCount,
      underMaintenance: maintenanceCount,
      retiredAssets: retiredCount,
      totalAssetValue: totalValue,
    };
  }, [assets]);

  // Filtered Assets List
  const filteredAssets = useMemo(() => {
    return assets
      .filter((a) => {
        if (categoryFilter !== 'All' && a.category !== categoryFilter) return false;
        if (statusFilter !== 'All' && a.status !== statusFilter) return false;
        if (employeeFilter !== 'All' && String(a.assignedEmployeeId) !== String(employeeFilter)) return false;
        if (locationFilter !== 'All' && a.locationDepartment !== locationFilter) return false;

        if (search.trim()) {
          const q = search.toLowerCase().trim();
          const nameMatch = (a.assetName || '').toLowerCase().includes(q);
          const codeMatch = (a.assetCode || '').toLowerCase().includes(q);
          const serialMatch = (a.serialNumber || '').toLowerCase().includes(q);
          const brandMatch = (a.brand || '').toLowerCase().includes(q);
          const empMatch = (a.assignedEmployeeName || '').toLowerCase().includes(q);
          const locMatch = (a.locationDepartment || '').toLowerCase().includes(q);

          if (!nameMatch && !codeMatch && !serialMatch && !brandMatch && !empMatch && !locMatch) {
            return false;
          }
        }

        return true;
      });
  }, [assets, categoryFilter, statusFilter, employeeFilter, locationFilter, search]);

  // Handlers
  const handleRefresh = async () => {
    setIsSyncing(true);
    try {
      await getAllAssets();
      showToast('Assets synced with Firestore.', 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Failed to sync assets.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingAsset(null);
    setFormState({
      assetName: '',
      assetCode: `AST-${Math.floor(1000 + Math.random() * 9000)}`,
      category: 'Laptop',
      brand: '',
      model: '',
      serialNumber: '',
      purchaseDate: todayStr,
      purchaseCost: 0,
      warrantyExpiry: '',
      status: 'Available',
      assignedEmployeeId: '',
      locationDepartment: '',
      vendorSupplier: '',
      notes: '',
    });
    setFormErrors({});
    setShowFormModal(true);
  };

  const handleOpenEditModal = (asset: AssetRecord) => {
    setEditingAsset(asset);
    setFormState({
      assetName: asset.assetName || '',
      assetCode: asset.assetCode || '',
      category: asset.category || 'Laptop',
      brand: asset.brand || '',
      model: asset.model || '',
      serialNumber: asset.serialNumber || '',
      purchaseDate: asset.purchaseDate || todayStr,
      purchaseCost: asset.purchaseCost || 0,
      warrantyExpiry: asset.warrantyExpiry || '',
      status: asset.status || 'Available',
      assignedEmployeeId: String(asset.assignedEmployeeId || ''),
      locationDepartment: asset.locationDepartment || '',
      vendorSupplier: asset.vendorSupplier || '',
      notes: asset.notes || '',
    });
    setFormErrors({});
    setShowFormModal(true);
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};

    if (!formState.assetName.trim()) {
      errs.assetName = 'Asset Name is required.';
    }
    if (!formState.assetCode.trim()) {
      errs.assetCode = 'Asset Code is required.';
    }
    if (!formState.category) {
      errs.category = 'Category is required.';
    }
    if (!formState.status) {
      errs.status = 'Status is required.';
    }
    if (Number(formState.purchaseCost) < 0) {
      errs.purchaseCost = 'Purchase Cost cannot be negative.';
    }
    if (formState.status === 'Assigned' && !formState.assignedEmployeeId) {
      errs.assignedEmployeeId = 'Please select an employee when Status is Assigned.';
    }

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const selectedEmp = activeEmployees.find((emp) => String(emp.id) === String(formState.assignedEmployeeId));
      const empName = selectedEmp ? selectedEmp.name : '';

      if (editingAsset && editingAsset.id) {
        await updateAsset(
          editingAsset.id,
          {
            assetName: formState.assetName.trim(),
            assetCode: formState.assetCode.trim(),
            category: formState.category,
            brand: formState.brand.trim(),
            model: formState.model.trim(),
            serialNumber: formState.serialNumber.trim(),
            purchaseDate: formState.purchaseDate,
            purchaseCost: Number(formState.purchaseCost) || 0,
            warrantyExpiry: formState.warrantyExpiry,
            status: formState.status,
            assignedEmployeeId: formState.status === 'Assigned' ? formState.assignedEmployeeId : '',
            assignedEmployeeName: formState.status === 'Assigned' ? empName : '',
            locationDepartment: formState.locationDepartment.trim(),
            vendorSupplier: formState.vendorSupplier.trim(),
            notes: formState.notes.trim(),
          },
          userName
        );
        showToast(`Asset "${formState.assetName}" updated successfully.`, 'success');
      } else {
        await addAsset(
          {
            assetName: formState.assetName.trim(),
            assetCode: formState.assetCode.trim(),
            category: formState.category,
            brand: formState.brand.trim(),
            model: formState.model.trim(),
            serialNumber: formState.serialNumber.trim(),
            purchaseDate: formState.purchaseDate,
            purchaseCost: Number(formState.purchaseCost) || 0,
            warrantyExpiry: formState.warrantyExpiry,
            status: formState.status,
            assignedEmployeeId: formState.status === 'Assigned' ? formState.assignedEmployeeId : '',
            assignedEmployeeName: formState.status === 'Assigned' ? empName : '',
            locationDepartment: formState.locationDepartment.trim(),
            vendorSupplier: formState.vendorSupplier.trim(),
            notes: formState.notes.trim(),
          },
          userName
        );
        showToast(`Asset "${formState.assetName}" created successfully.`, 'success');
      }

      setShowFormModal(false);
    } catch (err: any) {
      console.error('Save asset failed:', err);
      showToast(err?.message || 'Failed to save asset record.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAssignModal = (asset: AssetRecord) => {
    setAssigningAsset(asset);
    setAssignEmployeeId(String(asset.assignedEmployeeId || ''));
    setAssignNotes('');
    setAssignError('');
  };

  const handleConfirmAssign = async () => {
    if (!assigningAsset || !assigningAsset.id) return;
    if (!assignEmployeeId) {
      setAssignError('Please select an employee to assign this asset to.');
      return;
    }

    const targetEmp = activeEmployees.find((emp) => String(emp.id) === String(assignEmployeeId));
    if (!targetEmp) {
      setAssignError('Selected employee is invalid.');
      return;
    }

    setIsSubmitting(true);
    try {
      await assignAsset(
        assigningAsset.id,
        targetEmp.id || assignEmployeeId,
        targetEmp.name,
        assignNotes.trim(),
        userName
      );
      showToast(`Asset "${assigningAsset.assetName}" assigned to ${targetEmp.name}.`, 'success');
      setAssigningAsset(null);
    } catch (err: any) {
      console.error('Assign asset failed:', err);
      showToast(err?.message || 'Failed to assign asset.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenReturnModal = (asset: AssetRecord) => {
    setReturningAsset(asset);
    setReturnStatus('Available');
    setReturnNotes('');
  };

  const handleConfirmReturn = async () => {
    if (!returningAsset || !returningAsset.id) return;

    setIsSubmitting(true);
    try {
      await unassignAsset(returningAsset.id, returnStatus, returnNotes.trim(), userName);
      showToast(`Asset "${returningAsset.assetName}" unassigned / returned.`, 'success');
      setReturningAsset(null);
    } catch (err: any) {
      console.error('Return asset failed:', err);
      showToast(err?.message || 'Failed to return asset.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!assetToDelete || !assetToDelete.id) return;
    setIsDeleting(true);
    try {
      await deleteAsset(assetToDelete.id);
      showToast(`Asset "${assetToDelete.assetName}" deleted permanently.`, 'success');
      setAssetToDelete(null);
    } catch (err: any) {
      console.error('Delete asset failed:', err);
      showToast(err?.message || 'Failed to delete asset.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    if (filteredAssets.length === 0) {
      showToast('No asset records to export.', 'error');
      return;
    }

    const headers = [
      'Asset Code',
      'Asset Name',
      'Category',
      'Brand',
      'Model',
      'Serial Number',
      'Status',
      'Assigned Employee',
      'Location/Department',
      'Purchase Date',
      'Purchase Cost (INR)',
      'Warranty Expiry',
      'Vendor/Supplier',
      'Notes',
    ];

    const escapeCSV = (val: string | number | undefined | null) => {
      const str = val === undefined || val === null ? '' : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = filteredAssets.map((a) => [
      escapeCSV(a.assetCode),
      escapeCSV(a.assetName),
      escapeCSV(a.category),
      escapeCSV(a.brand),
      escapeCSV(a.model),
      escapeCSV(a.serialNumber),
      escapeCSV(a.status),
      escapeCSV(a.assignedEmployeeName || 'Unassigned'),
      escapeCSV(a.locationDepartment),
      escapeCSV(a.purchaseDate),
      escapeCSV(a.purchaseCost),
      escapeCSV(a.warrantyExpiry),
      escapeCSV(a.vendorSupplier),
      escapeCSV(a.notes),
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `assets_export_${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${filteredAssets.length} asset record(s) to CSV.`, 'success');
  };

  return (
    <div style={{ padding: '24px 24px 40px', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      {/* PAGE HEADER */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#EEF2FF',
              color: '#4F46E5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>
              Asset Management
            </h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: '2px 0 0 0' }}>
              Track hardware, equipment, employee assignments & lifecycle history
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Refresh / Sync Button */}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRefresh}
            disabled={isSyncing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, fontSize: 13 }}
          >
            <RefreshCw size={15} className={isSyncing ? 'spin' : ''} /> Sync
          </button>

          {/* Export CSV */}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportCSV}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, fontSize: 13 }}
          >
            <Download size={15} /> Export CSV
          </button>

          {/* Add Asset Button */}
          <button
            type="button"
            className="btn-primary"
            onClick={handleOpenAddModal}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, fontSize: 13, fontWeight: 600 }}
          >
            <Plus size={16} /> Add Asset
          </button>
        </div>
      </div>

      {/* SUMMARY CARDS (Real calculated values) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        {/* Total Assets */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Total Assets</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#EEF2FF',
                color: '#4F46E5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Box size={16} />
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginTop: 8 }}>
            {summary.totalAssets}
          </div>
        </div>

        {/* Assigned Assets */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Assigned</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#EFF6FF',
                color: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <UserCheck size={16} />
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#2563EB', marginTop: 8 }}>
            {summary.assignedAssets}
          </div>
        </div>

        {/* Available Assets */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Available</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#ECFDF5',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#059669', marginTop: 8 }}>
            {summary.availableAssets}
          </div>
        </div>

        {/* Under Maintenance */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Maintenance</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#FFFBEB',
                color: '#D97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle size={16} />
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#D97706', marginTop: 8 }}>
            {summary.underMaintenance}
          </div>
        </div>

        {/* Retired Assets */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Retired</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#F1F5F9',
                color: '#64748B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <XCircle size={16} />
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#64748B', marginTop: 8 }}>
            {summary.retiredAssets}
          </div>
        </div>

        {/* Total Asset Value */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Total Value</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#F0FDF4',
                color: '#16A34A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <DollarSign size={16} />
            </div>
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#16A34A', marginTop: 8 }}>
            {formatCurrency(summary.totalAssetValue)}
          </div>
        </div>
      </div>

      {/* FILTERS & SEARCH ROW */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 14,
          padding: 16,
          border: '1px solid #E2E8F0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          marginBottom: 20,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
        }}
      >
        {/* Search Input */}
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
          <Search
            size={16}
            color="#94A3B8"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            className="input-field"
            placeholder="Search asset, code, serial number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36, fontSize: 13, height: 38 }}
          />
        </div>

        {/* Category Filter */}
        <div style={{ flex: '0 1 150px', minWidth: 130 }}>
          <select
            className="input-field"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ fontSize: 13, height: 38 }}
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div style={{ flex: '0 1 150px', minWidth: 130 }}>
          <select
            className="input-field"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ fontSize: 13, height: 38 }}
          >
            <option value="All">All Statuses</option>
            {STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        {/* Employee Filter */}
        <div style={{ flex: '0 1 160px', minWidth: 140 }}>
          <select
            className="input-field"
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            style={{ fontSize: 13, height: 38 }}
          >
            <option value="All">All Employees</option>
            {activeEmployees.map((emp) => (
              <option key={emp.id} value={String(emp.id)}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>

        {/* Location Filter */}
        {locations.length > 0 && (
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <select
              className="input-field"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              style={{ fontSize: 13, height: 38 }}
            >
              <option value="All">All Locations</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Clear Filters Button */}
        {(search ||
          categoryFilter !== 'All' ||
          statusFilter !== 'All' ||
          employeeFilter !== 'All' ||
          locationFilter !== 'All') && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSearch('');
              setCategoryFilter('All');
              setStatusFilter('All');
              setEmployeeFilter('All');
              setLocationFilter('All');
            }}
            style={{ fontSize: 12.5, height: 38, padding: '0 12px' }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* TABLE OR ZERO STATE */}
      {assets.length === 0 ? (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 16,
            padding: 48,
            textAlign: 'center',
            border: '1px dashed #CBD5E1',
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: '#F1F5F9',
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
            }}
          >
            <Box size={30} strokeWidth={1.8} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
            No Assets Cataloged Yet
          </h3>
          <p
            style={{
              fontSize: 13.5,
              color: '#64748B',
              maxWidth: 420,
              margin: '0 auto 20px auto',
              lineHeight: 1.5,
            }}
          >
            Track laptops, equipment, and company hardware with full assignment and lifecycle tracking.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={handleOpenAddModal}
            style={{ fontSize: 13.5, padding: '9px 18px' }}
          >
            <Plus size={16} style={{ marginRight: 6 }} /> Add Your First Asset
          </button>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 16,
            padding: 40,
            textAlign: 'center',
            border: '1px solid #E2E8F0',
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
            No Matching Assets Found
          </h3>
          <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
            No assets match your search and filter criteria.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 14,
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                textAlign: 'left',
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: '#F8FAFC',
                    borderBottom: '1px solid #E2E8F0',
                    color: '#475569',
                    fontWeight: 700,
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <th style={{ padding: '14px 16px' }}>Asset</th>
                  <th style={{ padding: '14px 12px' }}>Asset Code</th>
                  <th style={{ padding: '14px 12px' }}>Category</th>
                  <th style={{ padding: '14px 12px' }}>Brand / Model</th>
                  <th style={{ padding: '14px 12px' }}>Assigned To</th>
                  <th style={{ padding: '14px 12px' }}>Purchase Date</th>
                  <th style={{ padding: '14px 12px', textAlign: 'right' }}>Cost</th>
                  <th style={{ padding: '14px 12px' }}>Status</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset, idx) => (
                  <tr
                    key={asset.id || idx}
                    style={{
                      borderBottom: '1px solid #F1F5F9',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Asset Name */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            background: '#EEF2FF',
                            color: '#4F46E5',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {getCategoryIcon(asset.category)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: '#0F172A' }}>{asset.assetName}</div>
                          {asset.locationDepartment && (
                            <div style={{ fontSize: 11, color: '#64748B' }}>
                              {asset.locationDepartment}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Asset Code */}
                    <td style={{ padding: '14px 12px', fontWeight: 700, color: '#334155' }}>
                      {asset.assetCode}
                    </td>

                    {/* Category */}
                    <td style={{ padding: '14px 12px', color: '#475569', fontWeight: 600 }}>
                      {asset.category}
                    </td>

                    {/* Brand / Model */}
                    <td style={{ padding: '14px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#334155' }}>{asset.brand || '-'}</div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>{asset.model || ''}</div>
                    </td>

                    {/* Assigned To */}
                    <td style={{ padding: '14px 12px' }}>
                      {asset.assignedEmployeeName ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              background: '#EFF6FF',
                              color: '#2563EB',
                              fontWeight: 700,
                              fontSize: 10,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {asset.assignedEmployeeName.substring(0, 2).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 600, color: '#0F172A', fontSize: 12.5 }}>
                            {asset.assignedEmployeeName}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#94A3B8', fontSize: 12 }}>Unassigned</span>
                      )}
                    </td>

                    {/* Purchase Date */}
                    <td style={{ padding: '14px 12px', color: '#64748B' }}>
                      {asset.purchaseDate || '-'}
                    </td>

                    {/* Cost */}
                    <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                      {formatCurrency(asset.purchaseCost)}
                    </td>

                    {/* Status Badge */}
                    <td style={{ padding: '14px 12px' }}>{getStatusBadge(asset.status)}</td>

                    {/* Actions */}
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {/* View Details */}
                        <button
                          type="button"
                          onClick={() => setViewingAsset(asset)}
                          style={{
                            border: '1px solid #C7D2FE',
                            background: '#EEF2FF',
                            color: '#4338CA',
                            borderRadius: 6,
                            padding: 6,
                            cursor: 'pointer',
                          }}
                          title="View Details"
                        >
                          <FileText size={14} />
                        </button>

                        {/* Assign / Return */}
                        {asset.status === 'Assigned' ? (
                          <button
                            type="button"
                            onClick={() => handleOpenReturnModal(asset)}
                            style={{
                              border: '1px solid #FDE68A',
                              background: '#FFFBEB',
                              color: '#D97706',
                              borderRadius: 6,
                              padding: 6,
                              cursor: 'pointer',
                            }}
                            title="Unassign / Return Asset"
                          >
                            <UserX size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenAssignModal(asset)}
                            style={{
                              border: '1px solid #BFDBFE',
                              background: '#EFF6FF',
                              color: '#2563EB',
                              borderRadius: 6,
                              padding: 6,
                              cursor: 'pointer',
                            }}
                            title="Assign to Employee"
                          >
                            <UserCheck size={14} />
                          </button>
                        )}

                        {/* Edit */}
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(asset)}
                          style={{
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#475569',
                            borderRadius: 6,
                            padding: 6,
                            cursor: 'pointer',
                          }}
                          title="Edit Asset"
                        >
                          <Edit3 size={14} />
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => setAssetToDelete(asset)}
                          style={{
                            border: '1px solid #FEE2E2',
                            background: '#FEF2F2',
                            color: '#DC2626',
                            borderRadius: 6,
                            padding: 6,
                            cursor: 'pointer',
                          }}
                          title="Delete Asset"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE / EDIT ASSET MODAL */}
      {showFormModal && (
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
          onClick={() => setShowFormModal(false)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 620,
              padding: 28,
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <div>
                <h2 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 17, fontWeight: 700, color: '#1A1F36', margin: 0 }}>
                  {editingAsset ? 'Edit Asset Record' : 'Add New Asset'}
                </h2>
                <p style={{ fontSize: 12.5, color: '#64748B', margin: '2px 0 0 0' }}>
                  {editingAsset
                    ? `Update hardware properties & status for ${editingAsset.assetCode}`
                    : 'Enter equipment information & initial assignment'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveAsset}>
              {/* Asset Name & Asset Code */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Asset Name *
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. MacBook Pro M3 Max"
                    value={formState.assetName}
                    onChange={(e) => setFormState({ ...formState, assetName: e.target.value })}
                    style={{ width: '100%', borderColor: formErrors.assetName ? '#EF4444' : undefined }}
                  />
                  {formErrors.assetName && (
                    <span style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4, display: 'block' }}>
                      {formErrors.assetName}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Asset Code / Asset ID *
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. AST-1002"
                    value={formState.assetCode}
                    onChange={(e) => setFormState({ ...formState, assetCode: e.target.value })}
                    style={{ width: '100%', borderColor: formErrors.assetCode ? '#EF4444' : undefined }}
                  />
                  {formErrors.assetCode && (
                    <span style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4, display: 'block' }}>
                      {formErrors.assetCode}
                    </span>
                  )}
                </div>
              </div>

              {/* Category & Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Category *
                  </label>
                  <select
                    className="input-field"
                    value={formState.category}
                    onChange={(e) => setFormState({ ...formState, category: e.target.value as AssetCategory })}
                    style={{ width: '100%' }}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Status *
                  </label>
                  <select
                    className="input-field"
                    value={formState.status}
                    onChange={(e) => setFormState({ ...formState, status: e.target.value as AssetStatus })}
                    style={{ width: '100%' }}
                  >
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Conditional Employee Assignment */}
              {formState.status === 'Assigned' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Assigned Employee *
                  </label>
                  <select
                    className="input-field"
                    value={formState.assignedEmployeeId}
                    onChange={(e) => setFormState({ ...formState, assignedEmployeeId: e.target.value })}
                    style={{ width: '100%', borderColor: formErrors.assignedEmployeeId ? '#EF4444' : undefined }}
                  >
                    <option value="">Select Employee...</option>
                    {activeEmployees.map((emp) => (
                      <option key={emp.id} value={String(emp.id)}>
                        {emp.name} ({emp.role || 'Staff'})
                      </option>
                    ))}
                  </select>
                  {formErrors.assignedEmployeeId && (
                    <span style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4, display: 'block' }}>
                      {formErrors.assignedEmployeeId}
                    </span>
                  )}
                </div>
              )}

              {/* Brand & Model */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Brand / Manufacturer
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. Apple, Dell, HP"
                    value={formState.brand}
                    onChange={(e) => setFormState({ ...formState, brand: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Model
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. XPS 15 9530"
                    value={formState.model}
                    onChange={(e) => setFormState({ ...formState, model: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Serial Number & Location */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Serial Number
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. C02G45XXQ157"
                    value={formState.serialNumber}
                    onChange={(e) => setFormState({ ...formState, serialNumber: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Location / Department
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. HQ Floor 3 / Engineering"
                    value={formState.locationDepartment}
                    onChange={(e) => setFormState({ ...formState, locationDepartment: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Purchase Date & Purchase Cost */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Purchase Date
                  </label>
                  <input
                    type="date"
                    className="input-field"
                    value={formState.purchaseDate}
                    onChange={(e) => setFormState({ ...formState, purchaseDate: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Purchase Cost (₹)
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    placeholder="0"
                    value={formState.purchaseCost}
                    onChange={(e) => setFormState({ ...formState, purchaseCost: e.target.value })}
                    style={{ width: '100%', borderColor: formErrors.purchaseCost ? '#EF4444' : undefined }}
                  />
                  {formErrors.purchaseCost && (
                    <span style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4, display: 'block' }}>
                      {formErrors.purchaseCost}
                    </span>
                  )}
                </div>
              </div>

              {/* Warranty Expiry & Vendor */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Warranty Expiry Date
                  </label>
                  <input
                    type="date"
                    className="input-field"
                    value={formState.warrantyExpiry}
                    onChange={(e) => setFormState({ ...formState, warrantyExpiry: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                    Vendor / Supplier
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. Croma, Reliance Digital, Apple India"
                    value={formState.vendorSupplier}
                    onChange={(e) => setFormState({ ...formState, vendorSupplier: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                  Notes / Remarks
                </label>
                <textarea
                  className="input-field"
                  rows={2}
                  placeholder="Additional specs, accessories included, condition..."
                  value={formState.notes}
                  onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              {/* Submit Buttons */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowFormModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting
                    ? 'Saving...'
                    : editingAsset
                    ? 'Save Asset Changes'
                    : 'Add Asset to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ASSIGN ASSET MODAL */}
      {assigningAsset && (
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
          onClick={() => setAssigningAsset(null)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 460,
              padding: 24,
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: '#EFF6FF',
                  color: '#2563EB',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px auto',
                }}
              >
                <UserCheck size={26} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: '0 0 4px 0' }}>
                Assign Asset to Employee
              </h3>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                {assigningAsset.assetName} (<strong>{assigningAsset.assetCode}</strong>)
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                Select Employee *
              </label>
              <select
                className="input-field"
                value={assignEmployeeId}
                onChange={(e) => {
                  setAssignEmployeeId(e.target.value);
                  setAssignError('');
                }}
                style={{ width: '100%', borderColor: assignError ? '#EF4444' : undefined }}
              >
                <option value="">Select Employee...</option>
                {activeEmployees.map((emp) => (
                  <option key={emp.id} value={String(emp.id)}>
                    {emp.name} ({emp.role || 'Staff'})
                  </option>
                ))}
              </select>
              {assignError && (
                <span style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4, display: 'block' }}>
                  {assignError}
                </span>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                Handover Notes / Condition Remarks
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Delivered with original charger & laptop bag"
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setAssigningAsset(null)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
                disabled={isSubmitting}
                onClick={handleConfirmAssign}
              >
                {isSubmitting ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RETURN / UNASSIGN ASSET MODAL */}
      {returningAsset && (
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
          onClick={() => setReturningAsset(null)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 460,
              padding: 24,
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: '#FFFBEB',
                  color: '#D97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px auto',
                }}
              >
                <UserX size={26} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: '0 0 4px 0' }}>
                Unassign / Return Asset
              </h3>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                Currently assigned to <strong>{returningAsset.assignedEmployeeName}</strong>
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                New Asset Status *
              </label>
              <select
                className="input-field"
                value={returnStatus}
                onChange={(e) => setReturnStatus(e.target.value as AssetStatus)}
                style={{ width: '100%' }}
              >
                <option value="Available">Available (Ready for reassignment)</option>
                <option value="Under Maintenance">Under Maintenance (Damaged / Needs Repair)</option>
                <option value="Retired">Retired (Decommissioned)</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 }}>
                Return / Inspection Notes
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Returned in good condition, charger missing"
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setReturningAsset(null)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', background: '#D97706', border: 'none' }}
                disabled={isSubmitting}
                onClick={handleConfirmReturn}
              >
                {isSubmitting ? 'Processing...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL */}
      {viewingAsset && (
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
          onClick={() => setViewingAsset(null)}
        >
          <div
            className="modal-box"
            style={{
              width: '100%',
              maxWidth: 600,
              padding: 28,
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                borderBottom: '1px solid #E2E8F0',
                paddingBottom: 16,
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: '#EEF2FF',
                    color: '#4F46E5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {getCategoryIcon(viewingAsset.category)}
                </div>
                <div>
                  <h2 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 17, fontWeight: 700, color: '#1A1F36', margin: 0 }}>
                    {viewingAsset.assetName}
                  </h2>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
                    Code: <strong>{viewingAsset.assetCode}</strong> | Category: {viewingAsset.category}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {getStatusBadge(viewingAsset.status)}
                <button
                  type="button"
                  onClick={() => setViewingAsset(null)}
                  style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 4 }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* DETAILS GRID */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
                background: '#F8FAFC',
                borderRadius: 12,
                padding: 18,
                border: '1px solid #E2E8F0',
                marginBottom: 20,
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>BRAND / MANUFACTURER</div>
                <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                  {viewingAsset.brand || 'N/A'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>MODEL</div>
                <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                  {viewingAsset.model || 'N/A'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>SERIAL NUMBER</div>
                <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                  {viewingAsset.serialNumber || 'N/A'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>ASSIGNED TO</div>
                <div style={{ fontWeight: 700, color: viewingAsset.assignedEmployeeName ? '#2563EB' : '#64748B', marginTop: 2 }}>
                  {viewingAsset.assignedEmployeeName || 'Unassigned'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>LOCATION / DEPT</div>
                <div style={{ fontWeight: 600, color: '#334155', marginTop: 2 }}>
                  {viewingAsset.locationDepartment || 'Main Office'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>VENDOR / SUPPLIER</div>
                <div style={{ fontWeight: 600, color: '#334155', marginTop: 2 }}>
                  {viewingAsset.vendorSupplier || 'N/A'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>PURCHASE DATE</div>
                <div style={{ fontWeight: 600, color: '#334155', marginTop: 2 }}>
                  {viewingAsset.purchaseDate || 'N/A'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>PURCHASE COST</div>
                <div style={{ fontWeight: 800, color: '#16A34A', marginTop: 2 }}>
                  {formatCurrency(viewingAsset.purchaseCost)}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 600 }}>WARRANTY EXPIRY</div>
                <div style={{ fontWeight: 600, color: '#334155', marginTop: 2 }}>
                  {viewingAsset.warrantyExpiry || 'No warranty info'}
                </div>
              </div>
            </div>

            {/* NOTES */}
            {viewingAsset.notes && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                  NOTES / REMARKS
                </div>
                <div
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 13,
                    color: '#334155',
                    lineHeight: 1.5,
                  }}
                >
                  {viewingAsset.notes}
                </div>
              </div>
            )}

            {/* LIFECYCLE HISTORY LOG */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#0F172A',
                  marginBottom: 12,
                }}
              >
                <History size={16} color="#4F46E5" /> Asset Lifecycle & Activity History
              </div>

              {viewingAsset.history && viewingAsset.history.length > 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    maxHeight: 180,
                    overflowY: 'auto',
                  }}
                >
                  {viewingAsset.history.slice().reverse().map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: '#F8FAFC',
                        borderRadius: 8,
                        padding: '10px 12px',
                        borderLeft: '3px solid #4F46E5',
                        fontSize: 12.5,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#0F172A' }}>
                        <span>{item.action}</span>
                        <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>{item.date}</span>
                      </div>
                      {item.notes && <div style={{ color: '#475569', marginTop: 2 }}>{item.notes}</div>}
                      {item.performedBy && (
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                          By: {item.performedBy}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: '#94A3B8', fontStyle: 'italic' }}>
                  No historical activity logged yet.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setViewingAsset(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHARED DELETE CONFIRMATION MODAL */}
      <DeleteConfirmationModal
        isOpen={Boolean(assetToDelete)}
        title="Delete Asset Record"
        itemName={
          assetToDelete
            ? `${assetToDelete.assetName} (${assetToDelete.assetCode} - ${formatCurrency(
                assetToDelete.purchaseCost
              )})`
            : ''
        }
        isDeleting={isDeleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setAssetToDelete(null)}
      />
    </div>
  );
}
