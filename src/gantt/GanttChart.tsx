import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Task } from '../types.ts';
import type { ProjectData } from '../data/index.ts';
import { useResolvedTheme, useThemeColors } from '../app/theme.ts';
import { displayColour, NEUTRAL } from '../lib/colours.ts';
import { Swatch } from '../components/Chips.tsx';
import { cascadeDependents, moveTask, resizeTask, type Actuals, type Slippage } from './ganttMath.ts';
import { GanttSvg, type DragMode } from './GanttSvg.tsx';
import { HEADER_H, ROW_H, type GanttRow, type Scale, type Zoom } from './layout.ts';

interface Props {
  data: ProjectData;
  rows: GanttRow[];
  scale: Scale;
  zoom: Zoom;
  today: string;
  colourOf: (t: Task) => string;
  actuals: Map<string, Actuals>;
  slips: Map<string, Slippage>;
  conflicts: Set<string>;
  showActual: boolean;
  showDeps: boolean;
  selectedId: string | null;
  scrollToId: string | null;
  onSelect: (id: string) => void;
  /** Called with every task whose dates changed (the dragged one plus pushed dependents). */
  onChange: (tasks: Task[]) => void;
}

interface Drag {
  task: Task;
  mode: DragMode;
  x0: number;
  dx: number;
}

function applyDrag(d: Drag, dayW: number): Task {
  const days = Math.round(d.dx / dayW);
  return d.mode === 'move' ? moveTask(d.task, days) : resizeTask(d.task, d.mode, days);
}

export function GanttChart(p: Props) {
  const colours = useThemeColors();
  const theme = useResolvedTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // While dragging, show the dragged task and any dependents it pushes.
  const preview = useMemo(() => {
    if (!drag || Math.abs(drag.dx) < 3) return undefined;
    const moved = applyDrag(drag, p.scale.dayW);
    const pushed = cascadeDependents(p.data.tasks, [moved]);
    return new Map([moved, ...pushed].map((t) => [t.id, t]));
  }, [drag, p.data.tasks, p.scale.dayW]);

  // Start scrolled so today (or the requested task) is in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = p.scrollToId ? p.data.taskById.get(p.scrollToId)?.start : p.today;
    if (target) el.scrollLeft = Math.max(0, p.scale.x(target) - el.clientWidth / 3);
    if (p.scrollToId) {
      const index = p.rows.findIndex((r) => r.kind === 'task' && r.task.id === p.scrollToId);
      if (index >= 0) {
        const top = el.getBoundingClientRect().top + window.scrollY + HEADER_H + index * ROW_H;
        window.scrollTo({ top: Math.max(0, top - window.innerHeight / 2), behavior: 'smooth' });
      }
    }
    // Only when the zoom level or requested task changes, not on every edit.
  }, [p.zoom, p.scrollToId]);

  function onBarPointerDown(e: PointerEvent<SVGElement>, task: Task, mode: DragMode) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ task, mode, x0: e.clientX, dx: 0 });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.x0 });
  }

  function onPointerUp() {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (Math.abs(d.dx) < 3) return p.onSelect(d.task.id);
    const moved = applyDrag(d, p.scale.dayW);
    if (moved.start === d.task.start && moved.end === d.task.end) return;
    p.onChange([moved, ...cascadeDependents(p.data.tasks, [moved])]);
  }

  function onBarKeyDown(e: KeyboardEvent<SVGElement>, task: Task) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      p.onSelect(task.id);
      return;
    }
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const moved = e.shiftKey ? resizeTask(task, 'end', step) : moveTask(task, step);
    p.onChange([moved, ...cascadeDependents(p.data.tasks, [moved])]);
  }

  return (
    <div className="gantt card">
      <div className="gantt-labels" style={{ paddingTop: HEADER_H }}>
        {p.rows.map((r) =>
          r.kind === 'group' ? (
            <div key={r.key} className="gantt-label group" style={{ height: ROW_H }}>
              <Swatch colour={r.colour} />
              <span className="label">{r.label}</span>
            </div>
          ) : (
            <button
              key={r.key}
              className={`gantt-label task${p.selectedId === r.task.id ? ' selected' : ''}`}
              style={{ height: ROW_H }}
              onClick={() => p.onSelect(r.task.id)}
              title={r.task.name}
            >
              <span className="label">
                {r.task.milestone ? '◆ ' : ''}
                {r.task.name}
              </span>
              <SlipBadge slip={p.slips.get(r.task.id)} />
              <span className="avatars">
                {r.task.assigneeIds.slice(0, 3).map((id) => {
                  const m = p.data.memberById.get(id);
                  return (
                    <span key={id} className="avatar" style={{ background: displayColour(m?.colour ?? NEUTRAL, theme) }} title={m?.name}>
                      {(m?.name ?? '?')
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0])
                        .join('')}
                    </span>
                  );
                })}
              </span>
            </button>
          ),
        )}
      </div>
      <div className="gantt-scroll" ref={scroller}>
        <div onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
          <GanttSvg
            rows={p.rows}
            scale={p.scale}
            zoom={p.zoom}
            weekStartsOn={p.data.project.weekStartsOn}
            today={p.today}
            colours={colours}
            colourOf={p.colourOf}
            actuals={p.actuals}
            slips={p.slips}
            showActual={p.showActual}
            showDeps={p.showDeps}
            conflicts={p.conflicts}
            selectedId={p.selectedId}
            preview={preview}
            onBarPointerDown={onBarPointerDown}
            onBarKeyDown={onBarKeyDown}
          />
        </div>
      </div>
    </div>
  );
}

export function SlipBadge({ slip }: { slip?: Slippage }) {
  if (!slip) return null;
  if (slip.status === 'overdue') return <span className="badge danger" title={slip.label}>+{slip.endSlip}d</span>;
  if (slip.status === 'done-late') return <span className="badge warn" title={slip.label}>+{slip.endSlip}d</span>;
  if (slip.status === 'late-start') return <span className="badge warn" title={slip.label}>late</span>;
  if (slip.status === 'done' || slip.status === 'done-early') return <span className="badge ok" title={slip.label}>✓</span>;
  return null;
}
