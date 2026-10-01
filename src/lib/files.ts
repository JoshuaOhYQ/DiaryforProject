/** Browser file helpers: downloads, reading files, shrinking screenshots. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'logbook';
}

/** Let the user pick a file and resolve with it (or null if they cancel). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const MAX_WIDTH = 1600;

/**
 * Shrink large screenshots so the Git repo stays small. Keeps PNG (crisp text) when the
 * result is reasonably small, otherwise uses JPEG. Non-images are returned unchanged.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  if (scale === 1 && file.size < 900_000 && (file.type === 'image/png' || file.type === 'image/jpeg')) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string, quality?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
  const png = await toBlob('image/png');
  if (png && png.size < 900_000) return png;
  return (await toBlob('image/jpeg', 0.86)) ?? png ?? file;
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/** Convert any browser-readable image to PNG (Word only accepts PNG/JPEG/GIF/BMP). */
export async function toPng(blob: Blob): Promise<Blob | null> {
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  } catch {
    return null;
  }
}
