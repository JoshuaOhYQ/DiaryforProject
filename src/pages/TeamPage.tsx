import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Entry, Feature, Member } from '../types.ts';
import { useProject } from '../app/context.ts';
import { href, navigate, useRoute } from '../app/router.ts';
import { toast } from '../app/toast.tsx';
import { FEATURE_STATUSES, newFeature, newMember, store, type ProjectData } from '../data/index.ts';
import { nextColour } from '../lib/colours.ts';
import { PillToggles, Swatch } from '../components/Chips.tsx';
import { CommitInput, CommitTextarea } from '../components/CommitInput.tsx';
import { EntryCard } from '../components/EntryCard.tsx';
import { Modal } from '../components/Modal.tsx';
import { addDays, formatDate, relativeDays, startOfWeek, todayISO } from '../lib/dates.ts';
import { buildMatrix, NO_FEATURE, tallyBy } from '../lib/stats.ts';
import { formatHours, pluralise } from '../lib/text.ts';

const TABS = [
  { key: 'matrix', label: 'Who did what' },
  { key: 'members', label: 'Members' },
  { key: 'features', label: 'Features' },
] as const;

export function TeamPage() {
  const { params } = useRoute();
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'matrix';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">Members, the features they own, and who has worked on what.</p>
        </div>
        <div className="btn-group" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" className="btn" aria-pressed={tab === t.key} aria-selected={tab === t.key} onClick={() => navigate('/team', { tab: t.key }, true)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'matrix' && <MatrixView />}
      {tab === 'members' && <MembersView />}
      {tab === 'features' && <FeaturesView />}
    </>
  );
}

// ---- Who did what ------------------------------------------------------------

