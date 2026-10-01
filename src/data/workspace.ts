/**
 * The shape of data/logbook.json, plus helpers to create, clean up and serialise it.
 *
 * normalize* functions fill in defaults for missing fields and keep any fields they
 * don't know about, so an older copy of the app never strips data a newer one added.
 */
import type {
  CollectionName,
  Entry,
  Feature,
  FeatureStatus,
  Member,
  Project,
  RecordOf,
  Task,
  Tombstone,
  WeekNote,
  Workspace,
} from '../types.ts';
import { isISODate } from '../lib/dates.ts';

export const SCHEMA_VERSION = 1 as const;

export const COLLECTIONS: readonly CollectionName[] = ['projects', 'members', 'features', 'tasks', 'entries', 'weekNotes'];

export const DEFAULT_ENTRY_TYPES = ['Design', 'Build', 'Test', 'Debug', 'Research', 'Meeting', 'Writing'];

export const FEATURE_STATUSES: FeatureStatus[] = ['Not started', 'In progress', 'Blocked', 'Done'];

/** Distinct colours that read well on light and dark backgrounds. */
export const PALETTE = ['#2f7fc1', '#d0556d', '#2e9a6b', '#d4892a', '#8a63c9', '#1f9db0', '#c4604a', '#6f7f8f', '#b0478f', '#5f9a2f'];

export function emptyWorkspace(): Workspace {
  return { schemaVersion: SCHEMA_VERSION, projects: [], members: [], features: [], tasks: [], entries: [], weekNotes: [], tombstones: [] };
}

type Raw = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown): boolean => v === true || v === 'true';
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const date = (v: unknown, fallback = ''): string => (isISODate(v) ? v : fallback);
const stamp = (v: unknown): string => (typeof v === 'string' && v ? v : '1970-01-01T00:00:00.000Z');

/** Known fields first (in a fixed order, so the JSON file diffs cleanly), then unknown extras. */
function withExtras<T extends object>(known: T, raw: Raw): T {
  const out = { ...known } as Raw;
  for (const [k, v] of Object.entries(raw)) if (!(k in out)) out[k] = v;
  return out as T;
}

function base(raw: Raw) {
  return { id: str(raw.id), createdAt: stamp(raw.createdAt), updatedAt: stamp(raw.updatedAt ?? raw.createdAt) };
}

export function normalizeProject(raw: Raw): Project {
  const types = strArray(raw.entryTypes);
  return withExtras<Project>(
    {
      ...base(raw),
      name: str(raw.name, 'Untitled project'),
      description: str(raw.description),
      organisation: str(raw.organisation),
      course: str(raw.course),
      group: str(raw.group),
      supervisor: str(raw.supervisor),
      startDate: date(raw.startDate),
      repoUrl: str(raw.repoUrl),
      entryTypes: types.length ? types : [...DEFAULT_ENTRY_TYPES],
      weekStartsOn: raw.weekStartsOn === 0 ? 0 : 1,
    },
    raw,
  );
}

export function normalizeMember(raw: Raw): Member {
  return withExtras<Member>(
    {
      ...base(raw),
      projectId: str(raw.projectId),
      name: str(raw.name, 'Unnamed'),
      role: str(raw.role),
      colour: str(raw.colour, PALETTE[0]),
      archived: bool(raw.archived),
    },
    raw,
  );
}

export function normalizeFeature(raw: Raw): Feature {
  const status = FEATURE_STATUSES.includes(raw.status as FeatureStatus) ? (raw.status as FeatureStatus) : 'Not started';
  return withExtras<Feature>(
    {
      ...base(raw),
      projectId: str(raw.projectId),
      name: str(raw.name, 'Unnamed feature'),
      description: str(raw.description),
      status,
      ownerIds: strArray(raw.ownerIds),
      colour: str(raw.colour, PALETTE[0]),
      order: num(raw.order),
    },
    raw,
  );
}

export function normalizeTask(raw: Raw): Task {
  const start = date(raw.start, date(raw.end, '1970-01-01'));
  const milestone = bool(raw.milestone);
  let end = date(raw.end, start);
  if (milestone || end < start) end = start;
  return withExtras<Task>(
    {
      ...base(raw),
      projectId: str(raw.projectId),
      name: str(raw.name, 'Untitled task'),
      featureId: typeof raw.featureId === 'string' && raw.featureId ? raw.featureId : null,
      assigneeIds: strArray(raw.assigneeIds),
      start,
      end,
      progress: Math.min(100, Math.max(0, Math.round(num(raw.progress)))),
      dependsOn: strArray(raw.dependsOn),
      milestone,
      notes: str(raw.notes),
    },
    raw,
  );
}

