import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Wallet } from 'lucide-react';
import { db, type Client, type Deliverable, type Invoice, type Payment, type Project } from '../db/database';
import { isTaskDone } from '../utils/attendanceTimes';
import { clientLabel } from '../utils/financials';
import { currentMonth, monthLabel, ongoingStatement, subServiceLabel, getOngoingCategoryBadge, getOngoingCategoryName, type OngoingStatement } from '../utils/serviceCatalog';
import { PaymentModal, billingLine, inr } from './OngoingDialogs';

interface Props {
  projects: Project[];
  clients: Client[];
  deliverables: Deliverable[];
  payments: Payment[];
  invoices: Invoice[];
  /** Open the project's own page */
  onOpen: (p: Project) => void;
}

/**
 * Projects → Ongoing Works: a compact list of never-ending client work grouped by client.
 * Everything else (work, tasks, daily posts, payments, statement, editing) is on the project's page.
 */
export default function OngoingWorks({ projects, clients, deliverables, payments, invoices, onOpen }: Props) {
  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('All');
  const [serviceFilter, setServiceFilter] = useState('All');
  const [payFor, setPayFor] = useState<Project | null>(null);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];

  const statements = useMemo(() => {
    const map = new Map<string, OngoingStatement>();
    projects.forEach((p) => map.set(String(p.id), ongoingStatement(p, deliverables, payments, invoices)));
    return map;
  }, [projects, deliverables, payments, invoices]);

  const openTasksFor = (p: Project) => tasks.filter((t) => String(t.projectId ?? '') === String(p.id) && !isTaskDone(t)).length;

  const filtered = projects.filter((p) => {
    const q = search.trim().toLowerCase();
    if (q && ![p.name, p.clientName, p.serviceName, subServiceLabel(p)].some((v) => (v || '').toLowerCase().includes(q))) return false;
    if (clientFilter !== 'All' && String(p.clientId) !== clientFilter) return false;
    if (serviceFilter !== 'All' && p.serviceName !== serviceFilter) return false;
    return true;
  });

  const monthRow = (p: Project) => statements.get(String(p.id))?.months.find((m) => m.month === month);
  const totals = filtered.reduce(
    (acc, p) => {
      const st = statements.get(String(p.id));
      const m = monthRow(p);
      acc.billed += m?.billed || 0;
      acc.received += m?.received || 0;
      acc.totalBilled += st?.billed || 0;
      acc.totalReceived += st?.received || 0;
      acc.outstanding += st?.outstanding || 0;
      acc.advance += st?.advance || 0;
      return acc;
    },
    { billed: 0, received: 0, totalBilled: 0, totalReceived: 0, outstanding: 0, advance: 0 }
  );

  // Group by client, clients with most outstanding first
  const groups = useMemo(() => {
    const byClient = new Map<string, Project[]>();
    filtered.forEach((p) => {
      const key = String(p.clientId || p.clientName);
      byClient.set(key, [...(byClient.get(key) || []), p]);
    });
    return Array.from(byClient.values())
      .map((list) => ({
        list,
        client: clients.find((c) => String(c.id) === String(list[0].clientId)),
        outstanding: list.reduce((s, p) => s + (statements.get(String(p.id))?.outstanding || 0), 0),
      }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [filtered, clients, statements]);

  const serviceOptions = Array.from(new Set(projects.map((p) => p.serviceName))).sort();
  const clientOptions = Array.from(new Map(projects.map((p) => [String(p.clientId), p.clientName])).entries());

  if (projects.length === 0) {
    return (
      <div style={{ padding: '48px 16px', textAlign: 'center', color: '#697586' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔁</div>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#1A1F36', marginBottom: 4 }}>No ongoing works yet</div>
        <div style={{ fontSize: 13, maxWidth: 460, margin: '0 auto' }}>
          Create a project (or edit one) and tick <strong>Ongoing project</strong>. Media Works, Digital Marketing, Organic Marketing and SEO projects start as
          ongoing automatically.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input className="input-base" type="month" style={{ width: 170, fontSize: 13 }} value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} />
        <input className="input-base" style={{ fontSize: 13, flex: '1 1 200px', maxWidth: 280 }} placeholder="Search client, project, service..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select-base" style={{ fontSize: 13 }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="All">All Clients</option>
          {clientOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select className="select-base" style={{ fontSize: 13 }} value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
          <option value="All">All Services</option>
          {serviceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { label: 'Ongoing Works', value: String(filtered.length), sub: `${groups.length} client(s)`, color: '#1A1F36' },
          { label: 'Total Billed', value: inr(totals.totalBilled), sub: `${monthLabel(month)}: ${inr(totals.billed)}`, color: '#3B5BDB' },
          { label: 'Total Received', value: inr(totals.totalReceived), sub: `${monthLabel(month)}: ${inr(totals.received)}`, color: '#12B76A' },
          {
            label: 'Outstanding',
            value: inr(totals.outstanding),
            sub: totals.advance ? `${inr(totals.advance)} paid in advance` : 'Billed − received',
            color: totals.outstanding ? '#F59E0B' : '#12B76A',
          },
        ].map((c) => (
          <div key={c.label} className="stat-card" style={{ flex: '1 1 170px' }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.color, fontFamily: 'Plus Jakarta Sans' }}>{c.value}</div>
            <div style={{ fontSize: 11.5, color: '#697586' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {groups.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: '#697586' }}>No ongoing works match your filters.</div>}

      {/* Clients */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {groups.map(({ list, client, outstanding }) => (
          <div key={String(list[0].clientId || list[0].clientName)} className="ow-group">
            <div className="ow-group-head">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>{client ? clientLabel(client) : list[0].clientName}</div>
                <div style={{ fontSize: 11.5, color: '#697586' }}>
                  {list.length} ongoing work{list.length > 1 ? 's' : ''}
                  {client?.phone ? ` · ${client.phone}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: '#697586', whiteSpace: 'nowrap' }}>
                Outstanding <strong style={{ color: outstanding ? '#F59E0B' : '#12B76A', fontSize: 14 }}>{inr(outstanding)}</strong>
              </div>
            </div>
            {list.map((p) => {
              const st = statements.get(String(p.id));
              const open = openTasksFor(p);
              const schedules = (p.schedules || []).filter((s) => s.active).length;
              return (
                <div
                  key={p.id}
                  className="ow-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(p)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(p)}
                >
                  <div className="ow-main">
                    <div className="ow-name">{p.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {(() => {
                        const badge = getOngoingCategoryBadge(p.serviceName);
                        return (
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: badge.color,
                              background: badge.bg,
                              border: `1px solid ${badge.border}`,
                              borderRadius: 5,
                              padding: '1px 6px',
                            }}
                          >
                            {badge.name}
                          </span>
                        );
                      })()}
                      {(p.subServices || []).map((s) => (
                        <span key={s} className="badge badge-gray" style={{ fontSize: 10.5 }}>
                          {s}
                        </span>
                      ))}
                      {p.status !== 'In Progress' && (
                        <span className="badge badge-amber" style={{ fontSize: 10.5 }}>
                          {p.status}
                        </span>
                      )}
                    </div>
                    <div className="ow-meta">
                      {billingLine(p)}
                      {open ? ` · ${open} open task${open > 1 ? 's' : ''}` : ''}
                      {schedules ? ` · ${schedules} daily post schedule${schedules > 1 ? 's' : ''}` : ''}
                    </div>
                  </div>
                  <div className="ow-money">
                    <div>
                      <span>Billed</span>
                      <strong>{inr(st?.billed || 0)}</strong>
                    </div>
                    <div>
                      <span>Received</span>
                      <strong style={{ color: '#12B76A' }}>{inr(st?.received || 0)}</strong>
                    </div>
                    <div>
                      <span>{st?.advance ? 'Advance' : 'Due'}</span>
                      <strong style={{ color: st?.advance ? '#12B76A' : st?.outstanding ? '#F59E0B' : '#12B76A' }}>{inr(st?.advance || st?.outstanding || 0)}</strong>
                    </div>
                  </div>
                  <div className="ow-actions">
                    <button
                      className="btn-secondary ow-pay"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPayFor(p);
                      }}
                      title="Record a payment"
                    >
                      <Wallet size={14} /> Payment
                    </button>
                    <ChevronRight size={20} color="#98A2B3" />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {payFor && (
        <PaymentModal project={payFor} suggested={statements.get(String(payFor.id))?.outstanding} onClose={() => setPayFor(null)} />
      )}
    </div>
  );
}
