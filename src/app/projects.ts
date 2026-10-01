/** Creating, copying and deleting whole projects. */
import type { CollectionName, Project, Workspace } from '../types.ts';
import { store, type ProjectData } from '../data/index.ts';
import { instantiateTemplate, type ProjectTemplate } from '../templates/index.ts';

export function createProject(template: ProjectTemplate, overrides: Partial<Project> = {}): string {
  const { projectId, changes } = instantiateTemplate(template, overrides);
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

export function deleteProject(ws: Workspace, projectId: string): void {
  const del: { collection: CollectionName; id: string }[] = [{ collection: 'projects', id: projectId }];
  for (const c of ['members', 'features', 'tasks', 'entries', 'weekNotes'] as const) {
    for (const r of ws[c]) if (r.projectId === projectId) del.push({ collection: c, id: r.id });
  }
  store.apply({ del });
}
