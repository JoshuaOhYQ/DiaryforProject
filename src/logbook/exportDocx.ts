/**
 * The weekly log book as a Word document (.docx), built with the `docx` library.
 * Loaded on demand, so the library only downloads when someone exports.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { Lexer, type Token, type Tokens } from 'marked';
import type { AttachmentRef } from '../types.ts';
import type { ProjectData } from '../data/select.ts';
import { formatDate, formatRange, todayISO } from '../lib/dates.ts';
import { formatHours, formatNumber, pluralise } from '../lib/text.ts';
import type { LogbookWeek } from './buildWeek.ts';
import type { LogbookOptions } from './LogbookDocument.tsx';

export interface DocxImage {
  data: ArrayBuffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

const ACCENT = '2B6F8E';
const RULE = 'CFD5DC';
const SOFT = 'F2F4F7';
const MUTED = '5D6673';
const PAGE_WIDTH_TWIPS = 11906 - 2 * 1000; // A4 minus margins
const MAX_IMAGE_W = 560;
const MAX_IMAGE_H = 420;

type Block = Paragraph | Table;

interface Style {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  size?: number;
  color?: string;
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function run(text: string, style: Style = {}): TextRun {
  return new TextRun({ text, bold: style.bold, italics: style.italics, strike: style.strike, size: style.size, color: style.color });
}

function inline(tokens: Token[] | undefined, style: Style = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...inline(t.tokens, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...inline(t.tokens, { ...style, italics: true }));
        break;
      case 'del':
        out.push(...inline(t.tokens, { ...style, strike: true }));
        break;
      case 'codespan':
        out.push(new TextRun({ text: decode(t.text), font: 'Consolas', size: (style.size ?? 21) - 2, bold: style.bold }));
        break;
      case 'link':
        out.push(new ExternalHyperlink({ link: t.href, children: [new TextRun({ text: decode(t.text) || t.href, style: 'Hyperlink', bold: style.bold })] }));
        break;
      case 'br':
        out.push(new TextRun({ break: 1 }));
        break;
      case 'image':
        break;
      case 'html':
        out.push(run(decode(t.text.replace(/<[^>]+>/g, '')), style));
        break;
      default:
        if ('tokens' in t && Array.isArray(t.tokens) && t.tokens.length) out.push(...inline(t.tokens, style));
        else if ('text' in t) out.push(run(decode(String(t.text)), style));
    }
  }
  return out;
}

function listBlocks(list: Tokens.List, level: number, style: Style): Block[] {
  const out: Block[] = [];
  list.items.forEach((item, i) => {
    const children: ParagraphChild[] = [];
    const nested: Block[] = [];
    for (const tok of item.tokens) {
      if (tok.type === 'list') nested.push(...listBlocks(tok as Tokens.List, level + 1, style));
      else if (tok.type === 'text' || tok.type === 'paragraph') children.push(...inline((tok as Tokens.Text).tokens ?? [tok], style));
    }
    if (list.ordered) {
      const n = (typeof list.start === 'number' ? list.start : 1) + i;
      out.push(new Paragraph({ children: [run(`${n}. `, style), ...children], indent: { left: 360 * (level + 1), hanging: 280 }, spacing: { after: 40 } }));
    } else {
      out.push(new Paragraph({ children, bullet: { level }, spacing: { after: 40 } }));
    }
    out.push(...nested);
  });
  return out;
}

/** Markdown text → Word paragraphs and tables. */
export function markdownBlocks(md: string, style: Style = {}): Block[] {
  if (!md.trim()) return [];
  const out: Block[] = [];
  for (const t of new Lexer({ gfm: true, breaks: true }).lex(md)) {
    switch (t.type) {
      case 'paragraph':
      case 'text':
        out.push(new Paragraph({ children: inline((t as Tokens.Paragraph).tokens, style), spacing: { after: 80 } }));
        break;
      case 'heading':
        out.push(new Paragraph({ children: inline(t.tokens, { ...style, bold: true }), spacing: { before: 80, after: 40 } }));
        break;
      case 'list':
        out.push(...listBlocks(t as Tokens.List, 0, style));
        break;
      case 'code':
        for (const line of (t as Tokens.Code).text.split('\n')) {
          out.push(new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 17 })], shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' }, spacing: { after: 0 } }));
        }
        out.push(new Paragraph({ spacing: { after: 60 } }));
        break;
      case 'blockquote':
        for (const b of markdownBlocks((t as Tokens.Blockquote).text, { ...style, italics: true })) out.push(b);
        break;
      case 'table': {
        const tt = t as Tokens.Table;
        out.push(
          table(
            tt.header.map((h) => [new Paragraph({ children: inline(h.tokens, { bold: true }) })]),
            tt.rows.map((r) => r.map((c) => [new Paragraph({ children: inline(c.tokens) })])),
          ),
        );
        out.push(new Paragraph({ spacing: { after: 60 } }));
        break;
      }
      default:
        break; // space, hr, html blocks
    }
  }
  return out;
}

