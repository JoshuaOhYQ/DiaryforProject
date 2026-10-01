/**
 * Styles for the log book page, shared by the on-screen preview and the printed PDF.
 * It always looks like paper (dark text on white), whatever the app theme.
 */
export const LOGBOOK_CSS = `
.logbook-doc {
  --ink: #1d232b; --ink-2: #47515e; --rule: #cfd5dc; --soft: #f2f4f7; --accent: #2b6f8e;
  color: var(--ink); background: #fff;
  font: 10.5pt/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
}
.logbook-doc * { box-sizing: border-box; }
.logbook-doc h1 { font-size: 18pt; margin: 0 0 2pt; line-height: 1.2; }
.logbook-doc h2 { font-size: 12.5pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid var(--accent); color: var(--accent); break-after: avoid; }
.logbook-doc h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
.logbook-doc h4 { font-size: 10.5pt; margin: 8pt 0 2pt; }
.logbook-doc p { margin: 0 0 6pt; }
.logbook-doc .meta { color: var(--ink-2); margin: 0; }
.logbook-doc .meta strong { color: var(--ink); }
.logbook-doc .title-block { border-bottom: 1pt solid var(--rule); padding-bottom: 8pt; margin-bottom: 4pt; }
.logbook-doc .week-label { font-size: 12pt; font-weight: 650; margin-top: 6pt; }
.logbook-doc table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: 9.5pt; }
.logbook-doc th, .logbook-doc td { border: 0.75pt solid var(--rule); padding: 3pt 5pt; text-align: left; vertical-align: top; }
.logbook-doc th { background: var(--soft); font-weight: 650; }
.logbook-doc td.n, .logbook-doc th.n { text-align: right; font-variant-numeric: tabular-nums; }
.logbook-doc tr.total td, .logbook-doc tr.total th { font-weight: 700; background: var(--soft); }
.logbook-doc .stats { display: flex; gap: 10pt; flex-wrap: wrap; margin: 6pt 0; }
.logbook-doc .stat { border: 0.75pt solid var(--rule); border-radius: 4pt; padding: 4pt 8pt; min-width: 80pt; }
.logbook-doc .stat b { display: block; font-size: 14pt; }
.logbook-doc .stat span { color: var(--ink-2); font-size: 8.5pt; }
.logbook-doc .member-summary { break-inside: avoid; margin-bottom: 10pt; }
.logbook-doc .entry { border: 0.75pt solid var(--rule); border-radius: 4pt; padding: 6pt 8pt; margin: 0 0 8pt; break-inside: avoid; }
.logbook-doc .entry-meta { color: var(--ink-2); font-size: 9pt; margin-bottom: 3pt; }
.logbook-doc .entry-meta b { color: var(--ink); }
.logbook-doc .field-label { font-size: 8pt; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-2); margin-top: 4pt; }
.logbook-doc .md p, .logbook-doc .md ul, .logbook-doc .md ol, .logbook-doc .md pre, .logbook-doc .md table { margin: 0 0 4pt; }
.logbook-doc .md ul, .logbook-doc .md ol { padding-left: 14pt; }
.logbook-doc .md pre { background: var(--soft); padding: 4pt 6pt; border-radius: 3pt; white-space: pre-wrap; font-size: 8.5pt; }
.logbook-doc .md code { font-family: ui-monospace, Consolas, monospace; font-size: 9pt; }
.logbook-doc .md h1, .logbook-doc .md h2, .logbook-doc .md h3, .logbook-doc .md h4 { font-size: 10.5pt; border: 0; color: var(--ink); margin: 6pt 0 2pt; padding: 0; }
.logbook-doc .shots { display: flex; flex-wrap: wrap; gap: 6pt; margin-top: 5pt; }
.logbook-doc .shots figure { margin: 0; max-width: 100%; }
.logbook-doc .shots img { max-width: 100%; max-height: 9cm; border: 0.75pt solid var(--rule); border-radius: 3pt; display: block; }
.logbook-doc .shots figcaption { font-size: 8pt; color: var(--ink-2); }
.logbook-doc .links { font-size: 9pt; margin-top: 3pt; }
.logbook-doc .links a { color: var(--accent); margin-right: 8pt; word-break: break-all; }
.logbook-doc .empty-note { color: var(--ink-2); font-style: italic; }
.logbook-doc .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; margin-top: 28pt; break-inside: avoid; }
.logbook-doc .sign div { border-top: 0.75pt solid var(--ink); padding-top: 3pt; font-size: 9pt; color: var(--ink-2); }
.logbook-doc .swatch { display: inline-block; width: 8pt; height: 8pt; border-radius: 2pt; margin-right: 4pt; vertical-align: baseline; }
`;

export const PRINT_PAGE_CSS = `
@page { size: A4; margin: 16mm 15mm; }
html, body { margin: 0; background: #fff; }
`;
