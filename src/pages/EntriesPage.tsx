import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileUp, Plus, Search, X } from 'lucide-react';
import { useEntryEditor, useProject } from '../app/context.ts';
import { navigate, useRoute } from '../app/router.ts';
import { EntryCard } from '../components/EntryCard.tsx';
import { ImportDialog } from '../components/ImportDialog.tsx';
import { entriesToCsv } from '../lib/csv.ts';
import { formatDate, relativeDays } from '../lib/dates.ts';
import { downloadText, safeFileName } from '../lib/files.ts';
import { allTags, EMPTY_FILTER, filterEntries, isFilterActive, totalHours, type EntryFilter } from '../lib/search.ts';
import { formatHours, pluralise } from '../lib/text.ts';

const PAGE = 60;

export function EntriesPage() {
  const data = useProject();
  const editor = useEntryEditor();
  const { params } = useRoute();
  const highlight = params.get('entry');
  const [filter, setFilter] = useState<EntryFilter>(() => ({
    ...EMPTY_FILTER,
    memberIds: params.get('member') ? [params.get('member')!] : [],
    featureIds: params.get('feature') ? [params.get('feature')!] : [],
  }));
  const [limit, setLimit] = useState(PAGE);
  const [importing, setImporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterEntries(data.entries, filter, data), [data, filter]);
  const tags = useMemo(() => allTags(data.entries), [data.entries]);
  const shown = results.slice(0, highlight ? Math.max(limit, results.findIndex((e) => e.id === highlight) + 1) : limit);

  const groups = useMemo(() => {
    const out: { date: string; entries: typeof shown }[] = [];
    for (const e of shown) {
      const last = out[out.length - 1];
      if (last?.date === e.date) last.entries.push(e);
      else out.push({ date: e.date, entries: [e] });
    }
    return out;
  }, [shown]);

  // Arriving from the Gantt chart or a search link: scroll to the entry.
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`entry-${highlight}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  // "/" focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (patch: Partial<EntryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
    if (highlight) navigate('/log', {}, true);
  };

  const one = (list: string[]) => list[0] ?? '';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Log</h1>
          <p className="muted">
            {pluralise(results.length, 'entry', 'entries')} · {formatHours(totalHours(results))}
            {isFilterActive(filter) && ` (filtered from ${data.entries.length})`}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setImporting(true)}>
            <FileUp size={16} /> Import markdown
          </button>
          <button className="btn" onClick={() => downloadText(entriesToCsv(results, data), `${safeFileName(data.project.name)}-entries.csv`, 'text/csv')} disabled={!results.length}>
            <Download size={16} /> CSV
          </button>
          <button className="btn primary" onClick={() => editor.openNew()}>
            <Plus size={16} /> New entry <kbd>N</kbd>
          </button>
        </div>
      </div>

      <div className="card filters" role="search">
        <div className="field search">
          <label htmlFor="f-text">Search</label>
          <div className="search-box">
            <Search size={16} />
            <input ref={searchRef} id="f-text" type="search" value={filter.text} onChange={(e) => update({ text: e.target.value })} placeholder='Search all text… ( / )  e.g. broker "two brokers"' />
          </div>
        </div>
        <div className="field">
          <label htmlFor="f-member">Member</label>
          <select id="f-member" value={one(filter.memberIds)} onChange={(e) => update({ memberIds: e.target.value ? [e.target.value] : [] })}>
            <option value="">Everyone</option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-feature">Feature</label>
          <select id="f-feature" value={one(filter.featureIds)} onChange={(e) => update({ featureIds: e.target.value ? [e.target.value] : [] })}>
            <option value="">All features</option>
            {data.features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-type">Type</label>
          <select id="f-type" value={one(filter.types)} onChange={(e) => update({ types: e.target.value ? [e.target.value] : [] })}>
            <option value="">All types</option>
            {data.project.entryTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-tag">Tag</label>
          <select id="f-tag" value={one(filter.tags)} onChange={(e) => update({ tags: e.target.value ? [e.target.value] : [] })}>
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label">Dates</span>
          <div className="dates">
            <input type="date" aria-label="From" value={filter.from} onChange={(e) => update({ from: e.target.value })} />
            <input type="date" aria-label="To" value={filter.to} onChange={(e) => update({ to: e.target.value })} />
            {isFilterActive(filter) && (
              <button className="btn ghost icon" onClick={() => update(EMPTY_FILTER)} aria-label="Clear filters" title="Clear filters">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {data.entries.length === 0 ? (
        <div className="card empty">
          <h3>No entries yet</h3>
          <p>
            Press <kbd>N</kbd> anywhere to log what you just did. It takes under a minute.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => editor.openNew()}>
              <Plus size={16} /> Add the first entry
            </button>
            <button className="btn" onClick={() => setImporting(true)}>
              <FileUp size={16} /> Import a markdown work log
            </button>
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="card empty">
          <h3>Nothing matches</h3>
          <button className="btn" onClick={() => update(EMPTY_FILTER)}>
            Clear filters
          </button>
        </div>
      ) : (
        groups.map((g) => (
          <section className="day-group" key={g.date}>
            <h2 className="day-head">
              <strong>{formatDate(g.date, 'long')}</strong>
              <span>{relativeDays(g.date)}</span>
              <span>· {formatHours(totalHours(g.entries))}</span>
            </h2>
            {g.entries.map((e) => (
              <EntryCard key={e.id} entry={e} highlight={e.id === highlight} onTagClick={(t) => update({ tags: [t] })} />
            ))}
          </section>
        ))
      )}

      {results.length > shown.length && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({results.length - shown.length} older)
          </button>
        </div>
      )}

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}
