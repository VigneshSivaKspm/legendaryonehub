import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  checkImportAccess,
  planLedgerImport,
  runLedgerImport,
  LedgerImportError,
  type LedgerImportPlan,
} from '../services/ledgerImportService';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** Settings → Data Import: preview and run the one-time 2026 ledger import. */
export default function LedgerImport() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [plan, setPlan] = useState<LedgerImportPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [access, setAccess] = useState<Awaited<ReturnType<typeof checkImportAccess>> | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setAccess(await checkImportAccess());
      setPlan(await planLedgerImport());
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleImport = async () => {
    setImporting(true);
    setImportError('');
    try {
      const done = await runLedgerImport(user);
      showToast(
        `Imported ${done.newClients} new clients, ${done.newProjects} projects, ${done.newPayments} payments, ${done.newExpenses} project expenses, ${done.newCompanyExpenses} company expenses and ${done.newCredentials} logins.`,
        'success'
      );
      await refresh();
    } catch (err: any) {
      const stageErr = err instanceof LedgerImportError ? err : null;
      const cause = stageErr ? stageErr.cause : err;
      const denied = cause?.code === 'permission-denied' || /permission/i.test(cause?.message || '');
      const saved = stageErr?.savedStages.length ? ` Already saved: ${stageErr.savedStages.join(', ')}.` : ' Nothing was saved.';
      const msg = denied
        ? `Firestore rules blocked writing ${stageErr ? `"${stageErr.collectionName}"` : 'the data'}.${saved} Publish the latest firestore.rules in Firebase Console → Firestore Database → Rules, then click Import again (it continues where it stopped).`
        : `Import stopped${stageErr ? ` at ${stageErr.stage}` : ''}: ${cause?.message || cause}.${saved}`;
      setImportError(msg);
      showToast(msg, 'error');
      await refresh();
    } finally {
      setImporting(false);
    }
  };

  const nothingLeft =
    !!plan && plan.newClients === 0 && plan.newProjects === 0 && plan.newPayments === 0 && plan.newExpenses === 0 && plan.newCredentials === 0 && plan.newCompanyExpenses === 0;

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 18, color: '#1A1F36' }}>Import Business Ledgers (2025 & 2026)</div>
      <div style={{ fontSize: 13, color: '#697586', margin: '4px 0 18px', lineHeight: 1.5 }}>
        Adds both ledgers: one client per person with all of their projects, a payment for every amount received,
        domain costs / expenses / commissions, and every login from the sheets (kept in the admin-only Access tab of
        each project). Existing clients are matched by phone number. Running it again never creates duplicates.
      </div>

      {access && (
        <div
          style={{
            fontSize: 12.5,
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 14,
            background: access.isAdmin ? '#ECFDF5' : '#FEF2F2',
            color: access.isAdmin ? '#065F46' : '#991B1B',
            lineHeight: 1.5,
          }}
        >
          {access.isAdmin ? (
            <>
              Signed in as <strong>{access.email}</strong> · profile role <strong>{access.role}</strong>. The database rules treat this
              account as an Owner/Admin.
            </>
          ) : !access.profileFound ? (
            <>
              No profile document found at <code>users/{access.uid}</code> for {access.email}. The rules only allow accounts with a
              profile. In Firebase Console → Firestore, create that document with <code>role: "Owner"</code>,{' '}
              <code>status: "Active"</code> and your email.
            </>
          ) : (
            <>
              Profile role is <strong>{access.role || '(empty)'}</strong>, status <strong>{access.status}</strong>. Importing
              logins needs a role containing "Owner" or "Admin" and status Active.
            </>
          )}
        </div>
      )}

      {importError && (
        <div style={{ fontSize: 12.5, color: '#991B1B', background: '#FEF2F2', borderRadius: 10, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
          {importError}
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: '#697586' }}>Checking what's already in the workspace…</div>}
      {error && <div style={{ fontSize: 13, color: '#EF4444' }}>Could not read the workspace: {error}</div>}

      {plan && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              ['Clients', `${plan.newClients} new · ${plan.matchedClients} existing`],
              ['Projects', `${plan.newProjects} new${plan.skippedProjects ? ` · ${plan.skippedProjects} done` : ''}`],
              ['Payments', `${plan.newPayments} to add`],
              ['Expenses', `${plan.newExpenses} to add`],
              ['Logins', `${plan.newCredentials} to add`],
              ['Company expenses', `${plan.newCompanyExpenses} to add · ${inr(plan.totals.companyExpenses)}`],
              ['Total budget', inr(plan.totals.budget)],
              ['Received', inr(plan.totals.received)],
              ['Balance', inr(plan.totals.balance)],
              ['Project expenses + commission', inr(plan.totals.expenses)],
            ].map(([label, value]) => (
              <div key={label} style={{ background: '#F8F9FC', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#697586', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1F36', marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>

          {plan.newServices.length > 0 && (
            <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 12 }}>
              Services added to the catalog: {plan.newServices.join(', ')}
            </div>
          )}

          <div style={{ border: '1px solid #E5E9F2', borderRadius: 10, maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>CLIENT</th>
                  <th>COMPANY</th>
                  <th>PHONE</th>
                  <th style={{ textAlign: 'center' }}>PROJECTS</th>
                  <th style={{ textAlign: 'right' }}>TOTAL</th>
                  <th style={{ textAlign: 'right' }}>RECEIVED</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plan.clients.map((c) => (
                  <tr key={c.ledger.key}>
                    <td style={{ fontWeight: 600 }}>{c.ledger.contact}</td>
                    <td style={{ color: '#697586' }}>{c.ledger.company || '—'}</td>
                    <td style={{ color: '#697586' }}>{c.ledger.phone}</td>
                    <td style={{ textAlign: 'center' }}>{c.projectCount}</td>
                    <td style={{ textAlign: 'right' }}>{inr(c.total)}</td>
                    <td style={{ textAlign: 'right', color: '#12B76A' }}>{inr(c.received)}</td>
                    <td>
                      <span className={`badge ${c.existing ? 'badge-blue' : 'badge-green'}`}>
                        {c.existing ? `Existing: ${c.existing.contact || c.existing.name}` : 'New'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={refresh} disabled={importing}>
              Re-check
            </button>
            <button type="button" className="btn-primary" onClick={handleImport} disabled={importing || nothingLeft}>
              {importing ? 'Importing…' : nothingLeft ? 'Already imported' : 'Import into workspace'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
