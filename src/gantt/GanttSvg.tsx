/**
 * Draws the Gantt chart as plain SVG with concrete colours. The same component renders the
 * interactive chart and the PNG/PDF export, so they always look the same.
 */
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Member, Task } from '../types.ts';
import type { ThemeColors } from '../app/theme.ts';
import { addDays, formatDate, formatRange } from '../lib/dates.ts';
import type { Actuals, Slippage } from './ganttMath.ts';
import { buildHeader, HEADER_H, ROW_H, type GanttRow, type Scale, type Zoom } from './layout.ts';

export type DragMode = 'move' | 'start' | 'end';

export interface GanttSvgProps {
  rows: GanttRow[];
  scale: Scale;
  zoom: Zoom;
  weekStartsOn: 0 | 1;
  today: string;
  colours: ThemeColors;
  colourOf: (t: Task) => string;
  actuals: Map<string, Actuals>;
  slips: Map<string, Slippage>;
  showActual: boolean;
  showDeps: boolean;
  /** "taskId|dependsOnId" pairs that start too early. */
  conflicts: Set<string>;
  selectedId?: string | null;
  /** Temporary positions while dragging. */
  preview?: Map<string, Task>;
  /** Export only: draw a label column of this width inside the SVG, and a title. */
  labelWidth?: number;
  title?: string;
  subtitle?: string;
  memberById?: Map<string, Member>;
  onBarPointerDown?: (e: PointerEvent<SVGElement>, task: Task, mode: DragMode) => void;
  onBarKeyDown?: (e: KeyboardEvent<SVGElement>, task: Task) => void;
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function GanttSvg(p: GanttSvgProps) {
  const { rows, scale, colours: c } = p;
  const labelW = p.labelWidth ?? 0;
  const titleH = p.title ? 44 : 0;
  const top = titleH + HEADER_H;
  const width = labelW + scale.width;
  const height = top + rows.length * ROW_H + 8;
  const header = buildHeader(scale, p.zoom, p.weekStartsOn);
  const taskOf = (t: Task) => p.preview?.get(t.id) ?? t;
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => r.kind === 'task' && rowIndex.set(r.task.id, i));
  const X = (date: string) => labelW + scale.x(date);
  const rowY = (i: number) => top + i * ROW_H;
  const barH = p.showActual ? 15 : 20;
  const barTop = p.showActual ? 6 : 8;
  const todayX = X(p.today) + scale.dayW / 2;
  const interactive = !!p.onBarPointerDown;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fontFamily={FONT}
      fontSize={12}
      role="img"
      aria-label="Gantt chart"
      style={{ display: 'block', userSelect: 'none' }}
    >
      <defs>
        <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill={c.muted} />
        </marker>
        <marker id="gantt-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill={c.danger} />
        </marker>
      </defs>

      <rect x={0} y={0} width={width} height={height} fill={c.surface} />

      {p.title && (
        <g>
          <text x={12} y={20} fontSize={16} fontWeight={700} fill={c.text}>
            {p.title}
          </text>
          {p.subtitle && (
            <text x={12} y={37} fontSize={11.5} fill={c.muted}>
              {p.subtitle}
            </text>
          )}
        </g>
      )}

      {/* weekend shading and grid */}
      {header.weekends.map((w) => (
        <rect key={`we-${w.x}`} x={labelW + w.x} y={top} width={w.width} height={rows.length * ROW_H} fill={c.surface2} opacity={0.7} />
      ))}
      {rows.map((r, i) =>
        r.kind === 'group' ? <rect key={`band-${r.key}`} x={labelW} y={rowY(i)} width={scale.width} height={ROW_H} fill={c.surface2} opacity={0.55} /> : null,
      )}
      {header.lines.map((l) => (
        <line key={`l-${l.x}`} x1={labelW + l.x + 0.5} x2={labelW + l.x + 0.5} y1={titleH + 24} y2={height} stroke={l.major ? c.borderStrong : c.border} strokeWidth={1} opacity={l.major ? 0.9 : 0.6} />
      ))}
      {rows.map((_, i) => (
        <line key={`h-${i}`} x1={0} x2={width} y1={rowY(i) + ROW_H + 0.5} y2={rowY(i) + ROW_H + 0.5} stroke={c.border} opacity={0.6} />
      ))}

