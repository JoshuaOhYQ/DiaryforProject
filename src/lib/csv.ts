import type { Entry } from '../types.ts';
import type { ProjectData } from '../data/select.ts';

export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The BOM makes Excel open the file as UTF-8.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function entriesToCsv(entries: Entry[], data: Pick<ProjectData, 'memberById' | 'featureById' | 'taskById'>): string {
  const header = ['Date', 'Author', 'Feature', 'Task', 'Type', 'Hours', 'What I did', 'Problems', 'How I fixed them', 'Result / evidence', 'Next steps', 'Tags', 'Links', 'Attachments', 'Entry id'];
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => [
      e.date,
      data.memberById.get(e.authorId)?.name ?? '',
      e.featureId ? (data.featureById.get(e.featureId)?.name ?? '') : '',
      e.taskId ? (data.taskById.get(e.taskId)?.name ?? '') : '',
      e.type,
      e.hours,
      e.did,
      e.problems,
      e.fixes,
      e.result,
      e.next,
      e.tags.join(' '),
      e.links.map((l) => (l.label ? `${l.label} <${l.url}>` : l.url)).join('; '),
      e.attachments.map((a) => a.file).join('; '),
      e.id,
    ]);
  return toCsv([header, ...rows]);
}
