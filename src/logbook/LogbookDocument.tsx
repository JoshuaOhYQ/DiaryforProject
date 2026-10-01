/** The weekly log book page. Used for the on-screen preview and, rendered to HTML, for printing. */
import type { ReactNode } from 'react';
import { Wand2 } from 'lucide-react';
import type { Entry } from '../types.ts';
import type { ProjectData } from '../data/select.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { formatDate, formatRange, todayISO } from '../lib/dates.ts';
import { formatHours, formatNumber, pluralise } from '../lib/text.ts';
import { CommitTextarea } from '../components/CommitInput.tsx';
import type { LogbookWeek } from './buildWeek.ts';

export interface LogbookOptions {
  screenshots: boolean;
  signOff: boolean;
  /** Include every entry in full (otherwise only the summary sections). */
  details: boolean;
}

interface Props {
  week: LogbookWeek;
  data: ProjectData;
  options: LogbookOptions;
  /** Attachment id → image URL. */
  images: Map<string, string>;
  /** On screen: narratives can be edited and drafted. */
  onNarrative?: (memberId: string, text: string) => void;
}

const FIELDS: [keyof Entry & ('did' | 'problems' | 'fixes' | 'result' | 'next'), string][] = [
  ['did', 'What I did'],
  ['problems', 'Problems encountered'],
  ['fixes', 'How they were fixed'],
  ['result', 'Result / evidence'],
  ['next', 'Next steps'],
];

