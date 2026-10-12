import { db, safeOpenDatabase, type Project } from '../db/database';
import { addService, updateService } from './serviceService';
import { updateProject, syncProjectFinancials } from './projectService';
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
