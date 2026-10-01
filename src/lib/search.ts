/** Full-text search and filters over log entries. */
import type { Entry, ISODate } from '../types.ts';
import type { ProjectData } from '../data/select.ts';

export interface EntryFilter {
  text: string;
  memberIds: string[];
  featureIds: string[];
  types: string[];
  tags: string[];
  from: ISODate | '';
  to: ISODate | '';
  taskId?: string | null;
}

export const EMPTY_FILTER: EntryFilter = { text: '', memberIds: [], featureIds: [], types: [], tags: [], from: '', to: '' };

type Lookups = Pick<ProjectData, 'memberById' | 'featureById' | 'taskById'>;

const haystacks = new WeakMap<Entry, string>();

export function entryHaystack(e: Entry, lookups: Lookups): string {
  let h = haystacks.get(e);
  if (h === undefined) {
    h = [
      e.date,
      e.type,
      lookups.memberById.get(e.authorId)?.name,
      e.featureId ? lookups.featureById.get(e.featureId)?.name : '',
      e.taskId ? lookups.taskById.get(e.taskId)?.name : '',
      e.did,
      e.problems,
      e.fixes,
      e.result,
      e.next,
      e.tags.map((t) => `#${t}`).join(' '),
      e.links.map((l) => `${l.label} ${l.url}`).join(' '),
      e.attachments.map((a) => a.name).join(' '),
    ]
      .join('\n')
      .toLowerCase();
    haystacks.set(e, h);
  }
  return h;
}

/** Words must all appear (in any order); "quoted phrases" must appear as written. */
export function parseQuery(text: string): string[] {
  const terms: string[] = [];
  for (const m of text.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim();
    if (term) terms.push(term);
  }
  return terms;
}

export function filterEntries(entries: Entry[], f: EntryFilter, lookups: Lookups): Entry[] {
  const terms = parseQuery(f.text);
  return entries.filter((e) => {
    if (f.memberIds.length && !f.memberIds.includes(e.authorId)) return false;
    if (f.featureIds.length && !f.featureIds.includes(e.featureId ?? '')) return false;
    if (f.types.length && !f.types.includes(e.type)) return false;
    if (f.tags.length && !f.tags.every((t) => e.tags.includes(t))) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.taskId && e.taskId !== f.taskId) return false;
    if (terms.length) {
      const h = entryHaystack(e, lookups);
      if (!terms.every((t) => h.includes(t))) return false;
    }
    return true;
  });
}

export function isFilterActive(f: EntryFilter): boolean {
  return !!(f.text.trim() || f.memberIds.length || f.featureIds.length || f.types.length || f.tags.length || f.from || f.to || f.taskId);
}

export function allTags(entries: Entry[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function totalHours(entries: Entry[]): number {
  return Math.round(entries.reduce((sum, e) => sum + e.hours, 0) * 100) / 100;
}
