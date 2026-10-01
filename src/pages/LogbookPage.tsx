import { useEffect, useMemo, useState } from 'react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ChevronLeft, ChevronRight, Download, FileDown, FileText } from 'lucide-react';
import type { AttachmentRef } from '../types.ts';
import { useProject } from '../app/context.ts';
import { navigate, useRoute } from '../app/router.ts';
import { toast } from '../app/toast.tsx';
import { newWeekNote, store, weekNoteId } from '../data/index.ts';
import { attachmentUrl } from '../components/attachments.tsx';
import { entriesToCsv } from '../lib/csv.ts';
import { addDays, isISODate, startOfWeek, todayISO } from '../lib/dates.ts';
import { blobToDataUrl, downloadBlob, downloadText, imageSize, safeFileName, toPng } from '../lib/files.ts';
import { getPref, setPref } from '../lib/prefs.ts';
import { printDocument } from '../lib/print.ts';
import { pluralise } from '../lib/text.ts';
import { buildWeek } from '../logbook/buildWeek.ts';
import { LOGBOOK_CSS, PRINT_PAGE_CSS } from '../logbook/docCss.ts';
import { LogbookDocument, type LogbookOptions } from '../logbook/LogbookDocument.tsx';

const DEFAULT_OPTIONS: LogbookOptions = { screenshots: true, signOff: true, details: true };

