/**
 * Draft a log book paragraph from structured entries. Plain template, no AI: it only
 * rearranges what was written, so it never invents work. Edit the result before submitting.
 */
import type { Entry } from '../types.ts';
import { firstSentence, formatHours, joinWithAnd, markdownToPlain, pluralise, stripTrailingPunctuation } from '../lib/text.ts';

interface Input {
  name: string;
  /** e.g. "5–11 Oct 2026" */
  range: string;
  entries: Entry[];
  featureName: (id: string | null) => string | null;
}

const clean = (md: string) => stripTrailingPunctuation(firstSentence(markdownToPlain(md).replace(/\s+/g, ' ').trim(), 160));

export function draftNarrative({ name, range, entries, featureName }: Input): string {
  if (!entries.length) return `${name} did not log any work during the week of ${range}.`;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const hours = sorted.reduce((s, e) => s + e.hours, 0);

  // Features, biggest first.
  const byFeature = new Map<string, number>();
  for (const e of sorted) {
    const f = featureName(e.featureId);
    if (f) byFeature.set(f, (byFeature.get(f) ?? 0) + e.hours);
  }
  const features = [...byFeature.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const featureText = features.length ? `, mainly on ${joinWithAnd(features.map(([f, h]) => (h > 0 ? `${f} (${formatHours(h)})` : f)))}` : '';

  // Types of work, most frequent first.
  const typeCounts = new Map<string, number>();
  for (const e of sorted) typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t.toLowerCase());

  const parts: string[] = [];
  parts.push(`During the week of ${range}, ${name} logged ${formatHours(hours).replace(' h', ' hours')} across ${pluralise(sorted.length, 'entry', 'entries')}${featureText}.`);
  if (types.length) parts.push(`The work was mostly ${joinWithAnd(types.slice(0, 3))}.`);

  const did = sorted.map((e) => clean(e.did)).filter(Boolean);
  if (did.length) parts.push(`Work carried out: ${did.slice(0, 4).join('; ')}.`);

  const withProblem = sorted.find((e) => clean(e.problems));
  if (withProblem) {
    parts.push(`Problem encountered: ${clean(withProblem.problems)}.`);
    const fix = clean(withProblem.fixes);
    if (fix) parts.push(`Solution: ${fix}.`);
  }

  const result = [...sorted].reverse().map((e) => clean(e.result)).find(Boolean);
  if (result) parts.push(`Outcome: ${result}.`);

  const next = [...sorted].reverse().map((e) => clean(e.next)).find(Boolean);
  if (next) parts.push(`Next steps: ${next}.`);

  return parts.join(' ');
}
