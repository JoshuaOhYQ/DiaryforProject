import { useLayoutEffect, useRef, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronUp, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import type { Entry } from '../types.ts';
import { useEntryEditor, useProject } from '../app/context.ts';
import { href } from '../app/router.ts';
import { toast } from '../app/toast.tsx';
import { store } from '../data/index.ts';
import { formatDate } from '../lib/dates.ts';
import { formatHours } from '../lib/text.ts';
import { AttachmentThumb } from './attachments.tsx';
import { FeatureChip, MemberChip } from './Chips.tsx';
import { Markdown } from './Markdown.tsx';

export const ENTRY_SECTIONS: { key: 'did' | 'problems' | 'fixes' | 'result' | 'next'; label: string }[] = [
  { key: 'did', label: 'What I did' },
  { key: 'problems', label: 'Problems encountered' },
  { key: 'fixes', label: 'How I fixed them' },
  { key: 'result', label: 'Result / evidence' },
  { key: 'next', label: 'Next steps' },
];

export function deleteEntry(entry: Entry) {
  if (!confirm('Delete this log entry?')) return;
  store.remove('entries', entry.id);
  toast('Entry deleted', { label: 'Undo', run: () => store.put('entries', entry) });
}

interface Props {
  entry: Entry;
  showDate?: boolean;
  compact?: boolean;
  highlight?: boolean;
  onTagClick?: (tag: string) => void;
}

export function EntryCard({ entry, showDate, compact, highlight, onTagClick }: Props) {
  const { taskById } = useProject();
  const editor = useEntryEditor();
  const task = entry.taskId ? taskById.get(entry.taskId) : undefined;
  const sections = compact ? ENTRY_SECTIONS.filter((s) => s.key === 'did' || s.key === 'problems') : ENTRY_SECTIONS;
  const body = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [expanded, setExpanded] = useState(!!highlight);

  // Long entries (e.g. an imported report) are folded so the log stays scannable.
  useLayoutEffect(() => {
    if (!compact && body.current) setTall(body.current.scrollHeight > 560);
  }, [entry, compact]);

  return (
    <article className={`card entry${compact ? ' compact' : ''}${highlight ? ' highlight' : ''}`} id={`entry-${entry.id}`}>
      <div className="entry-head">
        {showDate && <strong className="small">{formatDate(entry.date, 'long')}</strong>}
        <MemberChip id={entry.authorId} />
        <FeatureChip id={entry.featureId} />
        <span className="badge">{entry.type}</span>
        <span className="small num muted">{formatHours(entry.hours)}</span>
        <span className="actions no-print">
          {compact && (
            <a className="btn ghost icon small" href={href('/log', { entry: entry.id })} title="Open in log" aria-label="Open in log">
              <ExternalLink size={15} />
            </a>
          )}
          <button className="btn ghost icon small" onClick={() => editor.openEdit(entry)} aria-label="Edit entry" title="Edit">
            <Pencil size={15} />
          </button>
          <button className="btn ghost icon small" onClick={() => deleteEntry(entry)} aria-label="Delete entry" title="Delete">
            <Trash2 size={15} />
          </button>
        </span>
      </div>

      <div ref={body} className={`entry-body${tall && !expanded ? ' clamped' : ''}`}>
        {sections.map((s) =>
          entry[s.key].trim() ? (
            <div className="entry-section" key={s.key}>
              {s.key !== 'did' && <div className="label">{s.label}</div>}
              <Markdown text={entry[s.key]} />
            </div>
          ) : null,
        )}
      </div>
      {tall && (
        <button className="btn ghost small" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {expanded ? 'Show less' : 'Show all'}
        </button>
      )}

      {!compact && entry.attachments.length > 0 && (
        <div className="thumbs">
          {entry.attachments.map((a) => (
            <AttachmentThumb key={a.id} attachment={a} />
          ))}
        </div>
      )}

      {(task || entry.tags.length > 0 || entry.links.length > 0) && (
        <div className="entry-foot">
          {task && (
            <a href={href('/gantt', { task: task.id })} title="Show on the Gantt chart">
              <CalendarRange size={14} />
              {task.milestone ? '◆ ' : ''}
              {task.name}
            </a>
          )}
          {entry.tags.map((t) =>
            onTagClick ? (
              <button key={t} className="tag" onClick={() => onTagClick(t)}>
                #{t}
              </button>
            ) : (
              <span key={t} className="tag">
                #{t}
              </span>
            ),
          )}
          {entry.links.map((l, i) => (
            <a key={`${l.url}-${i}`} href={l.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
              {l.label || l.url}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
