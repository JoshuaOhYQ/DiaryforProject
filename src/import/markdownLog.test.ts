import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newFeature, newMember } from '../data/factories.ts';
import { matchFeature, matchMember, parseMarkdownLog, splitProblemsAndFixes, unwrapLines } from './markdownLog.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('importing docs/WORK_LOG_smart_home.md (report layout)', () => {
  const entries = parseMarkdownLog(read('../../docs/WORK_LOG_smart_home.md'));
  const [entry] = entries;

  it('becomes a single dated entry by Oh Yu Qiao', () => {
    expect(entries).toHaveLength(1);
    expect(entry.date).toBe('2026-09-08');
    expect(entry.authorName).toBe('Oh Yu Qiao');
    expect(entry.featureHint).toMatch(/Smart Home/);
  });

  it('sorts sections into the right fields', () => {
    expect(entry.did).toMatch(/What I built/);
    expect(entry.did).toMatch(/MQTT broker/);
    expect(entry.result).toMatch(/19 automated tests/);
    expect(entry.next).toMatch(/Flash the ESP32/);
    expect(entry.next).toMatch(/9 October hardware deadline/);
  });

  it('separates problems from their fixes', () => {
    expect(entry.problems).toMatch(/tests crashed on Windows/);
    expect(entry.problems).toMatch(/two brokers running at once/);
    expect(entry.problems).not.toMatch(/Fixed by asking Python/);
    expect(entry.fixes).toMatch(/Fixed by asking Python/);
    expect(entry.fixes).toMatch(/stop the automatic one/);
    expect(entry.fixes).toMatch(/skipped it and\s+will test on the real ESP32/);
  });

  it('flags the missing hours instead of guessing', () => {
    expect(entry.hours).toBeNull();
    expect(entry.warnings).toContain('No hours found');
    expect(entry.tags).toContain('imported');
  });

  it('matches the author and feature to the PIPER team', () => {
    const members = ['Oh Yu Qiao', 'Tay Shuen Min', 'Jordan Douglas Su E-Wern', 'Puteri Amelya Dania'].map((name) => newMember('p', { name }));
    const features = ['Smart Home (MQTT)', 'Voice (STT/TTS)', 'LLM backend', 'Robot hardware (ESP32/sensors)', 'Diary/Memory', 'Safety & Alerts', 'Report'].map((name) =>
      newFeature('p', { name }),
    );
    expect(matchMember(entry.authorName, members)?.name).toBe('Oh Yu Qiao');
    expect(matchFeature(entry.featureHint, features)?.name).toBe('Smart Home (MQTT)');
  });
});

describe('importing a dated log', () => {
  const entries = parseMarkdownLog(read('./fixtures/dated-log.md'));

  it('makes one entry per dated heading', () => {
    expect(entries.map((e) => e.date)).toEqual(['2026-09-14', '2026-09-16']);
    expect(entries.every((e) => e.authorName === 'Sample Student')).toBe(true);
  });

  it('reads labelled lines', () => {
    const [first] = entries;
    expect(first.hours).toBe(2.5);
    expect(first.did).toMatch(/Whisper set-up/);
    expect(first.problems).toMatch(/9 seconds per phrase/);
    expect(first.fixes).toMatch(/base\.en/);
    expect(first.result).toMatch(/18 of 20/);
    expect(first.next).toMatch(/GPU build/);
    expect(first.tags).toEqual(expect.arrayContaining(['whisper', 'stt', 'imported']));
  });

  it('reads sub-headings, hours, type and links', () => {
    const second = entries[1];
    expect(second.did).toMatch(/streams microphone audio/);
    expect(second.problems).toMatch(/Clipping/);
    expect(second.fixes).toMatch(/pre-roll/);
    expect(second.hours).toBe(3);
    expect(second.type).toBe('Build');
    expect(second.links.map((l) => l.url)).toContain('https://example.com/vad-notes');
  });
});

describe('splitProblemsAndFixes', () => {
  it('splits at "Fix:" and "so I" style sentences', () => {
    const { problems, fixes } = splitProblemsAndFixes('**Broker down.** Nothing connected. Fix: restarted it.\n\n**Wokwi busy.** Servers full, so I used the real board.');
    expect(problems).toBe('- **Broker down.** Nothing connected.\n- **Wokwi busy.**');
    expect(fixes).toBe('- **Broker down:** Fix: restarted it.\n- **Wokwi busy:** Servers full, so I used the real board.');
  });
});

describe('unwrapLines', () => {
  it('joins wrapped paragraph and list lines but leaves tables and code alone', () => {
    const md = ['A wrapped', 'paragraph.', '', '- item that', '  continues', '- next', '', '| a |', '| b |', '```', 'code', 'line', '```'].join('\n');
    expect(unwrapLines(md)).toBe(['A wrapped paragraph.', '', '- item that continues', '- next', '', '| a |', '| b |', '```', 'code', 'line', '```'].join('\n'));
  });
});

describe('edge cases', () => {
  it('returns nothing for an empty file', () => {
    expect(parseMarkdownLog('   ')).toEqual([]);
  });
});
