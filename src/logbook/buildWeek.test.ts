import { describe, expect, it } from 'vitest';
import { applyChanges } from '../data/changes.ts';
import { newEntry, newFeature, newMember, newProject, newTask, newWeekNote } from '../data/factories.ts';
import { selectProject } from '../data/select.ts';
import { emptyWorkspace } from '../data/workspace.ts';
import { buildWeek, weekNumberLabel } from './buildWeek.ts';
import { draftNarrative } from './narrative.ts';

function fixture() {
  const project = newProject({ name: 'PIPER', startDate: '2026-09-07' });
  const ana = newMember(project.id, { name: 'Ana Lim' });
  const ben = newMember(project.id, { name: 'Ben Tan' });
  const mqtt = newFeature(project.id, { name: 'Smart Home (MQTT)' });
  const done = newTask(project.id, { name: 'Broker set-up', featureId: mqtt.id, start: '2026-10-01', end: '2026-10-06', progress: 100, assigneeIds: [ana.id] });
  const next = newTask(project.id, { name: 'Flash ESP32', featureId: mqtt.id, start: '2026-10-13', end: '2026-10-16', assigneeIds: [ben.id] });
  const milestone = newTask(project.id, { name: 'Hardware deadline', start: '2026-10-09', end: '2026-10-09', milestone: true });
  const entries = [
    newEntry(project.id, { date: '2026-10-05', authorId: ana.id, featureId: mqtt.id, taskId: done.id, hours: 2, type: 'Build', did: 'Installed **Mosquitto**.', problems: 'Two brokers were running.', fixes: 'Stopped the Windows service.', next: 'Turn on the password.' }),
    newEntry(project.id, { date: '2026-10-07', authorId: ana.id, featureId: mqtt.id, taskId: done.id, hours: 1.5, type: 'Test', did: 'Ran the 19 tests.', result: 'All 19 pass.' }),
    newEntry(project.id, { date: '2026-10-07', authorId: ben.id, hours: 3, type: 'Research', did: 'Read the Whisper docs.' }),
    newEntry(project.id, { date: '2026-10-12', authorId: ben.id, hours: 4, did: 'Next week, not this one.' }),
  ];
  const ws = applyChanges(
    emptyWorkspace(),
    { put: { projects: [project], members: [ana, ben], features: [mqtt], tasks: [done, next, milestone], entries, weekNotes: [newWeekNote(project.id, '2026-10-05', ana.id, 'Saved paragraph.')] } },
    '2026-10-01T00:00:00.000Z',
  );
  return { data: selectProject(ws, project.id)!, ana, ben };
}

describe('buildWeek', () => {
  const { data, ana, ben } = fixture();
  const week = buildWeek(data, '2026-10-08', null, '2026-10-10');

  it('covers Monday to Sunday of the chosen week', () => {
    expect(week.weekStart).toBe('2026-10-05');
    expect(week.weekEnd).toBe('2026-10-11');
    expect(week.weekLabel).toBe('Week 5');
    expect(week.entries).toHaveLength(3);
  });

  it('builds the hours table', () => {
    const anaRow = week.hoursTable.find((r) => r.member.id === ana.id)!;
    expect(anaRow.perDay).toEqual([2, 0, 1.5, 0, 0, 0, 0]);
    expect(anaRow.total).toBe(3.5);
    expect(week.dayTotals[2]).toBe(4.5);
    expect(week.totalHours).toBe(6.5);
  });

  it('summarises each member and keeps saved narratives', () => {
    const a = week.members.find((m) => m.member.id === ana.id)!;
    expect(a.narrative).toBe('Saved paragraph.');
    expect(a.features[0]).toMatchObject({ hours: 3.5 });
    expect(a.draft).toMatch(/Ana Lim logged 3\.5 hours across 2 entries, mainly on Smart Home \(MQTT\)/);
  });

  it('lists completed tasks, milestones, issues and next week', () => {
    expect(week.completed.map((c) => c.task.name)).toEqual(['Broker set-up']);
    expect(week.completed[0].slip.status).toBe('done-late'); // last entry 7 Oct, planned end 6 Oct
    expect(week.milestones.map((m) => m.task.name)).toEqual(['Hardware deadline']);
    expect(week.issues).toHaveLength(1);
    expect(week.plannedNext.map((t) => t.name)).toEqual(['Flash ESP32']);
    expect(week.nextSteps.map((n) => n.member.name)).toEqual(['Ana Lim']);
  });

  it('filters everything to one member for individual pages', () => {
    const benWeek = buildWeek(data, '2026-10-08', ben.id, '2026-10-10');
    expect(benWeek.entries).toHaveLength(1);
    expect(benWeek.hoursTable).toHaveLength(1);
    expect(benWeek.completed).toHaveLength(0);
    expect(benWeek.plannedNext.map((t) => t.name)).toEqual(['Flash ESP32']);
  });

  it('numbers weeks from the project start, or by ISO week', () => {
    expect(weekNumberLabel(data.project, '2026-09-07')).toBe('Week 1');
    expect(weekNumberLabel(data.project, '2026-08-31')).toBe('Before week 1');
    expect(weekNumberLabel({ ...data.project, startDate: '' }, '2026-10-05')).toBe('Week 41');
  });
});

describe('draftNarrative', () => {
  it('only uses what was written', () => {
    const { data, ana } = fixture();
    const entries = data.entries.filter((e) => e.authorId === ana.id);
    const text = draftNarrative({ name: 'Ana Lim', range: '5–11 Oct 2026', entries, featureName: (id) => (id ? 'Smart Home (MQTT)' : null) });
    expect(text).toBe(
      'During the week of 5–11 Oct 2026, Ana Lim logged 3.5 hours across 2 entries, mainly on Smart Home (MQTT) (3.5 h). ' +
        'The work was mostly build and test. Work carried out: Installed Mosquitto; Ran the 19 tests. ' +
        'Problem encountered: Two brokers were running. Solution: Stopped the Windows service. Outcome: All 19 pass. Next steps: Turn on the password.',
    );
  });

  it('says so when nothing was logged', () => {
    expect(draftNarrative({ name: 'Ben', range: 'x', entries: [], featureName: () => null })).toMatch(/did not log any work/);
  });
});
