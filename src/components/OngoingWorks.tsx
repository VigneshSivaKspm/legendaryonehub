import { useEffect, useMemo, useRef, useState } from 'react';
import type { Client, Deliverable, Invoice, Payment, Project } from '../db/database';
import { useToast } from '../context/ToastContext';
import { addDeliverable, deleteDeliverable } from '../services/deliverableService';
import { addPayment } from '../services/paymentService';
import { syncOngoingProjectValue } from '../services/serviceCatalogService';
import EmployeeSelect from './EmployeeSelect';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import { clientLabel, paymentsForProject } from '../utils/financials';
import {
  currentMonth,
  itemTypesFor,
  monthLabel,
  monthOf,
  ongoingStatement,
  subServiceLabel,
  workFor,
  type OngoingStatement,
} from '../utils/serviceCatalog';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const today = () => new Date().toISOString().split('T')[0];
const prettyDate = (d?: string) => {
  const iso = /^\d{4}-\d{2}-\d{2}/.test(d || '') ? d!.slice(0, 10) : '';
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : d || '—';
};
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1A1F36', marginBottom: 5 } as const;
const METHODS = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Card'];

interface Props {
  projects: Project[];
  clients: Client[];
  deliverables: Deliverable[];
  payments: Payment[];
  invoices: Invoice[];
  onEdit: (p: Project, e: React.MouseEvent) => void;
}

/**
 * Projects → Ongoing Works: never-ending client work (media production, ads, organic marketing, SEO)
 * grouped by client, with monthly counts, retainer billing, payments and a running statement.
 */
