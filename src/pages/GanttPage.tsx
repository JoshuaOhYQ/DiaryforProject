import { useMemo, useState } from 'react';
import { Diamond, FileDown, Image as ImageIcon, Plus } from 'lucide-react';
import type { Task } from '../types.ts';
import { useProject } from '../app/context.ts';
import { navigate, useRoute } from '../app/router.ts';
import { LIGHT_COLORS } from '../app/theme.ts';
import { toast } from '../app/toast.tsx';
import { newTask, store } from '../data/index.ts';
import { Swatch } from '../components/Chips.tsx';
import { addDays, formatDate, todayISO } from '../lib/dates.ts';
import { safeFileName } from '../lib/files.ts';
import { getPref, setPref } from '../lib/prefs.ts';
import { pluralise } from '../lib/text.ts';
import { downloadGanttPng, printGantt } from '../gantt/exportGantt.ts';
import { GanttChart } from '../gantt/GanttChart.tsx';
import type { GanttSvgProps } from '../gantt/GanttSvg.tsx';
import { actualsByTask, dependencyConflicts, slippage } from '../gantt/ganttMath.ts';
import { buildRows, chartRange, makeScale, type Zoom } from '../gantt/layout.ts';
import { TaskPanel } from '../gantt/TaskPanel.tsx';

