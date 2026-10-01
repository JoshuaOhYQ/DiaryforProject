import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Link2, X } from 'lucide-react';
import type { Entry } from '../types.ts';
import { useProject } from '../app/context.ts';
import { toast } from '../app/toast.tsx';
import { store } from '../data/index.ts';
import { isISODate } from '../lib/dates.ts';
import { prepareImage } from '../lib/files.ts';
import { setPref } from '../lib/prefs.ts';
import { parseLinkInput, parseTags } from '../lib/text.ts';
import { AttachmentThumb } from './attachments.tsx';

interface Props {
  initial: Entry;
  isNew: boolean;
  onDone: () => void;
  formId: string;
}

const hasDetails = (e: Entry) => !!(e.problems || e.fixes || e.result || e.next || e.tags.length || e.links.length);

/** Quick-add and edit form for a log entry. Ctrl/Cmd+Enter saves. */
export function EntryForm({ initial, isNew, onDone, formId }: Props) {
  const data = useProject();
  const { project } = data;
  const [entry, setEntry] = useState<Entry>(initial);
  const [more, setMore] = useState(!isNew || hasDetails(initial));
  const [tagText, setTagText] = useState(initial.tags.join(', '));
  const [linkText, setLinkText] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Entry>) => setEntry((e) => ({ ...e, ...patch }));

  const authors = data.members.filter((m) => !m.archived || m.id === entry.authorId);
  const tasks = useMemo(
    () => data.tasks.filter((t) => !entry.featureId || t.featureId === entry.featureId || t.id === entry.taskId),
    [data.tasks, entry.featureId, entry.taskId],
  );

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy((n) => n + files.length);
    for (const file of files) {
      try {
        if (file.size > 25 * 1024 * 1024) {
          toast(`${file.name} is over 25 MB; link to it instead.`);
          continue;
        }
        const blob = await prepareImage(file);
        const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        const ref = await store.addAttachment(blob, name);
        setEntry((e) => ({ ...e, attachments: [...e.attachments, ref] }));
      } catch (err) {
        toast(`Could not add ${file.name}: ${(err as Error).message}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    const typingText = (e.target as HTMLElement).matches('input, textarea') && e.clipboardData.types.includes('text/plain');
    if (typingText) return;
    e.preventDefault();
    void addFiles(files);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void addFiles([...e.dataTransfer.files]);
  }

  function addLink() {
    const link = parseLinkInput(linkText, project.repoUrl);
    if (!link) {
      if (linkText.trim()) setError('Links must start with http(s)://, or be a commit hash (set the repo URL in Settings).');
      return false;
    }
    set({ links: [...entry.links, link] });
    setLinkText('');
    setError('');
    return true;
  }

  function save() {
    if (!isISODate(entry.date)) return setError('Pick a date.');
    if (!entry.authorId) return setError('Choose who did the work (add members on the Team page).');
    if (!(entry.did.trim() || entry.problems.trim() || entry.result.trim())) return setError('Write a line about what you did.');
    if (busy) return setError('Wait for attachments to finish adding.');
    let links = entry.links;
    if (linkText.trim()) {
      const link = parseLinkInput(linkText, project.repoUrl);
      if (!link) return setError('That link is not a URL or commit hash.');
      links = [...links, link];
    }
    store.put('entries', { ...entry, links, tags: parseTags(tagText), hours: Math.max(0, Number(entry.hours) || 0) });
    setPref(`lastAuthor:${project.id}`, entry.authorId);
    setPref(`lastType:${project.id}`, entry.type);
    setPref(`lastFeature:${project.id}:${entry.authorId}`, entry.featureId);
    toast(isNew ? 'Entry added' : 'Entry updated');
    onDone();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  }

  return (
    <form
      id={formId}
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="top-row">
        <div className="field">
          <label htmlFor="e-date">Date</label>
          <input id="e-date" type="date" value={entry.date} onChange={(e) => set({ date: e.target.value })} required />
        </div>
        <div className="field author">
          <label htmlFor="e-author">Who</label>
          <select id="e-author" value={entry.authorId} onChange={(e) => set({ authorId: e.target.value })}>
            {!entry.authorId && <option value="">Choose…</option>}
            {authors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="e-hours">Hours</label>
          <input
            id="e-hours"
            type="number"
            min={0}
            max={24}
            step={0.25}
            inputMode="decimal"
            list="hour-options"
            value={Number.isFinite(entry.hours) ? entry.hours : ''}
            onChange={(e) => set({ hours: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
          <datalist id="hour-options">
            {[0.5, 1, 1.5, 2, 3, 4, 6, 8].map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="field">
        <span className="label">Type</span>
        <div className="pills" role="radiogroup" aria-label="Type of work">
          {project.entryTypes.map((t) => (
            <button type="button" key={t} className="pill" role="radio" aria-checked={entry.type === t} onClick={() => set({ type: t })}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="e-feature">Feature</label>
          <select
            id="e-feature"
            value={entry.featureId ?? ''}
            onChange={(e) => {
              const featureId = e.target.value || null;
              const task = entry.taskId ? data.taskById.get(entry.taskId) : null;
              set({ featureId, taskId: task && featureId && task.featureId !== featureId ? null : entry.taskId });
            }}
          >
            <option value="">— None —</option>
            {data.features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="e-task">Gantt task</label>
          <select
            id="e-task"
            value={entry.taskId ?? ''}
            onChange={(e) => {
              const taskId = e.target.value || null;
              const task = taskId ? data.taskById.get(taskId) : null;
              set({ taskId, featureId: entry.featureId ?? task?.featureId ?? null });
            }}
          >
            <option value="">— None —</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.milestone ? '◆ ' : ''}
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="e-did">What I did</label>
        <textarea
          id="e-did"
          rows={isNew ? 4 : 6}
          autoFocus
          value={entry.did}
          onChange={(e) => set({ did: e.target.value })}
          placeholder="e.g. Set up the Mosquitto broker and tested publish/subscribe from the ESP32. Markdown works: **bold**, - lists, `code`."
        />
      </div>

      <div className={`dropzone${over ? ' over' : ''}`}>
        {entry.attachments.length > 0 && (
          <div className="thumbs" style={{ marginTop: 0, marginBottom: '0.5rem', justifyContent: 'center' }}>
            {entry.attachments.map((a) => (
              <AttachmentThumb key={a.id} attachment={a} onRemove={() => set({ attachments: entry.attachments.filter((x) => x.id !== a.id) })} />
            ))}
          </div>
        )}
        <span>
          {busy ? 'Adding…' : 'Paste a screenshot (Ctrl+V), drop files here, or '}
          {!busy && (
            <button type="button" className="btn small ghost" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={15} /> choose files
            </button>
          )}
        </span>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => void addFiles([...(e.target.files ?? [])])} />
      </div>

      <button type="button" className="btn ghost small details-toggle" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        Problems, fixes, results, next steps, tags and links
      </button>

      {more && (
        <>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="e-problems">Problems encountered</label>
              <textarea id="e-problems" rows={3} value={entry.problems} onChange={(e) => set({ problems: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="e-fixes">How I fixed them</label>
              <textarea id="e-fixes" rows={3} value={entry.fixes} onChange={(e) => set({ fixes: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="e-result">Result / evidence</label>
              <textarea id="e-result" rows={3} value={entry.result} onChange={(e) => set({ result: e.target.value })} placeholder="Test output, measurements, what now works…" />
            </div>
            <div className="field">
              <label htmlFor="e-next">Next steps</label>
              <textarea id="e-next" rows={3} value={entry.next} onChange={(e) => set({ next: e.target.value })} />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="e-tags">Tags</label>
              <input id="e-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="mqtt, esp32, safety" />
            </div>
            <div className="field">
              <label htmlFor="e-link">Links</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  id="e-link"
                  className="grow"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      addLink();
                    }
                  }}
                  placeholder="https://… or commit hash"
                />
                <button type="button" className="btn" onClick={addLink}>
                  <Link2 size={15} /> Add
                </button>
              </div>
              {entry.links.length > 0 && (
                <div className="link-list">
                  {entry.links.map((l, i) => (
                    <div className="link-row" key={`${l.url}-${i}`}>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.label || l.url}
                      </a>
                      <button type="button" className="btn ghost icon small" aria-label="Remove link" onClick={() => set({ links: entry.links.filter((_, j) => j !== i) })}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
