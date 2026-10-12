import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import {
  db,
  type Project,
  type ProjectTask,
  type ProjectMilestone,
  type ProjectFile,
  type ProjectActivity,
} from '../db/database';

const PROJECTS_COL = 'projects';
const TASKS_COL = 'tasks';
const MILESTONES_COL = 'projectMilestones';
const FILES_COL = 'projectFiles';
const ACTIVITY_COL = 'projectActivity';

const isFinished = (p: { progress?: number; status?: string }) => Number(p.progress) >= 100 || p.status === 'Completed';

function todayDDMMYYYY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * The project's end date (stored in `deadline`) is set automatically: the day it reaches
 * 100% or is marked Completed. It is kept while the project stays finished and cleared if reopened.
 */
function resolveEndDate(next: { progress?: number; status?: string }, existing?: Project): string {
  if (!isFinished(next)) return '';
  return existing && isFinished(existing) && existing.deadline ? existing.deadline : todayDDMMYYYY();
}

export async function getAllProjects(): Promise<Project[]> {
  try {
    const q = query(collection(dbFirestore, PROJECTS_COL), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as Project[];
  } catch (err) {
    console.warn('[ProjectService] Firestore fetch failed, falling back to cache:', err);
    return await db.projects.toArray();
  }
}

export async function getProjectById(id: string | number): Promise<Project | undefined> {
  try {
    const docRef = doc(dbFirestore, PROJECTS_COL, String(id));
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { ...docSnap.data(), id: docSnap.id } as Project;
    }
    return await db.projects.get(id as any);
  } catch (err) {
    console.warn('[ProjectService] Firestore getById failed, falling back to cache:', err);
    return await db.projects.get(id as any);
  }
}

