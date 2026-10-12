import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  saveCompanyProfile,
  uploadCompanyLogo,
  type CompanyProfile,
} from '../services/companyService';
import logoBrand from '../assets/legendary-one-logo.png';

interface Props {
  initialData?: CompanyProfile | null;
  onComplete?: () => void;
  isEditMode?: boolean;
}

const BUSINESS_TYPES = [
  'Private Limited (Pvt Ltd)',
  'One Person Company (OPC)',
  'Limited Liability Partnership (LLP)',
  'Partnership Firm',
  'Sole Proprietorship',
  'Public Limited Company',
  'IT Services & Digital Agency',
  'MSME / Startup Enterprise',
  'Other',
];

const WORKING_DAYS_OPTIONS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export default function CompanySetupWizard({
  initialData,
  onComplete,
  isEditMode = false,
}: Props) {
  const { user, firebaseUser, logout, refreshCompanyProfile } = useAuth();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [storageWarning, setStorageWarning] = useState<string>('');
  const [logoPreview, setLogoPreview] = useState<string>(initialData?.logoUrl || '');
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    // Step 1: Company Info
    companyName: initialData?.companyName || '',
    tagline: initialData?.tagline || '',
    businessType: initialData?.businessType || 'Private Limited (Pvt Ltd)',
    businessEmail: initialData?.businessEmail || user?.email || '',
    phoneNumber: initialData?.phoneNumber || '',
    website: initialData?.website || '',
    addressLine1: initialData?.addressLine1 || '',
    addressLine2: initialData?.addressLine2 || '',
    city: initialData?.city || '',
    state: initialData?.state || '',
    pincode: initialData?.pincode || '',
    country: initialData?.country || 'India',

    // Step 2: Business & Tax
    gstin: initialData?.gstin || '',
    pan: initialData?.pan || '',
    udyamNumber: initialData?.udyamNumber || '',
    financialYearStart: initialData?.financialYearStart || 'April 1st',
    currency: initialData?.currency || 'INR (₹)',

    // Step 3: Bank Details
    bankName: initialData?.bankName || '',
    accountHolderName: initialData?.accountHolderName || '',
    accountNumber: initialData?.accountNumber || '',
    confirmAccountNumber: initialData?.accountNumber || '',
    ifscCode: initialData?.ifscCode || '',
    branchName: initialData?.branchName || '',

    // Step 4: Office Settings
    workingDays: initialData?.workingDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    officeStartTime: initialData?.officeStartTime || '09:30',
    officeEndTime: initialData?.officeEndTime || '18:30',
    weeklyOff: initialData?.weeklyOff || 'Sunday',
    defaultInvoicePrefix: initialData?.defaultInvoicePrefix || 'INV-',
    defaultQuotationPrefix: initialData?.defaultQuotationPrefix || 'QT-',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateField = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setErrors((prev) => ({ ...prev, logo: 'Logo image size must be under 5MB.' }));
        return;
      }
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
      setErrors((prev) => {
        const next = { ...prev };
        delete next['logo'];
        return next;
      });
    }
  };

  // Step Validations
  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.companyName.trim()) newErrors.companyName = 'Company Name is required.';
      if (!formData.businessType.trim()) newErrors.businessType = 'Business Type is required.';
      if (!formData.businessEmail.trim()) {
        newErrors.businessEmail = 'Business Email is required.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.businessEmail.trim())) {
        newErrors.businessEmail = 'Enter a valid email address.';
      }

      if (!formData.phoneNumber.trim()) {
        newErrors.phoneNumber = 'Phone Number is required.';
      } else {
        const cleanPhone = formData.phoneNumber.replace(/[\s\-\+]/g, '');
        if (!/^(91)?[6-9]\d{9}$/.test(cleanPhone)) {
          newErrors.phoneNumber = 'Enter a valid 10-digit Indian phone number.';
        }
      }

      if (formData.website.trim()) {
        const webPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
        if (!webPattern.test(formData.website.trim())) {
          newErrors.website = 'Enter a valid website URL (e.g. https://example.com)';
        }
      }

      if (!formData.addressLine1.trim()) newErrors.addressLine1 = 'Address Line 1 is required.';
      if (!formData.city.trim()) newErrors.city = 'City is required.';
      if (!formData.state.trim()) newErrors.state = 'State is required.';
      if (!formData.pincode.trim()) {
        newErrors.pincode = 'Pincode is required.';
      } else if (!/^[1-9][0-9]{5}$/.test(formData.pincode.trim())) {
        newErrors.pincode = 'Enter a valid 6-digit Indian pincode.';
      }
      if (!formData.country.trim()) newErrors.country = 'Country is required.';
    }

    if (step === 2) {
      if (formData.gstin.trim()) {
        const gstinUpper = formData.gstin.trim().toUpperCase();
        if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstinUpper)) {
          newErrors.gstin = 'Enter a valid 15-character GSTIN (e.g., 33AAAAA0000A1Z5).';
        }
      }

      if (formData.pan.trim()) {
        const panUpper = formData.pan.trim().toUpperCase();
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panUpper)) {
          newErrors.pan = 'Enter a valid 10-character PAN (e.g., ABCDE1234F).';
        }
      }

      if (!formData.financialYearStart) newErrors.financialYearStart = 'Select Financial Year Start.';
      if (!formData.currency) newErrors.currency = 'Select Currency.';
    }

    if (step === 3) {
      if (!formData.bankName.trim()) newErrors.bankName = 'Bank Name is required.';
      if (!formData.accountHolderName.trim()) newErrors.accountHolderName = 'Account Holder Name is required.';
      if (!formData.accountNumber.trim()) {
        newErrors.accountNumber = 'Account Number is required.';
      } else if (formData.accountNumber.trim().length < 8) {
        newErrors.accountNumber = 'Account Number must be at least 8 digits.';
      }

      if (!formData.confirmAccountNumber.trim()) {
        newErrors.confirmAccountNumber = 'Please confirm Account Number.';
      } else if (formData.confirmAccountNumber.trim() !== formData.accountNumber.trim()) {
        newErrors.confirmAccountNumber = 'Account Number confirmation does not match.';
      }

      if (!formData.ifscCode.trim()) {
        newErrors.ifscCode = 'IFSC Code is required.';
      } else {
        const ifscUpper = formData.ifscCode.trim().toUpperCase();
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscUpper)) {
          newErrors.ifscCode = 'Enter a valid 11-character IFSC code (e.g., SBIN0001234).';
        }
      }

      if (!formData.branchName.trim()) newErrors.branchName = 'Branch Name is required.';
    }

    if (step === 4) {
      if (formData.workingDays.length === 0) newErrors.workingDays = 'Select at least one working day.';
      if (!formData.officeStartTime) newErrors.officeStartTime = 'Office Start Time is required.';
      if (!formData.officeEndTime) newErrors.officeEndTime = 'Office End Time is required.';
      if (!formData.weeklyOff) newErrors.weeklyOff = 'Weekly Off setting is required.';
      if (!formData.defaultInvoicePrefix.trim()) newErrors.defaultInvoicePrefix = 'Default Invoice Prefix is required.';
      if (!formData.defaultQuotationPrefix.trim()) newErrors.defaultQuotationPrefix = 'Default Quotation Prefix is required.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setErrorMessage('');
      setCurrentStep((prev) => Math.min(prev + 1, 4));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setErrorMessage('Please fix the errors highlighted below before proceeding.');
    }
  };

  const handlePrev = () => {
    setErrorMessage('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveAndFinish = async () => {
    if (!validateStep(4)) {
      setErrorMessage('Please resolve all validation errors in Step 4.');
      return;
    }

    if (!user || !firebaseUser) {
      setErrorMessage('User session expired. Please log in again.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setStorageWarning('');

    try {
      // A blob: preview URL only works in this tab, so never save it
      let finalLogoUrl = logoPreview.startsWith('blob:') ? initialData?.logoUrl || '' : logoPreview;

      // Logo is resized in the browser and saved inside the company profile (no Storage bucket)
      if (logoFile) {
        const uploadRes = await uploadCompanyLogo(logoFile, firebaseUser.uid);
        if (uploadRes.url) {
          finalLogoUrl = uploadRes.url;
        } else {
          setStorageWarning(uploadRes.error || 'The logo could not be processed; the previous logo was kept.');
        }
      }

      const payload = {
        companyName: formData.companyName.trim(),
        logoUrl: finalLogoUrl,
        tagline: formData.tagline.trim(),
        businessType: formData.businessType.trim(),
        businessEmail: formData.businessEmail.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        website: formData.website.trim(),
        addressLine1: formData.addressLine1.trim(),
        addressLine2: formData.addressLine2.trim(),
        city: formData.city.trim(),
        state: formData.state.trim(),
        pincode: formData.pincode.trim(),
        country: formData.country.trim(),

        gstin: formData.gstin.trim().toUpperCase(),
        pan: formData.pan.trim().toUpperCase(),
        udyamNumber: formData.udyamNumber.trim(),
        financialYearStart: formData.financialYearStart,
        currency: formData.currency,

        bankName: formData.bankName.trim(),
        accountHolderName: formData.accountHolderName.trim(),
        accountNumber: formData.accountNumber.trim(),
        ifscCode: formData.ifscCode.trim().toUpperCase(),
        branchName: formData.branchName.trim(),

        workingDays: formData.workingDays,
        officeStartTime: formData.officeStartTime,
        officeEndTime: formData.officeEndTime,
        weeklyOff: formData.weeklyOff,
        defaultInvoicePrefix: formData.defaultInvoicePrefix.trim(),
        defaultQuotationPrefix: formData.defaultQuotationPrefix.trim(),
      };

      const result = await saveCompanyProfile(payload, user, firebaseUser.uid);

      if (!result.success) {
        setErrorMessage(result.message || 'Failed to save company profile.');
        setIsSubmitting(false);
        return;
      }

      // Refresh Auth Context to trigger state change & grant Dashboard access
      await refreshCompanyProfile();

      if (onComplete) {
        onComplete();
      }
    } catch (err: any) {
      console.error('Save Company Profile failed:', err);
      setErrorMessage(err?.message || 'An unexpected error occurred while saving setup.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleWorkingDay = (day: string) => {
    setFormData((prev) => {
      const exists = prev.workingDays.includes(day);
      const updated = exists
        ? prev.workingDays.filter((d) => d !== day)
        : [...prev.workingDays, day];
      return { ...prev, workingDays: updated };
    });
    if (errors.workingDays) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.workingDays;
        return next;
      });
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0F172A 0%, #1A1F36 60%, #1E293B 100%)',
        color: '#F8FAFC',
        fontFamily: 'Inter, sans-serif',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Top Header Bar */}
      <div
        style={{
          width: '100%',
          maxWidth: 920,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#0F172A',
              border: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={logoBrand}
              alt="Legendary One"
              style={{ width: 34, height: 34, objectFit: 'contain', mixBlendMode: 'screen' }}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: 'Plus Jakarta Sans',
                fontWeight: 800,
                fontSize: 18,
                letterSpacing: '-0.3px',
                color: '#FFF',
              }}
            >
              Legendary One Business OS
            </div>
            <div style={{ fontSize: 12, color: '#94A3B8' }}>First-Time Company Setup Wizard</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className="badge"
            style={{ background: 'rgba(59,91,219,0.2)', color: '#818CF8', border: '1px solid #4F46E5', fontSize: 12 }}
          >
            {user?.role}
          </span>
          {!isEditMode && (
            <button
              onClick={() => logout()}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                color: '#94A3B8',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 12.5,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#FFF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94A3B8')}
            >
              Sign Out
            </button>
          )}
        </div>
      </div>

      {/* Main Container Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 920,
          background: '#FFFFFF',
          borderRadius: 20,
          color: '#1A1F36',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
        }}
      >
        {/* Wizard Title & Stepper Header */}
        <div
          style={{
            background: '#F8FAFC',
            padding: '24px 32px 20px',
            borderBottom: '1px solid #E2E8F0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1
                style={{
                  fontFamily: 'Plus Jakarta Sans',
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#0F172A',
                  margin: 0,
                }}
              >
                {isEditMode ? 'Edit Company Settings' : 'Company Setup & Onboarding'}
              </h1>
              <p style={{ fontSize: 13.5, color: '#64748B', margin: '4px 0 0' }}>
                Provide your official business, tax, banking, and office details to activate your OS workspace.
              </p>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3B5BDB', background: '#EEF2FF', padding: '6px 14px', borderRadius: 20 }}>
              Step {currentStep} of 4
            </div>
          </div>

          {/* Stepper Progress Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginTop: 24,
            }}
          >
            {[
              { num: 1, title: 'Company Info', desc: 'Identity & Address' },
              { num: 2, title: 'Business & Tax', desc: 'GST, PAN & Currency' },
              { num: 3, title: 'Bank Details', desc: 'Account & IFSC' },
              { num: 4, title: 'Office Settings', desc: 'Timing & Prefixes' },
            ].map((step) => {
              const isActive = currentStep === step.num;
              const isCompleted = currentStep > step.num;
              return (
                <button
                  key={step.num}
                  onClick={() => {
                    if (step.num < currentStep) {
                      setCurrentStep(step.num);
                    }
                  }}
                  disabled={step.num > currentStep && !isCompleted}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: isActive ? '2px solid #3B5BDB' : isCompleted ? '1px solid #CBD5E1' : '1px solid #E2E8F0',
                    background: isActive ? '#EEF2FF' : isCompleted ? '#F1F5F9' : '#FFFFFF',
                    cursor: step.num <= currentStep ? 'pointer' : 'not-allowed',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isActive ? '#3B5BDB' : isCompleted ? '#10B981' : '#E2E8F0',
                        color: isActive || isCompleted ? '#FFF' : '#64748B',
                      }}
                    >
                      {isCompleted ? '✓' : step.num}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 12.5,
                        color: isActive ? '#1E40AF' : isCompleted ? '#0F172A' : '#64748B',
                      }}
                    >
                      {step.title}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: isActive ? '#3B5BDB' : '#94A3B8', paddingLeft: 26 }}>
                    {step.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Wizard Form Content */}
        <div style={{ padding: '28px 32px' }}>
          {/* Top Error Message Banner */}
          {errorMessage && (
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#991B1B',
                borderRadius: 10,
                padding: '12px 16px',
                fontSize: 13.5,
                fontWeight: 500,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span>⚠️</span>
              <div>{errorMessage}</div>
            </div>
          )}

          {/* Storage Warning Report (as required by prompt) */}
          {storageWarning && (
            <div
              style={{
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                color: '#92400E',
                borderRadius: 10,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 20,
                lineHeight: 1.4,
              }}
            >
              <strong>Logo notice:</strong> {storageWarning}
            </div>
          )}

          {/* STEP 1: Company Information */}
          {currentStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                Step 1 — Company Profile & Contact Information
              </div>

              {/* Logo Upload Section */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  padding: 16,
                  background: '#F8FAFC',
                  borderRadius: 12,
                  border: errors.logo ? '1px solid #EF4444' : '1px dashed #CBD5E1',
                }}
              >
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 12,
                    background: '#FFF',
                    border: '1px solid #E2E8F0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo Preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontSize: 28, color: '#94A3B8' }}>🏢</span>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0F172A', marginBottom: 2 }}>Company Logo</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
                    Upload PNG, JPG or SVG logo. Max file size: 5MB.
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <label
                      className="btn-secondary"
                      style={{ fontSize: 12.5, padding: '6px 12px', cursor: 'pointer', background: '#FFF' }}
                    >
                      <span>📁 Choose Image</span>
                      <input type="file" accept="image/*" onChange={handleLogoChange} style={{ display: 'none' }} />
                    </label>
                    {logoPreview && (
                      <button
                        type="button"
                        onClick={() => {
                          setLogoPreview('');
                          setLogoFile(null);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#EF4444',
                          fontSize: 12.5,
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        Remove Logo
                      </button>
                    )}
                  </div>
                  {errors.logo && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.logo}</div>}
                </div>
              </div>

              {/* Form Grid Step 1 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Company Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. Acme Technologies Pvt Ltd"
                    value={formData.companyName}
                    onChange={(e) => updateField('companyName', e.target.value)}
                    style={{ borderColor: errors.companyName ? '#EF4444' : undefined }}
                  />
                  {errors.companyName && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.companyName}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Tagline / Motto
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. Innovating Enterprise Digital Solutions"
                    value={formData.tagline}
                    onChange={(e) => updateField('tagline', e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Business Type <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.businessType ? '#EF4444' : undefined }}
                    value={formData.businessType}
                    onChange={(e) => updateField('businessType', e.target.value)}
                  >
                    {BUSINESS_TYPES.map((bt) => (
                      <option key={bt} value={bt}>
                        {bt}
                      </option>
                    ))}
                  </select>
                  {errors.businessType && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.businessType}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Business Email <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="email"
                    className="input-base"
                    placeholder="e.g. contact@company.com"
                    value={formData.businessEmail}
                    onChange={(e) => updateField('businessEmail', e.target.value)}
                    style={{ borderColor: errors.businessEmail ? '#EF4444' : undefined }}
                  />
                  {errors.businessEmail && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.businessEmail}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Phone Number (Indian) <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. 9876543210 or +91 9876543210"
                    value={formData.phoneNumber}
                    onChange={(e) => updateField('phoneNumber', e.target.value)}
                    style={{ borderColor: errors.phoneNumber ? '#EF4444' : undefined }}
                  />
                  {errors.phoneNumber && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.phoneNumber}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Official Website
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. https://mycompany.com"
                    value={formData.website}
                    onChange={(e) => updateField('website', e.target.value)}
                    style={{ borderColor: errors.website ? '#EF4444' : undefined }}
                  />
                  {errors.website && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.website}</div>}
                </div>
              </div>

              {/* Registered Address */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>
                  Registered Office Address
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      Address Line 1 <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      className="input-base"
                      placeholder="e.g. Building No. 42, OMR Tech Corridor, Anna Nagar"
                      value={formData.addressLine1}
                      onChange={(e) => updateField('addressLine1', e.target.value)}
                      style={{ borderColor: errors.addressLine1 ? '#EF4444' : undefined }}
                    />
                    {errors.addressLine1 && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.addressLine1}</div>}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      Address Line 2
                    </label>
                    <input
                      className="input-base"
                      placeholder="e.g. Near Bus Terminus / Landmark"
                      value={formData.addressLine2}
                      onChange={(e) => updateField('addressLine2', e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      City <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      className="input-base"
                      placeholder="e.g. Chennai"
                      value={formData.city}
                      onChange={(e) => updateField('city', e.target.value)}
                      style={{ borderColor: errors.city ? '#EF4444' : undefined }}
                    />
                    {errors.city && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.city}</div>}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      State <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      className="input-base"
                      placeholder="e.g. Tamil Nadu"
                      value={formData.state}
                      onChange={(e) => updateField('state', e.target.value)}
                      style={{ borderColor: errors.state ? '#EF4444' : undefined }}
                    />
                    {errors.state && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.state}</div>}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      Pincode <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      className="input-base"
                      placeholder="e.g. 600040"
                      value={formData.pincode}
                      onChange={(e) => updateField('pincode', e.target.value)}
                      style={{ borderColor: errors.pincode ? '#EF4444' : undefined }}
                    />
                    {errors.pincode && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.pincode}</div>}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      Country <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      className="input-base"
                      placeholder="India"
                      value={formData.country}
                      onChange={(e) => updateField('country', e.target.value)}
                      style={{ borderColor: errors.country ? '#EF4444' : undefined }}
                    />
                    {errors.country && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.country}</div>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Business & Tax */}
          {currentStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                Step 2 — Business Registration, GSTIN & Tax Configuration
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    GSTIN Number (Optional)
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. 33AAAAA0000A1Z5"
                    value={formData.gstin}
                    onChange={(e) => updateField('gstin', e.target.value.toUpperCase())}
                    style={{ borderColor: errors.gstin ? '#EF4444' : undefined, textTransform: 'uppercase' }}
                  />
                  <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>Format: 15-character GST registration code</div>
                  {errors.gstin && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.gstin}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    PAN Card Number (Optional)
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. ABCDE1234F"
                    value={formData.pan}
                    onChange={(e) => updateField('pan', e.target.value.toUpperCase())}
                    style={{ borderColor: errors.pan ? '#EF4444' : undefined, textTransform: 'uppercase' }}
                  />
                  <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>Format: 10-character Permanent Account Number</div>
                  {errors.pan && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.pan}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    UDYAM / MSME Registration No (Optional)
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. UDYAM-TN-01-0012345"
                    value={formData.udyamNumber}
                    onChange={(e) => updateField('udyamNumber', e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Financial Year Start <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.financialYearStart ? '#EF4444' : undefined }}
                    value={formData.financialYearStart}
                    onChange={(e) => updateField('financialYearStart', e.target.value)}
                  >
                    <option value="April 1st">April 1st (Indian Standard Fiscal Year)</option>
                    <option value="January 1st">January 1st (Calendar Year)</option>
                    <option value="July 1st">July 1st</option>
                    <option value="October 1st">October 1st</option>
                  </select>
                  {errors.financialYearStart && (
                    <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.financialYearStart}</div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Base Currency <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.currency ? '#EF4444' : undefined }}
                    value={formData.currency}
                    onChange={(e) => updateField('currency', e.target.value)}
                  >
                    <option value="INR (₹)">INR (₹) — Indian Rupee</option>
                    <option value="USD ($)">USD ($) — US Dollar</option>
                    <option value="EUR (€)">EUR (€) — Euro</option>
                    <option value="GBP (£)">GBP (£) — British Pound</option>
                    <option value="AED (AED)">AED (AED) — UAE Dirham</option>
                    <option value="SGD ($)">SGD ($) — Singapore Dollar</option>
                  </select>
                  {errors.currency && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.currency}</div>}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Bank Details */}
          {currentStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                Step 3 — Primary Business Bank Account Details
              </div>
              <p style={{ fontSize: 13, color: '#64748B', marginTop: -12 }}>
                These banking details will automatically print on your generate invoices and payment receipts.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Bank Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. HDFC Bank / ICICI Bank / SBI"
                    value={formData.bankName}
                    onChange={(e) => updateField('bankName', e.target.value)}
                    style={{ borderColor: errors.bankName ? '#EF4444' : undefined }}
                  />
                  {errors.bankName && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.bankName}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Account Holder Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. Legendary One Technologies Pvt Ltd"
                    value={formData.accountHolderName}
                    onChange={(e) => updateField('accountHolderName', e.target.value)}
                    style={{ borderColor: errors.accountHolderName ? '#EF4444' : undefined }}
                  />
                  {errors.accountHolderName && (
                    <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.accountHolderName}</div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Account Number <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="password"
                    className="input-base"
                    placeholder="Enter Account Number"
                    value={formData.accountNumber}
                    onChange={(e) => updateField('accountNumber', e.target.value)}
                    style={{ borderColor: errors.accountNumber ? '#EF4444' : undefined }}
                  />
                  {errors.accountNumber && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.accountNumber}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Confirm Account Number <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="input-base"
                    placeholder="Re-enter Account Number to Confirm"
                    value={formData.confirmAccountNumber}
                    onChange={(e) => updateField('confirmAccountNumber', e.target.value)}
                    style={{ borderColor: errors.confirmAccountNumber ? '#EF4444' : undefined }}
                  />
                  {errors.confirmAccountNumber && (
                    <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.confirmAccountNumber}</div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    IFSC Code <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. HDFC0001234"
                    value={formData.ifscCode}
                    onChange={(e) => updateField('ifscCode', e.target.value.toUpperCase())}
                    style={{ borderColor: errors.ifscCode ? '#EF4444' : undefined, textTransform: 'uppercase' }}
                  />
                  {errors.ifscCode && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.ifscCode}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Branch Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    className="input-base"
                    placeholder="e.g. Guindy Branch, Chennai"
                    value={formData.branchName}
                    onChange={(e) => updateField('branchName', e.target.value)}
                    style={{ borderColor: errors.branchName ? '#EF4444' : undefined }}
                  />
                  {errors.branchName && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.branchName}</div>}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Office Settings */}
          {currentStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                Step 4 — Working Hours & Document Prefixes
              </div>

              {/* Working Days Selector */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 700, color: '#0F172A' }}>
                    Working Days <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
                        }))
                      }
                      style={{ fontSize: 11.5, background: '#EEF2FF', color: '#3B5BDB', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Mon-Fri (5 Days)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                        }))
                      }
                      style={{ fontSize: 11.5, background: '#EEF2FF', color: '#3B5BDB', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Mon-Sat (6 Days)
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {WORKING_DAYS_OPTIONS.map((day) => {
                    const isSelected = formData.workingDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleWorkingDay(day)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          border: isSelected ? '1px solid #3B5BDB' : '1px solid #E2E8F0',
                          background: isSelected ? '#3B5BDB' : '#F8FAFC',
                          color: isSelected ? '#FFF' : '#475569',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {isSelected ? `✓ ${day}` : day}
                      </button>
                    );
                  })}
                </div>
                {errors.workingDays && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 6 }}>{errors.workingDays}</div>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Office Start Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="input-base"
                    value={formData.officeStartTime}
                    onChange={(e) => updateField('officeStartTime', e.target.value)}
                    style={{ borderColor: errors.officeStartTime ? '#EF4444' : undefined }}
                  />
                  {errors.officeStartTime && (
                    <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.officeStartTime}</div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Office End Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="input-base"
                    value={formData.officeEndTime}
                    onChange={(e) => updateField('officeEndTime', e.target.value)}
                    style={{ borderColor: errors.officeEndTime ? '#EF4444' : undefined }}
                  />
                  {errors.officeEndTime && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.officeEndTime}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                    Weekly Off Day <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <select
                    className="select-base"
                    style={{ width: '100%', borderColor: errors.weeklyOff ? '#EF4444' : undefined }}
                    value={formData.weeklyOff}
                    onChange={(e) => updateField('weeklyOff', e.target.value)}
                  >
                    <option value="Sunday">Sunday</option>
                    <option value="Saturday & Sunday">Saturday & Sunday</option>
                    <option value="Friday">Friday</option>
                    <option value="None">None</option>
                  </select>
                  {errors.weeklyOff && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.weeklyOff}</div>}
                </div>
              </div>

              {/* Document Sequence Prefixes */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>
                  Default Invoice & Quotation Prefix Sequences
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      Default Invoice Prefix <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      className="input-base"
                      placeholder="e.g. INV-"
                      value={formData.defaultInvoicePrefix}
                      onChange={(e) => updateField('defaultInvoicePrefix', e.target.value)}
                      style={{ borderColor: errors.defaultInvoicePrefix ? '#EF4444' : undefined }}
                    />
                    <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>Generated format: INV-2026-0001</div>
                    {errors.defaultInvoicePrefix && (
                      <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.defaultInvoicePrefix}</div>
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                      Default Quotation Prefix <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      className="input-base"
                      placeholder="e.g. QT-"
                      value={formData.defaultQuotationPrefix}
                      onChange={(e) => updateField('defaultQuotationPrefix', e.target.value)}
                      style={{ borderColor: errors.defaultQuotationPrefix ? '#EF4444' : undefined }}
                    />
                    <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>Generated format: QT-2026-0001</div>
                    {errors.defaultQuotationPrefix && (
                      <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.defaultQuotationPrefix}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Navigation Action Controls */}
          <div
            style={{
              marginTop: 32,
              paddingTop: 20,
              borderTop: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {currentStep > 1 ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={handlePrev}
                disabled={isSubmitting}
                style={{ padding: '10px 20px', fontWeight: 600 }}
              >
                ← Previous Step
              </button>
            ) : (
              <div />
            )}

            {currentStep < 4 ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleNext}
                style={{ padding: '10px 24px', fontWeight: 700, background: '#3B5BDB' }}
              >
                Continue to Step {currentStep + 1} →
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveAndFinish}
                disabled={isSubmitting}
                style={{
                  padding: '10px 28px',
                  fontWeight: 800,
                  fontSize: 14,
                  background: isSubmitting ? '#94A3B8' : '#10B981',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                }}
              >
                {isSubmitting ? 'Saving to Firestore...' : '✓ Save & Complete Setup'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer Branding */}
      <div style={{ marginTop: 24, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
        Legendary One Business OS • Secure Firestore Persistent Storage
      </div>
    </div>
  );
}