      {/* header */}
      <rect x={labelW} y={titleH} width={scale.width} height={HEADER_H} fill={c.surface} />
      {header.months.map((m) => (
        <g key={`m-${m.x}`}>
          <line x1={labelW + m.x + 0.5} x2={labelW + m.x + 0.5} y1={titleH} y2={titleH + 24} stroke={c.borderStrong} />
          <text x={labelW + m.x + 6} y={titleH + 16} fontWeight={650} fill={c.text}>
            {m.label}
          </text>
        </g>
      ))}
      {header.ticks.map((t) => (
        <text key={`t-${t.x}`} x={labelW + t.x + (p.zoom === 'week' ? t.width / 2 : 3)} y={titleH + 42} textAnchor={p.zoom === 'week' ? 'middle' : 'start'} fill={c.muted} fontSize={11}>
          {t.label}
          {t.sub && (
            <tspan x={labelW + t.x + t.width / 2} dy={-12} fontSize={9} opacity={0.8}>
              {t.sub}
            </tspan>
          )}
        </text>
      ))}
      <line x1={0} x2={width} y1={top - 0.5} y2={top - 0.5} stroke={c.borderStrong} />

      {/* label column (export only) */}
      {labelW > 0 && (
        <g>
          <rect x={0} y={titleH} width={labelW} height={height - titleH} fill={c.surface} />
          <line x1={labelW - 0.5} x2={labelW - 0.5} y1={titleH} y2={height} stroke={c.borderStrong} />
          <text x={12} y={top - 12} fill={c.muted} fontSize={11} fontWeight={650}>
            TASK
          </text>
          {rows.map((r, i) =>
            r.kind === 'group' ? (
              <g key={`lab-${r.key}`}>
                <rect x={12} y={rowY(i) + 13} width={10} height={10} rx={2} fill={r.colour} />
                <text x={28} y={rowY(i) + 22} fontWeight={700} fill={c.text}>
                  {truncate(r.label, 36)}
                </text>
              </g>
            ) : (
              <g key={`lab-${r.key}`}>
                <text x={28} y={rowY(i) + 22} fill={c.text}>
                  {r.task.milestone ? '◆ ' : ''}
                  {truncate(r.task.name, Math.floor((labelW - 110) / 6.4))}
                </text>
                <text x={labelW - 10} y={rowY(i) + 22} textAnchor="end" fill={c.muted} fontSize={11}>
                  {r.task.assigneeIds.map((id) => initials(p.memberById?.get(id)?.name ?? '?')).join(' ')}
                  {r.task.milestone ? '' : `  ${r.task.progress}%`}
                </text>
              </g>
            ),
          )}
        </g>
      )}

      {/* dependency arrows */}
      {p.showDeps &&
        rows.map((r) => {
          if (r.kind !== 'task') return null;
          const succ = taskOf(r.task);
          const si = rowIndex.get(succ.id)!;
          return succ.dependsOn.map((depId) => {
            const pi = rowIndex.get(depId);
            if (pi === undefined) return null;
            const predRow = rows[pi];
            if (predRow.kind !== 'task') return null;
            const pred = taskOf(predRow.task);
            const bad = p.conflicts.has(`${succ.id}|${depId}`);
            const x1 = X(pred.end) + (pred.milestone ? scale.dayW / 2 + 7 : scale.dayW);
            const y1 = rowY(pi) + ROW_H / 2;
            const x2 = X(succ.start) + (succ.milestone ? scale.dayW / 2 - 8 : 0);
            const y2 = rowY(si) + ROW_H / 2;
            const elbow = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
            return (
              <path
                key={`dep-${succ.id}-${depId}`}
                d={`M${x1},${y1} H${elbow} V${y2} H${x2 - 1}`}
                fill="none"
                stroke={bad ? c.danger : c.muted}
                strokeWidth={bad ? 1.6 : 1.2}
                strokeDasharray={bad ? '4 3' : undefined}
                markerEnd={`url(#${bad ? 'gantt-arrow-bad' : 'gantt-arrow'})`}
                opacity={0.9}
              />
            );
          });
        })}

