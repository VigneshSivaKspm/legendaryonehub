import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  FileText,
  Upload,
  Eye,
  Download,
  Edit3,
  Trash2,
  Filter,
  Search,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  HardDrive,
  X,
  RefreshCw,
  Calendar,
  Building2,
  User,
  Briefcase,
  Folder,
  FileSpreadsheet,
  Image as ImageIcon,
  ExternalLink,
  ShieldCheck,
  Tag,
  FileCheck,
  Sparkles,
} from 'lucide-react';
import { db, type DocumentRecord, type DocumentType, type DocumentCategory, type DocumentRelatedTo, type DocumentStatus } from '../db/database';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import {
  getDriveConfig,
  getDriveToken,
  isDriveConnected,
  disconnectDrive,
  loadGoogleIdentity,
  saveDriveClientId,
  type DriveConfig,
} from '../services/googleDriveService';
import { isOwnerOrAdminRole } from '../services/authService';
import {
  getAllDocuments,
  uploadAndAddDocument,
  updateDocumentMetadata,
  replaceDocumentFile,
  deleteDocument,
  openDocumentFile,
  syncDocumentsFromDrive,
  formatFileSize,
  deriveDocumentStatus,
  validateDocumentFile,
} from '../services/documentService';

const DOCUMENT_TYPES: DocumentType[] = [
  'Agreement',
  'Invoice',
  'Quotation',
  'Contract',
  'Employee Document',
  'ID Proof',
  'Tax / GST',
  'Banking',
  'Project File',
  'Certificate',
  'Other',
];

const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'Legal & Compliance',
  'Financial & Tax',
  'Human Resources',
  'Operations & Projects',
  'Client & Sales',
  'Administrative',
  'Other',
];

const RELATED_TO_OPTIONS: DocumentRelatedTo[] = ['Client', 'Project', 'Employee', 'Business', 'Other'];