export function normalizeEntry(raw: Raw): Entry {
  const links = Array.isArray(raw.links)
    ? raw.links
        .filter((l): l is Raw => !!l && typeof l === 'object')
        .map((l) => ({ label: str(l.label), url: str(l.url) }))
        .filter((l) => l.url)
    : [];
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments
        .filter((a): a is Raw => !!a && typeof a === 'object' && typeof a.id === 'string')
        .map((a) => ({ id: str(a.id), name: str(a.name, 'file'), mime: str(a.mime, 'application/octet-stream'), size: num(a.size), file: str(a.file) }))
    : [];
  return withExtras<Entry>(
    {
      ...base(raw),
      projectId: str(raw.projectId),
      date: date(raw.date, '1970-01-01'),
      authorId: str(raw.authorId),
      featureId: typeof raw.featureId === 'string' && raw.featureId ? raw.featureId : null,
      taskId: typeof raw.taskId === 'string' && raw.taskId ? raw.taskId : null,
      hours: Math.max(0, num(raw.hours)),
      type: str(raw.type, 'Build'),
      did: str(raw.did),
      problems: str(raw.problems),
      fixes: str(raw.fixes),
      result: str(raw.result),
      next: str(raw.next),
      tags: strArray(raw.tags),
      links,
      attachments,
    },
    raw,
  );
}

export function normalizeWeekNote(raw: Raw): WeekNote {
  return withExtras<WeekNote>(
    {
      ...base(raw),
      projectId: str(raw.projectId),
      weekStart: date(raw.weekStart, '1970-01-01'),
      memberId: typeof raw.memberId === 'string' && raw.memberId ? raw.memberId : null,
      narrative: str(raw.narrative),
    },
    raw,
  );
}

const NORMALIZERS: { [C in CollectionName]: (raw: Raw) => RecordOf<C> } = {
  projects: normalizeProject,
  members: normalizeMember,
  features: normalizeFeature,
  tasks: normalizeTask,
  entries: normalizeEntry,
  weekNotes: normalizeWeekNote,
};

export function normalizeRecord<C extends CollectionName>(collection: C, raw: object): RecordOf<C> {
  return NORMALIZERS[collection](raw as Raw) as RecordOf<C>;
}

/** Accepts anything parsed from JSON and returns a valid Workspace (throws if it clearly isn't one). */
export function normalizeWorkspace(input: unknown): Workspace {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('This file is not a log book backup.');
  const raw = input as Raw;
  const looksRight = COLLECTIONS.some((c) => Array.isArray(raw[c]));
  if (!looksRight) throw new Error('This file is not a log book backup (no projects, entries or tasks found).');
  const ws = emptyWorkspace();
  for (const c of COLLECTIONS) {
    const list = Array.isArray(raw[c]) ? (raw[c] as unknown[]) : [];
    const seen = new Set<string>();
    const records = list
      .filter((r): r is Raw => !!r && typeof r === 'object' && typeof (r as Raw).id === 'string' && !!(r as Raw).id)
      .map((r) => NORMALIZERS[c](r))
      .filter((r) => !seen.has(r.id) && !!seen.add(r.id));
    (ws[c] as RecordOf<typeof c>[]) = records;
  }
  ws.tombstones = Array.isArray(raw.tombstones)
    ? (raw.tombstones as Raw[])
        .filter((t) => t && typeof t.id === 'string' && COLLECTIONS.includes(t.collection as CollectionName))
        .map((t): Tombstone => ({ id: str(t.id), collection: t.collection as CollectionName, deletedAt: stamp(t.deletedAt) }))
    : [];
  return sortWorkspace(ws);
}

const byCreated = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Stable ordering so saving the same data twice produces an identical file. */
export function sortWorkspace(ws: Workspace): Workspace {
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: [...ws.projects].sort(byCreated),
    members: [...ws.members].sort(byCreated),
    features: [...ws.features].sort(byCreated),
    tasks: [...ws.tasks].sort(byCreated),
    entries: [...ws.entries].sort(byCreated),
    weekNotes: [...ws.weekNotes].sort(byCreated),
    tombstones: [...ws.tombstones].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify(sortWorkspace(ws), null, 2) + '\n';
}

export function parseWorkspace(text: string): Workspace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  return normalizeWorkspace(parsed);
}

/** Pull one project (and everything that belongs to it) out of a workspace. */
export function extractProject(ws: Workspace, projectId: string): Workspace {
  const out = emptyWorkspace();
  out.projects = ws.projects.filter((p) => p.id === projectId);
  for (const c of COLLECTIONS) {
    if (c === 'projects') continue;
    (out[c] as { projectId: string }[]) = (ws[c] as { projectId: string }[]).filter((r) => r.projectId === projectId);
  }
  return out;
}
