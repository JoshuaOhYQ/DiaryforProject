/**
 * Turn an existing markdown work log into log entries.
 *
 * Two layouts are understood:
 *  1. A dated log: every heading that contains a date ("## 12 Sep 2026", "### 2026-09-12 — MQTT")
 *     starts a new entry. Inside it, "Problem:", "Fix:", "Next:", "Hours:" lines or sub-headings
 *     sort the text into fields.
 *  2. A one-off report (like docs/WORK_LOG_smart_home.md): the whole file becomes one entry,
 *     with "Date:" and "Done by:" read from the top and each section sorted by its heading.
 *
 * Anything that can't be sorted ends up in "What I did", so no text is ever dropped.
 */
import type { Entry, Feature, ISODate, Link, Member } from '../types.ts';
import { findDateInText, todayISO } from '../lib/dates.ts';
import { defaultLinkLabel, parseTags } from '../lib/text.ts';
import { newEntry } from '../data/factories.ts';

export type EntryField = 'did' | 'problems' | 'fixes' | 'result' | 'next';

export interface ParsedEntry {
  date: ISODate | null;
  authorName: string | null;
  featureHint: string | null;
  title: string;
  hours: number | null;
  type: string | null;
  did: string;
  problems: string;
  fixes: string;
  result: string;
  next: string;
  tags: string[];
  links: Link[];
  warnings: string[];
}

interface Section {
  level: number;
  title: string;
  lines: string[];
}

const FIELD_RULES: [EntryField | 'problemsFixes', RegExp][] = [
  ['next', /\b(next( steps?)?|to-?do|plans?( for)?|upcoming|future work|action items?|what i (will )?do next)\b/],
  ['problemsFixes', /(problem|issue|challenge|bug|blocker|difficult)\w*\b.*\b(fix|solv|resolv|solution|overc)/],
  ['fixes', /\b(fix(es|ed)?|solutions?|solved|resolved|resolution|workarounds?|how i (fixed|solved))\b/],
  ['problems', /\b(problems?|issues?|challenges?|bugs?|blockers?|difficult(y|ies)|obstacles?|work around|risks?)\b/],
  ['result', /\b(results?|evidence|outcomes?|testing|tests?|status|stands|achieved|verification|findings|notes? for)\b/],
  ['did', /\b(what i (did|built|made)|work done|done|summary|built|tasks?|activities|overview|implementation|design|decisions?)\b/],
];

const META_RULES: [MetaKey, RegExp][] = [
  ['date', /^(date|day|when)$/],
  ['author', /^(done by|author|by|name|member|student|logged by|written by)$/],
  ['feature', /^(part of the system|feature|subsystem|sub-system|area|module|component|work ?package)$/],
  ['hours', /^(hours?|hrs|time spent|time|duration)$/],
  ['type', /^(type|category|activity)$/],
  ['tags', /^(tags?|keywords?|labels?)$/],
  ['project', /^(project)$/],
];
type MetaKey = 'date' | 'author' | 'feature' | 'hours' | 'type' | 'tags' | 'project';