export function LogbookPage() {
  const data = useProject();
  const { params } = useRoute();
  const today = todayISO();
  const weekParam = params.get('week');
  const anchor = weekParam && isISODate(weekParam) ? weekParam : today;
  const memberId = params.get('member') || null;
  const [options, setOptionsState] = useState<LogbookOptions>(() => ({ ...DEFAULT_OPTIONS, ...getPref('logbook.options', {}) }));
  const [busy, setBusy] = useState(false);

  const week = useMemo(() => buildWeek(data, anchor, memberId, today), [data, anchor, memberId, today]);
  const images = useImageUrls(options.screenshots ? week.entries.flatMap((e) => e.attachments).filter((a) => a.mime.startsWith('image/')) : []);

  const go = (patch: { week?: string; member?: string | null }) =>
    navigate('/logbook', { week: patch.week ?? week.weekStart, member: patch.member === undefined ? memberId : patch.member }, true);

  const setOption = (key: keyof LogbookOptions, value: boolean) => {
    const next = { ...options, [key]: value };
    setOptionsState(next);
    setPref('logbook.options', next);
  };

  const saveNarrative = (mId: string, text: string) => {
    const existing = data.weekNotes.find((n) => n.id === weekNoteId(data.project.id, week.weekStart, mId));
    store.put('weekNotes', existing ? { ...existing, narrative: text } : newWeekNote(data.project.id, week.weekStart, mId, text));
  };

  const fileBase = `${safeFileName(data.project.name)}-logbook-${week.weekLabel.replace(/\s+/g, '').toLowerCase()}-${week.weekStart}${week.member ? `-${safeFileName(week.member.name)}` : ''}`;

  async function exportDocx() {
    setBusy(true);
    try {
      const { buildLogbookDocx } = await import('../logbook/exportDocx.ts');
      const blob = await buildLogbookDocx(week, data, options, async (ref) => {
        const raw = await store.getAttachment(ref);
        const png = raw && (await toPng(raw));
        const size = png && (await imageSize(png));
        return png && size ? { data: await png.arrayBuffer(), type: png.type === 'image/jpeg' ? 'jpg' : 'png', ...size } : null;
      });
      downloadBlob(blob, `${fileBase}.docx`);
    } catch (e) {
      toast(`Could not create the Word file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    setBusy(true);
    try {
      const dataUrls = new Map<string, string>();
      if (options.screenshots) {
        for (const e of week.entries)
          for (const a of e.attachments.filter((x) => x.mime.startsWith('image/'))) {
            const blob = await store.getAttachment(a);
            if (blob) dataUrls.set(a.id, await blobToDataUrl(blob));
          }
      }
      const host = document.createElement('div');
      const root = createRoot(host);
      flushSync(() => root.render(createElement(LogbookDocument, { week, data, options, images: dataUrls })));
      const html = host.innerHTML;
      root.unmount();
      await printDocument(html, fileBase, PRINT_PAGE_CSS + LOGBOOK_CSS);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>Log book</h1>
          <p className="muted">Pick a week: its entries are collected into a log book page you can print or hand in.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => downloadText(entriesToCsv(week.entries, data), `${fileBase}.csv`, 'text/csv')} disabled={!week.entries.length}>
            <Download size={16} /> CSV
          </button>
          <button className="btn" onClick={exportPdf} disabled={busy} title="Opens the print dialog: choose “Save as PDF”">
            <FileDown size={16} /> PDF
          </button>
          <button className="btn primary" onClick={exportDocx} disabled={busy}>
            <FileText size={16} /> Word (.docx)
          </button>
        </div>
      </div>

      <div className="card logbook-controls no-print">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="btn icon" onClick={() => go({ week: addDays(week.weekStart, -7) })} aria-label="Previous week">
            <ChevronLeft size={18} />
          </button>
          <div className="week-picker">
            <strong>{week.weekLabel}</strong>
            <span className="muted small">{week.rangeLabel}</span>
          </div>
          <button className="btn icon" onClick={() => go({ week: addDays(week.weekStart, 7) })} aria-label="Next week">
            <ChevronRight size={18} />
          </button>
          <input type="date" aria-label="Jump to a date" value={week.weekStart} onChange={(e) => isISODate(e.target.value) && go({ week: startOfWeek(e.target.value, data.project.weekStartsOn) })} />
          {week.weekStart !== startOfWeek(today, data.project.weekStartsOn) && (
            <button className="btn small ghost" onClick={() => go({ week: today })}>
              This week
            </button>
          )}
        </div>
        <div className="row">
          <select value={memberId ?? ''} onChange={(e) => go({ member: e.target.value || null })} aria-label="Whose pages">
            <option value="">Whole team</option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} only
              </option>
            ))}
          </select>
          <label className="row small">
            <input type="checkbox" checked={options.details} onChange={(e) => setOption('details', e.target.checked)} /> Full entries
          </label>
          <label className="row small">
            <input type="checkbox" checked={options.screenshots} onChange={(e) => setOption('screenshots', e.target.checked)} /> Screenshots
          </label>
          <label className="row small">
            <input type="checkbox" checked={options.signOff} onChange={(e) => setOption('signOff', e.target.checked)} /> Signature lines
          </label>
        </div>
      </div>

      {week.entries.length === 0 && (
        <div className="notice warn no-print" style={{ marginBottom: '1rem' }}>
          <span>
            No entries in this week{week.member ? ` for ${week.member.name}` : ''}. Use the arrows to pick another week, or press <kbd>N</kbd> to log work.
          </span>
        </div>
      )}
      {week.entries.length > 0 && !week.members.some((m) => m.narrative.trim()) && (
        <p className="small muted no-print">
          Tip: “Draft from entries” writes a summary paragraph for each member from {pluralise(week.entries.length, 'entry', 'entries')}. Edit it, and it’s saved with the week.
        </p>
      )}

      <style>{LOGBOOK_CSS}</style>
      <div className="paper">
        <LogbookDocument week={week} data={data} options={options} images={images} onNarrative={saveNarrative} />
      </div>
    </>
  );
}

/** Object URLs for a list of image attachments (for the on-screen preview). */
function useImageUrls(refs: AttachmentRef[]): Map<string, string> {
  const [urls, setUrls] = useState(new Map<string, string>());
  const key = refs.map((r) => r.id).join(',');
  useEffect(() => {
    let live = true;
    Promise.all(refs.map(async (r) => [r.id, await attachmentUrl(r)] as const)).then((pairs) => {
      if (live) setUrls(new Map(pairs.filter((p): p is readonly [string, string] => !!p[1])));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return urls;
}
