import { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Lead } from '../db/database';
import { newestFirst } from '../utils/sort';
import {
  addLead,
  updateLead,
  deleteLead,
  normalizeIndianPhone,
  validateEmail,
} from '../services/leadService';
import { useToast } from '../context/ToastContext';
import { Trash2 } from 'lucide-react';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const stages = ['New Enquiry', 'Contacted', 'Requirement Collected', 'Quotation Sent', 'Negotiation', 'Converted', 'Lost'] as const;
const stageColors: Record<string, string> = {
  'New Enquiry': '#3B5BDB',
  'Contacted': '#0EA5E9',
  'Requirement Collected': '#8B5CF6',
  'Quotation Sent': '#F59E0B',
  'Negotiation': '#F97316',
  'Converted': '#12B76A',
  'Lost': '#94A3B8',
};

const LEAD_SERVICES = [
  'Website Development',
  'Mobile App Dev',
  'Software Dev',
  'E-commerce Development',
  'UI/UX Design',
  'Digital Marketing',
  'Social Media Marketing',
  'SEO',
  'Google Ads / PPC',
  'Branding',
  'Logo Design',
  'Graphic Design',
  'Posters & Flyers',
  'Video Editing',
  'Motion Graphics / Animation',
  'Photography',
  'Content Writing',
  'Domain & Hosting',
  'Website Maintenance',
  'Other',
];

export interface LeadFormData {
  name: string;
  company: string;
  phone: string;
  email: string;
  service: string;
  source: string;
  followUpDate: string;
  notes: string;
}

export interface LeadFormErrors {
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  service?: string;
  source?: string;
  followUpDate?: string;
  notes?: string;
}

const initialFormState: LeadFormData = {
  name: '',
  company: '',
  phone: '',
  email: '',
  service: 'Website Development',
  source: 'Referral',
  followUpDate: '',
  notes: '',
};

export function validateLeadForm(data: LeadFormData): LeadFormErrors {
  const errors: LeadFormErrors = {};

  // 1. Name: required, trimmed, minimum 2 characters.
  const trimmedName = (data.name || '').trim();
  if (!trimmedName) {
    errors.name = 'Full name is required.';
  } else if (trimmedName.length < 2) {
    errors.name = 'Full name must be at least 2 characters.';
  }

  // 2. Phone: required. Accept Indian mobile numbers only after normalization.
  const trimmedPhone = (data.phone || '').trim();
  if (!trimmedPhone) {
    errors.phone = 'Phone number is required.';
  } else {
    const normalizedPhone = normalizeIndianPhone(trimmedPhone);
    if (!normalizedPhone) {
      errors.phone = 'Please enter a valid 10-digit Indian mobile number (starts with 6-9).';
    }
  }

  // 3. Email: optional, but if provided it must pass a proper email-format check.
  const trimmedEmail = (data.email || '').trim();
  if (trimmedEmail && !validateEmail(trimmedEmail)) {
    errors.email = 'Please enter a valid email address.';
  }

  // 4. Service Required: required.
  if (!data.service || !data.service.trim()) {
    errors.service = 'Service required is required.';
  }

  // 5. Lead Source: required.
  if (!data.source || !data.source.trim()) {
    errors.source = 'Lead source is required.';
  }

  return errors;
}

// Deterministic self-tests run on module load in development mode
if (import.meta.env.DEV) {
  const testRejections = validateLeadForm({
    name: 'sursh',
    phone: '123',
    email: 'abc',
    service: 'Website Development',
    source: 'Referral',
    company: '',
    followUpDate: '',
    notes: '',
  });
  console.assert(testRejections.phone !== undefined, 'Validation Self-Test Failed: phone 123 should be rejected');
  console.assert(testRejections.email !== undefined, 'Validation Self-Test Failed: email abc should be rejected');

  const testAcceptance = validateLeadForm({
    name: 'Suresh Babu',
    phone: '+91 9876543210',
    email: 'suresh@sblogistics.com',
    service: 'Website Development',
    source: 'Referral',
    company: '',
    followUpDate: '',
    notes: '',
  });
  console.assert(Object.keys(testAcceptance).length === 0, 'Validation Self-Test Failed: Valid lead should pass validation');

  const testNoEmail = validateLeadForm({
    name: 'Suresh Babu',
    phone: '+91 9876543210',
    email: '',
    service: 'Website Development',
    source: 'Referral',
    company: '',
    followUpDate: '',
    notes: '',
  });
  console.assert(testNoEmail.email === undefined, 'Validation Self-Test Failed: email should be optional');
}

