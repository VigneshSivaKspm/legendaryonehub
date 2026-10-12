import { collection, doc, getDoc, getDocs, writeBatch, type WriteBatch } from 'firebase/firestore';
import { auth, dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type Client, type Project, type User } from '../db/database';
import { LEDGER_CLIENTS, LEDGER_ROWS, LEDGER_SERVICES, type LedgerClient, type LedgerRow } from '../data/ledgerData';
import { CREDENTIALS_COL } from './credentialService';
import { COMPANY_EXPENSES } from '../data/companyExpenses';

/**
 * One-time import of the business ledgers (older 2025 sheet + 2026 sheet).
 *
 * Idempotent: every record gets a fixed document id (ledger25_… / ledger26_…), and existing
 * clients are matched by phone (or exact name when the sheet has no phone), so running it again
 * never duplicates anything and never overwrites records edited after the import.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const ID = {
  client: (key: string) => `ledger26_client_${key}`,
  project: (r: LedgerRow) => `ledger${r.sheet}_project_${pad(r.sno)}`,
  payment: (r: LedgerRow, i: number) => `ledger${r.sheet}_payment_${pad(r.sno)}${i > 0 ? `_${i + 1}` : ''}`,
  expense: (r: LedgerRow, i: number) => `ledger${r.sheet}_expense_${pad(r.sno)}_${i + 1}`,
  credential: (r: LedgerRow, i: number) => `ledger${r.sheet}_cred_${pad(r.sno)}_${i + 1}`,
  service: (name: string) => `ledger26_service_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
  companyExpense: (sno: number) => `company26_expense_${pad(sno)}`,
};

const digits = (phone?: string) => (phone || '').replace(/\D/g, '').slice(-10);
const toIso = (ddmmyyyy: string) => {
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}-${m}-${d}`;
};
const formatPhone = (p: string) => (p ? `${p.slice(0, 5)} ${p.slice(5)}` : '');
const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
const rowIso = (r: LedgerRow) => (r.date ? toIso(r.date) : r.approx || '2025-06-01');
const paymentsOf = (r: LedgerRow) => (r.payments?.length ? r.payments : r.received > 0 ? [r.received] : []);

export interface LedgerImportPlan {
  clients: { ledger: LedgerClient; existing?: Client; projectCount: number; total: number; received: number }[];
  newClients: number;
  matchedClients: number;
  newProjects: number;
  skippedProjects: number;
  newPayments: number;
  newExpenses: number;
  newCredentials: number;
  newCompanyExpenses: number;
  newServices: string[];
  totals: { budget: number; received: number; balance: number; expenses: number; companyExpenses: number };
}

async function loadExisting() {
  const cols = ['clients', 'projects', 'payments', 'expenses', 'services'];
  const [clients, projects, payments, expenses, services] = await Promise.all(cols.map((c) => getDocs(collection(dbFirestore, c))));
  // Credentials are admin-only; a failed read just means none can be checked
  const creds = await getDocs(collection(dbFirestore, CREDENTIALS_COL)).catch(() => null);
  const ids = (snap: { docs: { id: string }[] } | null) => new Set((snap?.docs || []).map((d) => d.id));
  return {
    clients: clients.docs.map((d) => ({ ...(d.data() as Client), id: d.id })),
    projects: new Map(projects.docs.map((d) => [d.id, { ...(d.data() as Project & { importedBy?: string }), id: d.id }])),
    paymentIds: ids(payments),
    expenseIds: ids(expenses),
    credentialIds: ids(creds),
    serviceNames: new Set(services.docs.map((d) => String(d.data().name || '').toLowerCase())),
  };
}

function matchClient(ledger: LedgerClient, existing: Client[]): Client | undefined {
  const byId = existing.find((c) => c.id === ID.client(ledger.key));
  if (byId) return byId;
  if (ledger.phone) {
    return existing.find((c) => {
      if (digits(c.phone) !== ledger.phone) return false;
      // GV Sir and Rajesh Sir share the JKKM phone: for shared numbers the first name must match too
      const shared = LEDGER_CLIENTS.filter((l) => l.phone === ledger.phone).length > 1;
      return !shared || (c.contact || c.name || '').toLowerCase().startsWith(ledger.contact.split(' ')[0].toLowerCase());
    });
  }
  // No phone in the sheet: only an exact name match counts
  const name = ledger.contact.trim().toLowerCase();
  return existing.find((c) => (c.contact || '').trim().toLowerCase() === name || (c.name || '').trim().toLowerCase() === name);
}

function projectNotes(r: LedgerRow): string {
  const costs = (r.costs || []).reduce((s, c) => s + c.amount, 0);
  const parts = [r.notes];
  if (!r.date && r.approx) {
    parts.push(`Date not recorded in the ledger (approx. ${new Date(r.approx).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}).`);
  }
  if (r.payments && r.payments.length > 1) parts.push(`Received in parts: ${r.payments.map(inr).join(' + ')}.`);
  if (r.sheetProfit !== undefined && r.sheetProfit !== r.budget - costs) parts.push(`Profit written in the sheet: ${inr(r.sheetProfit)}.`);
  if (!r.extra) parts.push(`Ledger ${r.sheet === '25' ? '2025' : '2026'} · S.No ${r.sno}.`);
  return parts.filter(Boolean).join(' ');
}

export async function planLedgerImport(): Promise<LedgerImportPlan> {
  const ex = await loadExisting();
  const rowsFor = (key: string) => LEDGER_ROWS.filter((r) => r.client === key);

  const clients = LEDGER_CLIENTS.map((ledger) => {
    const rows = rowsFor(ledger.key);
    return {
      ledger,
      existing: matchClient(ledger, ex.clients),
      projectCount: rows.length,
      total: rows.reduce((s, r) => s + r.budget, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
    };
  });

  const newRows = LEDGER_ROWS.filter((r) => !ex.projects.has(ID.project(r)));
  const needed = new Set(LEDGER_ROWS.map((r) => r.service));
  return {
    clients,
    newClients: clients.filter((c) => !c.existing).length,
    matchedClients: clients.filter((c) => c.existing).length,
    newProjects: newRows.length,
    skippedProjects: LEDGER_ROWS.length - newRows.length,
    newPayments: LEDGER_ROWS.flatMap((r) => paymentsOf(r).map((_, i) => ID.payment(r, i))).filter((id) => !ex.paymentIds.has(id)).length,
    newExpenses: LEDGER_ROWS.flatMap((r) => (r.costs || []).map((_, i) => ID.expense(r, i))).filter((id) => !ex.expenseIds.has(id)).length,
    newCredentials: LEDGER_ROWS.flatMap((r) => (r.credentials || []).map((_, i) => ID.credential(r, i))).filter((id) => !ex.credentialIds.has(id)).length,
    newCompanyExpenses: COMPANY_EXPENSES.filter((e) => !ex.expenseIds.has(ID.companyExpense(e.sno))).length,
    newServices: LEDGER_SERVICES.filter((s) => needed.has(s.name) && !ex.serviceNames.has(s.name.toLowerCase())).map((s) => s.name),
    totals: {
      budget: LEDGER_ROWS.reduce((s, r) => s + r.budget, 0),
      received: LEDGER_ROWS.reduce((s, r) => s + r.received, 0),
      balance: LEDGER_ROWS.reduce((s, r) => s + r.budget - r.received, 0),
      expenses: LEDGER_ROWS.reduce((s, r) => s + (r.costs || []).reduce((a, c) => a + c.amount, 0), 0),
      companyExpenses: COMPANY_EXPENSES.reduce((s, e) => s + e.amount, 0),
    },
  };
}

/** How the Firestore rules will see the signed-in account (shown on the import screen). */
export async function checkImportAccess(): Promise<{ uid: string; email: string; profileFound: boolean; role: string; status: string; isAdmin: boolean }> {
  const fbUser = auth.currentUser;
  if (!fbUser) return { uid: '', email: '', profileFound: false, role: '', status: '', isAdmin: false };
  const snap = await getDoc(doc(dbFirestore, 'users', fbUser.uid)).catch(() => null);
  const data = snap?.exists() ? snap.data() : null;
  const role = String(data?.role || '');
  const status = String(data?.status || 'Active');
  return {
    uid: fbUser.uid,
    email: fbUser.email || '',
    profileFound: !!data,
    role,
    status,
    isAdmin: !!data && status !== 'Disabled' && /owner|admin/i.test(role),
  };
}

