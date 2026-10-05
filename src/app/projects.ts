/** Creating, copying and deleting whole projects. */
import type { CollectionName, Project, Workspace } from '../types.ts';
import { getDataKeys, setDataKeys, store, type ProjectData } from '../data/index.ts';
import { unlockAdmin, type LockInfo } from '../lib/lock.ts';
import { addProjectPassword, isLockedSite, removeLockedProject } from './auth.ts';
import { instantiateTemplate, type ProjectTemplate } from '../templates/index.ts';

export function createProject(template: ProjectTemplate, overrides: Partial<Project> = {}): string {
  const { projectId, changes } = instantiateTemplate(template, overrides);
  store.apply(changes);
  return projectId;
}

/** Why a locked log book can't save a new project from here, or null when it can. */
export function cannotSaveNewProject(): string | null {
  const status = store.getStatus();
  if (store.canWriteFiles) return null;
  if (status.folderNeedsPermission) return 'Allow access to the data folder first.';
  return status.folderSupported
    ? 'Connect the repo’s data folder first, or open the app with `npm run dev`.'
    : 'Open the app with `npm run dev` (or in Chrome/Edge with the data folder connected) to create a project.';
}

/**
 * Create a project on a locked log book (from the sign-in page): checks the admin password, saves
 * the new project's own password in data/lock.json, then signs in to the new project.
 */
export async function createLockedProject(
  lock: LockInfo,
  template: ProjectTemplate,
  { name, password, adminPassword }: { name: string; password: string; adminPassword: string },
): Promise<string> {
  if (!lock.admin) throw new Error('No admin password is set yet. Run `npm run lock` in the repo to set one.');
  const adminKey = await unlockAdmin(lock, adminPassword);
  if (!adminKey) throw new Error('Wrong admin password.');
  if (!getDataKeys()) setDataKeys(new Map()); // locked, with nothing open yet
  await store.init();
  const problem = cannotSaveNewProject();
  if (problem) throw new Error(problem);
  const { projectId, changes } = instantiateTemplate(template, { name });
  await addProjectPassword(projectId, name, password, adminKey);
  store.apply(changes);
  return projectId;
}

/** A template holding an existing project's team and features (not its tasks or entries). */
export function templateFromProject(data: ProjectData): ProjectTemplate {
  const { project } = data;
  return {
    key: `copy-${project.id}`,
    label: `Same team as ${project.name}`,
    description: '',
    project: {
      organisation: project.organisation,
      course: project.course,
      group: project.group,
      supervisor: project.supervisor,
      entryTypes: project.entryTypes,
      weekStartsOn: project.weekStartsOn,
    },
    members: data.members.filter((m) => !m.archived).map((m) => ({ name: m.name, role: m.role, colour: m.colour })),
    features: data.features.map((f) => ({
      name: f.name,
      description: f.description,
      colour: f.colour,
      owners: f.ownerIds.map((id) => data.memberById.get(id)?.name ?? '').filter(Boolean),
    })),
    tasks: [],
  };
}

/**
 * Delete a project with all its records. On a locked log book only an admin can (pass the admin
 * password): it is also taken off the sign-in page and its encrypted folder is removed. That part
 * runs first, so a failure deletes nothing.
 */
export async function deleteProject(ws: Workspace, projectId: string, adminPassword = ''): Promise<void> {
  if (isLockedSite()) await removeLockedProject(projectId, adminPassword);
  const del: { collection: CollectionName; id: string }[] = [{ collection: 'projects', id: projectId }];
  for (const c of ['members', 'features', 'tasks', 'entries', 'weekNotes'] as const) {
    for (const r of ws[c]) if (r.projectId === projectId) del.push({ collection: c, id: r.id });
  }
  store.apply({ del });
}