export default function Leads() {
  const { showToast } = useToast();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  // Add Form states
  const [formData, setFormData] = useState<LeadFormData>(initialFormState);
  const [formErrors, setFormErrors] = useState<LeadFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Form states
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editFormData, setEditFormData] = useState<LeadFormData>(initialFormState);
  const [editFormErrors, setEditFormErrors] = useState<LeadFormErrors>({});
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Delete states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch live leads from Dexie cache (synchronized in real time with Firestore)
  const leads = useLiveQuery(async () => newestFirst(await db.leads.toArray()), []) || [];

  // Optimistic stage tracking for drag-and-drop and stage updates
  const [optimisticStages, setOptimisticStages] = useState<Record<string | number, Lead['stage']>>({});
  const [draggedLeadId, setDraggedLeadId] = useState<string | number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const hasDraggedRef = useRef(false);

  const effectiveLeads = leads.map((lead) => {
    if (lead.id !== undefined && optimisticStages[lead.id]) {
      return { ...lead, stage: optimisticStages[lead.id] };
    }
    return lead;
  });

  const byStage = (stage: string) => effectiveLeads.filter((l) => l.stage === stage);

  const handleDragStart = (e: React.DragEvent, leadId: string | number) => {
    hasDraggedRef.current = true;
    setDraggedLeadId(leadId);
    try {
      e.dataTransfer.setData('text/plain', String(leadId));
      e.dataTransfer.setData('application/json', JSON.stringify({ leadId: String(leadId) }));
    } catch (_) { }
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedLeadId(null);
    setDragOverStage(null);
    setTimeout(() => {
      hasDraggedRef.current = false;
    }, 150);
  };

  const handleCardClick = (lead: Lead) => {
    if (hasDraggedRef.current) return;
    setSelected(lead);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(stage);
  };

  const handleDragLeave = (e: React.DragEvent, stage: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    if (dragOverStage === stage) {
      setDragOverStage(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStage: Lead['stage']) => {
    e.preventDefault();
    setDragOverStage(null);

    const rawLeadId = e.dataTransfer.getData('text/plain') || draggedLeadId;
    if (!rawLeadId) return;

    const leadToMove = effectiveLeads.find((l) => String(l.id) === String(rawLeadId));
    if (!leadToMove || !leadToMove.id) return;

    if (leadToMove.stage === targetStage) {
      setDraggedLeadId(null);
      return;
    }

    const leadId = leadToMove.id;

    // 1. Immediate optimistic UI update - moves card immediately & updates column counts
    setOptimisticStages((prev) => ({ ...prev, [leadId]: targetStage }));
    setDraggedLeadId(null);

    // 2. Save stage change to Firestore first, Dexie second via updateLead
    try {
      await updateLead(leadId, { stage: targetStage });
      // Remove optimistic override after Firestore and Dexie update completes
      setOptimisticStages((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      if (selected && selected.id === leadId) {
        setSelected((prev) => (prev ? { ...prev, stage: targetStage } : null));
      }
      showToast(`Moved "${leadToMove.name}" to ${targetStage}`, 'success');
    } catch (err: any) {
      console.error('Failed to update lead stage via drag-and-drop:', err);
      // Revert optimistic stage update back to original stage if Firestore fails
      setOptimisticStages((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      showToast(err?.message || `Failed to move lead to "${targetStage}". Reverting change.`, 'error');
    }
  };

  const handleInputChange = (field: keyof LeadFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleEditInputChange = (field: keyof LeadFormData, value: string) => {
    setEditFormData((prev) => ({ ...prev, [field]: value }));
    if (editFormErrors[field]) {
      setEditFormErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleOpenAdd = () => {
    setFormData(initialFormState);
    setFormErrors({});
    setShowAdd(true);
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateLeadForm(formData);

    // If ANY validation fails: set field errors, return immediately, NEVER call addLead, NEVER close modal
    if (Object.keys(errors).length > 0) {
      console.warn('[Leads Form Validation Failed]', errors);
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedPhone = formData.phone.trim();
      const normalizedPhone = normalizeIndianPhone(trimmedPhone) || trimmedPhone;

      const trimmedName = formData.name.trim();

      await addLead({
        name: trimmedName,
        company: formData.company.trim() || 'Individual',
        phone: normalizedPhone,
        email: formData.email.trim(),
        service: formData.service,
        source: formData.source,
        followUpDate: formData.followUpDate || new Date().toLocaleDateString('en-GB'),
        stage: 'New Enquiry',
        notes: formData.notes.trim(),
      });

      showToast(`Lead "${trimmedName}" created successfully!`, 'success');
      setShowAdd(false);
      setFormData(initialFormState);
      setFormErrors({});
    } catch (err: any) {
      console.error('Failed to create lead in Firestore:', err);
      showToast(err?.message || 'Failed to create lead. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEdit = (lead: Lead) => {
    setEditingLead(lead);
    setEditFormData({
      name: lead.name,
      company: lead.company === 'Individual' ? '' : lead.company,
      phone: lead.phone,
      email: lead.email,
      service: lead.service,
      source: lead.source,
      followUpDate: lead.followUpDate || '',
      notes: lead.notes || '',
    });
    setEditFormErrors({});
  };

  const handleUpdateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLead?.id) return;

    const errors = validateLeadForm(editFormData);

    if (Object.keys(errors).length > 0) {
      setEditFormErrors(errors);
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const trimmedPhone = editFormData.phone.trim();
      const normalizedPhone = normalizeIndianPhone(trimmedPhone) || trimmedPhone;

      const trimmedName = editFormData.name.trim();

      const updatedLeadData: Partial<Lead> = {
        name: trimmedName,
        company: editFormData.company.trim() || 'Individual',
        phone: normalizedPhone,
        email: editFormData.email.trim(),
        service: editFormData.service,
        source: editFormData.source,
        followUpDate: editFormData.followUpDate || '',
        notes: editFormData.notes.trim(),
      };

      await updateLead(editingLead.id, updatedLeadData);

      showToast(`Lead "${trimmedName}" updated successfully!`, 'success');
      setEditingLead(null);

      // Keep Lead Details modal updated with latest fields
      if (selected && selected.id === editingLead.id) {
        setSelected((prev) => (prev ? { ...prev, ...updatedLeadData } : null));
      }
    } catch (err: any) {
      console.error('Failed to update lead:', err);
      showToast(err?.message || 'Failed to update lead. Please try again.', 'error');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleStageChange = async (leadId: string | number, newStage: Lead['stage']) => {
    try {
      await updateLead(leadId, { stage: newStage });
      if (selected && selected.id === leadId) {
        setSelected((prev) => (prev ? { ...prev, stage: newStage } : null));
      }
      showToast(`Lead stage updated to "${newStage}"`, 'success');
    } catch (err: any) {
      console.error('Failed to update lead stage:', err);
      showToast(err?.message || 'Failed to update lead stage. Please try again.', 'error');
    }
  };

  const handleDeleteLead = async () => {
    if (!selected?.id) return;
    setIsDeleting(true);
    try {
      const leadName = selected.name;
      await deleteLead(selected.id);
      showToast(`Lead "${leadName}" deleted successfully.`, 'success');
      setShowDeleteConfirm(false);
      setSelected(null);
    } catch (err: any) {
      console.error('Failed to delete lead:', err);
      showToast(err?.message || 'Failed to delete lead. Please try again.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexShrink: 0 }}>
        <div>
          <div className="page-title">Lead Pipeline</div>
          <div style={{ fontSize: 13, color: '#697586', marginTop: 2 }}>Track and manage sales opportunities stored in Firestore</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', background: '#F8F9FC', border: '1px solid #E5E9F2', borderRadius: 8, padding: 3, gap: 2 }}>
            {(['kanban', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: view === v ? '#fff' : 'transparent',
                  color: view === v ? '#1A1F36' : '#697586',
                  boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {v === 'kanban' ? '⊟ Kanban' : '≡ List'}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={handleOpenAdd}>+ Add Lead</button>
        </div>
      </div>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexShrink: 0, flexWrap: 'wrap' }}>
        {stages.map((s) => {
          const count = byStage(s).length;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: '#fff', border: '1px solid #E5E9F2', borderRadius: 99, fontSize: 12.5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: stageColors[s], display: 'inline-block' }} />
              <span style={{ color: '#697586' }}>{s}</span>
              <span style={{ fontWeight: 700, color: '#1A1F36' }}>{count}</span>
            </div>
          );
        })}
      </div>

      {view === 'kanban' ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', flex: 1, paddingBottom: 16 }}>
          {stages.map((stage) => {
            const stageLeads = byStage(stage);
            const isColumnHovered = dragOverStage === stage;
            return (
              <div
                key={stage}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, stage)}
                onDragLeave={(e) => handleDragLeave(e, stage)}
                onDrop={(e) => handleDrop(e, stage)}
                style={{
                  minWidth: 240,
                  width: 240,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  borderRadius: 12,
                  outline: isColumnHovered ? '2px dashed #3B5BDB' : 'none',
                  outlineOffset: '-2px',
                  transition: 'outline 0.15s',
                }}
              >
                {/* Column header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#fff', borderRadius: '12px 12px 0 0', border: '1px solid #E5E9F2', borderBottom: `3px solid ${stageColors[stage]}` }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1F36' }}>{stage}</div>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: stageColors[stage], color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{stageLeads.length}</span>
                </div>

                {/* Cards Container / Drop Zone */}
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: 8,
                    background: isColumnHovered ? '#E2E8F0' : '#F1F5F9',
                    borderRadius: '0 0 12px 12px',
                    border: '1px solid #E5E9F2',
                    borderTop: 'none',
                    minHeight: 120,
                    transition: 'background 0.15s',
                  }}
                >
                  {stageLeads.map((lead) => {
                    const isBeingDragged = String(draggedLeadId) === String(lead.id);
                    return (
                      <div
                        key={lead.id}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, lead.id!)}
                        onDragEnd={handleDragEnd}
                        onClick={() => handleCardClick(lead)}
                        style={{
                          background: '#fff',
                          borderRadius: 10,
                          padding: 12,
                          border: '1px solid #E5E9F2',
                          cursor: isBeingDragged ? 'grabbing' : 'grab',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                          transition: 'box-shadow 0.15s, opacity 0.15s',
                          opacity: isBeingDragged ? 0.4 : 1,
                          userSelect: 'none',
                          WebkitUserSelect: 'none',
                          MozUserSelect: 'none',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
                        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)')}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1F36', marginBottom: 2, userSelect: 'none', WebkitUserSelect: 'none' }}>{lead.name}</div>
                        <div style={{ fontSize: 11.5, color: '#697586', marginBottom: 8, userSelect: 'none', WebkitUserSelect: 'none' }}>{lead.company}</div>
                        <span className="badge badge-blue" style={{ fontSize: 10.5, marginBottom: 8, userSelect: 'none', WebkitUserSelect: 'none' }}>{lead.service}</span>
                        <div style={{ fontSize: 11.5, color: '#697586', marginTop: 6, display: 'flex', justifyContent: 'space-between', userSelect: 'none', WebkitUserSelect: 'none' }}>
                          <span>{lead.source}</span>
                          <span>{lead.followUpDate || 'No date'}</span>
                        </div>
                      </div>
                    );
                  })}
                  {stageLeads.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: '20px 0', pointerEvents: 'none', userSelect: 'none' }}>No leads</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table-base">
            <thead>
              <tr><th>NAME</th><th>COMPANY</th><th>SERVICE</th><th>SOURCE</th><th>FOLLOW-UP</th><th>STAGE</th></tr>
            </thead>
            <tbody>
              {effectiveLeads.map((l) => (
                <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(l)}>
                  <td style={{ fontWeight: 600 }}>{l.name}</td>
                  <td>{l.company}</td>
                  <td>{l.service}</td>
                  <td><span className="badge badge-gray">{l.source}</span></td>
                  <td>{l.followUpDate || '—'}</td>
                  <td><span className="badge" style={{ background: stageColors[l.stage] + '22', color: stageColors[l.stage] }}>{l.stage}</span></td>
                </tr>
              ))}
              {effectiveLeads.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#697586' }}>
                    No leads created in Firestore yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Lead detail drawer */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-box" style={{ width: 480, padding: 28, marginLeft: 'auto', marginRight: 0, height: '100%', borderRadius: '16px 0 0 16px', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17 }}>Lead Details</div>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setSelected(null)}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#3B5BDB', fontSize: 16 }}>
                  {selected.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#1A1F36' }}>{selected.name}</div>
                  <div style={{ fontSize: 13, color: '#697586' }}>{selected.company}</div>
                </div>
              </div>

              {/* Interactive Stage Selector */}
              <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #F1F5F9', alignItems: 'center' }}>
                <div style={{ fontSize: 12.5, color: '#697586', width: 130, flexShrink: 0, fontWeight: 600 }}>Stage</div>
                <select
                  className="select-base"
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: stageColors[selected.stage],
                    borderColor: stageColors[selected.stage] + '44',
                    background: stageColors[selected.stage] + '11',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                  value={selected.stage}
                  onChange={(e) => {
                    if (selected.id) {
                      handleStageChange(selected.id, e.target.value as Lead['stage']);
                    }
                  }}
                >
                  {stages.map((s) => (
                    <option key={s} value={s} style={{ color: '#1A1F36', fontWeight: 500 }}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {[
                ['Phone', selected.phone],
                ['Email', selected.email],
                ['Service Required', selected.service],
                ['Lead Source', selected.source],
                ['Follow-up Date', selected.followUpDate || 'Not set'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: 12.5, color: '#697586', width: 130, flexShrink: 0 }}>{l}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1A1F36' }}>{v}</div>
                </div>
              ))}

              {selected.notes && (
                <div style={{ marginTop: 16, padding: 14, background: '#F8F9FC', borderRadius: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#697586', marginBottom: 4 }}>NOTES</div>
                  <div style={{ fontSize: 13, color: '#1A1F36' }}>{selected.notes}</div>
                </div>
              )}
            </div>

            {/* Actions: Edit, Delete, Close */}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #E5E9F2', flexShrink: 0 }}>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', fontSize: 13 }}
                onClick={() => handleOpenEdit(selected)}
              >
                ✏️ Edit Lead
              </button>
              <button
                type="button"
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #FECACA',
                  background: '#FEF2F2',
                  color: '#DC2626',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'background 0.15s',
                }}
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={14} /> Delete
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '8px 14px', fontSize: 13 }}
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selected && (
        <DeleteConfirmationModal
          isOpen={showDeleteConfirm}
          title="Delete Lead"
          itemName={selected.name}
          description={
            <>
              Are you sure you want to delete lead <strong style={{ color: '#1A1F36' }}>"{selected.name}"</strong>? This action will permanently remove the lead from Firestore and cannot be undone.
            </>
          }
          isDeleting={isDeleting}
          onConfirm={handleDeleteLead}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Edit Lead Modal */}
      {editingLead && (
        <div className="modal-overlay" onClick={() => setEditingLead(null)}>
          <div className="modal-box" style={{ width: 560, padding: 28, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>Edit Lead</div>
                <div style={{ fontSize: 12, color: '#697586' }}>Update details for lead "{editingLead.name}"</div>
              </div>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setEditingLead(null)}>×</button>
            </div>

            <form onSubmit={handleUpdateLead} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Full Name */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Full Name *</label>
                  <input
                    className="input-base"
                    style={{ borderColor: editFormErrors.name ? '#EF4444' : undefined }}
                    placeholder="e.g. Suresh Babu"
                    value={editFormData.name}
                    onChange={(e) => handleEditInputChange('name', e.target.value)}
                  />
                  {editFormErrors.name && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{editFormErrors.name}</div>}
                </div>

                {/* Company Name */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Company Name</label>
                  <input
                    className="input-base"
                    placeholder="e.g. SB Logistics"
                    value={editFormData.company}
                    onChange={(e) => handleEditInputChange('company', e.target.value)}
                  />
                </div>

                {/* Phone Number */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Phone Number *</label>
                  <input
                    className="input-base"
                    style={{ borderColor: editFormErrors.phone ? '#EF4444' : undefined }}
                    placeholder="e.g. 9876543210"
                    value={editFormData.phone}
                    onChange={(e) => handleEditInputChange('phone', e.target.value)}
                  />
                  {editFormErrors.phone && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{editFormErrors.phone}</div>}
                </div>

                {/* Email Address */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Email Address</label>
                  <input
                    className="input-base"
                    type="email"
                    style={{ borderColor: editFormErrors.email ? '#EF4444' : undefined }}
                    placeholder="e.g. suresh@sblogistics.com"
                    value={editFormData.email}
                    onChange={(e) => handleEditInputChange('email', e.target.value)}
                  />
                  {editFormErrors.email && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{editFormErrors.email}</div>}
                </div>


                {/* Service Required */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Service Required *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: editFormErrors.service ? '#EF4444' : undefined }}
                    value={editFormData.service}
                    onChange={(e) => handleEditInputChange('service', e.target.value)}
                  >
                    {LEAD_SERVICES.map((svc) => (
                      <option key={svc} value={svc}>{svc}</option>
                    ))}
                  </select>
                  {editFormErrors.service && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{editFormErrors.service}</div>}
                </div>

                {/* Lead Source */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Lead Source *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: editFormErrors.source ? '#EF4444' : undefined }}
                    value={editFormData.source}
                    onChange={(e) => handleEditInputChange('source', e.target.value)}
                  >
                    <option value="Referral">Referral</option>
                    <option value="Instagram">Instagram</option>
                    <option value="Google">Google</option>
                    <option value="LinkedIn">LinkedIn</option>
                    <option value="Facebook">Facebook</option>
                    <option value="Walk-in">Walk-in</option>
                  </select>
                  {editFormErrors.source && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{editFormErrors.source}</div>}
                </div>


                {/* Follow-up Date */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Follow-up Date</label>
                  <input
                    className="input-base"
                    type="date"
                    value={editFormData.followUpDate}
                    onChange={(e) => handleEditInputChange('followUpDate', e.target.value)}
                  />
                </div>

                {/* Lead Notes */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Lead Notes</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="Enter project requirements or client communication notes..."
                    value={editFormData.notes}
                    onChange={(e) => handleEditInputChange('notes', e.target.value)}
                  />
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditingLead(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmittingEdit}>
                  {isSubmittingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-box" style={{ width: 560, padding: 28, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 18, color: '#1A1F36' }}>Add New Lead</div>
                <div style={{ fontSize: 12, color: '#697586' }}>Fields marked with * are required</div>
              </div>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#697586' }} onClick={() => setShowAdd(false)}>×</button>
            </div>

            <form onSubmit={handleCreateLead} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Full Name */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Full Name *</label>
                  <input
                    className="input-base"
                    style={{ borderColor: formErrors.name ? '#EF4444' : undefined }}
                    placeholder="e.g. Suresh Babu"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                  />
                  {formErrors.name && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.name}</div>}
                </div>

                {/* Company Name */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Company Name</label>
                  <input
                    className="input-base"
                    placeholder="e.g. SB Logistics"
                    value={formData.company}
                    onChange={(e) => handleInputChange('company', e.target.value)}
                  />
                </div>

                {/* Phone Number */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Phone Number *</label>
                  <input
                    className="input-base"
                    style={{ borderColor: formErrors.phone ? '#EF4444' : undefined }}
                    placeholder="e.g. 9876543210"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                  />
                  {formErrors.phone && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.phone}</div>}
                </div>

                {/* Email Address */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Email Address</label>
                  <input
                    className="input-base"
                    type="email"
                    style={{ borderColor: formErrors.email ? '#EF4444' : undefined }}
                    placeholder="e.g. suresh@sblogistics.com"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                  />
                  {formErrors.email && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.email}</div>}
                </div>


                {/* Service Required */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Service Required *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: formErrors.service ? '#EF4444' : undefined }}
                    value={formData.service}
                    onChange={(e) => handleInputChange('service', e.target.value)}
                  >
                    {LEAD_SERVICES.map((svc) => (
                      <option key={svc} value={svc}>{svc}</option>
                    ))}
                  </select>
                  {formErrors.service && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.service}</div>}
                </div>

                {/* Lead Source */}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Lead Source *</label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: formErrors.source ? '#EF4444' : undefined }}
                    value={formData.source}
                    onChange={(e) => handleInputChange('source', e.target.value)}
                  >
                    <option value="Referral">Referral</option>
                    <option value="Instagram">Instagram</option>
                    <option value="Google">Google</option>
                    <option value="LinkedIn">LinkedIn</option>
                    <option value="Facebook">Facebook</option>
                    <option value="Walk-in">Walk-in</option>
                  </select>
                  {formErrors.source && <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 4 }}>{formErrors.source}</div>}
                </div>


                {/* Follow-up Date */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Follow-up Date</label>
                  <input
                    className="input-base"
                    type="date"
                    value={formData.followUpDate}
                    onChange={(e) => handleInputChange('followUpDate', e.target.value)}
                  />
                </div>

                {/* Lead Notes */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: '#1A1F36' }}>Lead Notes</label>
                  <textarea
                    className="input-base"
                    rows={2}
                    placeholder="Enter project requirements or client communication notes..."
                    value={formData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                  />
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Add Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
