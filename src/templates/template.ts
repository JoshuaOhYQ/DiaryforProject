/**
 * Project templates: a starting team, features and milestones for a new project.
 * Add your own by copying piper.ts and listing it in index.ts.
 */
import type { FeatureStatus, ISODate, Project } from '../types.ts';
import type { Changes } from '../data/changes.ts';
import { newFeature, newMember, newProject, newTask } from '../data/factories.ts';
import { PALETTE } from '../data/workspace.ts';

export interface ProjectTemplate {
  key: string;
  label: string;
  description: string;
  project: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>;
  members: { name: string; role?: string; colour?: string }[];
  features: { name: string; description?: string; status?: FeatureStatus; colour?: string; owners?: string[] }[];
  tasks: {
    name: string;
    feature?: string;
    assignees?: string[];
    start: ISODate;
    end?: ISODate;
    milestone?: boolean;
    progress?: number;
    notes?: string;
    /** Names of other tasks in this template. */
    dependsOn?: string[];
  }[];
}

/** Turn a template into records for a brand-new project (fresh ids every time). */
export function instantiateTemplate(t: ProjectTemplate, overrides: Partial<Project> = {}): { projectId: string; changes: Changes } {
  const project = newProject({ ...t.project, ...overrides });
  const members = t.members.map((m, i) =>
    newMember(project.id, { name: m.name, role: m.role ?? '', colour: m.colour ?? PALETTE[i % PALETTE.length] }),
  );
  const memberId = (name: string) => members.find((m) => m.name === name)?.id;
  const features = t.features.map((f, i) =>
    newFeature(project.id, {
      name: f.name,
      description: f.description ?? '',
      status: f.status ?? 'Not started',
      colour: f.colour ?? PALETTE[i % PALETTE.length],
      ownerIds: (f.owners ?? []).map(memberId).filter((id): id is string => !!id),
      order: i,
    }),
  );
  const tasks = t.tasks.map((task) =>
    newTask(project.id, {
      name: task.name,
      featureId: features.find((f) => f.name === task.feature)?.id ?? null,
      assigneeIds: (task.assignees ?? []).map(memberId).filter((id): id is string => !!id),
      start: task.start,
      end: task.milestone ? task.start : (task.end ?? task.start),
      milestone: !!task.milestone,
      progress: task.progress ?? 0,
      notes: task.notes ?? '',
    }),
  );
  t.tasks.forEach((task, i) => {
    tasks[i].dependsOn = (task.dependsOn ?? []).map((name) => tasks.find((x) => x.name === name)?.id).filter((id): id is string => !!id);
  });
  return { projectId: project.id, changes: { put: { projects: [project], members, features, tasks } } };
}