type CellContent = string | Block[];

function cell(content: CellContent, opts: { header?: boolean; align?: 'right'; width?: number } = {}): TableCell {
  const children =
    typeof content === 'string'
      ? [
          new Paragraph({
            children: content.split('\n').map((line, i) => new TextRun({ text: line, bold: opts.header, size: 19, break: i ? 1 : undefined })),
            alignment: opts.align === 'right' ? AlignmentType.RIGHT : undefined,
          }),
        ]
      : content.length
        ? content
        : [new Paragraph('')];
  return new TableCell({
    children,
    shading: opts.header ? { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
  });
}

function table(header: CellContent[], rows: CellContent[][], fractions?: number[], numericCols: number[] = []): Table {
  const cols = header.length;
  const widths = (fractions ?? Array(cols).fill(1 / cols)).map((f) => Math.round(f * PAGE_WIDTH_TWIPS));
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  return new Table({
    width: { size: PAGE_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { header: true, width: widths[i], align: numericCols.includes(i) ? 'right' : undefined })) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, { width: widths[i], align: numericCols.includes(i) ? 'right' : undefined })) })),
    ],
  });
}

const h1 = (text: string) => new Paragraph({ children: [run(text, { bold: true, size: 34 })], spacing: { after: 60 } });
const h2 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [run(text, { bold: true, size: 25, color: ACCENT })],
    spacing: { before: 280, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: ACCENT, space: 2 } },
    keepNext: true,
  });
const h3 = (children: ParagraphChild[]) => new Paragraph({ heading: HeadingLevel.HEADING_3, children, spacing: { before: 180, after: 60 }, keepNext: true });
const meta = (text: string) => new Paragraph({ children: [run(text, { color: MUTED, size: 19 })], spacing: { after: 40 } });
const label = (text: string) => new Paragraph({ children: [run(text.toUpperCase(), { bold: true, size: 15, color: MUTED })], spacing: { before: 80, after: 20 }, keepNext: true });
const note = (text: string) => new Paragraph({ children: [run(text, { italics: true, color: MUTED })] });

async function imageBlock(ref: AttachmentRef, getImage: (ref: AttachmentRef) => Promise<DocxImage | null>): Promise<Paragraph[]> {
  const img = await getImage(ref);
  if (!img) return [];
  const scale = Math.min(1, MAX_IMAGE_W / img.width, MAX_IMAGE_H / img.height);
  return [
    new Paragraph({
      children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }, altText: { name: ref.name, description: ref.name, title: ref.name } })],
      spacing: { before: 60, after: 20 },
    }),
    new Paragraph({ children: [run(ref.name, { size: 16, color: MUTED })], spacing: { after: 80 } }),
  ];
}

