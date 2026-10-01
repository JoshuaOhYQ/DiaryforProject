/** Markdown → safe HTML for display. */
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const md = new Marked({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const cache = new Map<string, string>();

export function renderMarkdown(src: string): string {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const html = DOMPurify.sanitize(md.parse(src, { async: false }) as string);
  if (cache.size > 500) cache.clear();
  cache.set(src, html);
  return html;
}
