import { db, safeOpenDatabase, type Project } from '../db/database';
import { addService, updateService } from './serviceService';
import { updateProject, syncProjectFinancials } from './projectService';
import { deletePayment } from './paymentService';
import { updateDeliverable } from './deliverableService';
import { NEW_SERVICES, LEGACY_SERVICE_MAP, ongoingStatement } from '../utils/serviceCatalog';

let migrationDone = false;

/**
 * One-time catalog update, safe to run repeatedly:
 * - adds the Media Works and Organic Marketing services if missing
 * - archives the old Video Editing / Graphic Design services
 * - moves their projects to Media Works (Video / Posters)
 * Returns how many projects were moved.
 */
export async function migrateServiceCatalog(): Promise<number> {
  if (migrationDone) return 0;
  migrationDone = true;
  await safeOpenDatabase();
  const [services, projects] = await Promise.all([db.services.toArray(), db.projects.toArray()]);
  if (services.length === 0) {
    migrationDone = false; // catalog not synced yet; try again next time
    return 0;
  }

  const names = new Set(services.map((s) => s.name.trim().toLowerCase()));
  for (const svc of NEW_SERVICES) {
    if (!names.has(svc.name.toLowerCase())) {
      await addService({ ...svc, defaultPrice: 0, status: 'Active' });
    }
  }
  for (const svc of services) {
    if (LEGACY_SERVICE_MAP[svc.name] && svc.status !== 'Archived' && svc.id !== undefined) {
      await updateService(svc.id, { status: 'Archived' });
    }
  }

  let moved = 0;
  for (const p of projects) {
    const target = LEGACY_SERVICE_MAP[p.serviceName];
    if (!target || p.id === undefined) continue;
    await updateProject(p.id, {
      serviceName: target.serviceName,
      subServices: Array.from(new Set([...(p.subServices || []), ...target.subServices])),
    });
    moved++;
  }

  await cleanupSeptemberOngoingWorks();

  return moved;
}

/**
 * An ongoing project's value is what has been billed so far (retainer months + work logged),
 * so the Projects totals, client balances and reports stay correct as months pass.
 */
export async function syncOngoingProjectValue(project: Project): Promise<void> {
  if (!project.ongoing || project.id === undefined) return;
  const [deliverables, payments, invoices] = await Promise.all([db.deliverables.toArray(), db.payments.toArray(), db.invoices.toArray()]);
  const billed = Math.round(ongoingStatement(project, deliverables, payments, invoices).billed);
  if (billed !== Math.round(Number(project.value) || 0)) {
    await updateProject(project.id, { value: billed });
  }
  await syncProjectFinancials(project.id);
}

let cleanupOngoingDone = false;

/**
 * Cleans up September month for ongoing marketing projects:
 * - Suresh Anna (Nesam Tour & Travels): start in October, 1 pending payment of ₹5,000
 * - Rajmohan (Sree Aadithyaa): start in October, remove Sep payment, 1 pending payment of ₹6,000
 * - Vijay S (Youpeak): start in October, remove Sep payment, 1 pending payment of ₹5,000
 * - Govindarajan (GS Distributors): keep only 1 payment of ₹800 as paid, remove duplicate ₹800
 */
