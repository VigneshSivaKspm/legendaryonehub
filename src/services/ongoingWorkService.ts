import { doc, runTransaction } from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, safeOpenDatabase, type Deliverable, type Project, type ProjectTask, type WorkSchedule } from '../db/database';
import { addTask } from './taskService';
import { addDeliverable, updateDeliverable } from './deliverableService';
import { updateProject } from './projectService';

/**
 * Ongoing-project work for employees.
 * - assignOngoingWork: admin orders items (2 videos, 5 posters…) with a price each; every line becomes an employee
 *   task (no amounts) plus a billing entry that is billed to the client when the task is completed.
 * - ensureScheduledTasks: posting schedules ("a reel every day at 9 AM and 6 PM") turn into a task per day and time.
 *   There is no server, so whoever has the app open (the employee or an admin) creates the missing ones.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Missed days are created as overdue tasks so gaps stay visible, up to this many days back */
const BACKFILL_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clean = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m || 0)} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function describeSchedule(s: WorkSchedule): string {
  const days = s.days.length === 7 ? 'Every day' : s.days.length === 6 && !s.days.includes('Sunday') ? 'Mon–Sat' : s.days.map((d) => d.slice(0, 3)).join(', ');
  return `${days} at ${[...s.times].sort().map(time12).join(' & ')}`;
}

// ---------------------------------------------------------------------------
// Assigned work (media projects)
// ---------------------------------------------------------------------------

export interface WorkLine {
  type: string;
  details: string;
  qty: number;
  rate: number;
  employeeId: string | number;
  employeeName: string;
  dueDate: string; // YYYY-MM-DD
  priority: 'Low' | 'Medium' | 'High';
}

export async function assignOngoingWork(project: Project, lines: WorkLine[]): Promise<number> {
  if (project.id === undefined) return 0;
  for (const line of lines) {
    const title = `${line.type}${line.qty > 1 ? ` × ${line.qty}` : ''} · ${line.details || project.name}`;
    const deliverableId = await addDeliverable({
      client: project.clientName,
      clientId: project.clientId,
      type: line.type,
      description: line.details || title,
      qty: line.qty,
      rate: line.rate,
      amount: line.qty * line.rate,
      date: line.dueDate,
      employee: line.employeeName,
      period: line.dueDate.slice(0, 7),
      status: 'Pending', // billed when the employee completes the task
      projectId: project.id,
      projectName: project.name,
    });
    const taskId = await addTask({
      title,
      description: [line.details, `Client: ${project.clientName}`].filter(Boolean).join('\n'),
      projectId: project.id,
      projectName: project.name,
      client: project.clientName,
      assignedTo: line.employeeName,
      assignedToId: line.employeeId,
      dueDate: line.dueDate,
      start: localDate(new Date()),
      priority: line.priority,
      status: 'Pending',
      workType: line.type,
      quantity: line.qty,
      source: 'ongoing',
      deliverableId,
    });
    await updateDeliverable(deliverableId, { taskId });
  }

  // Everyone given work joins the project team
  const team = new Set(project.team || []);
  lines.forEach((l) => l.employeeName && team.add(l.employeeName));
  if (team.size !== (project.team || []).length) {
    await updateProject(project.id, { team: Array.from(team) });
  }
  return lines.length;
}

// ---------------------------------------------------------------------------
// Posting schedules (organic / digital marketing)
// ---------------------------------------------------------------------------

export function scheduleTaskId(projectId: string | number, scheduleId: string, date: string, time: string): string {
  return `rec_${String(projectId).replace(/[^\w-]/g, '')}_${scheduleId}_${date.replace(/-/g, '')}_${time.replace(':', '')}`;
}

export function scheduleDates(s: WorkSchedule, today: string, backfill = BACKFILL_DAYS): string[] {
  const out: string[] = [];
  const end = new Date(today + 'T00:00:00');
  for (let i = backfill; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const date = localDate(d);
    if (date < s.startDate || (s.endDate && date > s.endDate)) continue;
    if (!s.days.includes(WEEKDAYS[d.getDay()])) continue;
    out.push(date);
  }
  return out;
}

async function createScheduledTask(p: Project, s: WorkSchedule, date: string, time: string, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const rate = Number(s.rate) || 0;
  const billId = `${id}_bill`;
  const title = `${s.workType}${s.channels.length ? ` · ${s.channels.join(', ')}` : ''} · ${time12(time)}`;
  const task = clean<ProjectTask>({
    title,
    task: title,
    description: [s.instructions, `Post for ${p.clientName} (${p.name}) at ${time12(time)}.`].filter(Boolean).join('\n'),
    projectId: p.id,
    projectName: p.name,
    project: p.name,
    client: p.clientName,
    assignedTo: s.employeeName,
    assignee: s.employeeName,
    assignedToId: s.employeeId,
    start: date,
    dueDate: date,
    deadline: date,
    dueTime: time,
    priority: 'High',
    status: 'Pending',
    workType: s.workType,
    quantity: 1,
    channels: s.channels,
    source: 'schedule',
    scheduleId: s.id,
    deliverableId: rate > 0 ? billId : undefined,
    createdAt: now,
    updatedAt: now,
  });
  const bill = clean<Deliverable>({
    client: p.clientName,
    clientId: p.clientId,
    type: s.workType,
    description: title,
    qty: 1,
    rate,
    amount: rate,
    date,
    employee: s.employeeName,
    period: date.slice(0, 7),
    status: 'Pending',
    projectId: p.id,
    projectName: p.name,
    taskId: id,
    createdAt: now,
    updatedAt: now,
  });

  const created = await runTransaction(dbFirestore, async (tx) => {
    const taskRef = doc(dbFirestore, 'tasks', id);
    if ((await tx.get(taskRef)).exists()) return false; // someone else already created it
    tx.set(taskRef, task);
    if (rate > 0) tx.set(doc(dbFirestore, 'deliverables', billId), bill);
    return true;
  });
  if (created) {
    await db.tasks.put({ ...task, id });
    if (rate > 0) await db.deliverables.put({ ...bill, id: billId });
  }
  return created;
}

let running = false;

/**
 * Creates today's (and recently missed) scheduled tasks. Employees pass their own id so they only create their work.
 * Returns how many tasks were created.
 */
export async function ensureScheduledTasks(opts: { employeeId?: string | number } = {}): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    await safeOpenDatabase();
    const projects = await db.projects.toArray();
    const today = localDate(new Date());
    let created = 0;
    for (const p of projects) {
      if (!p.ongoing || !p.schedules?.length || p.id === undefined) continue;
      if (['Completed', 'Cancelled', 'Archived', 'On Hold'].includes(p.status)) continue;
      for (const s of p.schedules) {
        if (!s.active || !s.times.length) continue;
        if (opts.employeeId !== undefined && String(s.employeeId) !== String(opts.employeeId)) continue;
        for (const date of scheduleDates(s, today)) {
          for (const time of s.times) {
            const id = scheduleTaskId(p.id, s.id, date, time);
            if (await db.tasks.get(id)) continue;
            try {
              if (await createScheduledTask(p, s, date, time, id)) created++;
            } catch (err) {
              console.warn('[OngoingWork] Could not create scheduled task', id, err);
            }
          }
        }
      }
    }
    return created;
  } finally {
    running = false;
  }
}

export async function saveSchedules(project: Project, schedules: WorkSchedule[]): Promise<void> {
  if (project.id === undefined) return;
  const team = new Set(project.team || []);
  schedules.forEach((s) => s.active && team.add(s.employeeName));
  await updateProject(project.id, { schedules, team: Array.from(team) });
}