      {/* tasks */}
      {rows.map((r, i) => {
        if (r.kind !== 'task') return null;
        const t = taskOf(r.task);
        const colour = p.colourOf(t);
        const y = rowY(i);
        const a = p.actuals.get(t.id);
        const slip = p.slips.get(t.id);
        const selected = p.selectedId === t.id;
        const tip = `${t.name}\nPlanned: ${t.milestone ? formatDate(t.start) : formatRange(t.start, t.end)}${
          a?.start ? `\nActual: ${formatRange(a.start, a.end!)} (${a.entryCount} entries, ${a.hours} h)` : '\nNo linked log entries yet'
        }${slip ? `\n${slip.label}` : ''}${t.milestone ? '' : `\n${t.progress}% complete`}`;
        const handlers = (mode: DragMode) =>
          interactive
            ? {
                onPointerDown: (e: PointerEvent<SVGElement>) => p.onBarPointerDown!(e, r.task, mode),
                style: { cursor: mode === 'move' ? 'grab' : 'ew-resize', touchAction: 'none' as const },
              }
            : {};

        // Actual bar (from linked entries) and slippage beyond the planned end.
        const actual =
          p.showActual && a?.start ? (
            <g>
              <rect x={X(a.start) + 1} y={y + 25} width={Math.max(4, X(addDays(a.end!, 1)) - X(a.start) - 2)} height={5} rx={2.5} fill={c.text} opacity={0.55} />
              {a.end! > t.end && <rect x={X(addDays(t.end, 1))} y={y + 25} width={X(addDays(a.end!, 1)) - X(addDays(t.end, 1)) - 1} height={5} rx={2.5} fill={c.danger} />}
            </g>
          ) : null;
        const overdue =
          p.showActual && slip?.status === 'overdue' ? (
            <line x1={X(addDays(t.end, 1))} x2={todayX} y1={y + 27.5} y2={y + 27.5} stroke={c.danger} strokeWidth={2} strokeDasharray="3 3" />
          ) : null;

        if (t.milestone) {
          const cx = X(t.start) + scale.dayW / 2;
          const cy = y + (p.showActual ? 13.5 : ROW_H / 2);
          const s = 8;
          return (
            <g key={t.id}>
              {actual}
              {overdue}
              <g
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                aria-label={interactive ? `Milestone ${t.name}, ${formatDate(t.start)}` : undefined}
                onKeyDown={interactive ? (e) => p.onBarKeyDown?.(e, r.task) : undefined}
                {...handlers('move')}
              >
                <title>{tip}</title>
                <rect x={cx - 14} y={cy - 14} width={28} height={28} fill="transparent" />
                <path
                  d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`}
                  fill={t.progress >= 100 ? colour : c.surface}
                  stroke={selected ? c.text : colour}
                  strokeWidth={selected ? 2.5 : 2}
                />
                {p.zoom === 'week' && (
                  <text x={cx + s + 5} y={cy + 4} fill={c.text2} fontSize={11}>
                    {truncate(t.name, 28)}
                  </text>
                )}
              </g>
            </g>
          );
        }

        const x1 = X(t.start) + 1;
        const w = Math.max(scale.dayW - 2, X(addDays(t.end, 1)) - X(t.start) - 2);
        const progressW = (w * t.progress) / 100;
        return (
          <g key={t.id}>
            {actual}
            {overdue}
            <g
              tabIndex={interactive ? 0 : undefined}
              role={interactive ? 'button' : undefined}
              aria-label={interactive ? `${t.name}, ${formatRange(t.start, t.end)}, ${t.progress}% complete` : undefined}
              onKeyDown={interactive ? (e) => p.onBarKeyDown?.(e, r.task) : undefined}
            >
              <title>{tip}</title>
              <rect x={x1} y={y + barTop} width={w} height={barH} rx={4} fill={colour} opacity={0.3} {...handlers('move')} />
              {progressW > 0 && <rect x={x1} y={y + barTop} width={progressW} height={barH} rx={4} fill={colour} pointerEvents="none" />}
              <rect x={x1} y={y + barTop} width={w} height={barH} rx={4} fill="none" stroke={selected ? c.text : colour} strokeWidth={selected ? 2 : 1} pointerEvents="none" />
              {interactive && (
                <>
                  <rect x={x1 - 3} y={y + barTop} width={8} height={barH} fill="transparent" {...handlers('start')} />
                  <rect x={x1 + w - 5} y={y + barTop} width={8} height={barH} fill="transparent" {...handlers('end')} />
                </>
              )}
            </g>
          </g>
        );
      })}

      {/* today */}
      {p.today >= scale.start && p.today <= scale.end && (
        <g pointerEvents="none">
          <line x1={todayX} x2={todayX} y1={top - 6} y2={height} stroke={c.danger} strokeWidth={1.5} />
          <rect x={todayX - 19} y={top - 15} width={38} height={14} rx={7} fill={c.danger} />
          <text x={todayX} y={top - 5} textAnchor="middle" fill="#fff" fontSize={9.5} fontWeight={700}>
            TODAY
          </text>
        </g>
      )}
    </svg>
  );
}
