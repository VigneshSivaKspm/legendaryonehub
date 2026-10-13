import type { Deliverable, Invoice, Payment, Project } from '../db/database';
import { paymentsForProject } from './financials';
import { LEDGER_ROWS } from '../data/ledgerData';

/**
 * Sub-categories offered for a service. "multi" lets the user tick several; "single" is one choice.
 * Media Works replaced the old "Video Editing" and "Graphic Design" services.
 */
export const SUB_SERVICES: Record<string, { label: string; mode: 'single' | 'multi'; options: string[] }> = {
  'Media Works': { label: 'Media Types', mode: 'multi', options: ['Video', 'Posters', 'PDF', 'Audio'] },
  'Digital Marketing': { label: 'Ad Platform', mode: 'single', options: ['Meta Ads', 'Google Ads', 'Both'] },
  'Organic Marketing': { label: 'Channels', mode: 'multi', options: ['Facebook', 'Instagram', 'WhatsApp', 'Google Business Profile'] },
};

/** Services that usually run month after month; new projects of these start as "ongoing". */
export const ONGOING_SERVICES = new Set(['Media Works', 'Digital Marketing', 'Organic Marketing', 'SEO']);

/** Services added for the new catalog, created automatically if missing. */
export const NEW_SERVICES = [
  { name: 'Media Works', description: 'Videos, posters, PDFs and audio produced for clients.', pricingType: 'Per Unit' as const },
  { name: 'Organic Marketing', description: 'Facebook, Instagram, WhatsApp and Google Business Profile management.', pricingType: 'Monthly Retainer' as const },
];

/** Old service → new service + sub-category. */
export const LEGACY_SERVICE_MAP: Record<string, { serviceName: string; subServices: string[] }> = {
  'Video Editing': { serviceName: 'Media Works', subServices: ['Video'] },
  'Graphic Design': { serviceName: 'Media Works', subServices: ['Posters'] },
};

/** Work types that can be counted on an ongoing project. Media Works counts its chosen media types. */
const DEFAULT_ITEM_TYPES: Record<string, string[]> = {
  'Media Works': ['Posters', 'Video', 'PDF', 'Audio', 'Brochure', 'Banner', 'Logo'],
  'Organic Marketing': ['Post', 'Reel', 'Story', 'Carousel', 'Poster', 'Video'],
  'Digital Marketing': ['Campaign', 'Ad Creative', 'Ad Copy', 'Poster', 'Video Ad'],
  SEO: ['Blog Article', 'Backlink', 'Technical Audit', 'Keyword Strategy', 'On-Page Optimization'],
  'Website Development': ['UI Design', 'Frontend Bugfix', 'Feature Update', 'Maintenance', 'Backup'],
};

export function itemTypesFor(p: Pick<Project, 'serviceName' | 'subServices' | 'itemRates'>): string[] {
  const base =
    p.serviceName === 'Media Works' && p.subServices?.length
      ? p.subServices
      : DEFAULT_ITEM_TYPES[p.serviceName] || ['Deliverable', 'Task', 'Feature', 'Bugfix', 'Item'];
  return Array.from(new Set([...base, ...Object.keys(p.itemRates || {})]));
}

/**
 * Returns a descriptive, clear name for ongoing/retainer projects based on category.
 */
export function getOngoingCategoryName(serviceName?: string, subServices?: string[]): string {
  if (!serviceName) return 'Recurring Retainer';
  const sub = subServices && subServices.length > 0 ? ` (${subServices.join(', ')})` : '';
  switch (serviceName) {
    case 'Organic Marketing':
      return `Organic Marketing Retainer${sub}`;
    case 'Digital Marketing':
      return `Digital Marketing Retainer${sub}`;
    case 'Media Works':
      return `Media Works & Content Production${sub}`;
    case 'SEO':
      return `Monthly SEO Retainer${sub}`;
    case 'Website Development':
    case 'Web Development':
      return `Website Maintenance Retainer${sub}`;
    case 'Android App':
    case 'Mobile App':
      return `App Support & Maintenance${sub}`;
    default:
      return `${serviceName} (Retainer)${sub}`;
  }
}

/**
 * Returns badge styling and clean label for a project service category.
 */
