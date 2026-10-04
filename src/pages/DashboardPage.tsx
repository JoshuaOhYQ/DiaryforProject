import { useId, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { AlertTriangle, BookOpenText, CalendarClock, CheckCircle2, CircleAlert, Plus, Table2 } from 'lucide-react';
import type { Task } from '../types.ts';
import { useEntryEditor, useProject } from '../app/context.ts';
import { href } from '../app/router.ts';
import { useResolvedTheme, useThemeColors } from '../app/theme.ts';
import { Swatch } from '../components/Chips.tsx';
import { CountUp } from '../components/CountUp.tsx';
import { displayColour, NEUTRAL } from '../lib/colours.ts';
import { addDays, diffDays, formatDate, MONTHS_SHORT, relativeDays, startOfWeek, todayISO } from '../lib/dates.ts';
import { daysSinceLastEntry, recentWeeks, tallyBy, weeklyByMember, NO_FEATURE, type WeekCell } from '../lib/stats.ts';
import { formatHours, formatNumber, pluralise } from '../lib/text.ts';
import { isDueWithin, isOverdue } from '../gantt/ganttMath.ts';

const RANGES = [
  { key: 8, label: 'Last 8 weeks' },
  { key: 12, label: 'Last 12 weeks' },
  { key: 0, label: 'Since the start' },
] as const;

export function DashboardPage() {
  const data = useProject();
  const editor = useEntryEditor();
  const today = todayISO();
  const ws = data.project.weekStartsOn;
  const thisWeek = startOfWeek(today, ws);
  const lastWeek = addDays(thisWeek, -7);
  const [range, setRange] = useState<number>(8);

  const inWeek = (start: string) => data.entries.filter((e) => e.date >= start && e.date <= addDays(start, 6));
  const now = inWeek(thisWeek);
  const before = inWeek(lastWeek);
  const hoursNow = now.reduce((s, e) => s + e.hours, 0);
  const hoursBefore = before.reduce((s, e) => s + e.hours, 0);

  const overdue = data.tasks.filter((t) => isOverdue(t, today)).sort((a, b) => a.end.localeCompare(b.end));
  const dueSoon = data.tasks.filter((t) => isDueWithin(t, today, 7)).sort((a, b) => a.end.localeCompare(b.end));

  // Weeks shown in the charts below the filter row.
  const weeks = useMemo(() => {
    if (range) return recentWeeks(today, range, ws);
    const first = [data.project.startDate, ...data.entries.map((e) => e.date)].filter(Boolean).sort()[0] ?? today;
    const count = Math.min(52, Math.max(1, Math.floor(diffDays(startOfWeek(first, ws), thisWeek) / 7) + 1));
    return recentWeeks(today, count, ws);
  }, [range, today, ws, data.entries, data.project.startDate, thisWeek]);
  const rangeEntries = useMemo(() => data.entries.filter((e) => e.date >= weeks[0]), [data.entries, weeks]);

  const people = data.members.filter((m) => !m.archived || rangeEntries.some((e) => e.authorId === m.id));
  const weekly = useMemo(() => weeklyByMember(rangeEntries, people.map((m) => m.id), weeks, ws), [rangeEntries, people, weeks, ws]);
  const since = useMemo(() => daysSinceLastEntry(data.entries, people.map((m) => m.id), today), [data.entries, people, today]);
  const maxWeek = Math.max(1, ...[...weekly.values()].flat().map((c) => c.hours));
  const byFeature = useMemo(() => tallyBy(rangeEntries, (e) => e.featureId ?? NO_FEATURE), [rangeEntries]);
  const [asTable, setAsTable] = useState(false);

  const delta = hoursNow - hoursBefore;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {data.project.name} · {formatDate(today, 'long')}
          </p>
        </div>
        <div className="row">
          <a className="btn" href={href('/logbook', { week: thisWeek })}>
            <BookOpenText size={16} /> This week’s log book
          </a>
          <button className="btn primary" onClick={() => editor.openNew()}>
            <Plus size={16} /> Log work <kbd>N</kbd>
          </button>
        </div>
      </div>

      <div className="kpi-row">
        <StatTile label="Hours this week" value={formatHours(hoursNow)} note={before.length || now.length ? `${delta >= 0 ? '+' : '−'}${formatNumber(Math.abs(Math.round(delta * 100) / 100))} h vs last week` : 'Nothing logged yet'} />
        <StatTile label="Entries this week" value={String(now.length)} note={`${new Set(now.map((e) => e.authorId)).size} of ${data.activeMembers.length} members logged`} />
        <StatTile
          label="Overdue tasks"
          value={String(overdue.length)}
          status={overdue.length ? 'critical' : 'good'}
          note={overdue.length ? 'Past their planned end' : 'Nothing overdue'}
        />
        <StatTile label="Due in the next 7 days" value={String(dueSoon.length)} note={dueSoon.length ? `Next: ${dueSoon[0].name}` : 'Nothing due'} />
      </div>

      <div className="dash-grid">
        <section className="card card-pad">
          <div className="section-title">
            <h2>
              <AlertTriangle size={17} className="icon-danger" /> Overdue
            </h2>
            <span className="small muted">{pluralise(overdue.length, 'task')}</span>
          </div>
          <TaskList tasks={overdue} today={today} empty="No overdue tasks. Nice." />
        </section>
        <section className="card card-pad">
          <div className="section-title">
            <h2>
              <CalendarClock size={17} /> Due in the next 7 days
            </h2>
            <span className="small muted">{pluralise(dueSoon.length, 'task')}</span>
          </div>
          <TaskList tasks={dueSoon} today={today} empty="Nothing due this week." />
        </section>
      </div>

      <div className="filter-row" role="group" aria-label="Chart period">
        <div className="btn-group">
          {RANGES.map((r) => (
            <button key={r.key} className="btn small" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="small muted">
          {formatDate(weeks[0])} – {formatDate(addDays(weeks[weeks.length - 1], 6))} · {formatHours(rangeEntries.reduce((s, e) => s + e.hours, 0))} logged
        </span>
      </div>

      <section className="card card-pad" style={{ marginBottom: '1rem' }}>
        <div className="section-title">
          <div>
            <h2>Hours per member per week</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Same scale for everyone. Hover or tab to a column for details.
            </p>
          </div>
          <button className="btn small" aria-pressed={asTable} onClick={() => setAsTable((x) => !x)}>
            <Table2 size={15} /> {asTable ? 'Show charts' : 'Show as table'}
          </button>
        </div>
        {people.length === 0 ? (
          <p className="muted">Add team members on the Team page.</p>
        ) : asTable ? (
          <WeeklyTable people={people} weekly={weekly} weeks={weeks} />
        ) : (
          <div className="multiples">
            {people.map((m) => (
              <div className="multiple" key={m.id}>
                <div className="row between" style={{ flexWrap: 'nowrap' }}>
                  <span className="chip" style={{ color: 'var(--text)', fontWeight: 600 }}>
                    <Swatch colour={m.colour} round />
                    <span className="label">{m.name}</span>
                  </span>
                  <span className="small muted num nowrap">{formatHours(weekly.get(m.id)!.reduce((s, c) => s + c.hours, 0))}</span>
                </div>
                <MiniColumns cells={weekly.get(m.id)!} max={maxWeek} colour={m.colour} name={m.name} />
                <LastEntry days={since.get(m.id) ?? null} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <h2>Hours by feature</h2>
          <span className="small muted">{pluralise(rangeEntries.length, 'entry', 'entries')}</span>
        </div>
        <FeatureBars
          rows={[
            ...data.features.map((f) => ({ id: f.id, name: f.name, colour: f.colour, hours: byFeature.get(f.id)?.hours ?? 0, count: byFeature.get(f.id)?.count ?? 0 })),
            ...(byFeature.has(NO_FEATURE) ? [{ id: NO_FEATURE, name: 'No feature', colour: NEUTRAL, hours: byFeature.get(NO_FEATURE)!.hours, count: byFeature.get(NO_FEATURE)!.count }] : []),
          ].sort((a, b) => b.hours - a.hours)}
        />
      </section>
    </>
  );
}

function StatTile({ label, value, note, status }: { label: string; value: string; note?: string; status?: 'good' | 'critical' }) {
  return (
    <div className="card stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        <CountUp value={value} />
      </div>
      {note && (
        <div className={`stat-note${status ? ` ${status}` : ''}`}>
          {status === 'critical' && <CircleAlert size={14} />}
          {status === 'good' && <CheckCircle2 size={14} />}
          {note}
        </div>
      )}
    </div>
  );
}

function TaskList({ tasks, today, empty }: { tasks: Task[]; today: string; empty: string }) {
  const data = useProject();
  if (!tasks.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="task-list">
      {tasks.slice(0, 8).map((t) => {
        const late = t.end < today;
        return (
          <li key={t.id}>
            <a href={href('/gantt', { task: t.id })}>
              <Swatch colour={(t.featureId && data.featureById.get(t.featureId)?.colour) || NEUTRAL} />
              <span className="grow label">
                {t.milestone ? '◆ ' : ''}
                {t.name}
              </span>
              <span className="small muted nowrap hide-mobile">{t.assigneeIds.map((id) => data.memberById.get(id)?.name.split(' ')[0]).join(', ')}</span>
              <span className={`badge ${late ? 'danger' : ''} nowrap`}>{late ? `${diffDays(t.end, today)}d overdue` : t.end === today ? 'today' : relativeDays(t.end, today)}</span>
            </a>
          </li>
        );
      })}
      {tasks.length > 8 && <li className="small muted">and {tasks.length - 8} more on the Gantt chart</li>}
    </ul>
  );
}

function LastEntry({ days }: { days: number | null }) {
  const level = days === null || days > 7 ? 'critical' : days > 3 ? 'warning' : 'good';
  const text = days === null ? 'No entries yet' : days === 0 ? 'Last entry today' : `Last entry ${pluralise(days, 'day')} ago`;
  const Icon = level === 'good' ? CheckCircle2 : level === 'warning' ? AlertTriangle : CircleAlert;
  return (
    <div className={`last-entry ${level}`}>
      <Icon size={14} aria-hidden="true" />
      {text}
    </div>
  );
}

const shortDate = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS_SHORT[+iso.slice(5, 7) - 1]}`;

interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
}

function useTip() {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: PointerEvent<Element> | FocusEvent<Element>, value: string, label: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = wrap.current!.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2 - w.left, y: r.top - w.top, value, label });
  };
  const node: ReactNode = tip && (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  );
  return { wrap, show, hide: () => setTip(null), node };
}

/** One member's hours per week as thin columns (4px rounded tops, 2px gaps). */
function MiniColumns({ cells, max, colour, name }: { cells: WeekCell[]; max: number; colour: string; name: string }) {
  const theme = useResolvedTheme();
  const c = useThemeColors();
  const fill = displayColour(colour, theme);
  const { wrap, show, hide, node } = useTip();
  // useId() contains characters like «» that don't work inside url(#...).
  const gradient = `cols-${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const W = 300;
  const plotTop = 16;
  const plotH = 70;
  const base = plotTop + plotH;
  const H = base + 18;
  const band = W / cells.length;
  const colW = Math.max(3, Math.min(24, band - 2));
  const y = (h: number) => (h / max) * plotH;
  const last = cells[cells.length - 1];

  return (
    <div ref={wrap} className="viz-wrap" onPointerLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${name}: hours per week`} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={fill} />
            <stop offset="1" stopColor={fill} stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={plotTop + 0.5} y2={plotTop + 0.5} stroke={c.grid} />
        <text x={0} y={plotTop - 4} fontSize={10} fill={c.muted}>
          {formatNumber(Math.round(max * 10) / 10)} h
        </text>
        {cells.map((cell, i) => {
          const h = y(cell.hours);
          const x = i * band + (band - colW) / 2;
          const r = Math.min(4, h, colW / 2);
          const top = base - h;
          const label = `Week of ${shortDate(cell.weekStart)} · ${pluralise(cell.count, 'entry', 'entries')}`;
          return (
            <g
              key={cell.weekStart}
              tabIndex={0}
              role="img"
              aria-label={`${label}: ${formatHours(cell.hours)}`}
              onPointerEnter={(e) => show(e, formatHours(cell.hours), label)}
              onFocus={(e) => show(e, formatHours(cell.hours), label)}
              onBlur={hide}
              className="viz-hit"
            >
              <rect x={i * band} y={plotTop} width={band} height={plotH} fill="transparent" />
              {cell.hours > 0 && (
                <path
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + colW - r} Q${x + colW},${top} ${x + colW},${top + r} V${base} Z`}
                  fill={`url(#${gradient})`}
                />
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} stroke={c.borderStrong} />
        {last.hours > 0 && (
          <text x={(cells.length - 0.5) * band} y={base - y(last.hours) - 4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={c.text}>
            {formatNumber(last.hours)}
          </text>
        )}
        <text x={band / 2} y={H - 3} fontSize={10} fill={c.muted} textAnchor={cells.length > 1 ? 'start' : 'middle'}>
          {shortDate(cells[0].weekStart)}
        </text>
        {cells.length > 1 && (
          <text x={W} y={H - 3} fontSize={10} fill={c.muted} textAnchor="end">
            this week
          </text>
        )}
      </svg>
      {node}
    </div>
  );
}

function WeeklyTable({ people, weekly, weeks }: { people: { id: string; name: string }[]; weekly: Map<string, WeekCell[]>; weeks: string[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Member</th>
            {weeks.map((w) => (
              <th key={w} className="num nowrap">
                {shortDate(w)}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {people.map((m) => {
            const row = weekly.get(m.id)!;
            return (
              <tr key={m.id}>
                <td className="nowrap">{m.name}</td>
                {row.map((c) => (
                  <td key={c.weekStart} className="num">
                    {c.hours ? formatNumber(c.hours) : '—'}
                  </td>
                ))}
                <td className="num">
                  <strong>{formatNumber(Math.round(row.reduce((s, c) => s + c.hours, 0) * 100) / 100)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Hours per feature: one hue for magnitude; the feature's own colour is the identity swatch. */
function FeatureBars({ rows }: { rows: { id: string; name: string; colour: string; hours: number; count: number }[] }) {
  const { wrap, show, hide, node } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.hours));
  const total = rows.reduce((s, r) => s + r.hours, 0);
  if (!rows.length) return <p className="muted">Add features on the Team page.</p>;
  return (
    <div ref={wrap} className="viz-wrap feature-bars" onPointerLeave={hide}>
      {rows.map((r) => {
        const label = `${r.name} · ${pluralise(r.count, 'entry', 'entries')}${total ? ` · ${Math.round((r.hours / total) * 100)}% of hours` : ''}`;
        return (
          <div
            key={r.id}
            className="fbar-row viz-hit"
            tabIndex={0}
            aria-label={`${r.name}: ${formatHours(r.hours)}, ${pluralise(r.count, 'entry', 'entries')}`}
            onPointerEnter={(e) => show(e, formatHours(r.hours), label)}
            onFocus={(e) => show(e, formatHours(r.hours), label)}
            onBlur={hide}
          >
            <span className="chip fbar-name">
              <Swatch colour={r.colour} />
              <span className="label">{r.name}</span>
            </span>
            <span className="fbar-track">
              {r.hours > 0 && <span className="fbar" style={{ width: `calc((100% - 4.5rem) * ${r.hours / max})` }} />}
              <span className="fbar-value num">{r.hours ? formatHours(r.hours) : '—'}</span>
            </span>
          </div>
        );
      })}
      {node}
    </div>
  );
}