const LABEL_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([A-Za-z][A-Za-z0-9 /&'()-]{0,40}?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/;

function cleanHeading(title: string): string {
  return title
    .replace(/^\s*(\d+[.)]|[IVX]+\.)\s+/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

function classifyHeading(title: string): EntryField | 'problemsFixes' | null {
  const t = cleanHeading(title).toLowerCase();
  for (const [field, re] of FIELD_RULES) if (re.test(t)) return field;
  return null;
}

function metaKey(label: string): MetaKey | null {
  const l = label.toLowerCase().trim();
  for (const [key, re] of META_RULES) if (re.test(l)) return key;
  return null;
}

function parseHours(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)?\b/i.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (/min/i.test(text) && !m[2]) return Math.round((n / 60) * 100) / 100;
  return Number.isFinite(n) && n <= 24 ? n : null;
}

function hoursInTitle(title: string): number | null {
  const m = /\(?\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)\b\)?/i.exec(title);
  return m ? parseFloat(m[1]) : null;
}

function splitSections(md: string): Section[] {
  const sections: Section[] = [{ level: 0, title: '', lines: [] }];
  let fence: string | null = null;
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) fence = fence === f[1] ? null : (fence ?? f[1]);
    const h = fence ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) sections.push({ level: h[1].length, title: h[2], lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections;
}

/** Trim blank lines and stray horizontal rules from the ends of a block. */
function tidy(text: string): string {
  const lines = text.split('\n');
  const isFiller = (l: string) => !l.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  while (lines.length && isFiller(lines[0])) lines.shift();
  while (lines.length && isFiller(lines[lines.length - 1])) lines.pop();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

class FieldCollector {
  private chunks: Record<EntryField, { heading: string; body: string }[]> = { did: [], problems: [], fixes: [], result: [], next: [] };

  add(field: EntryField, body: string, heading = '') {
    const text = tidy(body);
    if (text) this.chunks[field].push({ heading, body: text });
  }

  build(field: EntryField): string {
    const list = this.chunks[field];
    if (list.length === 1) return list[0].body;
    return list.map((c) => (c.heading ? `**${c.heading}**\n\n${c.body}` : c.body)).join('\n\n');
  }
}

/** Split a "problems I hit and how I solved them" section into problem and fix halves. */
export function splitProblemsAndFixes(text: string): { problems: string; fixes: string } {
  const paragraphs = tidy(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const items: string[][] = [];
  for (const p of paragraphs) {
    if (!items.length || /^(\*\*|__|[-*+]\s|\d+[.)]\s|#{1,6}\s)/.test(p)) items.push([p]);
    else items[items.length - 1].push(p);
  }

  const problems: string[] = [];
  const fixes: string[] = [];
  const FIX_START = /^(\*\*|__)?\s*(fix(ed)?|the fix|to fix|solution|solved|resolved|workaround|i fixed|i solved|i found it|i traced|i tracked)\b/i;
  const FIX_INSIDE = /\b(so i|fixed by|solved by|resolved by|fix was|worked around)\b/i;

  for (const item of items) {
    const raw = item.join('\n\n').replace(/^[-*+]\s+/, '');
    const title = /^(?:\*\*|__)(.+?)(?:\*\*|__)/.exec(raw)?.[1]?.replace(/[.:]\s*$/, '') ?? '';
    // Sentence boundaries, allowing for a closing ** or quote after the full stop.
    const sentences = raw.split(/(?<=[.!?](?:\*\*|__|["”')])?)\s+(?=\S)/);
    let at = sentences.findIndex((s, i) => i > 0 && (FIX_START.test(s) || FIX_INSIDE.test(s)));
    if (at === -1) at = sentences.length;
    const problem = sentences.slice(0, at).join(' ').replace(/\s*\n\s*/g, ' ').trim();
    const fix = sentences.slice(at).join(' ').replace(/\s*\n\s*/g, ' ').trim();
    if (problem) problems.push(`- ${problem}`);
    if (fix) fixes.push(title ? `- **${title}:** ${fix}` : `- ${fix}`);
  }
  return { problems: problems.join('\n'), fixes: fixes.join('\n') };
}

function extractLinks(text: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  const add = (label: string, url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  };
  for (const m of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/(?<![(\[])\bhttps?:\/\/[^\s)<>\]]+/g)) add('', m[0]);
  return links;
}

function emptyEntry(): ParsedEntry {
  return {
    date: null,
    authorName: null,
    featureHint: null,
    title: '',
    hours: null,
    type: null,
    did: '',
    problems: '',
    fixes: '',
    result: '',
    next: '',
    tags: [],
    links: [],
    warnings: [],
  };
}

/** Read "Key: value" lines; returns the lines that were not metadata. */
function readMeta(lines: string[], entry: ParsedEntry, fallbackYear?: number): string[] {
  const rest: string[] = [];
  for (const line of lines) {
    const m = LABEL_LINE.exec(line);
    const key = m ? metaKey(m[1]) : null;
    if (!m || !key) {
      rest.push(line);
      continue;
    }
    const value = m[2].replace(/[*_]+$/, '').trim();
    if (key === 'date') entry.date ??= findDateInText(value, fallbackYear);
    else if (key === 'author') entry.authorName ??= value;
    else if (key === 'feature') entry.featureHint ??= value;
    else if (key === 'hours') entry.hours ??= parseHours(value);
    else if (key === 'type') entry.type ??= value;
    else if (key === 'tags') entry.tags.push(...parseTags(value));
  }
  return rest;
}

/**
 * Join hard-wrapped lines back into paragraphs (many editors wrap at 80 columns), leaving
 * lists, tables, headings, quotes and code blocks alone.
 */
export function unwrapLines(md: string): string {
  const out: string[] = [];
  let fence = false;
  let prevJoinable = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      out.push(line);
      prevJoinable = false;
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    const startsBlock = !line.trim() || /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|\|)/.test(line);
    if (!startsBlock && prevJoinable && !/ {2}$/.test(out[out.length - 1])) {
      out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${line.trim()}`;
    } else {
      out.push(line);
    }
    prevJoinable = !!line.trim() && !/^\s*(#{1,6}\s|\|)/.test(line);
  }
  return out.join('\n');
}

function finish(entry: ParsedEntry, fields: FieldCollector, allText: string): ParsedEntry {
  entry.did = unwrapLines(fields.build('did'));
  entry.problems = unwrapLines(fields.build('problems'));
  entry.fixes = unwrapLines(fields.build('fixes'));
  entry.result = unwrapLines(fields.build('result'));
  entry.next = unwrapLines(fields.build('next'));
  entry.links = extractLinks(allText);
  if (!entry.tags.includes('imported')) entry.tags.push('imported');
  if (!entry.date) entry.warnings.push('No date found');
  if (entry.hours === null) entry.warnings.push('No hours found');
  if (!entry.authorName) entry.warnings.push('No author found');
  return entry;
}

function parseReport(sections: Section[], fallbackYear?: number): ParsedEntry {
  const entry = emptyEntry();
  const fields = new FieldCollector();
  const h1 = sections.find((s) => s.level === 1);
  entry.title = h1 ? cleanHeading(h1.title) : '';
  entry.date = h1 ? findDateInText(h1.title, fallbackYear) : null;

  for (const s of sections) {
    const isTop = s.level <= 1;
    const body = (isTop ? readMeta(s.lines, entry, fallbackYear) : s.lines).join('\n');
    if (isTop) {
      fields.add('did', body);
      continue;
    }
    const heading = cleanHeading(s.title);
    const kind = classifyHeading(s.title) ?? 'did';
    if (kind === 'problemsFixes') {
      const { problems, fixes } = splitProblemsAndFixes(body);
      fields.add('problems', problems, heading);
      fields.add('fixes', fixes, heading);
    } else {
      fields.add(kind, body, heading);
    }
  }
  entry.featureHint ??= entry.title || null;
  return finish(entry, fields, sections.map((s) => s.lines.join('\n')).join('\n'));
}

function parseDatedLog(sections: Section[], fallbackYear?: number): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const preamble = emptyEntry();
  readMeta(sections.filter((s) => s.level <= 1).flatMap((s) => s.lines), preamble, fallbackYear);

  let i = 0;
  while (i < sections.length) {
    const s = sections[i];
    const date = s.level >= 1 ? findDateInText(s.title, fallbackYear) : null;
    if (!date) {
      i++;
      continue;
    }
    const entry = emptyEntry();
    entry.date = date;
    entry.hours = hoursInTitle(s.title);
    entry.authorName = preamble.authorName;
    entry.featureHint = preamble.featureHint;
    entry.title = cleanHeading(
      s.title
        .replace(/\(?\b\d+(?:\.\d+)?\s*(h|hr|hrs|hours?)\b\)?/i, '')
        .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/, '')
        .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu|thur|thurs|fri|sat|sun)\b,?/i, '')
        .replace(/\b\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?(,?\s+\d{4})?\b/, '')
        .replace(/^[\s—–:|-]+|[\s—–:|-]+$/g, ''),
    );

    const fields = new FieldCollector();
    let current: EntryField = 'did';
    const consume = (lines: string[]) => {
      let buffer: string[] = [];
      const flush = () => {
        fields.add(current, buffer.join('\n'));
        buffer = [];
      };
      for (const line of readMeta(lines, entry, fallbackYear)) {
        const m = LABEL_LINE.exec(line);
        const label = m ? classifyHeading(m[1]) : null;
        if (m && label && m[1].split(/\s+/).length <= 4) {
          flush();
          if (label === 'problemsFixes') current = 'problems';
          else current = label;
          if (m[2].trim()) buffer.push(m[2]);
        } else {
          buffer.push(line);
        }
      }
      flush();
    };

    if (entry.title) fields.add('did', `**${entry.title}**`);
    consume(s.lines);
    let j = i + 1;
    while (j < sections.length && sections[j].level > s.level && !findDateInText(sections[j].title, fallbackYear)) {
      const sub = sections[j];
      const kind = classifyHeading(sub.title);
      if (kind === 'problemsFixes') {
        const { problems, fixes } = splitProblemsAndFixes(sub.lines.join('\n'));
        fields.add('problems', problems);
        fields.add('fixes', fixes);
      } else {
        current = kind ?? current;
        if (!kind) fields.add(current, `**${cleanHeading(sub.title)}**`);
        consume(sub.lines);
      }
      j++;
    }
    entries.push(finish(entry, fields, sections.slice(i, j).map((x) => x.lines.join('\n')).join('\n')));
    i = j;
  }
  return entries;
}

export function parseMarkdownLog(md: string, options: { fallbackYear?: number } = {}): ParsedEntry[] {
  const fallbackYear = options.fallbackYear ?? new Date().getFullYear();
  const sections = splitSections(md);
  const datedHeadings = sections.filter((s) => s.level >= 2 && findDateInText(s.title, fallbackYear));
  if (datedHeadings.length > 0) return parseDatedLog(sections, fallbackYear);
  if (!md.trim()) return [];
  return [parseReport(sections, fallbackYear)];
}

// ---- matching parsed names to the project's members and features -----------

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

export function matchMember(name: string | null, members: Member[]): Member | null {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  const exact = members.find((m) => m.name.toLowerCase() === n);
  if (exact) return exact;
  const nameWords = words(name);
  let best: Member | null = null;
  let bestScore = 0;
  for (const m of members) {
    const mw = words(m.name);
    const score = nameWords.filter((w) => mw.includes(w)).length;
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return best;
}

const STOP = new Set(['the', 'and', 'of', 'for', 'work', 'log', 'section', 'report', 'part', 'system']);

export function matchFeature(hint: string | null, features: Feature[]): Feature | null {
  if (!hint) return null;
  const hintWords = words(hint).filter((w) => !STOP.has(w));
  let best: Feature | null = null;
  let bestScore = 0;
  for (const f of features) {
    const fw = words(f.name).filter((w) => !STOP.has(w));
    const score = fw.filter((w) => hintWords.includes(w)).length / Math.max(1, fw.length);
    if (score > bestScore) [best, bestScore] = [f, score];
  }
  return bestScore >= 0.5 ? best : null;
}

export interface ImportContext {
  projectId: string;
  members: Member[];
  features: Feature[];
  entryTypes: string[];
  /** Used when the file doesn't say who wrote it. */
  fallbackAuthorId: string;
  fallbackType?: string;
}

/** Build a log entry from a parsed one, matching names to this project's members and features. */
export function toEntry(p: ParsedEntry, ctx: ImportContext): Entry {
  const type = ctx.entryTypes.find((t) => t.toLowerCase() === (p.type ?? '').toLowerCase()) ?? ctx.fallbackType ?? ctx.entryTypes[1] ?? ctx.entryTypes[0] ?? 'Build';
  return newEntry(ctx.projectId, {
    date: p.date ?? todayISO(),
    authorId: matchMember(p.authorName, ctx.members)?.id ?? ctx.fallbackAuthorId,
    featureId: (matchFeature(p.featureHint, ctx.features) ?? matchFeature(p.title, ctx.features))?.id ?? null,
    hours: p.hours ?? 0,
    type,
    did: p.did,
    problems: p.problems,
    fixes: p.fixes,
    result: p.result,
    next: p.next,
    tags: p.tags,
    links: p.links.map((l) => ({ label: l.label || defaultLinkLabel(l.url), url: l.url })),
  });
}