export async function cleanupSeptemberOngoingWorks(): Promise<void> {
  if (typeof window !== 'undefined') {
    if (localStorage.getItem('cleanup_sep_done_v4') === 'true') return;
    localStorage.setItem('cleanup_sep_done_v4', 'true');
  }
  if (cleanupOngoingDone) return;
  cleanupOngoingDone = true;

  try {
    await safeOpenDatabase();
    const [projects, payments, deliverables] = await Promise.all([
      db.projects.toArray(),
      db.payments.toArray(),
      db.deliverables.toArray(),
    ]);

    const isSuresh = (p: { clientName?: string; name?: string; id?: any }) =>
      /suresh/i.test(p.clientName || '') || /nesam/i.test(p.name || '') || String(p.id).includes('_43');

    const isRajmohan = (p: { clientName?: string; name?: string; id?: any }) =>
      /rajmohan/i.test(p.clientName || '') || /aadithya/i.test(p.name || '') || String(p.id).includes('_45');

    const isVijay = (p: { clientName?: string; name?: string; id?: any }) =>
      /vijay/i.test(p.clientName || '') || /youpeak/i.test(p.name || '') || String(p.id).includes('_44');

    const isGovindarajan = (p: { clientName?: string; name?: string; id?: any }) =>
      /govindarajan/i.test(p.clientName || '') || /distribut|dp images|group images/i.test(p.name || '') || String(p.id).includes('_32');

    // 1. Suresh Anna (Nesam Tour & Travels - Organic Marketing)
    const sureshProjs = projects.filter((p) => p.ongoing && isSuresh(p));
    for (const p of sureshProjs) {
      if (p.id === undefined) continue;
      await updateProject(p.id, { startDate: '2026-10-01', openingAmount: 0 });
      const delivs = deliverables.filter((d) => String(d.projectId) === String(p.id));
      for (const d of delivs) {
        if (d.id !== undefined && (d.period === '2026-09' || (d.date && /2026-09|\/09\/2026/.test(d.date)))) {
          await updateDeliverable(d.id, { period: '2026-10', date: '2026-10-01' });
        }
      }
      const pms = payments.filter((pm) => String(pm.projectId) === String(p.id) || isSuresh({ clientName: pm.clientName, name: pm.projectName }));
      for (const pm of pms) {
        if (pm.id !== undefined && (pm.date && /2026-09|\/09\/2026/.test(pm.date))) {
          try { await deletePayment(pm.id); } catch { await db.payments.delete(pm.id as any); }
        }
      }
    }

    // 2. Rajmohan (Sree Aadithyaa Digital & Organic Marketing)
    const rajmohanProjs = projects.filter((p) => p.ongoing && isRajmohan(p));
    for (const p of rajmohanProjs) {
      if (p.id === undefined) continue;
      await updateProject(p.id, { startDate: '2026-10-01', openingAmount: 0 });
      const delivs = deliverables.filter((d) => String(d.projectId) === String(p.id));
      for (const d of delivs) {
        if (d.id !== undefined && (d.period === '2026-09' || (d.date && /2026-09|\/09\/2026/.test(d.date)))) {
          await updateDeliverable(d.id, { period: '2026-10', date: '2026-10-01' });
        }
      }
      const pms = payments.filter((pm) => String(pm.projectId) === String(p.id) || (/rajmohan/i.test(pm.clientName || '') && /aadithya|marketing/i.test(pm.projectName || '')));
      for (const pm of pms) {
        if (pm.id !== undefined && (!pm.date || /2026-09|\/09\/2026/.test(pm.date) || Number(pm.amount) === 6000)) {
          try { await deletePayment(pm.id); } catch { await db.payments.delete(pm.id as any); }
        }
      }
    }

    // 3. Vijay S (Youpeak Organic Marketing)
    const vijayProjs = projects.filter((p) => p.ongoing && isVijay(p));
    for (const p of vijayProjs) {
      if (p.id === undefined) continue;
      await updateProject(p.id, { startDate: '2026-10-01', openingAmount: 0 });
      const delivs = deliverables.filter((d) => String(d.projectId) === String(p.id));
      for (const d of delivs) {
        if (d.id !== undefined && (d.period === '2026-09' || (d.date && /2026-09|\/09\/2026/.test(d.date)))) {
          await updateDeliverable(d.id, { period: '2026-10', date: '2026-10-01' });
        }
      }
      const pms = payments.filter((pm) => String(pm.projectId) === String(p.id) || (/vijay/i.test(pm.clientName || '') && /youpeak|marketing/i.test(pm.projectName || '')));
      for (const pm of pms) {
        if (pm.id !== undefined && (!pm.date || /2026-09|\/09\/2026/.test(pm.date) || Number(pm.amount) === 5000)) {
          try { await deletePayment(pm.id); } catch { await db.payments.delete(pm.id as any); }
        }
      }
    }

    // 4. Govindarajan (keep only 1 old payment of 800)
    const govindarajanProjs = projects.filter((p) => isGovindarajan(p));
    for (const p of govindarajanProjs) {
      if (p.id === undefined) continue;
      const pms = payments.filter(
        (pm) =>
          String(pm.projectId) === String(p.id) ||
          (/govindarajan/i.test(pm.clientName || '') && (Number(pm.amount) === 800 || /group images|dp images|posters/i.test(pm.projectName || '')))
      );
      if (pms.length > 1) {
        pms.sort((a, b) => String(a.date || a.createdAt || '').localeCompare(String(b.date || b.createdAt || '')));
        // keep pms[0], delete the rest
        for (let i = 1; i < pms.length; i++) {
          if (pms[i].id !== undefined) {
            try { await deletePayment(pms[i].id!); } catch { await db.payments.delete(pms[i].id as any); }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[cleanupSeptemberOngoingWorks] error:', err);
  }
}

