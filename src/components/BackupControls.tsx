import { Download, FolderOpen, GitMerge, RotateCcw, Unplug } from 'lucide-react';
import { toast } from '../app/toast.tsx';
import { extractProject, parseLogbookText, store, useSaveStatus } from '../data/index.ts';
import { downloadText, pickFile, safeFileName } from '../lib/files.ts';
import { todayISO } from '../lib/dates.ts';
import type { Project } from '../types.ts';

async function readBackup() {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  try {
    return parseLogbookText(await file.text());
  } catch (e) {
    toast((e as Error).message);
    return null;
  }
}

export async function restoreFromFile() {
  const backup = await readBackup();
  if (!backup) return;
  const counts = `${backup.projects.length} project(s), ${backup.entries.length} entries, ${backup.tasks.length} tasks`;
  if (!confirm(`Replace everything with this backup (${counts})?\n\nAnything not in the backup will be deleted. Download a backup of the current data first if unsure.`)) return;
  store.restore(backup);
  toast('Backup restored');
}

export async function mergeFromFile() {
  const other = await readBackup();
  if (!other) return;
  store.mergeIn(other);
  toast(`Merged: ${other.entries.length} entries, ${other.tasks.length} tasks checked`);
}

export function downloadBackup(project?: Project) {
  const json = project ? store.exportJson((ws) => extractProject(ws, project.id)) : store.exportJson();
  const name = project ? `${safeFileName(project.name)}-backup-${todayISO()}.json` : `logbook-backup-${todayISO()}.json`;
  downloadText(json, name, 'application/json');
}

/** How saving works on this device, plus folder connection controls. */
export function SaveTargetPanel() {
  const status = useSaveStatus();
  const connect = async () => {
    try {
      await store.connectFolder();
      toast('Folder connected: every save now writes logbook.json there');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message);
    }
  };
  const reconnect = async () => {
    try {
      await store.reconnectFolder();
      toast('Folder reconnected');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="stack">
      {status.error && <div className="notice danger">{status.error}</div>}
      {status.target === 'dev-server' && (
        <div className="notice">
          <span>
            Every change is written to <code>{status.targetLabel}</code> (and screenshots to <code>data/assets/</code>) in this repo. Commit and push those files to share them with the team.
          </span>
        </div>
      )}
      {status.target === 'folder' && (
        <div className="notice">
          <span>
            Every change is written to <code>{status.targetLabel}</code> in the folder you connected. Commit it with Git to share it.
          </span>
        </div>
      )}
      {status.target === 'none' && !status.folderNeedsPermission && (
        <div className="notice warn">
          <span>
            Changes are saved in this browser only.{' '}
            {status.folderSupported
              ? 'Connect the repo’s data folder so every save also writes data/logbook.json.'
              : 'Run the app with `npm run dev` (or use Chrome/Edge and connect the data folder) to write data/logbook.json. Until then, download a backup and send it to a teammate to merge.'}
          </span>
        </div>
      )}
      <div className="row">
        {status.folderNeedsPermission && (
          <button className="btn primary" onClick={reconnect}>
            <FolderOpen size={16} /> Reconnect data folder
          </button>
        )}
        {status.target !== 'dev-server' && status.folderSupported && (
          <button className="btn" onClick={connect}>
            <FolderOpen size={16} /> {status.target === 'folder' ? 'Choose a different folder' : 'Connect data folder'}
          </button>
        )}
        {(status.target === 'folder' || status.folderNeedsPermission) && (
          <button className="btn ghost" onClick={() => void store.disconnectFolder()}>
            <Unplug size={16} /> Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

export function BackupButtons({ project }: { project?: Project }) {
  return (
    <div className="row">
      <button className="btn" onClick={() => downloadBackup()}>
        <Download size={16} /> Download backup (all projects)
      </button>
      {project && (
        <button className="btn" onClick={() => downloadBackup(project)}>
          <Download size={16} /> This project only
        </button>
      )}
      <button className="btn" onClick={restoreFromFile}>
        <RotateCcw size={16} /> Restore from backup…
      </button>
      <button className="btn" onClick={mergeFromFile} title="Add a teammate's exported file without deleting anything">
        <GitMerge size={16} /> Merge a teammate’s file…
      </button>
    </div>
  );
}
