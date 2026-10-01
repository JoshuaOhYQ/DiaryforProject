import { renderMarkdown } from '../lib/markdown.ts';

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}