export default function Documents() {
  const { user } = useAuth();
  const { showToast } = useToast();

  // Reactive Dexie Live Queries
  const liveDocuments = useLiveQuery(() => db.documents.toArray(), []) || [];
  const liveClients = useLiveQuery(() => db.clients.toArray(), []) || [];
  const liveProjects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const liveEmployees = useLiveQuery(() => db.employees.toArray(), []) || [];

  // Loading & Sync States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Search & Filters
  const [searchVal, setSearchVal] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterRelatedTo, setFilterRelatedTo] = useState<string>('All');

  // Modal States
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showReplaceModal, setShowReplaceModal] = useState<boolean>(false);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);

  // Active Selected Document
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);

  // Form States for Upload
  const [uploadTitle, setUploadTitle] = useState<string>('');
  const [uploadType, setUploadType] = useState<DocumentType>('Agreement');
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>('Legal & Compliance');
  const [uploadRelatedTo, setUploadRelatedTo] = useState<DocumentRelatedTo>('Other');
  const [uploadRelatedRecordId, setUploadRelatedRecordId] = useState<string>('');
  const [uploadRelatedRecordName, setUploadRelatedRecordName] = useState<string>('');
  const [uploadIssueDate, setUploadIssueDate] = useState<string>('');
  const [uploadExpiryDate, setUploadExpiryDate] = useState<string>('');
  const [uploadNotes, setUploadNotes] = useState<string>('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Form States for Edit Metadata
  const [editTitle, setEditTitle] = useState<string>('');
  const [editType, setEditType] = useState<DocumentType>('Agreement');
  const [editCategory, setEditCategory] = useState<DocumentCategory>('Legal & Compliance');
  const [editRelatedTo, setEditRelatedTo] = useState<DocumentRelatedTo>('Other');
  const [editRelatedRecordId, setEditRelatedRecordId] = useState<string>('');
  const [editRelatedRecordName, setEditRelatedRecordName] = useState<string>('');
  const [editIssueDate, setEditIssueDate] = useState<string>('');
  const [editExpiryDate, setEditExpiryDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Form States for Replace File
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [isReplacing, setIsReplacing] = useState<boolean>(false);

  // Form State for Deleting
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Google Drive connection (browser sign-in to the company Google account)
  const [driveCfg, setDriveCfg] = useState<DriveConfig>({});
  const [driveConnected, setDriveConnected] = useState<boolean>(() => isDriveConnected());
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [showClientIdForm, setShowClientIdForm] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');

  useEffect(() => {
    getDriveConfig().then(setDriveCfg).catch(() => {});
    // Preload Google sign-in so the consent popup opens straight from the click
    loadGoogleIdentity().catch(() => {});
  }, []);

  const connectDrive = async (): Promise<boolean> => {
    if (isDriveConnected()) return true;
    setIsConnectingDrive(true);
    try {
      await getDriveToken();
      setDriveConnected(true);
      setDriveCfg(await getDriveConfig(true));
      showToast('Google Drive connected.', 'success');
      return true;
    } catch (err: any) {
      if (err?.message === 'DRIVE_NOT_CONFIGURED') {
        setShowClientIdForm(true);
        showToast('Add the Google OAuth Client ID to connect Google Drive.', 'info');
      } else {
        showToast(`Google Drive: ${err?.message || err}`, 'error');
      }
      return false;
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const handleSaveClientId = async () => {
    if (!clientIdInput.trim().endsWith('.apps.googleusercontent.com')) {
      showToast('That does not look like an OAuth Client ID (it ends with .apps.googleusercontent.com).', 'error');
      return;
    }
    try {
      await saveDriveClientId(clientIdInput);
      setDriveCfg(await getDriveConfig(true));
      setShowClientIdForm(false);
      showToast('Client ID saved. Click "Connect Google Drive".', 'success');
    } catch (err: any) {
      showToast(`Could not save Client ID: ${err?.message || err}`, 'error');
    }
  };

  // Initial Fetch on mount
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        await getAllDocuments();
      } catch (err: any) {
        console.warn('Initial documents fetch warning:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const [isDriveSyncing, setIsDriveSyncing] = useState(false);
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);

  const handleOpenFile = async (docItem: DocumentRecord, mode: 'view' | 'download') => {
    if (docItem.driveFileId && !(await connectDrive())) return;
    setOpeningId(String(docItem.id));
    try {
      await openDocumentFile(docItem, mode);
    } catch (err: any) {
      showToast(`Could not ${mode === 'view' ? 'open' : 'download'} file: ${err?.message || err}`, 'error');
    } finally {
      setOpeningId(null);
    }
  };

  const handleSyncFromDrive = async () => {
    if (!(await connectDrive())) return;
    setIsDriveSyncing(true);
    try {
      const { imported, folderLink } = await syncDocumentsFromDrive(user || undefined);
      setDriveFolderLink(folderLink);
      showToast(
        imported ? `Imported ${imported} new file${imported === 1 ? '' : 's'} from Google Drive.` : 'Catalog is up to date with Google Drive.',
        'success'
      );
    } catch (err: any) {
      showToast(`Drive sync failed: ${err?.message || err}`, 'error');
    } finally {
      setIsDriveSyncing(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setIsSyncing(true);
      await getAllDocuments();
      showToast('Document catalog refreshed from Firestore.', 'info');
    } catch (err: any) {
      showToast(`Refresh error: ${err?.message || err}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Derive Dynamic Summary Metrics
  const summary = useMemo(() => {
    let total = liveDocuments.length;
    let active = 0;
    let expiringSoon = 0;
    let expired = 0;
    let totalBytes = 0;

    liveDocuments.forEach((doc) => {
      const st = deriveDocumentStatus(doc.expiryDate);
      if (st === 'Active' || st === 'No Expiry') active++;
      else if (st === 'Expiring Soon') expiringSoon++;
      else if (st === 'Expired') expired++;

      totalBytes += doc.fileSize || 0;
    });

    return {
      total,
      active,
      expiringSoon,
      expired,
      totalStorageFormatted: formatFileSize(totalBytes),
    };
  }, [liveDocuments]);

  // Filtered Documents
  const filteredDocuments = useMemo(() => {
    const q = searchVal.trim().toLowerCase();
    return liveDocuments.filter((d) => {
      const derivedStatus = deriveDocumentStatus(d.expiryDate);

      // Search match
      if (q) {
        const titleMatch = d.title.toLowerCase().includes(q);
        const fileMatch = d.fileName.toLowerCase().includes(q);
        const notesMatch = (d.notes || '').toLowerCase().includes(q);
        const relatedMatch = (d.relatedRecordName || '').toLowerCase().includes(q);
        if (!titleMatch && !fileMatch && !notesMatch && !relatedMatch) {
          return false;
        }
      }

      // Type filter
      if (filterType !== 'All' && d.type !== filterType) return false;

      // Category filter
      if (filterCategory !== 'All' && d.category !== filterCategory) return false;

      // Status filter
      if (filterStatus !== 'All' && derivedStatus !== filterStatus) return false;

      // Related filter
      if (filterRelatedTo !== 'All' && d.relatedTo !== filterRelatedTo) return false;

      return true;
    });
  }, [liveDocuments, searchVal, filterType, filterCategory, filterStatus, filterRelatedTo]);

  // Handle File Input Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isReplace: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const val = validateDocumentFile(file);
    if (!val.valid) {
      showToast(val.error || 'Invalid file', 'error');
      e.target.value = '';
      if (isReplace) setReplaceFile(null);
      else setUploadFile(null);
      return;
    }

    if (isReplace) {
      setReplaceFile(file);
    } else {
      setUploadFile(file);
      // Auto fill title if empty
      if (!uploadTitle.trim()) {
        const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        setUploadTitle(nameWithoutExt.replace(/[-_]/g, ' '));
      }
    }
  };

  // Open Upload Modal (files go to Google Drive, so connect first)
  const openUploadModal = async () => {
    if (!(await connectDrive())) return;
    setUploadTitle('');
    setUploadType('Agreement');
    setUploadCategory('Legal & Compliance');
    setUploadRelatedTo('Other');
    setUploadRelatedRecordId('');
    setUploadRelatedRecordName('');
    setUploadIssueDate('');
    setUploadExpiryDate('');
    setUploadNotes('');
    setUploadFile(null);
    setShowUploadModal(true);
  };

  // Submit Upload Form
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle.trim()) {
      showToast('Please enter a Document Title.', 'error');
      return;
    }
    if (!uploadFile) {
      showToast('Please select a file to upload.', 'error');
      return;
    }

    try {
      setIsUploading(true);
      await uploadAndAddDocument(
        uploadFile,
        {
          title: uploadTitle,
          type: uploadType,
          category: uploadCategory,
          relatedTo: uploadRelatedTo,
          relatedRecordId: uploadRelatedRecordId,
          relatedRecordName: uploadRelatedRecordName,
          issueDate: uploadIssueDate,
          expiryDate: uploadExpiryDate,
          notes: uploadNotes,
        },
        user || undefined
      );

      showToast('Document uploaded successfully!', 'success');
      setShowUploadModal(false);
    } catch (err: any) {
      console.error('Upload submission error:', err);
      showToast(`Upload failed: ${err?.message || err}`, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (doc: DocumentRecord) => {
    setSelectedDoc(doc);
    setEditTitle(doc.title);
    setEditType(doc.type);
    setEditCategory(doc.category);
    setEditRelatedTo(doc.relatedTo || 'Other');
    setEditRelatedRecordId(doc.relatedRecordId || '');
    setEditRelatedRecordName(doc.relatedRecordName || '');
    setEditIssueDate(doc.issueDate || '');
    setEditExpiryDate(doc.expiryDate || '');
    setEditNotes(doc.notes || '');
    setShowEditModal(true);
  };

  // Submit Edit Form
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc?.id) return;
    if (!editTitle.trim()) {
      showToast('Document Title is required.', 'error');
      return;
    }

    try {
      setIsSavingEdit(true);
      await updateDocumentMetadata(selectedDoc.id, {
        title: editTitle,
        type: editType,
        category: editCategory,
        relatedTo: editRelatedTo,
        relatedRecordId: editRelatedRecordId,
        relatedRecordName: editRelatedRecordName,
        issueDate: editIssueDate,
        expiryDate: editExpiryDate,
        notes: editNotes,
      });

      showToast('Document metadata updated.', 'success');
      setShowEditModal(false);
      setSelectedDoc(null);
    } catch (err: any) {
      showToast(`Update error: ${err?.message || err}`, 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Open Replace Modal
  const openReplaceModal = (doc: DocumentRecord) => {
    setSelectedDoc(doc);
    setReplaceFile(null);
    setShowReplaceModal(true);
  };

  // Submit Replace File
  const handleReplaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc?.id) return;
    if (!(await connectDrive())) return;
    if (!replaceFile) {
      showToast('Please select a new replacement file.', 'error');
      return;
    }

    try {
      setIsReplacing(true);
      await replaceDocumentFile(selectedDoc.id, replaceFile, {}, user || undefined);
      showToast('Document file replaced successfully!', 'success');
      setShowReplaceModal(false);
      setSelectedDoc(null);
    } catch (err: any) {
      showToast(`Replace error: ${err?.message || err}`, 'error');
    } finally {
      setIsReplacing(false);
    }
  };

  // Open Delete Confirmation
  const openDeleteModal = (doc: DocumentRecord) => {
    setSelectedDoc(doc);
    setShowDeleteModal(true);
  };

  // Execute Delete
  const handleConfirmDelete = async () => {
    if (!selectedDoc?.id) return;
    if (selectedDoc.driveFileId && !(await connectDrive())) return;
    try {
      setIsDeleting(true);
      await deleteDocument(selectedDoc.id);
      showToast('Document deleted permanently.', 'success');
      setShowDeleteModal(false);
      setSelectedDoc(null);
    } catch (err: any) {
      showToast(`Delete failed: ${err?.message || err}`, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    if (filteredDocuments.length === 0) {
      showToast('No document records to export.', 'info');
      return;
    }

    const headers = [
      'Document Title',
      'Type',
      'Category',
      'Related To',
      'Related Record Name',
      'File Name',
      'File Size (Bytes)',
      'Issue Date',
      'Expiry Date',
      'Status',
      'Uploaded Date',
      'Download URL',
    ];

    const rows = filteredDocuments.map((d) => [
      `"${(d.title || '').replace(/"/g, '""')}"`,
      `"${(d.type || '').replace(/"/g, '""')}"`,
      `"${(d.category || '').replace(/"/g, '""')}"`,
      `"${(d.relatedTo || '').replace(/"/g, '""')}"`,
      `"${(d.relatedRecordName || '').replace(/"/g, '""')}"`,
      `"${(d.fileName || '').replace(/"/g, '""')}"`,
      d.fileSize || 0,
      `"${d.issueDate || ''}"`,
      `"${d.expiryDate || ''}"`,
      `"${deriveDocumentStatus(d.expiryDate)}"`,
      `"${d.createdAt ? d.createdAt.split('T')[0] : ''}"`,
      `"${(d.fileUrl || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Documents_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${filteredDocuments.length} document records to CSV.`, 'success');
  };

  // Icon Helper for File Types
  const getFileIcon = (fileType: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf' || fileType.includes('pdf')) {
      return <FileText size={18} style={{ color: '#EF4444' }} />;
    }
    if (['doc', 'docx'].includes(ext) || fileType.includes('word')) {
      return <FileText size={18} style={{ color: '#2563EB' }} />;
    }
    if (['xls', 'xlsx', 'csv'].includes(ext) || fileType.includes('excel') || fileType.includes('csv')) {
      return <FileSpreadsheet size={18} style={{ color: '#10B981' }} />;
    }
    if (['jpg', 'jpeg', 'png'].includes(ext) || fileType.includes('image')) {
      return <ImageIcon size={18} style={{ color: '#8B5CF6' }} />;
    }
    return <FileCheck size={18} style={{ color: '#64748B' }} />;
  };

  // Status Badge Rendering
  const renderStatusBadge = (expiryDate?: string) => {
    const status = deriveDocumentStatus(expiryDate);
    if (status === 'Active') {
      return <span className="badge badge-green">Active</span>;
    }
    if (status === 'Expiring Soon') {
      return <span className="badge badge-yellow">Expiring Soon</span>;
    }
    if (status === 'Expired') {
      return <span className="badge badge-red">Expired</span>;
    }
    return <span className="badge badge-blue">No Expiry</span>;
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1E293B', letterSpacing: '-0.02em', margin: 0 }}>
              Document Management
            </h1>
            <span className="badge badge-blue" style={{ fontSize: 11, fontWeight: 600 }}>
              Google Drive Storage
            </span>
          </div>
          <p style={{ fontSize: 13.5, color: '#64748B', margin: 0 }}>
            Centralized, secure cloud document vault for agreements, compliance, invoices, and business records.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRefresh}
            disabled={isSyncing}
            style={{ fontSize: 13, gap: 6 }}
            title="Sync latest data from Cloud Firestore"
          >
            <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync Catalog'}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleSyncFromDrive}
            disabled={isDriveSyncing}
            style={{ fontSize: 13, gap: 6 }}
            title="Import files added directly to the company Google Drive folder"
          >
            <RefreshCw size={15} className={isDriveSyncing ? 'animate-spin' : ''} />
            {isDriveSyncing ? 'Fetching...' : 'Fetch from Drive'}
          </button>

          {(driveFolderLink || driveCfg.folderLink) && (
            <a
              href={driveFolderLink || driveCfg.folderLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ fontSize: 13, textDecoration: 'none' }}
            >
              Open Drive Folder
            </a>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportCSV}
            style={{ fontSize: 13, gap: 6 }}
          >
            <Download size={15} />
            Export CSV
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={openUploadModal}
            style={{ fontSize: 13, gap: 6 }}
          >
            <Plus size={16} strokeWidth={2.5} />
            Upload Document
          </button>
        </div>
      </div>

      {/* Google Drive connection */}
      <div
        className="card"
        style={{ padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
      >
        <span className={`badge ${driveConnected ? 'badge-green' : 'badge-amber'}`}>
          {driveConnected ? 'Google Drive connected' : 'Google Drive not connected'}
        </span>
        <span style={{ fontSize: 12.5, color: '#697586' }}>
          {driveCfg.connectedEmail
            ? `Files are stored in ${driveCfg.connectedEmail}'s Drive. Sign in with that account to upload or open files.`
            : 'Connect the company Google account once; uploads then go to its "Legendary One Documents" folder.'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {isOwnerOrAdminRole(user?.role) && !import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <button type="button" className="btn-secondary" style={{ fontSize: 12.5 }} onClick={() => setShowClientIdForm((v) => !v)}>
              Drive Settings
            </button>
          )}
          {driveConnected ? (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 12.5 }}
              onClick={() => {
                disconnectDrive();
                setDriveConnected(false);
              }}
            >
              Disconnect
            </button>
          ) : (
            <button type="button" className="btn-primary" style={{ fontSize: 12.5 }} onClick={connectDrive} disabled={isConnectingDrive}>
              {isConnectingDrive ? 'Connecting...' : 'Connect Google Drive'}
            </button>
          )}
        </div>
        {showClientIdForm && (
          <div style={{ flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #E5E9F2', paddingTop: 10 }}>
            <input
              className="input-base"
              style={{ flex: '1 1 360px', fontSize: 13 }}
              placeholder={driveCfg.clientId || 'OAuth Client ID, e.g. 1234-abc.apps.googleusercontent.com'}
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
            />
            <button type="button" className="btn-primary" style={{ fontSize: 12.5 }} onClick={handleSaveClientId}>
              Save Client ID
            </button>
            <div style={{ flexBasis: '100%', fontSize: 11.5, color: '#697586', lineHeight: 1.5 }}>
              Google Cloud Console → enable Google Drive API → OAuth consent screen (add the company Gmail as a test user) →
              Credentials → OAuth client ID (Web application) with this site's URL under Authorised JavaScript origins.
            </div>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="stat-card" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Documents
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Folder size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{summary.total}</div>
          <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 4 }}>
            {liveDocuments.filter((d) => d.driveFileId).length} in Google Drive
          </div>
        </div>

        <div className="stat-card" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Active Documents
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#ECFDF5', color: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{summary.active}</div>
          <div style={{ fontSize: 11.5, color: '#10B981', marginTop: 4 }}>Valid & non-expired</div>
        </div>

        <div className="stat-card" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Expiring Soon
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FEF3C7', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{summary.expiringSoon}</div>
          <div style={{ fontSize: 11.5, color: '#D97706', marginTop: 4 }}>Expiring in next 30 days</div>
        </div>

        <div className="stat-card" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Expired
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FEE2E2', color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{summary.expired}</div>
          <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>Requires renewal or action</div>
        </div>

        <div className="stat-card" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Storage Used
            </span>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#F3E8FF', color: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HardDrive size={18} />
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{summary.totalStorageFormatted}</div>
          <div style={{ fontSize: 11.5, color: '#8B5CF6', marginTop: 4 }}>Total file sizes</div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 14,
          padding: 16,
          marginBottom: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
        }}
      >
        {/* Search Input */}
        <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            type="text"
            className="input-base"
            placeholder="Search by title, filename, notes, or related entity..."
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            style={{ paddingLeft: 36, fontSize: 13, background: '#F8FAFC' }}
          />
        </div>

        {/* Type Filter */}
        <div style={{ minWidth: 140 }}>
          <select
            className="input-base"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{ fontSize: 13, background: '#F8FAFC' }}
          >
            <option value="All">All Types</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Category Filter */}
        <div style={{ minWidth: 150 }}>
          <select
            className="input-base"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{ fontSize: 13, background: '#F8FAFC' }}
          >
            <option value="All">All Categories</option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div style={{ minWidth: 130 }}>
          <select
            className="input-base"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ fontSize: 13, background: '#F8FAFC' }}
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Expiring Soon">Expiring Soon</option>
            <option value="Expired">Expired</option>
            <option value="No Expiry">No Expiry</option>
          </select>
        </div>

        {/* Related To Filter */}
        <div style={{ minWidth: 130 }}>
          <select
            className="input-base"
            value={filterRelatedTo}
            onChange={(e) => setFilterRelatedTo(e.target.value)}
            style={{ fontSize: 13, background: '#F8FAFC' }}
          >
            <option value="All">All Entities</option>
            {RELATED_TO_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Clear Filters Button */}
        {(searchVal || filterType !== 'All' || filterCategory !== 'All' || filterStatus !== 'All' || filterRelatedTo !== 'All') && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSearchVal('');
              setFilterType('All');
              setFilterCategory('All');
              setFilterStatus('All');
              setFilterRelatedTo('All');
            }}
            style={{ fontSize: 12.5, padding: '7px 12px', color: '#EF4444', borderColor: '#FCA5A5' }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Main Table / List View */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        {isLoading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748B' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto', color: '#2563EB' }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Loading document management catalog...</div>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#F1F5F9', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
              <Folder size={32} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1E293B', marginBottom: 6 }}>
              {liveDocuments.length === 0 ? 'No Documents Uploaded Yet' : 'No Matching Documents Found'}
            </div>
            <div style={{ fontSize: 13.5, color: '#64748B', maxWidth: 420, margin: '0 auto 20px auto', lineHeight: 1.5 }}>
              {liveDocuments.length === 0
                ? 'Upload agreements, contracts, tax certificates, or client files. They are stored in the company Google Drive.'
                : 'Try adjusting your search terms or clearing category and status filters.'}
            </div>
            {liveDocuments.length === 0 && (
              <button type="button" className="btn-primary" onClick={openUploadModal} style={{ gap: 6, margin: '0 auto' }}>
                <Plus size={16} strokeWidth={2.5} />
                Upload First Document
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Document Title</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Category</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Related To</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>File Name & Size</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Uploaded Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Expiry Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((docItem) => {
                  const fileIcon = getFileIcon(docItem.fileType, docItem.fileName);

                  return (
                    <tr
                      key={docItem.id}
                      style={{ borderBottom: '1px solid #F1F5F9', transition: 'background 0.15s ease' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      {/* Document Title */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13.5, marginBottom: 2 }}>
                          {docItem.title}
                        </div>
                        {docItem.notes && (
                          <div style={{ fontSize: 11.5, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                            {docItem.notes}
                          </div>
                        )}
                      </td>

                      {/* Type */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        <span className="badge badge-purple" style={{ fontSize: 11 }}>
                          {docItem.type}
                        </span>
                      </td>

                      {/* Category */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>
                          {docItem.category}
                        </span>
                      </td>

                      {/* Related To */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        {docItem.relatedRecordName ? (
                          <div>
                            <div style={{ fontWeight: 600, color: '#1E293B', fontSize: 12.5 }}>{docItem.relatedRecordName}</div>
                            <div style={{ fontSize: 10.5, color: '#94A3B8' }}>{docItem.relatedTo}</div>
                          </div>
                        ) : (
                          <span style={{ color: '#94A3B8', fontSize: 12 }}>{docItem.relatedTo || 'N/A'}</span>
                        )}
                      </td>

                      {/* File Name & Size */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {fileIcon}
                          <div style={{ overflow: 'hidden' }}>
                            <div style={{ fontWeight: 600, color: '#2563EB', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={docItem.fileName}>
                              {docItem.fileName}
                            </div>
                            <div style={{ fontSize: 11, color: '#94A3B8' }}>
                              {formatFileSize(docItem.fileSize)}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Uploaded Date */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle', color: '#475569', fontSize: 12.5 }}>
                        {docItem.createdAt ? docItem.createdAt.split('T')[0] : 'N/A'}
                      </td>

                      {/* Expiry Date */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle', color: docItem.expiryDate ? '#1E293B' : '#94A3B8', fontSize: 12.5, fontWeight: docItem.expiryDate ? 600 : 400 }}>
                        {docItem.expiryDate || 'No Expiry'}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        {renderStatusBadge(docItem.expiryDate)}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                          {/* View */}
                          <button
                            type="button"
                            className="btn-icon"
                            title={docItem.driveFileId ? 'View (from Google Drive)' : 'View / Open File'}
                            disabled={openingId === String(docItem.id)}
                            onClick={() => handleOpenFile(docItem, 'view')}
                            style={{ padding: 6, color: '#2563EB' }}
                          >
                            <Eye size={15} />
                          </button>

                          {/* Download */}
                          <button
                            type="button"
                            className="btn-icon"
                            title="Download File"
                            disabled={openingId === String(docItem.id)}
                            onClick={() => handleOpenFile(docItem, 'download')}
                            style={{ padding: 6, color: '#10B981' }}
                          >
                            <Download size={15} />
                          </button>

                          {/* Edit Metadata */}
                          <button
                            type="button"
                            className="btn-icon"
                            title="Edit Metadata"
                            onClick={() => openEditModal(docItem)}
                            style={{ padding: 6, color: '#475569' }}
                          >
                            <Edit3 size={15} />
                          </button>

                          {/* Replace File */}
                          <button
                            type="button"
                            className="btn-icon"
                            title="Replace File"
                            onClick={() => openReplaceModal(docItem)}
                            style={{ padding: 6, color: '#8B5CF6' }}
                          >
                            <RefreshCw size={15} />
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            className="btn-icon"
                            title="Delete Document"
                            onClick={() => openDeleteModal(docItem)}
                            style={{ padding: 6, color: '#EF4444' }}
                          >
                            <Trash2 size={15} />
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

      {/* ========================================================================= */}
      {/* MODAL 1: UPLOAD DOCUMENT MODAL */}
      {/* ========================================================================= */}
      {showUploadModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 16 }}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', background: '#FFFFFF', borderRadius: 16, padding: 28, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Upload size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>Upload Document</h2>
                  <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>Saved to the company Google Drive folder</p>
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setShowUploadModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Document Title */}
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Document Title <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="text"
                  className="input-base"
                  placeholder="e.g. Master Services Agreement 2026"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  required
                />
              </div>

              {/* Type & Category */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Document Type <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="input-base"
                    value={uploadType}
                    onChange={(e) => setUploadType(e.target.value as DocumentType)}
                    required
                  >
                    {DOCUMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Category <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="input-base"
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value as DocumentCategory)}
                    required
                  >
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Related To & Related Record */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Related To
                  </label>
                  <select
                    className="input-base"
                    value={uploadRelatedTo}
                    onChange={(e) => {
                      const rel = e.target.value as DocumentRelatedTo;
                      setUploadRelatedTo(rel);
                      setUploadRelatedRecordId('');
                      setUploadRelatedRecordName('');
                    }}
                  >
                    {RELATED_TO_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Related Record
                  </label>
                  {uploadRelatedTo === 'Client' ? (
                    <select
                      className="input-base"
                      value={uploadRelatedRecordId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setUploadRelatedRecordId(id);
                        const match = liveClients.find((c) => String(c.id) === id);
                        setUploadRelatedRecordName(match ? `${match.name} (${match.company})` : '');
                      }}
                    >
                      <option value="">-- Select Client --</option>
                      {liveClients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} - {c.company}
                        </option>
                      ))}
                    </select>
                  ) : uploadRelatedTo === 'Project' ? (
                    <select
                      className="input-base"
                      value={uploadRelatedRecordId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setUploadRelatedRecordId(id);
                        const match = liveProjects.find((p) => String(p.id) === id);
                        setUploadRelatedRecordName(match ? match.name : '');
                      }}
                    >
                      <option value="">-- Select Project --</option>
                      {liveProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.clientName})
                        </option>
                      ))}
                    </select>
                  ) : uploadRelatedTo === 'Employee' ? (
                    <select
                      className="input-base"
                      value={uploadRelatedRecordId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setUploadRelatedRecordId(id);
                        const match = liveEmployees.find((emp) => String(emp.id) === id);
                        setUploadRelatedRecordName(match ? `${match.name} (${match.role})` : '');
                      }}
                    >
                      <option value="">-- Select Employee --</option>
                      {liveEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} - {emp.role}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="input-base"
                      placeholder="Record or Entity Name"
                      value={uploadRelatedRecordName}
                      onChange={(e) => setUploadRelatedRecordName(e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* Issue Date & Expiry Date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Issue Date
                  </label>
                  <input
                    type="date"
                    className="input-base"
                    value={uploadIssueDate}
                    onChange={(e) => setUploadIssueDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Expiry Date
                  </label>
                  <input
                    type="date"
                    className="input-base"
                    value={uploadExpiryDate}
                    onChange={(e) => setUploadExpiryDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Description / Notes */}
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Description / Notes
                </label>
                <textarea
                  className="input-base"
                  rows={2}
                  placeholder="Optional details, terms, or document reference numbers..."
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                />
              </div>

              {/* File Upload Box */}
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  File Upload <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <div
                  style={{
                    border: '2px dashed #CBD5E1',
                    borderRadius: 12,
                    padding: 20,
                    textAlign: 'center',
                    background: '#F8FAFC',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png"
                    onChange={(e) => handleFileChange(e, false)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                    required
                  />
                  {uploadFile ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                      <FileCheck size={24} style={{ color: '#10B981' }} />
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13 }}>{uploadFile.name}</div>
                        <div style={{ fontSize: 11.5, color: '#64748B' }}>{formatFileSize(uploadFile.size)}</div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload size={28} style={{ color: '#2563EB', marginBottom: 8 }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>Click or drag file to upload</div>
                      <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>
                        Supported formats: PDF, DOC/X, XLS/X, CSV, JPG, PNG (Max 20 MB)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Form Buttons */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowUploadModal(false)} disabled={isUploading}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isUploading} style={{ gap: 6 }}>
                  {isUploading ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Uploading File...
                    </>
                  ) : (
                    <>
                      <Upload size={15} />
                      Upload Document
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT METADATA MODAL */}
      {/* ========================================================================= */}
      {showEditModal && selectedDoc && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 16 }}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', background: '#FFFFFF', borderRadius: 16, padding: 28, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: '#F1F5F9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Edit3 size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>Edit Document Metadata</h2>
                  <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>Does not replace underlying file</p>
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setShowEditModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Document Title */}
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Document Title <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="text"
                  className="input-base"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </div>

              {/* Type & Category */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Document Type
                  </label>
                  <select
                    className="input-base"
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as DocumentType)}
                  >
                    {DOCUMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Category
                  </label>
                  <select
                    className="input-base"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as DocumentCategory)}
                  >
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Related To & Related Record */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Related To
                  </label>
                  <select
                    className="input-base"
                    value={editRelatedTo}
                    onChange={(e) => {
                      const rel = e.target.value as DocumentRelatedTo;
                      setEditRelatedTo(rel);
                      setEditRelatedRecordId('');
                      setEditRelatedRecordName('');
                    }}
                  >
                    {RELATED_TO_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Related Record
                  </label>
                  {editRelatedTo === 'Client' ? (
                    <select
                      className="input-base"
                      value={editRelatedRecordId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setEditRelatedRecordId(id);
                        const match = liveClients.find((c) => String(c.id) === id);
                        setEditRelatedRecordName(match ? `${match.name} (${match.company})` : '');
                      }}
                    >
                      <option value="">-- Select Client --</option>
                      {liveClients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} - {c.company}
                        </option>
                      ))}
                    </select>
                  ) : editRelatedTo === 'Project' ? (
                    <select
                      className="input-base"
                      value={editRelatedRecordId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setEditRelatedRecordId(id);
                        const match = liveProjects.find((p) => String(p.id) === id);
                        setEditRelatedRecordName(match ? match.name : '');
                      }}
                    >
                      <option value="">-- Select Project --</option>
                      {liveProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.clientName})
                        </option>
                      ))}
                    </select>
                  ) : editRelatedTo === 'Employee' ? (
                    <select
                      className="input-base"
                      value={editRelatedRecordId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setEditRelatedRecordId(id);
                        const match = liveEmployees.find((emp) => String(emp.id) === id);
                        setEditRelatedRecordName(match ? `${match.name} (${match.role})` : '');
                      }}
                    >
                      <option value="">-- Select Employee --</option>
                      {liveEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} - {emp.role}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="input-base"
                      placeholder="Record or Entity Name"
                      value={editRelatedRecordName}
                      onChange={(e) => setEditRelatedRecordName(e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* Issue Date & Expiry Date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Issue Date
                  </label>
                  <input
                    type="date"
                    className="input-base"
                    value={editIssueDate}
                    onChange={(e) => setEditIssueDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Expiry Date
                  </label>
                  <input
                    type="date"
                    className="input-base"
                    value={editExpiryDate}
                    onChange={(e) => setEditExpiryDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Description / Notes */}
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Description / Notes
                </label>
                <textarea
                  className="input-base"
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)} disabled={isSavingEdit}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSavingEdit}>
                  {isSavingEdit ? 'Saving Updates...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: REPLACE FILE MODAL */}
      {/* ========================================================================= */}
      {showReplaceModal && selectedDoc && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 16 }}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 500, background: '#FFFFFF', borderRadius: 16, padding: 28, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: '#F3E8FF', color: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RefreshCw size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>Replace File</h2>
                  <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>{selectedDoc.title}</p>
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setShowReplaceModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12.5, color: '#475569' }}>
              <div style={{ fontWeight: 700, color: '#1E293B', marginBottom: 2 }}>Current File:</div>
              <div>{selectedDoc.fileName} ({formatFileSize(selectedDoc.fileSize)})</div>
            </div>

            <form onSubmit={handleReplaceSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Select New Replacement File <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <div
                  style={{
                    border: '2px dashed #CBD5E1',
                    borderRadius: 12,
                    padding: 20,
                    textAlign: 'center',
                    background: '#F8FAFC',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png"
                    onChange={(e) => handleFileChange(e, true)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                    required
                  />
                  {replaceFile ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                      <FileCheck size={24} style={{ color: '#8B5CF6' }} />
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13 }}>{replaceFile.name}</div>
                        <div style={{ fontSize: 11.5, color: '#64748B' }}>{formatFileSize(replaceFile.size)}</div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload size={24} style={{ color: '#8B5CF6', marginBottom: 6 }} />
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1E293B' }}>Click or drag new file here</div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Max 20 MB</div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: '#D97706', background: '#FEF3C7', padding: '10px 12px', borderRadius: 8 }}>
                <strong>Safety Guarantee:</strong> The old file will be removed only after the new file is successfully uploaded to Google Drive and linked.
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowReplaceModal(false)} disabled={isReplacing}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isReplacing} style={{ background: '#8B5CF6', borderColor: '#8B5CF6' }}>
                  {isReplacing ? 'Replacing File...' : 'Confirm Replace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: DELETE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        title="Delete Document"
        itemName={selectedDoc?.title}
        description={
          selectedDoc ? (
            <>
              Are you sure you want to permanently delete <strong>"{selectedDoc.title}"</strong> ({selectedDoc.fileName})?
              <br />
              This moves the file to Google Drive trash (recoverable for 30 days) and deletes its record.
            </>
          ) : undefined
        }
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedDoc(null);
        }}
      />
    </div>
  );
}
