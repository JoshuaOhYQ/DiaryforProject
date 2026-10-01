/**
 * Print a standalone HTML document from a hidden frame. In the print dialog choose
 * "Save as PDF" to get a PDF; the title becomes the suggested file name.
 */
export async function printDocument(bodyHtml: string, title: string, css: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();

  // Wait for screenshots to load so they appear in the PDF.
  await Promise.all(
    [...doc.images].map((img) =>
      img.complete
        ? null
        : new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          }),
    ),
  );

  const win = frame.contentWindow!;
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
  // Some browsers don't fire afterprint; remove the frame eventually anyway.
  setTimeout(() => frame.isConnected && frame.remove(), 120_000);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
