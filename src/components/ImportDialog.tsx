import { useMemo, useState } from 'react';
import { AlertTriangle, FileUp } from 'lucide-react';
import type { Entry } from '../types.ts';
import { useProject } from '../app/context.ts';
import { toast } from '../app/toast.tsx';
import { store } from '../data/index.ts';
import { formatDate } from '../lib/dates.ts';
import { pickFile } from '../lib/files.ts';
import { parseMarkdownLog, toEntry, type ParsedEntry } from '../import/markdownLog.ts';
import { Modal } from './Modal.tsx';

interface Row {
  parsed: ParsedEntry;
  entry: Entry;
  include: boolean;
}

/** Paste or open a markdown work log, check what was found, then import it as entries. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const data = useProject();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const fallbackAuthorId = data.activeMembers[0]?.id ?? '';

  function parse(source: string) {
    const parsed = parseMarkdownLog(source);
    setRows(
      parsed.map((p) => ({
        parsed: p,
        include: true,
        entry: toEntry(p, {
          projectId: data.project.id,
          members: data.members,
          features: data.features,
          entryTypes: data.project.entryTypes,
          fallbackAuthorId,
        }),
      })),
    );
  }

  async function openFile() {
    const file = await pickFile('.md,.markdown,.txt,text/markdown,text/plain');
    if (!file) return;
    const content = await file.text();
    setText(content);
    setFileName(file.name);
    parse(content);
  }

  const update = (i: number, patch: Partial<Entry>) =>
    setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, entry: { ...r.entry, ...patch } } : r)));

  const chosen = useMemo(() => (rows ?? []).filter((r) => r.include), [rows]);

  function doImport() {
    const missingAuthor = chosen.some((r) => !r.entry.authorId);
    if (missingAuthor) return toast('Every entry needs an author. Add members on the Team page first.');
    store.apply({ put: { entries: chosen.map((r) => r.entry) } });
    toast(`Imported ${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}`);
    onClose();
  }

  return (
    <Modal
      title="Import a markdown work log"
      size="wide"
      onClose={onClose}
      dismissOnBackdrop={false}
      footer={
        <>
          <span className="muted small grow">{rows ? `${chosen.length} of ${rows.length} selected` : 'Dated headings become separate entries; a report becomes one entry.'}</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {rows ? (
            <button className="btn primary" onClick={doImport} disabled={!chosen.length}>
              Import {chosen.length || ''}
            </button>
          ) : (
            <button className="btn primary" onClick={() => parse(text)} disabled={!text.trim()}>
              Read entries
            </button>
          )}
        </>
      }
    >
      {!rows ? (
        <div className="stack">
          <div className="row">
            <button className="btn" onClick={openFile}>
              <FileUp size={16} /> Open a .md file
            </button>
            <span className="muted small">or paste the markdown below</span>
          </div>
          <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'## 12 Sep 2026 — Broker set-up (2h)\nInstalled Mosquitto…\n**Problem:** …\n**Fix:** …\nNext: …'} style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <h3>No entries found</h3>
          <p>Add a heading with a date (e.g. “## 12 Sep 2026”) to each entry, or a “Date:” line for a single report.</p>
          <button className="btn" onClick={() => setRows(null)}>
            Back
          </button>
        </div>
      ) : (
        <div>
          {fileName && <p className="muted small">From {fileName}</p>}
          {rows.map((r, i) => (
            <div key={i}>
              <div className="import-row">
                <input type="checkbox" checked={r.include} aria-label="Include" onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} />
                <input type="date" aria-label="Date" value={r.entry.date} onChange={(e) => update(i, { date: e.target.value })} />
                <select aria-label="Author" value={r.entry.authorId} onChange={(e) => update(i, { authorId: e.target.value })}>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select aria-label="Feature" value={r.entry.featureId ?? ''} onChange={(e) => update(i, { featureId: e.target.value || null })}>
                  <option value="">— No feature —</option>
                  {data.features.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input type="number" aria-label="Hours" min={0} step={0.25} value={r.entry.hours} onChange={(e) => update(i, { hours: Number(e.target.value) })} />
                <select aria-label="Type" value={r.entry.type} onChange={(e) => update(i, { type: e.target.value })}>
                  {data.project.entryTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="row small" style={{ padding: '0.3rem 0 0.6rem' }}>
                <strong>{r.parsed.title || formatDate(r.entry.date, 'long')}</strong>
                {r.parsed.warnings.map((w) => (
                  <span key={w} className="badge warn">
                    <AlertTriangle size={12} /> {w}
                  </span>
                ))}
                <button className="btn ghost small" onClick={() => setOpen(open === i ? null : i)}>
                  {open === i ? 'Hide text' : 'Show text'}
                </button>
              </div>
              {open === i && (
                <div className="card card-pad small" style={{ marginBottom: '0.75rem' }}>
                  {(['did', 'problems', 'fixes', 'result', 'next'] as const).map((k) =>
                    r.entry[k] ? (
                      <div key={k} style={{ marginBottom: '0.5rem' }}>
                        <strong>{{ did: 'What I did', problems: 'Problems', fixes: 'Fixes', result: 'Result', next: 'Next steps' }[k]}</strong>
                        <pre style={{ whiteSpace: 'pre-wrap', margin: '0.2rem 0 0', maxHeight: 180, overflow: 'auto' }}>{r.entry[k]}</pre>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
