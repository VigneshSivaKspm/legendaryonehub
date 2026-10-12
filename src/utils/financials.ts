import type { Client, Expense, Invoice, Payment, Project } from '../db/database';

const sameId = (a?: number | string, b?: number | string) =>
  a !== undefined && a !== null && a !== '' && b !== undefined && b !== null && String(a) === String(b);

/** Name shown for a client: the contact person, falling back to the stored name. */
export function clientLabel(client: Pick<Client, 'name' | 'contact'>): string {
  return (client.contact || '').trim() || client.name;
}

/** True when a record (project, invoice, payment) belongs to the given client. */
export function belongsToClient(rec: { clientId?: number | string; clientName?: string }, client: Client): boolean {
  if (rec.clientId !== undefined && rec.clientId !== null && rec.clientId !== '' && rec.clientId !== 0) {
    return sameId(rec.clientId, client.id);
  }
  return !!rec.clientName && rec.clientName === client.name;
}

/** Payments linked to a project directly, or through one of the project's invoices. */
export function paymentsForProject(project: Project, payments: Payment[], invoices: Invoice[]): Payment[] {
  const projectInvoiceIds = new Set(
    invoices.filter((inv) => sameId(inv.projectId, project.id)).map((inv) => String(inv.id))
  );
  return payments.filter(
    (pm) => sameId(pm.projectId, project.id) || (pm.invoiceId !== undefined && projectInvoiceIds.has(String(pm.invoiceId)))
  );
}

export interface ProjectFinancials {
  value: number;
  invoiced: number;
  received: number;
  pending: number;
  expenses: number;
  profit: number;
  paymentCount: number;
  expenseCount: number;
}

/**
 * Live project money figures. Received comes from confirmed payments and expenses from
 * expense records linked to the project; the stored project fields are used only when
 * nothing has been recorded yet (older projects entered by hand).
 */
export function computeProjectFinancials(
  project: Project,
  payments: Payment[],
  invoices: Invoice[],
  expenses: Expense[]
): ProjectFinancials {
  const linkedPayments = paymentsForProject(project, payments, invoices).filter((pm) => pm.status === 'Confirmed');
  const linkedExpenses = expenses.filter((ex) => sameId(ex.projectId, project.id));
  const value = Number(project.value) || 0;
  const received = linkedPayments.length
    ? linkedPayments.reduce((s, pm) => s + (Number(pm.amount) || 0), 0)
    : Number(project.received) || 0;
  const expenseTotal = linkedExpenses.length
    ? linkedExpenses.reduce((s, ex) => s + (Number(ex.amount) || 0), 0)
    : Number(project.expenses) || 0;
  const invoiced = invoices
    .filter((inv) => sameId(inv.projectId, project.id) && inv.status !== 'Cancelled')
    .reduce((s, inv) => s + (Number(inv.totalAmount) || 0), 0);

  return {
    value,
    invoiced,
    received,
    pending: Math.max(0, value - received),
    expenses: expenseTotal,
    profit: value - expenseTotal,
    paymentCount: linkedPayments.length,
    expenseCount: linkedExpenses.length,
  };
}

export interface ClientFinancials {
  services: string[];
  totalValue: number;
  paid: number;
  pending: number;
  projectCount: number;
}

/** Client totals derived from the client's projects and payments. */
export function computeClientFinancials(client: Client, projects: Project[], payments: Payment[]): ClientFinancials {
  const clientProjects = projects.filter((p) => belongsToClient(p, client));
  const clientPayments = payments.filter((pm) => pm.status === 'Confirmed' && belongsToClient(pm, client));

  const totalValue = clientProjects.length
    ? clientProjects.reduce((s, p) => s + (Number(p.value) || 0), 0)
    : Number(client.totalValue) || 0;
  const paid = clientPayments.length
    ? clientPayments.reduce((s, pm) => s + (Number(pm.amount) || 0), 0)
    : Number(client.paid) || 0;

  const services = Array.from(new Set(clientProjects.map((p) => p.serviceName).filter(Boolean)));
  if (services.length === 0 && client.services) services.push(client.services);

  return {
    services,
    totalValue,
    paid,
    pending: Math.max(0, totalValue - paid),
    projectCount: clientProjects.length,
  };
}