const PERIODS = [
  { key: 'all', label: 'All time' },
  { key: 'week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: '30', label: 'Last 30 days' },
] as const;

function periodRange(key: string, weekStartsOn: 0 | 1): [string, string] | null {
  const today = todayISO();
  const week = startOfWeek(today, weekStartsOn);
  if (key === 'week') return [week, addDays(week, 6)];
  if (key === 'last-week') return [addDays(week, -7), addDays(week, -1)];
  if (key === '30') return [addDays(today, -29), today];
  return null;
}

function MatrixView() {
  const data = useProject();
  const [period, setPeriod] = useState<string>('all');
  const [open, setOpen] = useState<{ title: string; entries: Entry[] } | null>(null);

  const range = periodRange(period, data.project.weekStartsOn);
  const entries = useMemo(() => (range ? data.entries.filter((e) => e.date >= range[0] && e.date <= range[1]) : data.entries), [data.entries, range?.[0], range?.[1]]);
  const m = useMemo(() => buildMatrix(entries), [entries]);

  const members = data.members.filter((x) => !x.archived || m.byMember.has(x.id));
  const columns: { id: string; name: string; colour: string }[] = [
    ...data.features.map((f) => ({ id: f.id, name: f.name, colour: f.colour })),
    ...(m.byFeature.has(NO_FEATURE) ? [{ id: NO_FEATURE, name: 'No feature', colour: 'var(--border-strong)' }] : []),
  ];

  const shade = (hours: number) => (hours > 0 && m.maxHours > 0 ? `color-mix(in srgb, var(--accent) ${Math.round(8 + (hours / m.maxHours) * 30)}%, transparent)` : undefined);

  const cellButton = (title: string, hours: number, count: number, list: Entry[], strong = false) =>
    count === 0 ? (
      <span className="muted">—</span>
    ) : (
      <button className="matrix-cell" onClick={() => setOpen({ title, entries: list })} title={`${title}: ${formatHours(hours)}, ${pluralise(count, 'entry', 'entries')}`}>
        <span className={`num${strong ? ' strong' : ''}`}>{formatHours(hours)}</span>
        <span className="small muted num">{pluralise(count, 'entry', 'entries')}</span>
      </button>
    );

  return (
    <>
      <div className="row between" style={{ marginBottom: '0.75rem' }}>
        <div className="btn-group">
          {PERIODS.map((p) => (
            <button key={p.key} className="btn small" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="small muted">Click a cell to see the entries behind it.</span>
      </div>

      {members.length === 0 ? (
        <div className="card empty">
          <h3>No members yet</h3>
          <a className="btn" href={href('/team', { tab: 'members' })}>
            Add members
          </a>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th>Member</th>
                {columns.map((c) => (
                  <th key={c.id} className="num">
                    <span className="chip" style={{ justifyContent: 'flex-end', whiteSpace: 'normal' }}>
                      <Swatch colour={c.colour} />
                      {c.name}
                    </span>
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {members.map((mem) => {
                const row = m.byMember.get(mem.id);
                return (
                  <tr key={mem.id}>
                    <th scope="row">
                      <span className="chip" style={{ color: 'var(--text)', fontSize: '0.9rem', textTransform: 'none', letterSpacing: 0 }}>
                        <Swatch colour={mem.colour} round />
                        {mem.name}
                      </span>
                    </th>
                    {columns.map((c) => {
                      const t = m.cell(mem.id, c.id);
                      return (
                        <td key={c.id} className="num" style={{ background: shade(t.hours) }}>
                          {cellButton(`${mem.name} · ${c.name}`, t.hours, t.count, t.entries)}
                        </td>
                      );
                    })}
                    <td className="num total">{cellButton(`${mem.name} · all features`, row?.hours ?? 0, row?.count ?? 0, row?.entries ?? [], true)}</td>
                  </tr>
                );
              })}
              <tr className="totals">
                <th scope="row">Total</th>
                {columns.map((c) => {
                  const t = m.byFeature.get(c.id);
                  return (
                    <td key={c.id} className="num">
                      {cellButton(`${c.name} · everyone`, t?.hours ?? 0, t?.count ?? 0, t?.entries ?? [], true)}
                    </td>
                  );
                })}
                <td className="num">{cellButton('Everyone · all features', m.total.hours, m.total.count, m.total.entries, true)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title={open.title} size="wide" onClose={() => setOpen(null)}>
          <p className="muted small">
            {pluralise(open.entries.length, 'entry', 'entries')} · {formatHours(open.entries.reduce((s, e) => s + e.hours, 0))}
          </p>
          {[...open.entries]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((e) => (
              <EntryCard key={e.id} entry={e} showDate compact />
            ))}
        </Modal>
      )}
    </>
  );
}

// ---- Members -----------------------------------------------------------------

function MembersView() {
  const data = useProject();
  const [name, setName] = useState('');
  const stats = useMemo(() => tallyBy(data.entries, (e) => e.authorId), [data.entries]);
  const update = (m: Member, patch: Partial<Member>) => store.put('members', { ...m, ...patch });

  function add() {
    if (!name.trim()) return;
    store.put('members', newMember(data.project.id, { name: name.trim(), colour: nextColour(data.members.map((m) => m.colour)) }));
    setName('');
  }

  function remove(m: Member) {
    const count = stats.get(m.id)?.count ?? 0;
    if (count > 0) {
      if (confirm(`${m.name} has ${pluralise(count, 'entry', 'entries')}, which must keep their author. Archive ${m.name} instead? Archived members stay in reports but disappear from pickers.`)) update(m, { archived: true });
      return;
    }
    if (!confirm(`Remove ${m.name} from the team?`)) return;
    store.apply({
      del: [{ collection: 'members', id: m.id }],
      put: {
        features: data.features.filter((f) => f.ownerIds.includes(m.id)).map((f) => ({ ...f, ownerIds: f.ownerIds.filter((id) => id !== m.id) })),
        tasks: data.tasks.filter((t) => t.assigneeIds.includes(m.id)).map((t) => ({ ...t, assigneeIds: t.assigneeIds.filter((id) => id !== m.id) })),
      },
    });
  }

  return (
    <div className="card table-wrap">
      <table className="table members-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>Colour</th>
            <th>Name</th>
            <th>Role</th>
            <th>Owns</th>
            <th className="num">Logged</th>
            <th>Last entry</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.members.map((m) => {
            const s = stats.get(m.id);
            const owns = data.features.filter((f) => f.ownerIds.includes(m.id));
            return (
              <tr key={m.id} style={m.archived ? { opacity: 0.6 } : undefined}>
                <td>
                  <input type="color" value={m.colour} aria-label={`Colour for ${m.name}`} onChange={(e) => update(m, { colour: e.target.value })} />
                </td>
                <td>
                  <CommitInput value={m.name} aria-label="Name" onCommit={(v) => v.trim() && update(m, { name: v.trim() })} style={{ width: '100%' }} />
                </td>
                <td>
                  <CommitInput value={m.role} aria-label="Role" placeholder="Role (optional)" onCommit={(v) => update(m, { role: v.trim() })} style={{ width: '100%' }} />
                </td>
                <td className="small">{owns.length ? owns.map((f) => f.name).join(', ') : <span className="muted">—</span>}</td>
                <td className="num nowrap">
                  {s ? (
                    <a href={href('/log', { member: m.id })}>
                      {formatHours(s.hours)} · {s.count}
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="small nowrap">{s?.last ? `${formatDate(s.last, 'short')} (${relativeDays(s.last)})` : <span className="muted">never</span>}</td>
                <td className="nowrap" style={{ textAlign: 'right' }}>
                  {m.archived ? (
                    <button className="btn ghost small" onClick={() => update(m, { archived: false })} title="Restore">
                      <ArchiveRestore size={15} /> Restore
                    </button>
                  ) : (
                    <button className="btn ghost icon small" onClick={() => remove(m)} aria-label={`Remove ${m.name}`} title={s ? 'Archive' : 'Remove'}>
                      {s ? <Archive size={15} /> : <Trash2 size={15} />}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form
        className="row"
        style={{ padding: '0.75rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="New member's name" aria-label="New member's name" />
        <button className="btn" type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Add member
        </button>
      </form>
    </div>
  );
}

// ---- Features ----------------------------------------------------------------

function FeaturesView() {
  const data = useProject();
  const [name, setName] = useState('');
  const stats = useMemo(() => tallyBy(data.entries, (e) => e.featureId ?? NO_FEATURE), [data.entries]);

  function add() {
    if (!name.trim()) return;
    store.put('features', newFeature(data.project.id, { name: name.trim(), colour: nextColour(data.features.map((f) => f.colour)), order: data.features.length }));
    setName('');
  }

  function move(index: number, dir: -1 | 1) {
    const list = [...data.features];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    const reordered = list.map((f, i) => ({ ...f, order: i })).filter((f) => data.featureById.get(f.id)?.order !== f.order);
    store.apply({ put: { features: reordered } });
  }

  return (
    <div className="stack">
      <div className="feature-grid">
        {data.features.map((f, i) => (
          <FeatureCard key={f.id} feature={f} data={data} stats={stats.get(f.id)} first={i === 0} last={i === data.features.length - 1} onMove={(d) => move(i, d)} />
        ))}
      </div>
      <form
        className="card row"
        style={{ padding: '0.75rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="New feature or subsystem" aria-label="New feature name" />
        <button className="btn" type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Add feature
        </button>
      </form>
    </div>
  );
}

function FeatureCard({
  feature: f,
  data,
  stats,
  first,
  last,
  onMove,
}: {
  feature: Feature;
  data: ProjectData;
  stats?: { hours: number; count: number };
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const update = (patch: Partial<Feature>) => store.put('features', { ...f, ...patch });
  const tasks = data.tasks.filter((t) => t.featureId === f.id);

  function remove() {
    const refs = (stats?.count ?? 0) + tasks.length;
    if (!confirm(refs ? `Delete "${f.name}"? Its ${pluralise(stats?.count ?? 0, 'entry', 'entries')} and ${pluralise(tasks.length, 'task')} will be kept with no feature.` : `Delete "${f.name}"?`)) return;
    store.apply({
      del: [{ collection: 'features', id: f.id }],
      put: {
        entries: data.entries.filter((e) => e.featureId === f.id).map((e) => ({ ...e, featureId: null })),
        tasks: tasks.map((t) => ({ ...t, featureId: null })),
      },
    });
    toast('Feature deleted');
  }

  const statusClass = { 'Not started': '', 'In progress': 'accent', Blocked: 'danger', Done: 'ok' }[f.status];

  return (
    <article className="card card-pad feature-card" style={{ borderTop: `3px solid ${f.colour}` }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="color" value={f.colour} aria-label="Colour" onChange={(e) => update({ colour: e.target.value })} />
        <CommitInput className="grow feature-name" value={f.name} aria-label="Feature name" onCommit={(v) => v.trim() && update({ name: v.trim() })} />
      </div>
      <select value={f.status} aria-label="Status" className={`status-select ${statusClass}`} onChange={(e) => update({ status: e.target.value as Feature['status'] })}>
        {FEATURE_STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <CommitTextarea value={f.description} rows={2} placeholder="What this part of the project does" aria-label="Description" onCommit={(v) => update({ description: v })} />
      <div className="field">
        <span className="label">Owners</span>
        {data.activeMembers.length ? (
          <PillToggles label="Owners" options={data.activeMembers.map((m) => ({ value: m.id, label: m.name, colour: m.colour }))} value={f.ownerIds} onChange={(ownerIds) => update({ ownerIds })} />
        ) : (
          <span className="small muted">Add members first.</span>
        )}
      </div>
      <div className="row between small">
        <span className="muted">
          {stats ? (
            <a href={href('/log', { feature: f.id })}>
              {formatHours(stats.hours)} · {pluralise(stats.count, 'entry', 'entries')}
            </a>
          ) : (
            'No entries yet'
          )}{' '}
          · {pluralise(tasks.length, 'task')}
        </span>
        <span className="row" style={{ gap: 0 }}>
          <button className="btn ghost icon small" disabled={first} onClick={() => onMove(-1)} aria-label="Move up" title="Move earlier">
            <ArrowUp size={15} />
          </button>
          <button className="btn ghost icon small" disabled={last} onClick={() => onMove(1)} aria-label="Move down" title="Move later">
            <ArrowDown size={15} />
          </button>
          <button className="btn ghost icon small danger" onClick={remove} aria-label={`Delete ${f.name}`} title="Delete">
            <Trash2 size={15} />
          </button>
        </span>
      </div>
    </article>
  );
}
