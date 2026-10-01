import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { AttachmentRef } from '../types.ts';
import { store } from '../data/index.ts';

const urls = new Map<string, Promise<string | null>>();

/** An object URL for an attachment, loaded from IndexedDB or data/assets/. */
export function attachmentUrl(ref: AttachmentRef): Promise<string | null> {
  let p = urls.get(ref.id);
  if (!p) {
    p = store.getAttachment(ref).then((blob) => {
      if (blob) return URL.createObjectURL(blob);
      urls.delete(ref.id); // not here yet (teammate's file before a pull): try again next time
      return null;
    });
    urls.set(ref.id, p);
  }
  return p;
}

export function useAttachmentUrl(ref: AttachmentRef): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    attachmentUrl(ref).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [ref]);
  return url;
}

export const isImage = (ref: AttachmentRef) => ref.mime.startsWith('image/');

export function AttachmentThumb({ attachment, onRemove }: { attachment: AttachmentRef; onRemove?: () => void }) {
  const url = useAttachmentUrl(attachment);
  const remove = onRemove && (
    <button type="button" className="remove" onClick={onRemove} aria-label={`Remove ${attachment.name}`}>
      <X size={14} />
    </button>
  );
  if (isImage(attachment) && url) {
    return (
      <span className="thumb">
        <a href={url} target="_blank" rel="noreferrer" title={attachment.name}>
          <img src={url} alt={attachment.name} loading="lazy" />
        </a>
        {remove}
      </span>
    );
  }
  return (
    <span className="thumb file">
      <a href={url ?? undefined} target="_blank" rel="noreferrer" title={url === null ? 'File not found on this computer yet — pull the latest changes' : attachment.name} style={{ color: 'inherit', textDecoration: 'none' }}>
        <FileText size={20} />
        <div>{attachment.name.length > 28 ? attachment.name.slice(0, 26) + '…' : attachment.name}</div>
      </a>
      {remove}
    </span>
  );
}
