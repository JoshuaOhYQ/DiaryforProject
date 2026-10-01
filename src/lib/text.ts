/** Plain-text helpers for markdown fields (no DOM needed, so they run in tests and scripts). */
import { Lexer, type Token } from 'marked';

/** Markdown → readable plain text: keeps words, drops formatting, code fences and images. */
export function markdownToPlain(src: string): string {
  if (!src.trim()) return '';
  const out: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      switch (t.type) {
        case 'heading':
        case 'paragraph':
          out.push(inlineText(t.tokens ?? []).trim());
          break;
        case 'list':
          for (const item of t.items) out.push(inlineText(item.tokens ?? []).replace(/\s+/g, ' ').trim());
          break;
        case 'blockquote':
          walk(t.tokens ?? []);
          break;
        case 'table':
          for (const row of t.rows) out.push(row.map((c: { text: string }) => c.text).join(' — '));
          break;
        case 'text':
          out.push(t.text);
          break;
        default:
          break; // code, hr, html, space
      }
    }
  };
  walk(new Lexer({ gfm: true }).lex(src));
  return out.filter(Boolean).join('\n');
}

function inlineText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (t.type === 'image') return '';
      if ('tokens' in t && Array.isArray(t.tokens) && t.tokens.length) return inlineText(t.tokens);
      if (t.type === 'br') return ' ';
      return 'text' in t ? decodeEntities(String(t.text)) : '';
    })
    .join('');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** First sentence of a block of text (or the first line if it has no full stop). */
export function firstSentence(text: string, maxLength = 220): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const m = /^(.+?[.!?])(\s|$)/.exec(line);
  const sentence = (m ? m[1] : line).trim();
  return sentence.length > maxLength ? sentence.slice(0, maxLength - 1).trimEnd() + '…' : sentence;
}

export function lowerFirst(s: string): string {
  if (!s) return s;
  // Keep acronyms and names like "MQTT" or "ESP32" as they are.
  if (/^[A-Z]{2,}/.test(s) || /^[A-Z][a-z]+\s[A-Z]/.test(s)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

export function stripTrailingPunctuation(s: string): string {
  return s.replace(/[\s.!?;:,]+$/, '');
}

export function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function pluralise(n: number, word: string, plural = `${word}s`): string {
  return `${formatNumber(n)} ${n === 1 ? word : plural}`;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatHours(n: number): string {
  return `${formatNumber(Math.round(n * 100) / 100)} h`;
}

/** Split "a, b; c" or "a b" style tag input into clean lowercase tags. */
export function parseTags(input: string): string[] {
  const parts = input.includes(',') || input.includes(';') ? input.split(/[,;]/) : input.split(/\s+/);
  const out: string[] = [];
  for (const p of parts) {
    const tag = p.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

const HEX_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * Accepts "https://…", "label | https://…" or a bare commit hash (expanded with the repo URL).
 * Returns null for anything that is not a link.
 */
export function parseLinkInput(input: string, repoUrl = ''): { label: string; url: string } | null {
  let text = input.trim();
  if (!text) return null;
  let label = '';
  const bar = text.indexOf('|');
  if (bar > 0) {
    label = text.slice(0, bar).trim();
    text = text.slice(bar + 1).trim();
  }
  if (HEX_SHA.test(text) && repoUrl) {
    return { label: label || `commit ${text.slice(0, 7)}`, url: `${repoUrl.replace(/\/+$/, '')}/commit/${text}` };
  }
  if (/^www\./i.test(text)) text = `https://${text}`;
  if (!/^https?:\/\//i.test(text)) return null;
  return { label: label || defaultLinkLabel(text), url: text };
}

export function defaultLinkLabel(url: string): string {
  try {
    const u = new URL(url);
    const commit = /\/commit\/([0-9a-f]{7,40})/i.exec(u.pathname);
    if (commit) return `commit ${commit[1].slice(0, 7)}`;
    const pr = /\/pull\/(\d+)/.exec(u.pathname);
    if (pr) return `PR #${pr[1]}`;
    const file = u.pathname.split('/').filter(Boolean).pop();
    if (file && /\.[a-z0-9]{2,5}$/i.test(file)) return decodeURIComponent(file);
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '');
  } catch {
    return url;
  }
}
