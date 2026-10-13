import type { CompanyService, Project } from '../db/database';
import { SUB_SERVICES, ONGOING_SERVICES, LEGACY_SERVICE_MAP, itemTypesFor } from '../utils/serviceCatalog';

type FormData = Omit<Project, 'id'>;
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;

/** Service dropdown: active services only (archived ones such as the old Video Editing are hidden). */
export function ServiceSelect({ formData, setFormData, services }: { formData: FormData; setFormData: (f: FormData) => void; services: CompanyService[] }) {
  const options = services
    .filter((s) => s.status !== 'Archived' && !LEGACY_SERVICE_MAP[s.name])
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b));
  if (formData.serviceName && !options.includes(formData.serviceName)) options.unshift(formData.serviceName);
  return (
    <select
      className="select-base"
      style={{ width: '100%' }}
      value={formData.serviceName}
      onChange={(e) => {
        const serviceName = e.target.value;
        setFormData({ ...formData, serviceName, subServices: [], ongoing: ONGOING_SERVICES.has(serviceName) || formData.ongoing });
      }}
    >
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

/**
 * Sub-categories for the chosen service, the "ongoing" switch and, for ongoing work,
 * the monthly retainer and per-item rates. Spans both columns of the project form grid.
 */
export default function ProjectServiceFields({
  formData,
  setFormData,
  error,
}: {
  formData: FormData;
  setFormData: (f: FormData) => void;
  /** Billing error from validation (ongoing projects need a retainer or a rate) */
  error?: string;
}) {
  const sub = SUB_SERVICES[formData.serviceName];
  const selected = formData.subServices || [];
  const rates = formData.itemRates || {};

  const toggle = (opt: string) => {
    const next = sub?.mode === 'single' ? [opt] : selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
    setFormData({ ...formData, subServices: next });
  };

  return (
    <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sub && (
        <div>
          <label style={labelStyle}>
            {sub.label} <span style={{ fontWeight: 400, color: '#697586' }}>({sub.mode === 'multi' ? 'select one or more' : 'select one'})</span>
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sub.options.map((opt) => {
              const on = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: `1px solid ${on ? '#3B5BDB' : '#D0D5DD'}`,
                    background: on ? '#EEF4FF' : '#fff',
                    color: on ? '#3B5BDB' : '#475569',
                  }}
                >
                  {sub.mode === 'multi' ? (on ? '☑ ' : '☐ ') : on ? '● ' : '○ '}
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 10,
          border: `1px solid ${formData.ongoing ? '#B2CCFF' : '#E5E9F2'}`,
          background: formData.ongoing ? '#F5F8FF' : '#F8F9FC',
          cursor: 'pointer',
        }}
      >
        <input type="checkbox" style={{ marginTop: 3 }} checked={!!formData.ongoing} onChange={(e) => setFormData({ ...formData, ongoing: e.target.checked })} />
        <span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1A1F36' }}>Ongoing project (never ends)</span>
          <span style={{ display: 'block', fontSize: 12, color: '#697586' }}>
            Billed every month from a retainer and/or per-item rates. Managed in Projects → Ongoing Works, where you log counts and payments.
          </span>
        </span>
      </label>

      {formData.ongoing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle}>Monthly Retainer (₹)</label>
            <input
              className="input-base"
              type="number"
              min="0"
              placeholder="0 if none"
              value={formData.monthlyRetainer || ''}
              onChange={(e) => setFormData({ ...formData, monthlyRetainer: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
          {itemTypesFor(formData).map((type) => (
            <div key={type}>
              <label style={labelStyle}>Rate per {type} (₹)</label>
              <input
                className="input-base"
                type="number"
                min="0"
                placeholder="0 if not charged"
                value={rates[type] || ''}
                onChange={(e) => setFormData({ ...formData, itemRates: { ...rates, [type]: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </div>
          ))}
          <div>
            <label style={labelStyle} title="Agreed before this became an ongoing project; billed once, in the start month">
              Opening Amount (₹)
            </label>
            <input
              className="input-base"
              type="number"
              min="0"
              placeholder="Earlier agreed value"
              value={formData.openingAmount ?? ''}
              onChange={(e) =>
                setFormData({ ...formData, openingAmount: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </div>
        </div>
      )}
      {formData.ongoing && (
        <div style={{ fontSize: 11.5, color: '#697586', marginTop: -4 }}>
          Opening amount = the fixed value agreed before it became ongoing (e.g. the first batch of work). It's billed once, in the start month, so
          earlier payments are matched against it.
        </div>
      )}
      {formData.ongoing && error &&<div style={{ fontSize: 11.5, color: '#EF4444', marginTop: -4 }}>{error}</div>}
    </div>
  );
}