export function getOngoingCategoryBadge(serviceName?: string): { name: string; color: string; bg: string; border: string } {
  switch (serviceName) {
    case 'Organic Marketing':
      return { name: 'Organic Marketing Retainer', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' };
    case 'Digital Marketing':
      return { name: 'Digital Marketing Retainer', color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' };
    case 'Media Works':
      return { name: 'Media Works & Content', color: '#0891B2', bg: '#ECFEFF', border: '#A5F3FC' };
    case 'SEO':
      return { name: 'Monthly SEO Retainer', color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' };
    case 'Website Development':
    case 'Web Development':
      return { name: 'Website Maintenance', color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
    default:
      return {
        name: serviceName ? `${serviceName} Retainer` : 'Recurring Work',
        color: '#475569',
        bg: '#F8FAFC',
        border: '#E2E8F0',
      };
  }
}

/** What a posting schedule can ask for. */
export const SCHEDULE_WORK_TYPES = ['Reel', 'Poster', 'Video', 'Post', 'Story', 'Carousel', 'Status Update', 'Ad Creative'];

export function subServiceLabel(p: Pick<Project, 'subServices'>): string {
  return (p.subServices || []).join(', ');
}

/** "YYYY-MM" from a stored date (DD/MM/YYYY as typed, or ISO from imports). */
export function monthOf(date?: string): string {
  const v = (date || '').trim();
  let m = /^(\d{4})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2]}`;
  return '';
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthsFrom(start: string, end: string): string[] {
  if (!start || start > end) return [end];
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export interface StatementMonth {
  month: string;
  /** Opening amount (agreed before the project went ongoing), billed in the first month */
  opening: number;
  retainer: number;
  items: { type: string; qty: number; amount: number }[];
  itemsTotal: number;
  billed: number;
  received: number;
  /** Running balance up to and including this month (billed − received) */
  balance: number;
}

export interface OngoingStatement {
  months: StatementMonth[];
  billed: number;
  received: number;
  outstanding: number;
  /** Paid more than billed so far (credit for future months) */
  advance: number;
  opening: number;
  /** Assigned work not completed yet: billed once the employee finishes it */
  inProgressValue: number;
  inProgressItems: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Amount agreed before a project became ongoing. Uses the saved opening amount; for projects that came
 * from the ledger import it falls back to the ledger budget (their value was replaced when they went ongoing).
 */
export function openingAmountFor(p: Project): number {
  if (p.openingAmount !== undefined && p.openingAmount !== null) return Number(p.openingAmount) || 0;
  // For monthly retainer ongoing projects, row.budget in the ledger was the retainer fee, not an opening debt
  if (p.ongoing && Number(p.monthlyRetainer) > 0) return 0;
  const row = LEDGER_ROWS.find((r) => `ledger${r.sheet}_project_${pad2(r.sno)}` === String(p.id));
  return row ? Number(row.budget) || 0 : 0;
}

export function workFor(p: Project, deliverables: Deliverable[]): Deliverable[] {
  return deliverables.filter((d) => d.projectId !== undefined && String(d.projectId) === String(p.id));
}

/**
 * Month-by-month bill for an ongoing project: the retainer every month from the start month until it is
 * completed / cancelled / archived, plus the work logged that month at its rate, against confirmed payments.
 */
export function ongoingStatement(p: Project, deliverables: Deliverable[], payments: Payment[], invoices: Invoice[], upTo = currentMonth()): OngoingStatement {
  const allWork = workFor(p, deliverables);
  // Only finished work is billed; assigned tasks still in progress wait until they're completed
  const work = allWork.filter((w) => w.status === 'Approved');
  const pendingWork = allWork.filter((w) => w.status !== 'Approved');
  const pays = paymentsForProject(p, payments, invoices).filter((pm) => pm.status === 'Confirmed');
  const projectStartMonth = monthOf(p.startDate);
  const startCandidates = [projectStartMonth, ...work.map((w) => w.period || monthOf(w.date)), ...pays.map((pm) => monthOf(pm.date))].filter(Boolean);
  const start = projectStartMonth || startCandidates.sort()[0] || upTo;
  const end = p.status === 'Completed' || p.status === 'Cancelled' || p.status === 'Archived' ? (monthOf(p.deadline) || upTo) : upTo;

  const opening = openingAmountFor(p);
  let balance = 0;
  const months = monthsFrom(start, end > upTo ? upTo : end).map((month, index) => {
    const monthWork = work.filter((w) => (w.period || monthOf(w.date)) === month);
    const byType = new Map<string, { qty: number; amount: number }>();
    monthWork.forEach((w) => {
      const cur = byType.get(w.type) || { qty: 0, amount: 0 };
      cur.qty += Number(w.qty) || 0;
      cur.amount += Number(w.amount ?? (Number(w.qty) || 0) * (Number(w.rate) || 0)) || 0;
      byType.set(w.type, cur);
    });
    const items = Array.from(byType, ([type, v]) => ({ type, ...v }));
    const itemsTotal = items.reduce((s, i) => s + i.amount, 0);
    const retainer = Number(p.monthlyRetainer) || 0;
    const monthOpening = index === 0 ? opening : 0;
    const billed = monthOpening + retainer + itemsTotal;
    const received = pays.filter((pm) => monthOf(pm.date) === month).reduce((s, pm) => s + (Number(pm.amount) || 0), 0);
    balance += billed - received;
    return { month, opening: monthOpening, retainer, items, itemsTotal, billed, received, balance };
  });

  const billed = months.reduce((s, m) => s + m.billed, 0);
  // Payments dated outside the statement months still count towards what's been received
  const received = pays.reduce((s, pm) => s + (Number(pm.amount) || 0), 0);
  return {
    months,
    billed,
    received,
    outstanding: Math.max(0, billed - received),
    advance: Math.max(0, received - billed),
    opening,
    inProgressValue: pendingWork.reduce((s, w) => s + (Number(w.amount ?? (Number(w.qty) || 0) * (Number(w.rate) || 0)) || 0), 0),
    inProgressItems: pendingWork.reduce((s, w) => s + (Number(w.qty) || 0), 0),
  };
}
