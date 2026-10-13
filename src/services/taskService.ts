import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
} from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';
import { db, type ProjectTask } from '../db/database';
import { notifyTaskAssigned } from './emailNotificationService';
import { updateDeliverable, deleteDeliverable } from './deliverableService';

const COLLECTION_NAME = 'tasks';

export type TaskStatus = 'Pending' | 'In Progress' | 'Completed';
export type TaskPriority = 'Low' | 'Medium' | 'High';

export interface TaskItem extends ProjectTask {
  title?: string;
  dueDate?: string;
  assignedTo?: string;
  description?: string;
}

export async function getAllTasks(): Promise<ProjectTask[]> {
  try {
    const q = query(collection(dbFirestore, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      ...docSnap.data(),
      id: docSnap.id,
    })) as ProjectTask[];
  } catch (err) {
    console.warn('[TaskService] Firestore fetch failed, using cache:', err);
    return await db.tasks.toArray();
  }
}

export async function addTask(taskData: Partial<ProjectTask>): Promise<string> {
  const now = new Date().toISOString();
  
  const title = taskData.title || taskData.task || '';
  const dueDate = taskData.dueDate || taskData.deadline || '';
  const assignedTo = taskData.assignedTo || taskData.assignee || '';
  const projectName = taskData.projectName || taskData.project || '';

  const rawPayload: Record<string, any> = {
    ...taskData,
    title,
    task: title, // maintain legacy field compatibility
    dueDate,
    deadline: dueDate, // maintain legacy field compatibility
    assignedTo,
    assignee: assignedTo, // maintain legacy field compatibility
    projectName,
    project: projectName, // maintain legacy field compatibility
    priority: taskData.priority || 'Medium',
    status: taskData.status || 'Pending',
    createdAt: now,
    updatedAt: now,
  };

  // Sanitize payload: remove undefined values for Firestore
  const payload: Record<string, any> = {};
  Object.keys(rawPayload).forEach((key) => {
    if (rawPayload[key] !== undefined) {
      payload[key] = rawPayload[key];
    }
  });

  // Write to Firestore first (source of truth)
  const docRef = await addDoc(collection(dbFirestore, COLLECTION_NAME), payload);
  const fullTask = { ...payload, id: docRef.id } as ProjectTask;

  // Update local Dexie cache only after Firestore succeeds
  await db.tasks.put(fullTask as any);

  if (assignedTo) notifyTaskAssigned(fullTask);

  return docRef.id;
}

export async function updateTask(
  id: string | number,
  updates: Partial<ProjectTask>
): Promise<void> {
  const now = new Date().toISOString();

  const title = updates.title || updates.task;
  const dueDate = updates.dueDate || updates.deadline;
  const assignedTo = updates.assignedTo || updates.assignee;
  const projectName = updates.projectName || updates.project;

  const rawPayload: Record<string, any> = {
    ...updates,
    updatedAt: now,
  };

  if (title !== undefined) {
    rawPayload.title = title;
    rawPayload.task = title;
  }
  if (dueDate !== undefined) {
    rawPayload.dueDate = dueDate;
    rawPayload.deadline = dueDate;
  }
  if (assignedTo !== undefined) {
    rawPayload.assignedTo = assignedTo;
    rawPayload.assignee = assignedTo;
  }
  if (projectName !== undefined) {
    rawPayload.projectName = projectName;
    rawPayload.project = projectName;
  }

  // Sanitize payload: remove undefined values for Firestore
  const payload: Record<string, any> = {};
  Object.keys(rawPayload).forEach((key) => {
    if (rawPayload[key] !== undefined) {
      payload[key] = rawPayload[key];
    }
  });

  const before = await db.tasks.get(id as any);

  // Write to Firestore first (source of truth)
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await updateDoc(docRef, payload);

  // Update local Dexie cache after Firestore succeeds
  await db.tasks.update(id as any, payload);

  // Email the new assignee when a task is reassigned
  const prevAssignee = before?.assignedTo || before?.assignee || '';
  if (assignedTo && assignedTo !== prevAssignee) notifyTaskAssigned({ ...before, ...payload });

  // Ongoing-project work is billed to the client when it's completed (and taken off the bill if reopened)
  const deliverableId = before?.deliverableId;
  if (deliverableId && updates.status !== undefined && updates.status !== before?.status) {
    const done = updates.status === 'Completed' || updates.status === 'Done';
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try {
      await updateDeliverable(deliverableId, done ? { status: 'Approved', date, period: date.slice(0, 7) } : { status: 'Pending' });
    } catch (err) {
      console.warn('[TaskService] Billing entry update failed:', err);
    }
  }
}

export async function deleteTask(id: string | number): Promise<void> {
  const existing = await db.tasks.get(id as any);
  // An unfinished ongoing-project task takes its unbilled entry with it; billed work stays on the client's bill
  if (existing?.deliverableId && existing.status !== 'Completed' && existing.status !== 'Done') {
    await deleteDeliverable(existing.deliverableId).catch((err) => console.warn('[TaskService] Billing entry delete failed:', err));
  }

  // Delete from Firestore first (source of truth)
  const docRef = doc(dbFirestore, COLLECTION_NAME, String(id));
  await deleteDoc(docRef);

  // Update local Dexie cache after Firestore succeeds
  await db.tasks.delete(id as any);
}