export async function addProject(projectData: Omit<Project, 'id'>): Promise<string> {
  const val = Number(projectData.value) || 0;
  const rec = Number(projectData.received) || 0;
  const exp = Number(projectData.expenses) || 0;
  const pend = Math.max(0, val - rec);
  const profit = val - exp;
  const now = new Date().toISOString();

  const progress = Math.min(100, Math.max(0, Number(projectData.progress) || 0));
  const newProjectData = {
    ...projectData,
    deadline: resolveEndDate({ progress, status: projectData.status }),
    value: val,
    received: rec,
    pending: pend,
    expenses: exp,
    estimatedProfit: profit,
    progress,
    status: projectData.status || 'In Progress',
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await addDoc(collection(dbFirestore, PROJECTS_COL), newProjectData);
  const fullProject: Project = { ...newProjectData, id: docRef.id };

  await db.projects.put(fullProject);

  // Add activity log in Firestore
  await addDoc(collection(dbFirestore, ACTIVITY_COL), {
    projectId: docRef.id,
    clientId: projectData.clientId,
    title: `Project "${projectData.name}" created`,
    user: 'System Admin',
    timestamp: `${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    type: 'project',
    createdAt: now,
  });

  return docRef.id;
}

export async function updateProject(id: string | number, updates: Partial<Project>): Promise<void> {
  const docRef = doc(dbFirestore, PROJECTS_COL, String(id));
  const existing = await getProjectById(id);

  const val = updates.value !== undefined ? Number(updates.value) : (existing?.value || 0);
  const rec = updates.received !== undefined ? Number(updates.received) : (existing?.received || 0);
  const exp = updates.expenses !== undefined ? Number(updates.expenses) : (existing?.expenses || 0);
  const pend = Math.max(0, val - rec);
  const profit = val - exp;
  const now = new Date().toISOString();

  const progress = updates.progress !== undefined ? Number(updates.progress) : Number(existing?.progress) || 0;
  const status = updates.status ?? existing?.status;

  const payload: Partial<Project> = {
    ...updates,
    deadline: resolveEndDate({ progress, status }, existing),
    value: val,
    received: rec,
    pending: pend,
    expenses: exp,
    estimatedProfit: profit,
    updatedAt: now,
  };

  await updateDoc(docRef, payload as any);
  await db.projects.update(id as any, payload);
}

/**
 * Recomputes a project's money fields from its recorded payments and expenses
 * and writes them back, so project lists, client totals and reports agree.
 * - received: confirmed payments linked to the project (directly or via its invoices)
 * - expenses: linked expense records, when any exist (otherwise the entered estimate is kept)
 */
export async function syncProjectFinancials(projectId: string | number | undefined): Promise<void> {
  if (projectId === undefined || projectId === null || projectId === '') return;
  try {
    const project = await db.projects.get(projectId as any);
    if (!project) return;

    const [payments, invoices, expenses] = await Promise.all([
      db.payments.toArray(),
      db.invoices.toArray(),
      db.expenses.toArray(),
    ]);
    const pid = String(projectId);
    const invoiceIds = new Set(invoices.filter((i) => String(i.projectId ?? '') === pid).map((i) => String(i.id)));
    const received = payments
      .filter(
        (pm) =>
          pm.status === 'Confirmed' &&
          (String(pm.projectId ?? '') === pid || (pm.invoiceId !== undefined && invoiceIds.has(String(pm.invoiceId))))
      )
      .reduce((s, pm) => s + (Number(pm.amount) || 0), 0);

    const linkedExpenses = expenses.filter((ex) => String(ex.projectId ?? '') === pid);
    const expenseTotal = linkedExpenses.length
      ? linkedExpenses.reduce((s, ex) => s + (Number(ex.amount) || 0), 0)
      : Number(project.expenses) || 0;

    const value = Number(project.value) || 0;
    const payload = {
      received,
      pending: Math.max(0, value - received),
      expenses: expenseTotal,
      estimatedProfit: value - expenseTotal,
      updatedAt: new Date().toISOString(),
    };
    await updateDoc(doc(dbFirestore, PROJECTS_COL, pid), payload);
    await db.projects.update(projectId as any, payload);
  } catch (err) {
    console.warn('[ProjectService] Financial sync warning:', err);
  }
}

export async function archiveProject(id: string | number): Promise<void> {
  await updateProject(id, { status: 'Archived' });
}

export async function deleteProject(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, PROJECTS_COL, String(id));
  await deleteDoc(docRef);
  await db.projects.delete(id as any);
}

// Tasks in Firestore
export async function getProjectTasks(projectId: string | number): Promise<ProjectTask[]> {
  try {
    const q = query(collection(dbFirestore, TASKS_COL), where('projectId', '==', String(projectId)));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as ProjectTask[];
  } catch (err) {
    return await db.tasks.where('projectId').equals(projectId as any).toArray();
  }
}

export async function addProjectTask(taskData: Omit<ProjectTask, 'id'>): Promise<string> {
  const now = new Date().toISOString();
  const payload = { ...taskData, createdAt: now, updatedAt: now };
  const docRef = await addDoc(collection(dbFirestore, TASKS_COL), payload);
  await db.tasks.put({ ...payload, id: docRef.id } as any);

  await addDoc(collection(dbFirestore, ACTIVITY_COL), {
    projectId: String(taskData.projectId),
    title: `Task "${taskData.task}" added`,
    user: taskData.assignee || 'User',
    timestamp: `${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    type: 'task',
    createdAt: now,
  });

  return docRef.id;
}

export async function updateProjectTask(id: string | number, updates: Partial<ProjectTask>): Promise<void> {
  const docRef = doc(dbFirestore, TASKS_COL, String(id));
  await updateDoc(docRef, { ...updates, updatedAt: new Date().toISOString() } as any);
  await db.tasks.update(id as any, updates);
}

export async function deleteProjectTask(id: string | number): Promise<void> {
  const docRef = doc(dbFirestore, TASKS_COL, String(id));
  await deleteDoc(docRef);
  await db.tasks.delete(id as any);
}

// Milestones in Firestore
export async function getProjectMilestones(projectId: string | number): Promise<ProjectMilestone[]> {
  try {
    const q = query(collection(dbFirestore, MILESTONES_COL), where('projectId', '==', String(projectId)));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as ProjectMilestone[];
  } catch (err) {
    return await db.projectMilestones.where('projectId').equals(projectId as any).toArray();
  }
}

export async function addProjectMilestone(milestoneData: Omit<ProjectMilestone, 'id'>): Promise<string> {
  const payload = { ...milestoneData, createdAt: new Date().toISOString() };
  const docRef = await addDoc(collection(dbFirestore, MILESTONES_COL), payload);
  await db.projectMilestones.put({ ...payload, id: docRef.id } as any);
  return docRef.id;
}

export async function updateProjectMilestone(id: string | number, updates: Partial<ProjectMilestone>): Promise<void> {
  const docRef = doc(dbFirestore, MILESTONES_COL, String(id));
  await updateDoc(docRef, updates as any);
  await db.projectMilestones.update(id as any, updates);
}

// Files in Firestore
export async function getProjectFiles(projectId: string | number): Promise<ProjectFile[]> {
  try {
    const q = query(collection(dbFirestore, FILES_COL), where('projectId', '==', String(projectId)));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as ProjectFile[];
  } catch (err) {
    return await db.projectFiles.where('projectId').equals(projectId as any).toArray();
  }
}

export async function addProjectFile(fileData: Omit<ProjectFile, 'id'>): Promise<string> {
  const payload = { ...fileData, createdAt: new Date().toISOString() };
  const docRef = await addDoc(collection(dbFirestore, FILES_COL), payload);
  await db.projectFiles.put({ ...payload, id: docRef.id } as any);
  return docRef.id;
}

// Activity in Firestore
export async function getProjectActivity(projectId: string | number): Promise<ProjectActivity[]> {
  try {
    const q = query(collection(dbFirestore, ACTIVITY_COL), where('projectId', '==', String(projectId)));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as ProjectActivity[];
  } catch (err) {
    return await db.projectActivity.where('projectId').equals(projectId as any).reverse().toArray();
  }
}

export async function addProjectActivity(activityData: Omit<ProjectActivity, 'id'>): Promise<string> {
  const payload = { ...activityData, createdAt: new Date().toISOString() };
  const docRef = await addDoc(collection(dbFirestore, ACTIVITY_COL), payload);
  await db.projectActivity.put({ ...payload, id: docRef.id } as any);
  return docRef.id;
}