export default function OngoingWorks({ projects, clients, deliverables, payments, invoices, onEdit }: Props) {
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('All');
  const [serviceFilter, setServiceFilter] = useState('All');
  const [busy, setBusy] = useState(false);

  const [statementFor, setStatementFor] = useState<Project | null>(null);
  const [statementTab, setStatementTab] = useState<'statement' | 'work' | 'payments'>('statement');
  const [countFor, setCountFor] = useState<Project | null>(null);
  const [countForm, setCountForm] = useState<{ date: string; employee: string; description: string; qty: Record<string, string>; rate: Record<string, string>; customType: string }>({
    date: today(),
    employee: '',
    description: '',
    qty: {},
    rate: {},
    customType: '',
  });
  const [payFor, setPayFor] = useState<Project | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: today(), method: 'UPI', reference: '' });
  const [workToDelete, setWorkToDelete] = useState<Deliverable | null>(null);

  const statements = useMemo(() => {
    const map = new Map<string, OngoingStatement>();
    projects.forEach((p) => map.set(String(p.id), ongoingStatement(p, deliverables, payments, invoices)));
    return map;
  }, [projects, deliverables, payments, invoices]);

  // Keep each project's stored value equal to what's been billed (retainer months roll over on their own)
  const syncing = useRef(false);
  useEffect(() => {
    if (syncing.current) return;
    const drifted = projects.filter((p) => Math.round(statements.get(String(p.id))?.billed || 0) !== Math.round(Number(p.value) || 0));
    if (drifted.length === 0) return;
    syncing.current = true;
    (async () => {
      for (const p of drifted) {
        try {
          await syncOngoingProjectValue(p);
        } catch (err) {
          console.warn('[OngoingWorks] value sync failed for', p.name, err);
        }
      }
      syncing.current = false;
    })();
  }, [projects, statements]);

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
      acc.outstanding += st?.outstanding || 0;
      return acc;
    },
    { billed: 0, received: 0, outstanding: 0 }
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

  // ---------- actions ----------
  const openCount = (p: Project) => {
    const rate: Record<string, string> = {};
    itemTypesFor(p).forEach((t) => (rate[t] = p.itemRates?.[t] ? String(p.itemRates[t]) : ''));
    setCountForm({ date: today(), employee: '', description: '', qty: {}, rate, customType: '' });
    setCountFor(p);
  };

  const saveCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!countFor) return;
    const types = [...itemTypesFor(countFor), ...(countForm.customType.trim() ? [countForm.customType.trim()] : [])];
    const entries = types
      .map((type) => ({ type, qty: Number(countForm.qty[type]) || 0, rate: Number(countForm.rate[type]) || 0 }))
      .filter((x) => x.qty > 0);
    if (entries.length === 0) {
      showToast('Enter a count for at least one item.', 'error');
      return;
    }
    setBusy(true);
    try {
      for (const x of entries) {
        await addDeliverable({
          client: countFor.clientName,
          clientId: countFor.clientId,
          type: x.type,
          description: countForm.description.trim() || `${x.type} for ${countFor.name}`,
          qty: x.qty,
          rate: x.rate,
          amount: x.qty * x.rate,
          date: countForm.date,
          employee: countForm.employee,
          period: monthOf(countForm.date),
          status: 'Approved',
          projectId: countFor.id,
          projectName: countFor.name,
        });
      }
      await syncOngoingProjectValue({ ...countFor });
      showToast(`Logged ${entries.map((x) => `${x.qty} ${x.type}`).join(', ')} for ${countFor.name}.`, 'success');
      setCountFor(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not save the counts.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openPay = (p: Project) => {
    const outstanding = statements.get(String(p.id))?.outstanding || 0;
    setPayForm({ amount: outstanding ? String(Math.round(outstanding)) : '', date: today(), method: 'UPI', reference: '' });
    setPayFor(p);
  };

  const savePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payFor) return;
    const amount = Number(payForm.amount);
    if (!(amount > 0)) {
      showToast('Enter an amount greater than 0.', 'error');
      return;
    }
    setBusy(true);
    try {
      await addPayment({
        paymentNumber: `PAY-${Date.now().toString().slice(-6)}`,
        clientName: payFor.clientName,
        clientId: payFor.clientId,
        projectId: payFor.id,
        projectName: payFor.name,
        amount,
        date: payForm.date,
        method: payForm.method,
        referenceNumber: payForm.reference.trim() || undefined,
        status: 'Confirmed',
      });
      await syncOngoingProjectValue({ ...payFor });
      showToast(`${inr(amount)} received from ${payFor.clientName}.`, 'success');
      setPayFor(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not record the payment.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteWork = async () => {
    if (!workToDelete?.id) return;
    setBusy(true);
    try {
      await deleteDeliverable(workToDelete.id);
      const p = projects.find((x) => String(x.id) === String(workToDelete.projectId));
      if (p) await syncOngoingProjectValue(p);
      showToast('Entry removed.', 'info');
      setWorkToDelete(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not remove the entry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const billingLine = (p: Project) => {
    const parts = [
      p.monthlyRetainer ? `${inr(p.monthlyRetainer)}/month` : '',
      ...Object.entries(p.itemRates || {})
        .filter(([, r]) => Number(r) > 0)
        .map(([t, r]) => `${t} ${inr(r)}`),
    ].filter(Boolean);
    return parts.join(' · ') || 'No rates set';
  };

  // ---------- render ----------
  if (projects.length === 0) {
    return (
      <div style={{ padding: '48px 16px', textAlign: 'center', color: '#697586' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔁</div>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#1A1F36', marginBottom: 4 }}>No ongoing works yet</div>
        <div style={{ fontSize: 13, maxWidth: 460, margin: '0 auto' }}>
          Create a project (or edit one) and tick <strong>Ongoing project</strong>. Media Works, Digital Marketing, Organic Marketing and SEO
          projects start as ongoing automatically.
        </div>
      </div>
    );
  }

  const st = statementFor ? statements.get(String(statementFor.id)) : undefined;

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
          { label: `Billed · ${monthLabel(month)}`, value: inr(totals.billed), color: '#3B5BDB' },
          { label: `Received · ${monthLabel(month)}`, value: inr(totals.received), color: '#12B76A' },
          { label: 'Outstanding (all months)', value: inr(totals.outstanding), color: totals.outstanding ? '#F59E0B' : '#12B76A' },
        ].map((c) => (
          <div key={c.label} className="stat-card" style={{ flex: '1 1 170px' }}>
            <div style={{ fontSize: 11.5, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.color, fontFamily: 'Plus Jakarta Sans' }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: 11.5, color: '#697586' }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Clients */}
      {groups.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: '#697586' }}>No ongoing works match your filters.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {groups.map(({ list, client, outstanding }) => (
          <div key={String(list[0].clientId || list[0].clientName)} style={{ border: '1px solid #E5E9F2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: '#F8F9FC', borderBottom: '1px solid #E5E9F2' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>{client ? clientLabel(client) : list[0].clientName}</div>
                <div style={{ fontSize: 11.5, color: '#697586' }}>
                  {list.length} ongoing work{list.length > 1 ? 's' : ''}
                  {client?.phone ? ` · ${client.phone}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: '#697586' }}>
                Outstanding <strong style={{ color: outstanding ? '#F59E0B' : '#12B76A', fontSize: 14 }}>{inr(outstanding)}</strong>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>WORK</th>
                    <th>BILLING</th>
                    <th>{monthLabel(month).toUpperCase()} COUNTS</th>
                    <th style={{ textAlign: 'right' }}>BILLED</th>
                    <th style={{ textAlign: 'right' }}>RECEIVED</th>
                    <th style={{ textAlign: 'right' }}>OUTSTANDING</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const m = monthRow(p);
                    const pst = statements.get(String(p.id));
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3, alignItems: 'center' }}>
                            <span className="badge badge-blue" style={{ fontSize: 10.5 }}>{p.serviceName}</span>
                            {(p.subServices || []).map((s) => (
                              <span key={s} className="badge badge-gray" style={{ fontSize: 10.5 }}>
                                {s}
                              </span>
                            ))}
                            {p.status !== 'In Progress' && <span className="badge badge-amber" style={{ fontSize: 10.5 }}>{p.status}</span>}
                          </div>
                        </td>
                        <td style={{ fontSize: 12, color: '#475569', maxWidth: 200 }}>{billingLine(p)}</td>
                        <td style={{ fontSize: 12.5 }}>
                          {m && m.items.length ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {m.items.map((i) => (
                                <span key={i.type} className="badge badge-purple" style={{ fontSize: 11 }}>
                                  {i.type} × {i.qty}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: '#94A3B8' }}>Nothing logged</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(m?.billed || 0)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#12B76A' }}>{inr(m?.received || 0)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: pst?.outstanding ? '#F59E0B' : '#12B76A' }}>{inr(pst?.outstanding || 0)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button className="btn-primary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => openCount(p)}>
                              + Count
                            </button>
                            <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px', color: '#12B76A', borderColor: '#ABEFC6' }} onClick={() => openPay(p)}>
                              + Payment
                            </button>
                            <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => { setStatementTab('statement'); setStatementFor(p); }}>
                              Statement
                            </button>
                            <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={(e) => onEdit(p, e)}>
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Log counts */}
      {countFor && (
        <div className="modal-overlay" onClick={() => !busy && setCountFor(null)}>
          <div className="modal-box" style={{ width: 520, maxWidth: '100%', padding: 26, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>Log Work Done</div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 16 }}>
              {countFor.name} · {countFor.clientName}
            </div>
            <form onSubmit={saveCount}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Date *</label>
                  <input className="input-base" type="date" value={countForm.date} onChange={(e) => setCountForm({ ...countForm, date: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Done by</label>
                  <EmployeeSelect value={countForm.employee} onChange={(name) => setCountForm({ ...countForm, employee: name })} placeholder="Select employee" />
                </div>
              </div>
              <div style={{ border: '1px solid #E5E9F2', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>ITEM</th>
                      <th style={{ width: 90 }}>COUNT</th>
                      <th style={{ width: 110 }}>RATE (₹)</th>
                      <th style={{ textAlign: 'right' }}>AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...itemTypesFor(countFor), 'custom'].map((type) => {
                      const key = type === 'custom' ? countForm.customType.trim() : type;
                      const qty = Number(countForm.qty[key]) || 0;
                      const rate = Number(countForm.rate[key]) || 0;
                      return (
                        <tr key={type}>
                          <td>
                            {type === 'custom' ? (
                              <input
                                className="input-base"
                                style={{ fontSize: 12.5, padding: '4px 8px' }}
                                placeholder="Other item (e.g. Reel)"
                                value={countForm.customType}
                                onChange={(e) => {
                                  const old = countForm.customType.trim();
                                  const next = e.target.value;
                                  const q = { ...countForm.qty };
                                  const r = { ...countForm.rate };
                                  if (old) {
                                    q[next.trim()] = q[old];
                                    r[next.trim()] = r[old];
                                    delete q[old];
                                    delete r[old];
                                  }
                                  setCountForm({ ...countForm, customType: next, qty: q, rate: r });
                                }}
                              />
                            ) : (
                              <strong style={{ fontSize: 13 }}>{type}</strong>
                            )}
                          </td>
                          <td>
                            <input
                              className="input-base"
                              type="number"
                              min="0"
                              style={{ fontSize: 12.5, padding: '4px 8px' }}
                              disabled={type === 'custom' && !key}
                              value={countForm.qty[key] || ''}
                              onChange={(e) => setCountForm({ ...countForm, qty: { ...countForm.qty, [key]: e.target.value } })}
                            />
                          </td>
                          <td>
                            <input
                              className="input-base"
                              type="number"
                              min="0"
                              style={{ fontSize: 12.5, padding: '4px 8px' }}
                              disabled={type === 'custom' && !key}
                              value={countForm.rate[key] || ''}
                              onChange={(e) => setCountForm({ ...countForm, rate: { ...countForm.rate, [key]: e.target.value } })}
                            />
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{qty ? inr(qty * rate) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <label style={labelStyle}>Note</label>
              <input className="input-base" placeholder="e.g. Diwali campaign creatives" value={countForm.description} onChange={(e) => setCountForm({ ...countForm, description: e.target.value })} />
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 8 }}>
                Counts are billed in the month of the date. Rate 0 = included in the retainer. Entries also appear on the Deliverables page.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setCountFor(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving...' : 'Save Counts'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment */}
      {payFor && (
        <div className="modal-overlay" onClick={() => !busy && setPayFor(null)}>
          <div className="modal-box" style={{ width: 440, maxWidth: '100%', padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>Record Payment</div>
            <div style={{ fontSize: 12.5, color: '#697586', marginBottom: 16 }}>
              {payFor.name} · {payFor.clientName} · outstanding {inr(statements.get(String(payFor.id))?.outstanding || 0)}
            </div>
            <form onSubmit={savePay}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Amount (₹) *</label>
                  <input className="input-base" type="number" min="1" autoFocus value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Date *</label>
                  <input className="input-base" type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Method</label>
                  <select className="select-base" style={{ width: '100%' }} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Reference</label>
                  <input className="input-base" placeholder="UPI ref / cheque no." value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: '#697586', marginTop: 10 }}>Also listed on the Payments page and the client's balance.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn-secondary" onClick={() => setPayFor(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement */}
      {statementFor && st && (
        <div className="modal-overlay" onClick={() => setStatementFor(null)}>
          <div className="modal-box" style={{ width: 860, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #E5E9F2', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 17, color: '#1A1F36' }}>{statementFor.name}</div>
                <div style={{ fontSize: 12.5, color: '#697586' }}>
                  {statementFor.clientName} · {statementFor.serviceName}
                  {subServiceLabel(statementFor) ? ` (${subServiceLabel(statementFor)})` : ''} · {billingLine(statementFor)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => openCount(statementFor)}>
                  + Count
                </button>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => openPay(statementFor)}>
                  + Payment
                </button>
                <button style={{ background: 'none', border: 'none', fontSize: 20, color: '#697586', cursor: 'pointer' }} onClick={() => setStatementFor(null)}>
                  ×
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, padding: '12px 22px', flexWrap: 'wrap' }}>
              {[
                ['Billed to date', inr(st.billed), '#1A1F36'],
                ['Received', inr(st.received), '#12B76A'],
                ['Outstanding', inr(st.outstanding), st.outstanding ? '#F59E0B' : '#12B76A'],
              ].map(([k, v, c]) => (
                <div key={k} style={{ flex: '1 1 150px', background: '#F8F9FC', borderRadius: 10, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: '#697586', fontWeight: 600, textTransform: 'uppercase' }}>{k}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '0 22px', borderBottom: '1px solid #E5E9F2', display: 'flex', gap: 4 }}>
              {(
                [
                  ['statement', 'Monthly Statement'],
                  ['work', `Work Log (${workFor(statementFor, deliverables).length})`],
                  ['payments', `Payments (${paymentsForProject(statementFor, payments, invoices).length})`],
                ] as const
              ).map(([key, label]) => (
                <button key={key} className={`tab-btn${statementTab === key ? ' active' : ''}`} style={{ padding: '8px 12px' }} onClick={() => setStatementTab(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {statementTab === 'statement' && (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>MONTH</th>
                      <th style={{ textAlign: 'right' }}>RETAINER</th>
                      <th>WORK</th>
                      <th style={{ textAlign: 'right' }}>BILLED</th>
                      <th style={{ textAlign: 'right' }}>RECEIVED</th>
                      <th style={{ textAlign: 'right' }}>BALANCE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...st.months].reverse().map((m) => (
                      <tr key={m.month}>
                        <td style={{ fontWeight: 600 }}>{monthLabel(m.month)}</td>
                        <td style={{ textAlign: 'right' }}>{m.retainer ? inr(m.retainer) : '—'}</td>
                        <td style={{ fontSize: 12 }}>{m.items.length ? m.items.map((i) => `${i.type} × ${i.qty} (${inr(i.amount)})`).join(' · ') : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(m.billed)}</td>
                        <td style={{ textAlign: 'right', color: '#12B76A', fontWeight: 600 }}>{m.received ? inr(m.received) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: m.balance > 0 ? '#F59E0B' : '#12B76A' }}>{inr(m.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {statementTab === 'work' && (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>ITEM</th>
                      <th style={{ textAlign: 'center' }}>COUNT</th>
                      <th style={{ textAlign: 'right' }}>RATE</th>
                      <th style={{ textAlign: 'right' }}>AMOUNT</th>
                      <th>BY</th>
                      <th>NOTE</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {workFor(statementFor, deliverables).length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                          No work logged yet. Use + Count to add videos, posters and more.
                        </td>
                      </tr>
                    ) : (
                      [...workFor(statementFor, deliverables)]
                        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
                        .map((w) => (
                          <tr key={w.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{prettyDate(w.date)}</td>
                            <td>
                              <span className="badge badge-purple">{w.type}</span>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{w.qty}</td>
                            <td style={{ textAlign: 'right' }}>{inr(w.rate)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(Number(w.amount ?? w.qty * w.rate))}</td>
                            <td style={{ fontSize: 12.5 }}>{w.employee || '—'}</td>
                            <td style={{ fontSize: 12, color: '#697586', maxWidth: 180 }}>{w.description}</td>
                            <td>
                              <button
                                className="btn-secondary"
                                style={{ fontSize: 11, padding: '3px 8px', color: '#EF4444', borderColor: '#FCA5A5' }}
                                onClick={() => setWorkToDelete(w)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              )}

              {statementTab === 'payments' && (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>PAYMENT #</th>
                      <th>METHOD</th>
                      <th>REFERENCE</th>
                      <th>STATUS</th>
                      <th style={{ textAlign: 'right' }}>AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsForProject(statementFor, payments, invoices).length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#697586' }}>
                          No payments yet.
                        </td>
                      </tr>
                    ) : (
                      [...paymentsForProject(statementFor, payments, invoices)]
                        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
                        .map((pm) => (
                          <tr key={pm.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{prettyDate(pm.date)}</td>
                            <td style={{ fontSize: 12.5, color: '#3B5BDB', fontWeight: 600 }}>{pm.paymentNumber}</td>
                            <td>{pm.method}</td>
                            <td style={{ fontSize: 12.5, color: '#697586' }}>{pm.referenceNumber || '—'}</td>
                            <td>
                              <span className={`badge ${pm.status === 'Confirmed' ? 'badge-green' : pm.status === 'Pending' ? 'badge-amber' : 'badge-red'}`}>{pm.status}</span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#12B76A' }}>{inr(pm.amount)}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {workToDelete && (
        <DeleteConfirmationModal
          isOpen={!!workToDelete}
          title="Remove Work Entry"
          itemName={`${workToDelete.type} × ${workToDelete.qty}`}
          description={
            <>
              Remove <strong style={{ color: '#1A1F36' }}>{workToDelete.type} × {workToDelete.qty}</strong> from {prettyDate(workToDelete.date)}? The bill for that month goes down by{' '}
              {inr(Number(workToDelete.amount ?? workToDelete.qty * workToDelete.rate))}.
            </>
          }
          isDeleting={busy}
          onConfirm={confirmDeleteWork}
          onClose={() => setWorkToDelete(null)}
        />
      )}
    </div>
  );
}
