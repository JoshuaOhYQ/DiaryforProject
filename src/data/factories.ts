/** Builders for new records with sensible defaults. The store stamps createdAt/updatedAt on save. */
import type { Entry, Feature, Member, Project, Task, WeekNote } from '../types.ts';
import { newId } from '../lib/id.ts';
import { normalizeEntry, normalizeFeature, normalizeMember, normalizeProject, normalizeTask, normalizeWeekNote } from './workspace.ts';

const UNSAVED = '';

export function newProject(fields: Partial<Project> = {}): Project {
  return normalizeProject({ ...fields, id: fields.id ?? newId(), createdAt: UNSAVED, updatedAt: UNSAVED });
}

export function newMember(projectId: string, fields: Partial<Member> = {}): Member {
  return normalizeMember({ ...fields, id: fields.id ?? newId(), projectId, createdAt: UNSAVED, updatedAt: UNSAVED });
}

export function newFeature(projectId: string, fields: Partial<Feature> = {}): Feature {
  return normalizeFeature({ ...fields, id: fields.id ?? newId(), projectId, createdAt: UNSAVED, updatedAt: UNSAVED });
}

export function newTask(projectId: string, fields: Partial<Task> = {}): Task {
  return normalizeTask({ ...fields, id: fields.id ?? newId(), projectId, createdAt: UNSAVED, updatedAt: UNSAVED });
}

export function newEntry(projectId: string, fields: Partial<Entry> = {}): Entry {
  return normalizeEntry({ ...fields, id: fields.id ?? newId(), projectId, createdAt: UNSAVED, updatedAt: UNSAVED });
}

/** Week notes use a predictable id, so two people writing the same week's note edit one record. */
export function weekNoteId(projectId: string, weekStart: string, memberId: string | null): string {
  return `${projectId}:${weekStart}:${memberId ?? 'team'}`;
}

export function newWeekNote(projectId: string, weekStart: string, memberId: string | null, narrative: string): WeekNote {
  return normalizeWeekNote({ id: weekNoteId(projectId, weekStart, memberId), projectId, weekStart, memberId, narrative, createdAt: UNSAVED, updatedAt: UNSAVED });
}
