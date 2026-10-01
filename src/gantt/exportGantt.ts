/** Gantt chart as a PNG image or a printable (vector) PDF page. */
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { downloadBlob } from '../lib/files.ts';
import { printDocument } from '../lib/print.ts';
import { GanttSvg, type GanttSvgProps } from './GanttSvg.tsx';

/** Render the chart (with its task names column) to an SVG string. */
export function ganttSvgMarkup(props: GanttSvgProps): { svg: string; width: number; height: number } {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(createElement(GanttSvg, props)));
  const el = host.querySelector('svg')!;
  const out = { svg: el.outerHTML, width: Number(el.getAttribute('width')), height: Number(el.getAttribute('height')) };
  root.unmount();
  return out;
}

export async function downloadGanttPng(props: GanttSvgProps, filename: string): Promise<void> {
  const { svg, width, height } = ganttSvgMarkup(props);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not draw the chart'));
      img.src = url;
    });
    const scale = Math.min(2, 16000 / width); // stay under browser canvas limits for very long projects
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!png) throw new Error('Could not create the PNG');
    downloadBlob(png, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function printGantt(props: GanttSvgProps, title: string): Promise<void> {
  const { svg } = ganttSvgMarkup(props);
  const css = `
    @page { size: A4 landscape; margin: 10mm; }
    html, body { margin: 0; background: #fff; }
    svg { width: 100%; height: auto; }
  `;
  await printDocument(svg.replace(/ width="\d+(\.\d+)?" height="\d+(\.\d+)?"/, ''), title, css);
}
