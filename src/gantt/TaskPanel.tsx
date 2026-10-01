import { useEffect, useState } from 'react';
import { CalendarPlus, Trash2, X } from 'lucide-react';
import type { Task } from '../types.ts';
import { useEntryEditor, useProject } from '../app/context.ts';
import { toast } from '../app/toast.tsx';
import { store } from '../data/index.ts';
import { PillToggles } from '../components/Chips.tsx';
import { CommitInput, CommitTextarea } from '../components/CommitInput.tsx';
import { EntryCard } from '../components/EntryCard.tsx';
import { addDays, diffDays, formatDate, formatRange, isISODate } from '../lib/dates.ts';
import { formatHours, pluralise } from '../lib/text.ts';
import { cascadeDependents, taskDays, wouldCreateCycle, type Actuals, type Slippage } from './ganttMath.ts';
import { SlipBadge } from './GanttChart.tsx';

interface Props {
  task: Task;
  actual: Actuals;
  slip: Slippage;
  onClose: () => void;
}

/** Edit a task and see the log entries linked to it (planned vs actual). */
export function TaskPanel({ task, actual, slip, onClose }: Props) {
  const data = useProject();
  const editor = useEntryEditor();
  const [progress, setProgress] = useState(task.progress);
  useEffect(() => setProgress(task.progress), [task.progress]);

  const entries = data.entries.filter((e) => e.taskId === task.id);
  const others = data.tasks.filter((t) => t.id !== task.id);
  const canDependOn = others.filter((t) => !task.dependsOn.includes(t.id) && !wouldCreateCycle(data.tasks, task.id, t.id));

  /** Save a change; if dates moved later, push dependent tasks along. */
  function save(next: Task) {
    const pushed = next.start !== task.start || next.end !== task.end || next.dependsOn !== task.dependsOn ? cascadeDependents(data.tasks, [next]) : [];
    store.apply({ put: { tasks: [next, ...pushed] } });
    if (pushed.length) toast(`Moved ${pluralise(pushed.length, 'dependent task')} to keep the order`);
  }
  const update = (patch: Partial<Task>) => save({ ...task, ...patch });

  function setStart(start: string) {
    if (!isISODate(start)) return;
    // Starting after the old end keeps the task's length; otherwise only the start moves.
    if (task.milestone) return update({ start, end: start });
    update(start > task.end ? { start, end: addDays(start, taskDays(task) - 1) } : { start });
  }

  function setEnd(end: string) {
    if (!isISODate(end)) return;
    update(end < task.start ? { start: end, end } : { end });
  }

  function remove() {
    if (!confirm(`Delete "${task.name}"?${entries.length ? ` Its ${pluralise(entries.length, 'log entry', 'log entries')} will be kept, unlinked.` : ''}`)) return;
    store.apply({
      del: [{ collection: 'tasks', id: task.id }],
      put: {
        entries: entries.map((e) => ({ ...e, taskId: null })),
        tasks: data.tasks.filter((t) => t.dependsOn.includes(task.id)).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== task.id) })),
      },
    });
    onClose();
    toast('Task deleted');
  }

  return (
    <aside className="card task-panel" aria-label={`Task: ${task.name}`}>
      <div className="row between" style={{ flexWrap: 'nowrap' }}>
        <CommitInput className="grow task-name" value={task.name} aria-label="Task name" onCommit={(v) => v.trim() && update({ name: v.trim() })} />
        <button className="btn ghost icon" onClick={onClose} aria-label="Close task panel">
          <X size={18} />
        </button>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="t-feature">Feature</label>
          <select id="t-feature" value={task.featureId ?? ''} onChange={(e) => update({ featureId: e.target.value || null })}>
            <option value="">— None —</option>
            {data.features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <label className="row small" style={{ alignSelf: 'end', paddingBottom: '0.5rem' }}>
          <input type="checkbox" checked={task.milestone} onChange={(e) => update({ milestone: e.target.checked, end: e.target.checked ? task.start : task.end })} />
          Milestone (◆)
        </label>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="t-start">{task.milestone ? 'Date' : 'Planned start'}</label>
          <input id="t-start" type="date" value={task.start} onChange={(e) => setStart(e.target.value)} />
        </div>
        {!task.milestone && (
          <div className="field">
            <label htmlFor="t-end">Planned end</label>
            <input id="t-end" type="date" value={task.end} min={task.start} onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="t-progress">
          {task.milestone ? 'Reached' : 'Complete'}: <strong className="num">{task.milestone ? (progress >= 100 ? 'yes' : 'no') : `${progress}%`}</strong>
        </label>
        {task.milestone ? (
          <label className="row small">
            <input type="checkbox" checked={task.progress >= 100} onChange={(e) => update({ progress: e.target.checked ? 100 : 0 })} /> Milestone reached
          </label>
        ) : (
          <input
            id="t-progress"
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            onPointerUp={() => progress !== task.progress && update({ progress })}
            onKeyUp={() => progress !== task.progress && update({ progress })}
            onBlur={() => progress !== task.progress && update({ progress })}
          />
        )}
      </div>

      <div className="field">
        <span className="label">Assigned to</span>
        <PillToggles label="Assignees" options={data.activeMembers.map((m) => ({ value: m.id, label: m.name, colour: m.colour }))} value={task.assigneeIds} onChange={(assigneeIds) => update({ assigneeIds })} />
      </div>

      <div className="field">
        <span className="label">Starts after</span>
        {task.dependsOn.map((id) => {
          const dep = data.taskById.get(id);
          return (
            <div key={id} className="row small" style={{ flexWrap: 'nowrap' }}>
              <span className="grow">
                {dep?.milestone ? '◆ ' : ''}
                {dep?.name ?? 'Deleted task'}
                {dep && <span className="muted"> · ends {formatDate(dep.end, 'short')}</span>}
              </span>
              <button className="btn ghost icon small" aria-label="Remove dependency" onClick={() => update({ dependsOn: task.dependsOn.filter((d) => d !== id) })}>
                <X size={14} />
              </button>
            </div>
          );
        })}
        <select value="" aria-label="Add a task this one waits for" onChange={(e) => e.target.value && update({ dependsOn: [...task.dependsOn, e.target.value] })}>
          <option value="">{task.dependsOn.length ? 'Add another…' : 'Nothing — add a task this waits for…'}</option>
          {canDependOn.map((t) => (
            <option key={t.id} value={t.id}>
              {t.milestone ? '◆ ' : ''}
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="t-notes">Notes</label>
        <CommitTextarea id="t-notes" rows={2} value={task.notes} onCommit={(notes) => update({ notes })} />
      </div>

      <div className="plan-vs-actual">
        <div className="row between">
          <strong>Planned vs actual</strong>
          <SlipBadge slip={slip} />
        </div>
        <dl>
          <dt>Planned</dt>
          <dd>
            {task.milestone ? formatDate(task.start, 'long') : `${formatRange(task.start, task.end)} (${pluralise(taskDays(task), 'day')})`}
          </dd>
          <dt>Actual</dt>
          <dd>
            {actual.start ? (
              <>
                {actual.start === actual.end ? formatDate(actual.start) : formatRange(actual.start, actual.end!)}
                {!task.milestone && ` (${pluralise(diffDays(actual.start, actual.end!) + 1, 'day')})`}
              </>
            ) : (
              <span className="muted">No log entries linked yet</span>
            )}
          </dd>
          <dt>Logged</dt>
          <dd>
            {formatHours(actual.hours)} in {pluralise(actual.entryCount, 'entry', 'entries')}
          </dd>
          <dt>Status</dt>
          <dd>{slip.label}</dd>
        </dl>
      </div>

      <div className="section-title" style={{ marginTop: '0.4rem' }}>
        <h3>Log entries</h3>
        <button className="btn small" onClick={() => editor.openNew({ taskId: task.id, featureId: task.featureId })}>
          <CalendarPlus size={15} /> Log work on this
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="small muted">Link entries to this task (the “Gantt task” field) to track the actual dates.</p>
      ) : (
        entries.map((e) => <EntryCard key={e.id} entry={e} showDate compact />)
      )}

      <button className="btn ghost danger small" style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }} onClick={remove}>
        <Trash2 size={15} /> Delete task
      </button>
    </aside>
  );
}