export function GanttPage() {
  const data = useProject();
  const { params } = useRoute();
  const selectedId = params.get('task');
  const [zoom, setZoomState] = useState<Zoom>(() => getPref('gantt.zoom', 'week'));
  const [colourBy, setColourByState] = useState<'feature' | 'member'>(() => getPref('gantt.colourBy', 'feature'));
  const [showActual, setShowActual] = useState(() => getPref('gantt.actual', true));
  const [showDeps, setShowDeps] = useState(() => getPref('gantt.deps', true));
  const [onlyFeature, setOnlyFeature] = useState<string>('');
  const today = todayISO();

  const setZoom = (z: Zoom) => {
    setZoomState(z);
    setPref('gantt.zoom', z);
  };
  const setColourBy = (c: 'feature' | 'member') => {
    setColourByState(c);
    setPref('gantt.colourBy', c);
  };
  const toggleActual = (on: boolean) => {
    setShowActual(on);
    setPref('gantt.actual', on);
  };
  const toggleDeps = (on: boolean) => {
    setShowDeps(on);
    setPref('gantt.deps', on);
  };
  // Scroll to a task only when arriving with one (e.g. from a log entry), not on every click.
  const [arrivedWith] = useState(selectedId);

  const actuals = useMemo(() => actualsByTask(data.tasks, data.entries), [data.tasks, data.entries]);
  const slips = useMemo(() => new Map(data.tasks.map((t) => [t.id, slippage(t, actuals.get(t.id)!, today)])), [data.tasks, actuals, today]);
  const conflictList = useMemo(() => dependencyConflicts(data.tasks), [data.tasks]);
  const conflicts = useMemo(() => new Set(conflictList.map((c) => `${c.taskId}|${c.dependsOnId}`)), [conflictList]);
  const rows = useMemo(() => buildRows(data.tasks, data.features, onlyFeature || null), [data.tasks, data.features, onlyFeature]);
  const range = useMemo(() => chartRange(data.tasks, actuals, today, zoom, data.project.weekStartsOn), [data.tasks, actuals, today, zoom, data.project.weekStartsOn]);
  const scale = useMemo(() => makeScale(range.start, range.end, zoom), [range, zoom]);

  const colourOf = (t: Task) => {
    if (colourBy === 'member') return data.memberById.get(t.assigneeIds[0] ?? '')?.colour ?? '#8a94a3';
    return (t.featureId && data.featureById.get(t.featureId)?.colour) || '#8a94a3';
  };

  const select = (id: string | null) => navigate('/gantt', { task: id }, true);
  const selected = selectedId ? data.taskById.get(selectedId) : undefined;

  function addTask(milestone: boolean) {
    const featureId = onlyFeature || selected?.featureId || null;
    const t = newTask(data.project.id, {
      name: milestone ? 'New milestone' : 'New task',
      featureId,
      start: today,
      end: milestone ? today : addDays(today, 6),
      milestone,
    });
    store.put('tasks', t);
    select(t.id);
    setTimeout(() => (document.querySelector('.task-name') as HTMLInputElement | null)?.select(), 50);
  }

  const exportProps = (): GanttSvgProps => ({
    rows,
    scale,
    zoom,
    weekStartsOn: data.project.weekStartsOn,
    today,
    colours: LIGHT_COLORS,
    colourOf,
    actuals,
    slips,
    showActual,
    showDeps,
    conflicts,
    labelWidth: 300,
    memberById: data.memberById,
    title: `${data.project.name} — Gantt chart`,
    subtitle: [data.project.course, data.project.group, `Generated ${formatDate(today, 'long')}`, showActual ? 'thin bars = actual dates from log entries, red = past planned end' : '']
      .filter(Boolean)
      .join(' · '),
  });

  const fileBase = `${safeFileName(data.project.name)}-gantt-${today}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gantt chart</h1>
          <p className="muted">
            {pluralise(data.tasks.filter((t) => !t.milestone).length, 'task')}, {pluralise(data.tasks.filter((t) => t.milestone).length, 'milestone')}. Drag bars to move them, drag the ends to resize, click to edit.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => addTask(true)}>
            <Diamond size={15} /> Milestone
          </button>
          <button className="btn primary" onClick={() => addTask(false)}>
            <Plus size={16} /> Task
          </button>
        </div>
      </div>

      <div className="gantt-toolbar">
        <div className="btn-group" aria-label="Zoom">
          <button className="btn small" aria-pressed={zoom === 'week'} onClick={() => setZoom('week')}>
            Weeks
          </button>
          <button className="btn small" aria-pressed={zoom === 'month'} onClick={() => setZoom('month')}>
            Months
          </button>
        </div>
        <div className="btn-group" aria-label="Colour bars by">
          <button className="btn small" aria-pressed={colourBy === 'feature'} onClick={() => setColourBy('feature')}>
            By feature
          </button>
          <button className="btn small" aria-pressed={colourBy === 'member'} onClick={() => setColourBy('member')}>
            By member
          </button>
        </div>
        <label className="row small">
          <input type="checkbox" checked={showActual} onChange={(e) => toggleActual(e.target.checked)} /> Planned vs actual
        </label>
        <label className="row small">
          <input type="checkbox" checked={showDeps} onChange={(e) => toggleDeps(e.target.checked)} /> Dependencies
        </label>
        <select value={onlyFeature} onChange={(e) => setOnlyFeature(e.target.value)} aria-label="Show feature" className="small">
          <option value="">All features</option>
          {data.features.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button className="btn small" onClick={() => downloadGanttPng(exportProps(), `${fileBase}.png`).catch((e) => toast(e.message))} disabled={!rows.length}>
          <ImageIcon size={15} /> PNG
        </button>
        <button className="btn small" onClick={() => printGantt(exportProps(), fileBase)} disabled={!rows.length} title="Opens the print dialog: choose “Save as PDF”">
          <FileDown size={15} /> PDF
        </button>
      </div>

      <div className="legend small">
        {(colourBy === 'feature' ? data.features : data.members).map((x) => (
          <span key={x.id} className="chip">
            <Swatch colour={x.colour} />
            {x.name}
          </span>
        ))}
        {showActual && (
          <span className="chip muted">
            <span className="legend-actual" /> actual (from log entries) <span className="legend-slip" /> past planned end
          </span>
        )}
      </div>

      {conflictList.length > 0 && (
        <div className="notice warn" style={{ marginBottom: '0.75rem' }}>
          <span>
            {pluralise(conflictList.length, 'task starts', 'tasks start')} before something {conflictList.length === 1 ? 'it depends' : 'they depend'} on has finished (red dashed arrows):{' '}
            {conflictList
              .slice(0, 3)
              .map((c) => data.taskById.get(c.taskId)?.name)
              .join(', ')}
            {conflictList.length > 3 ? '…' : ''}
          </span>
        </div>
      )}

      <div className={`gantt-layout${selected ? ' with-panel' : ''}`}>
        {rows.length === 0 ? (
          <div className="card empty">
            <h3>{data.tasks.length ? 'No tasks for this feature' : 'No tasks yet'}</h3>
            <p>Add tasks and milestones, then link log entries to them to see planned vs actual dates.</p>
            <button className="btn primary" onClick={() => addTask(false)}>
              <Plus size={16} /> Add a task
            </button>
          </div>
        ) : (
          <GanttChart
            data={data}
            rows={rows}
            scale={scale}
            zoom={zoom}
            today={today}
            colourOf={colourOf}
            actuals={actuals}
            slips={slips}
            conflicts={conflicts}
            showActual={showActual}
            showDeps={showDeps}
            selectedId={selectedId}
            scrollToId={arrivedWith}
            onSelect={(id) => select(id)}
            onChange={(tasks) => {
              store.apply({ put: { tasks } });
              if (tasks.length > 1) toast(`Moved ${pluralise(tasks.length - 1, 'dependent task')} to keep the order`);
            }}
          />
        )}
        {selected && <TaskPanel key={selected.id} task={selected} actual={actuals.get(selected.id)!} slip={slips.get(selected.id)!} onClose={() => select(null)} />}
      </div>
    </>
  );
}