type Stage = 'services' | 'clients' | 'projects' | 'payments' | 'expenses' | 'company expenses' | 'logins';
const STAGE_COLLECTION: Record<Stage, string> = {
  services: 'services',
  clients: 'clients',
  projects: 'projects',
  payments: 'payments',
  expenses: 'expenses',
  'company expenses': 'expenses',
  logins: CREDENTIALS_COL,
};

export class LedgerImportError extends Error {
  constructor(public stage: Stage, public collectionName: string, public cause: any, public savedStages: Stage[]) {
    super(`Saving ${stage} (${collectionName}) failed: ${cause?.code || cause?.message || cause}`);
  }
}

export async function runLedgerImport(currentUser?: User | null): Promise<LedgerImportPlan> {
  const plan = await planLedgerImport();
  const ex = await loadExisting();
  // Saved in stages so a blocked collection is reported by name; fixed ids make re-runs safe
  const stages: Record<Stage, WriteBatch> = {
    services: writeBatch(dbFirestore),
    clients: writeBatch(dbFirestore),
    projects: writeBatch(dbFirestore),
    payments: writeBatch(dbFirestore),
    expenses: writeBatch(dbFirestore),
    'company expenses': writeBatch(dbFirestore),
    logins: writeBatch(dbFirestore),
  };
  const counts: Record<Stage, number> = { services: 0, clients: 0, projects: 0, payments: 0, expenses: 0, 'company expenses': 0, logins: 0 };
  const batchFor = (stage: Stage) => {
    counts[stage]++;
    return stages[stage];
  };
  const now = new Date().toISOString();
  const importedBy = currentUser?.name || currentUser?.email || 'Ledger import';

  // 1. Services: keep locally seeded defaults too, otherwise they vanish once Firestore has services
  await safeOpenDatabase();
  const localServices = await db.services.toArray();
  const neededServices = new Set(LEDGER_ROWS.map((r) => r.service));
  for (const svc of LEDGER_SERVICES) {
    if (!neededServices.has(svc.name) || ex.serviceNames.has(svc.name.toLowerCase())) continue;
    const local = localServices.find((l) => l.name.toLowerCase() === svc.name.toLowerCase());
    batchFor('services').set(doc(dbFirestore, 'services', ID.service(svc.name)), {
      name: svc.name,
      description: local?.description || svc.description,
      pricingType: local?.pricingType || svc.pricingType,
      defaultPrice: local?.defaultPrice || 0,
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    });
    ex.serviceNames.add(svc.name.toLowerCase());
  }
  for (const local of localServices) {
    if (ex.serviceNames.has(local.name.toLowerCase())) continue;
    const { id: _localId, ...serviceData } = local;
    batchFor('services').set(doc(dbFirestore, 'services', ID.service(local.name)), { ...serviceData, createdAt: serviceData.createdAt || now, updatedAt: now });
    ex.serviceNames.add(local.name.toLowerCase());
  }

  // 2. Clients (existing ones are reused untouched)
  const clientRef = new Map<string, { id: string; name: string }>();
  for (const c of plan.clients) {
    if (c.existing) {
      clientRef.set(c.ledger.key, { id: String(c.existing.id), name: c.existing.name });
      continue;
    }
    const rows = LEDGER_ROWS.filter((r) => r.client === c.ledger.key).sort((a, b) => rowIso(a).localeCompare(rowIso(b)));
    const id = ID.client(c.ledger.key);
    batchFor('clients').set(doc(dbFirestore, 'clients', id), {
      name: c.ledger.contact,
      contact: c.ledger.contact,
      company: c.ledger.company,
      phone: formatPhone(c.ledger.phone),
      email: c.ledger.email || '',
      address: '',
      city: '',
      gstin: '',
      services: '',
      billing: 'One-Time',
      pricing: 0,
      totalValue: 0,
      paid: 0,
      pending: 0,
      projects: 0,
      joinDate: rows.find((r) => r.date)?.date || '',
      status: 'Active',
      notes: ['Imported from the business ledger.', c.ledger.notes].filter(Boolean).join(' '),
      createdAt: `${rows[0] ? rowIso(rows[0]) : '2025-06-01'}T09:00:00.000Z`,
      updatedAt: now,
      importedBy,
    });
    clientRef.set(c.ledger.key, { id, name: c.ledger.contact });
  }

  // 3. Projects, payments, expenses and logins
  for (const row of LEDGER_ROWS) {
    const client = clientRef.get(row.client)!;
    const projectId = ID.project(row);
    const iso = rowIso(row);
    const costTotal = (row.costs || []).reduce((s, c) => s + c.amount, 0);
    const finished = row.status !== 'In Progress';
    const existingProject = ex.projects.get(projectId);

    if (!existingProject) {
      batchFor('projects').set(doc(dbFirestore, 'projects', projectId), {
        name: row.project,
        clientId: client.id,
        clientName: client.name,
        serviceName: row.service,
        manager: '',
        team: [],
        startDate: row.date,
        // End date is the completion date; the ledger date is the best record of it for finished work
        deadline: finished ? row.date : '',
        domain: row.domain || '',
        value: row.budget,
        received: row.received,
        pending: Math.max(0, row.budget - row.received),
        expenses: costTotal,
        estimatedProfit: row.budget - costTotal,
        progress: finished ? 100 : 0,
        status: row.status,
        notes: projectNotes(row),
        requirements: '',
        createdAt: `${iso}T09:00:00.000Z`,
        updatedAt: now,
        importedBy,
      });
    } else if (row.sheet === '26' && (row.sno === 1 || row.sno === 4 || row.domain) && existingProject.importedBy) {
      // The first version of this import kept the login email / domain in notes: move them to the new fields
      batchFor('projects').update(doc(dbFirestore, 'projects', projectId), {
        notes: projectNotes(row),
        ...(row.domain && !existingProject.domain ? { domain: row.domain } : {}),
        updatedAt: now,
      });
    }

    paymentsOf(row).forEach((amount, i) => {
      const paymentId = ID.payment(row, i);
      if (ex.paymentIds.has(paymentId)) return;
      batchFor('payments').set(doc(dbFirestore, 'payments', paymentId), {
        paymentNumber: `PAY-L${row.sheet}-${String(row.sno).padStart(3, '0')}${i > 0 ? `-${i + 1}` : ''}`,
        clientName: client.name,
        clientId: client.id,
        projectId,
        projectName: row.project,
        amount,
        date: row.date ? iso : '',
        method: 'Not Recorded',
        referenceNumber: row.received < row.budget ? 'Ledger import (received to date)' : 'Ledger import',
        status: 'Confirmed',
        createdAt: `${iso}T10:00:00.000Z`,
      });
    });

    (row.costs || []).forEach((cost, i) => {
      const expenseId = ID.expense(row, i);
      if (ex.expenseIds.has(expenseId)) return;
      batchFor('expenses').set(doc(dbFirestore, 'expenses', expenseId), {
        expenseNumber: `EXP-L${row.sheet}-${String(row.sno).padStart(3, '0')}${row.costs!.length > 1 ? `-${i + 1}` : ''}`,
        name: cost.name,
        category: cost.category,
        amount: cost.amount,
        date: row.date ? iso : '',
        ...(cost.paidTo ? { paidTo: cost.paidTo } : {}),
        projectId,
        projectName: row.project,
        clientId: client.id,
        notes: `Ledger ${row.sheet === '25' ? '2025' : '2026'} · S.No ${row.sno}`,
        createdAt: `${iso}T11:00:00.000Z`,
      });
    });

    (row.credentials || []).forEach((cred, i) => {
      const credId = ID.credential(row, i);
      if (ex.credentialIds.has(credId)) return;
      batchFor('logins').set(doc(dbFirestore, CREDENTIALS_COL, credId), {
        clientId: client.id,
        projectId,
        projectName: row.project,
        label: cred.label,
        username: cred.username,
        password: cred.password,
        url: cred.url || '',
        notes: cred.notes || '',
        createdAt: now,
        updatedAt: now,
        updatedBy: importedBy,
      });
    });
  }

  // 4. Company (overhead) expenses: no project link
  for (const e of COMPANY_EXPENSES) {
    const id = ID.companyExpense(e.sno);
    if (ex.expenseIds.has(id)) continue;
    batchFor('company expenses').set(doc(dbFirestore, 'expenses', id), {
      expenseNumber: `EXP-C26-${String(e.sno).padStart(3, '0')}`,
      name: e.name,
      category: e.category,
      amount: e.amount,
      date: e.date,
      ...(e.paidTo ? { paidTo: e.paidTo } : {}),
      notes: [e.notes, e.monthOnly ? 'Month only in the sheet.' : '', `Company expenses sheet · S.No ${e.sno}`].filter(Boolean).join(' '),
      createdAt: `${e.date}T12:00:00.000Z`,
    });
  }

  // Each stage is atomic (all well under Firestore's 500-write limit); live sync refreshes every screen
  const saved: Stage[] = [];
  for (const stage of Object.keys(stages) as Stage[]) {
    if (counts[stage] === 0) continue;
    try {
      await stages[stage].commit();
      saved.push(stage);
    } catch (err) {
      throw new LedgerImportError(stage, STAGE_COLLECTION[stage], err, saved);
    }
  }
  return plan;
}
