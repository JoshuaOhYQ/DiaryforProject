/** Read-only views over the workspace for one project, with id lookups. Cached per workspace version. */
import type { Entry, Feature, Member, Project, Task, WeekNote, Workspace } from '../types.ts';

export interface ProjectData {
  project: Project;
  members: Member[];
  /** Members who are not archived, for pickers. */
  activeMembers: Member[];
  features: Feature[];
  tasks: Task[];
  /** Newest first. */
  entries: Entry[];
  weekNotes: WeekNote[];
  memberById: Map<string, Member>;
  featureById: Map<string, Feature>;
  taskById: Map<string, Task>;
}

const cache = new WeakMap<Workspace, Map<string, ProjectData>>();

export function selectProject(ws: Workspace, projectId: string | null): ProjectData | null {
  const project = ws.projects.find((p) => p.id === projectId);
  if (!project) return null;
  let perWs = cache.get(ws);
  if (!perWs) cache.set(ws, (perWs = new Map()));
  const hit = perWs.get(project.id);
  if (hit) return hit;

  const mine = <T extends { projectId: string }>(list: T[]) => list.filter((r) => r.projectId === project.id);
  const members = mine(ws.members).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const features = mine(ws.features).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const tasks = mine(ws.tasks).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.name.localeCompare(b.name));
  const entries = mine(ws.entries).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const data: ProjectData = {
    project,
    members,
    activeMembers: members.filter((m) => !m.archived),
    features,
    tasks,
    entries,
    weekNotes: mine(ws.weekNotes),
    memberById: new Map(members.map((m) => [m.id, m])),
    featureById: new Map(features.map((f) => [f.id, f])),
    taskById: new Map(tasks.map((t) => [t.id, t])),
  };
  perWs.set(project.id, data);
  return data;
}