export async function buildLogbookDocx(week: LogbookWeek, data: ProjectData, options: LogbookOptions, getImage: (ref: AttachmentRef) => Promise<DocxImage | null>): Promise<Blob> {
  const { project } = week;
  const memberName = (id: string) => data.memberById.get(id)?.name ?? 'Unknown';
  const featureName = (id: string | null) => (id ? (data.featureById.get(id)?.name ?? '—') : '—');
  const body: Block[] = [];

  // Title block
  body.push(h1(`${project.name} — Project Log Book`));
  const sub = [project.organisation, project.course, project.group].filter(Boolean).join(' · ');
  if (sub) body.push(meta(sub));
  if (project.supervisor) body.push(meta(`Supervisor: ${project.supervisor}`));
  body.push(
    meta(
      week.member
        ? `Student: ${week.member.name}${week.member.role ? ` (${week.member.role})` : ''}`
        : `Team: ${data.members.filter((m) => !m.archived).map((m) => m.name).join(', ')}`,
    ),
  );
  body.push(new Paragraph({ children: [run(`${week.weekLabel}: ${week.rangeLabel}`, { bold: true, size: 24 })], spacing: { before: 120, after: 80 } }));
  body.push(
    new Paragraph({
      children: [
        run(`${formatNumber(week.totalHours)} hours logged · ${pluralise(week.entries.length, 'entry', 'entries')} · ${pluralise(week.completed.length, 'task')} completed · ${pluralise(week.issues.length, 'issue')} recorded`, { color: MUTED }),
      ],
    }),
  );

  // Hours
  body.push(h2('Hours'));
  const dayHeads = week.days.map((d) => `${formatDate(d, 'weekday')} ${+d.slice(8, 10)}`);
  const hourRows: CellContent[][] = week.hoursTable.map((r) => [r.member.name, ...r.perDay.map((h) => (h ? formatNumber(h) : '')), formatNumber(r.total)]);
  if (week.hoursTable.length > 1) hourRows.push(['Total', ...week.dayTotals.map((h) => (h ? formatNumber(h) : '')), formatNumber(week.totalHours)]);
  const numeric = [1, 2, 3, 4, 5, 6, 7, 8];
  body.push(table(['Member', ...dayHeads, 'Total'], hourRows, [0.28, ...Array(7).fill(0.08), 0.16], numeric));

  // Per-member summary
  body.push(h2(week.member ? 'Summary' : 'Summary by member'));
  for (const m of week.members) {
    body.push(h3([run(`${m.member.name}${m.member.role ? ` — ${m.member.role}` : ''}`, { bold: true, size: 22 }), run(`  ·  ${formatHours(m.hours)}, ${pluralise(m.entries.length, 'entry', 'entries')}`, { color: MUTED, size: 19 })]));
    if (m.features.length) body.push(meta(`Worked on: ${m.features.map((f) => `${f.feature?.name ?? 'general'} (${formatHours(f.hours)})`).join(', ')}`));
    body.push(...markdownBlocks(m.narrative));
  }

  // Full entries
  if (options.details) {
    body.push(h2('Work log'));
    if (!week.entries.length) body.push(note('No entries were logged this week.'));
    for (const e of week.entries) {
      const task = e.taskId ? data.taskById.get(e.taskId)?.name : undefined;
      body.push(
        new Paragraph({
          children: [run(formatDate(e.date, 'long'), { bold: true }), run(`  ·  ${memberName(e.authorId)} · ${featureName(e.featureId)}${task ? ` · Task: ${task}` : ''} · ${e.type} · ${formatHours(e.hours)}`, { color: MUTED, size: 19 })],
          spacing: { before: 200, after: 60 },
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
          keepNext: true,
        }),
      );
      const fields: [string, string][] = [
        ['', e.did],
        ['Problems encountered', e.problems],
        ['How they were fixed', e.fixes],
        ['Result / evidence', e.result],
        ['Next steps', e.next],
      ];
      for (const [name, text] of fields) {
        if (!text.trim()) continue;
        if (name) body.push(label(name));
        body.push(...markdownBlocks(text));
      }
      if (e.links.length) {
        body.push(
          new Paragraph({
            children: e.links.flatMap((l, i) => [...(i ? [run('   ')] : []), new ExternalHyperlink({ link: l.url, children: [new TextRun({ text: l.label || l.url, style: 'Hyperlink', size: 18 })] })]),
            spacing: { after: 60 },
          }),
        );
      }
      if (options.screenshots) {
        for (const a of e.attachments.filter((x) => x.mime.startsWith('image/'))) body.push(...(await imageBlock(a, getImage)));
      }
      const files = e.attachments.filter((a) => !a.mime.startsWith('image/'));
      if (files.length) body.push(meta(`Attached: ${files.map((a) => a.name).join(', ')}`));
    }
  }

  // Completed tasks
  body.push(h2('Completed tasks and milestones'));
  if (!week.completed.length && !week.milestones.length) body.push(note('No tasks were completed this week.'));
  else
    body.push(
      table(
        ['Task', 'Feature', 'Planned', 'Actual', 'Status'],
        [
          ...week.completed.map(({ task, actual, slip }) => [task.name, featureName(task.featureId), formatRange(task.start, task.end), actual.start ? formatRange(actual.start, actual.end!) : '—', slip.label]),
          ...week.milestones.map(({ task, reached }) => [`◆ ${task.name}`, featureName(task.featureId), formatDate(task.start), '—', reached ? 'Reached' : 'Not yet reached']),
        ],
        [0.3, 0.2, 0.17, 0.17, 0.16],
      ),
    );

  // Issues
  body.push(h2('Issues and fixes'));
  if (!week.issues.length) body.push(note('No problems were recorded this week.'));
  else
    body.push(
      table(
        ['Date / who', 'Problem', 'How it was fixed'],
        week.issues.map((e) => [`${formatDate(e.date, 'short')}\n${memberName(e.authorId)}`, markdownBlocks(e.problems), e.fixes.trim() ? markdownBlocks(e.fixes) : [note('Not yet resolved')]]),
        [0.18, 0.41, 0.41],
      ),
    );

  // Next week
  body.push(h2('Plan for next week'));
  if (week.plannedNext.length)
    body.push(
      table(
        ['Planned task', 'Who', 'Dates', 'Done'],
        week.plannedNext.map((t) => [`${t.milestone ? '◆ ' : ''}${t.name}`, t.assigneeIds.map(memberName).join(', ') || '—', t.milestone ? formatDate(t.start) : formatRange(t.start, t.end), t.milestone ? '' : `${t.progress}%`]),
        [0.42, 0.26, 0.2, 0.12],
        [3],
      ),
    );
  for (const { member, entry } of week.nextSteps) {
    body.push(h3([run(member.name, { bold: true, size: 21 })]));
    body.push(...markdownBlocks(entry.next));
  }
  if (!week.plannedNext.length && !week.nextSteps.length) body.push(note('No next steps recorded.'));

  // Sign-off
  if (options.signOff) {
    const line = { style: BorderStyle.SINGLE, size: 6, color: '1D232B' };
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const signCell = (text: string) =>
      new TableCell({
        children: [new Paragraph({ children: [run(text, { size: 18, color: MUTED })] })],
        borders: { top: line, bottom: none, left: none, right: none },
        margins: { top: 60, right: 400 },
        width: { size: PAGE_WIDTH_TWIPS / 2, type: WidthType.DXA },
      });
    body.push(new Paragraph({ spacing: { before: 900 } }));
    body.push(
      new Table({
        width: { size: PAGE_WIDTH_TWIPS, type: WidthType.DXA },
        columnWidths: [PAGE_WIDTH_TWIPS / 2, PAGE_WIDTH_TWIPS / 2],
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: [new TableRow({ children: [signCell(`${week.member ? 'Student' : 'Team representative'} signature and date`), signCell('Supervisor signature and date')] })],
      }),
    );
  }
  body.push(new Paragraph({ children: [run(`Generated ${formatDate(todayISO(), 'long')} from the project log.`, { size: 16, color: MUTED })], spacing: { before: 300 } }));

  const doc = new Document({
    creator: 'Project log book',
    title: `${project.name} — ${week.weekLabel}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ size: 16, color: MUTED, children: [`${project.name} · ${week.weekLabel}${week.member ? ` · ${week.member.name}` : ''} · Page `, PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBlob(doc);
}