function Md({ text }: { text: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function LogbookDocument({ week, data, options, images, onNarrative }: Props) {
  const { project } = week;
  const featureName = (id: string | null) => (id ? (data.featureById.get(id)?.name ?? '—') : '—');
  const memberName = (id: string) => data.memberById.get(id)?.name ?? 'Unknown';
  const taskName = (id: string | null) => (id ? data.taskById.get(id)?.name : undefined);
  const subtitle = [project.organisation, project.course, project.group].filter(Boolean).join(' · ');

  return (
    <div className="logbook-doc">
      <header className="title-block">
        <h1>{project.name} — Project Log Book</h1>
        {subtitle && <p className="meta">{subtitle}</p>}
        {project.supervisor && (
          <p className="meta">
            Supervisor: <strong>{project.supervisor}</strong>
          </p>
        )}
        <p className="meta">
          {week.member ? (
            <>
              Student: <strong>{week.member.name}</strong>
              {week.member.role ? ` (${week.member.role})` : ''}
            </>
          ) : (
            <>Team: {data.members.filter((m) => !m.archived).map((m) => m.name).join(', ')}</>
          )}
        </p>
        <p className="week-label">
          {week.weekLabel}: {week.rangeLabel}
        </p>
      </header>

      <div className="stats">
        <div className="stat">
          <b>{formatNumber(week.totalHours)}</b>
          <span>hours logged</span>
        </div>
        <div className="stat">
          <b>{week.entries.length}</b>
          <span>log entries</span>
        </div>
        <div className="stat">
          <b>{week.completed.length}</b>
          <span>tasks completed</span>
        </div>
        <div className="stat">
          <b>{week.issues.length}</b>
          <span>issues recorded</span>
        </div>
      </div>

      <Section title="Hours">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              {week.days.map((d) => (
                <th key={d} className="n">
                  {formatDate(d, 'weekday')} {+d.slice(8, 10)}
                </th>
              ))}
              <th className="n">Total</th>
            </tr>
          </thead>
          <tbody>
            {week.hoursTable.map((r) => (
              <tr key={r.member.id}>
                <td>{r.member.name}</td>
                {r.perDay.map((h, i) => (
                  <td key={i} className="n">
                    {h ? formatNumber(h) : ''}
                  </td>
                ))}
                <td className="n">{formatNumber(r.total)}</td>
              </tr>
            ))}
            {week.hoursTable.length > 1 && (
              <tr className="total">
                <td>Total</td>
                {week.dayTotals.map((h, i) => (
                  <td key={i} className="n">
                    {h ? formatNumber(h) : ''}
                  </td>
                ))}
                <td className="n">{formatNumber(week.totalHours)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title={week.member ? 'Summary' : 'Summary by member'}>
        {week.members.map((m) => (
          <div className="member-summary" key={m.member.id}>
            <h3>
              {m.member.name}
              {m.member.role ? ` — ${m.member.role}` : ''}
              <span className="meta" style={{ fontWeight: 400 }}>
                {' '}
                · {formatHours(m.hours)}, {pluralise(m.entries.length, 'entry', 'entries')}
              </span>
            </h3>
            {m.features.length > 0 && (
              <p className="meta">Worked on: {m.features.map((f) => `${f.feature?.name ?? 'general'} (${formatHours(f.hours)})`).join(', ')}</p>
            )}
            {onNarrative ? (
              <div className="no-print narrative-editor">
                <CommitTextarea
                  value={m.narrative}
                  rows={m.narrative ? 4 : 2}
                  placeholder="Write a short paragraph for this week, or draft one from the entries →"
                  aria-label={`Narrative for ${m.member.name}`}
                  onCommit={(text) => onNarrative(m.member.id, text)}
                />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    if (m.narrative.trim() && !confirm('Replace the current paragraph with a new draft?')) return;
                    onNarrative(m.member.id, m.draft);
                  }}
                  title="Builds a paragraph from this week's entries. Edit it before you submit."
                >
                  <Wand2 size={14} /> Draft from entries
                </button>
              </div>
            ) : m.narrative.trim() ? (
              <Md text={m.narrative} />
            ) : null}
          </div>
        ))}
      </Section>

      {options.details && (
        <Section title="Work log">
          {week.entries.length === 0 && <p className="empty-note">No entries were logged this week.</p>}
          {week.entries.map((e) => {
            const shots = options.screenshots ? e.attachments.filter((a) => a.mime.startsWith('image/') && images.get(a.id)) : [];
            const files = e.attachments.filter((a) => !a.mime.startsWith('image/'));
            return (
              <article className="entry" key={e.id}>
                <div className="entry-meta">
                  <b>{formatDate(e.date, 'long')}</b> · {memberName(e.authorId)} · {featureName(e.featureId)}
                  {taskName(e.taskId) ? ` · Task: ${taskName(e.taskId)}` : ''} · {e.type} · {formatHours(e.hours)}
                </div>
                {FIELDS.map(([key, label]) =>
                  e[key].trim() ? (
                    <div key={key}>
                      {key !== 'did' && <div className="field-label">{label}</div>}
                      <Md text={e[key]} />
                    </div>
                  ) : null,
                )}
                {(e.links.length > 0 || files.length > 0) && (
                  <div className="links">
                    {e.links.map((l, i) => (
                      <a key={i} href={l.url}>
                        {l.label || l.url}
                      </a>
                    ))}
                    {files.map((a) => (
                      <span key={a.id}>📎 {a.name} </span>
                    ))}
                  </div>
                )}
                {shots.length > 0 && (
                  <div className="shots">
                    {shots.map((a) => (
                      <figure key={a.id}>
                        <img src={images.get(a.id)} alt={a.name} />
                        <figcaption>{a.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </Section>
      )}

      <Section title="Completed tasks and milestones">
        {week.completed.length === 0 && week.milestones.length === 0 ? (
          <p className="empty-note">No tasks were completed this week.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Feature</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {week.completed.map(({ task, actual, slip }) => (
                <tr key={task.id}>
                  <td>{task.name}</td>
                  <td>{featureName(task.featureId)}</td>
                  <td>{formatRange(task.start, task.end)}</td>
                  <td>{actual.start ? formatRange(actual.start, actual.end!) : '—'}</td>
                  <td>{slip.label}</td>
                </tr>
              ))}
              {week.milestones.map(({ task, reached }) => (
                <tr key={task.id}>
                  <td>◆ {task.name}</td>
                  <td>{featureName(task.featureId)}</td>
                  <td>{formatDate(task.start)}</td>
                  <td>—</td>
                  <td>{reached ? 'Reached' : 'Not yet reached'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Issues and fixes">
        {week.issues.length === 0 ? (
          <p className="empty-note">No problems were recorded this week.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: '16%' }}>Date / who</th>
                <th>Problem</th>
                <th>How it was fixed</th>
              </tr>
            </thead>
            <tbody>
              {week.issues.map((e) => (
                <tr key={e.id}>
                  <td>
                    {formatDate(e.date, 'short')}
                    <br />
                    {memberName(e.authorId)}
                  </td>
                  <td>
                    <Md text={e.problems} />
                  </td>
                  <td>{e.fixes.trim() ? <Md text={e.fixes} /> : <span className="empty-note">Not yet resolved</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Plan for next week">
        {week.plannedNext.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Planned task</th>
                <th>Who</th>
                <th>Dates</th>
                <th className="n">Done</th>
              </tr>
            </thead>
            <tbody>
              {week.plannedNext.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.milestone ? '◆ ' : ''}
                    {t.name}
                  </td>
                  <td>{t.assigneeIds.map(memberName).join(', ') || '—'}</td>
                  <td>{t.milestone ? formatDate(t.start) : formatRange(t.start, t.end)}</td>
                  <td className="n">{t.milestone ? '' : `${t.progress}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {week.nextSteps.map(({ member, entry }) => (
          <div key={member.id}>
            <h4>{member.name}</h4>
            <Md text={entry.next} />
          </div>
        ))}
        {week.plannedNext.length === 0 && week.nextSteps.length === 0 && <p className="empty-note">No next steps recorded.</p>}
      </Section>

      {options.signOff && (
        <div className="sign">
          <div>{week.member ? 'Student' : 'Team representative'} signature and date</div>
          <div>Supervisor signature and date</div>
        </div>
      )}
      <p className="meta" style={{ marginTop: '14pt', fontSize: '8pt' }}>
        Generated {formatDate(todayISO(), 'long')} from the project log.
      </p>
    </div>
  );
}
