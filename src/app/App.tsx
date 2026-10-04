import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { BookOpenText, CalendarRange, LayoutDashboard, LogOut, Monitor, Moon, NotebookPen, Plus, ScrollText, Settings, Sun, Users } from 'lucide-react';
import type { Entry } from '../types.ts';
import { newEntry, selectProject, store, useSaveStatus, useWorkspace, type ProjectData, type SaveStatus } from '../data/index.ts';
import { todayISO } from '../lib/dates.ts';
import { getPref, setPref } from '../lib/prefs.ts';
import { EntryForm } from '../components/EntryForm.tsx';
import { Modal } from '../components/Modal.tsx';
import { NewProjectDialog } from '../components/NewProjectDialog.tsx';
import { DashboardPage } from '../pages/DashboardPage.tsx';
import { EntriesPage } from '../pages/EntriesPage.tsx';
import { GanttPage } from '../pages/GanttPage.tsx';
import { LogbookPage } from '../pages/LogbookPage.tsx';
import { SettingsPage } from '../pages/SettingsPage.tsx';
import { TeamPage } from '../pages/TeamPage.tsx';
import { WelcomePage } from '../pages/WelcomePage.tsx';
import { AppActionsContext, EntryEditorContext, ProjectContext, type AppActions, type EntryEditor } from './context.ts';
import { isLockedSite, logout } from './auth.ts';
import { href, navigate, useRoute } from './router.ts';
import { setThemeMode, useThemeMode } from './theme.ts';
import { Toasts } from './toast.tsx';

interface Page {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  component: ComponentType;
  wide?: boolean;
}

const PAGES: Page[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, component: DashboardPage },
  { path: '/log', label: 'Log', icon: ScrollText, component: EntriesPage },
  { path: '/gantt', label: 'Gantt', icon: CalendarRange, component: GanttPage, wide: true },
  { path: '/team', label: 'Team', icon: Users, component: TeamPage },
  { path: '/logbook', label: 'Log book', icon: BookOpenText, component: LogbookPage },
  { path: '/settings', label: 'Settings', icon: Settings, component: SettingsPage },
];

const HOME = '/';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
}

function freshEntry(data: ProjectData, preset: Partial<Entry> = {}): Entry {
  const pid = data.project.id;
  const lastAuthor = getPref<string>(`lastAuthor:${pid}`, '');
  const authorId = preset.authorId ?? (data.activeMembers.some((m) => m.id === lastAuthor) ? lastAuthor : (data.activeMembers[0]?.id ?? ''));
  const lastFeature = getPref<string | null>(`lastFeature:${pid}:${authorId}`, null);
  const lastType = getPref<string>(`lastType:${pid}`, '');
  const types = data.project.entryTypes;
  return newEntry(pid, {
    date: todayISO(),
    authorId,
    featureId: lastFeature && data.featureById.has(lastFeature) ? lastFeature : null,
    type: types.includes(lastType) ? lastType : types.includes('Build') ? 'Build' : types[0],
    hours: 1,
    ...preset,
  });
}

export function App() {
  const ws = useWorkspace();
  const status = useSaveStatus();
  const route = useRoute();
  const [projectId, setProjectId] = useState<string | null>(() => getPref('project', null));
  const [editing, setEditing] = useState<{ entry: Entry; isNew: boolean } | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  const data = selectProject(ws, projectId) ?? selectProject(ws, ws.projects[0]?.id ?? null);

  const switchProject = useCallback((id: string) => {
    setProjectId(id);
    setPref('project', id);
  }, []);

  const actions = useMemo<AppActions>(() => ({ switchProject, newProject: () => setCreatingProject(true) }), [switchProject]);

  const editor = useMemo<EntryEditor>(
    () => ({
      openNew: (preset) => data && setEditing({ entry: freshEntry(data, preset), isNew: true }),
      openEdit: (entry) => setEditing({ entry, isNew: false }),
    }),
    [data],
  );

  // N = new entry, anywhere except while typing or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      editor.openNew();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  // Pick up a `git pull` when you come back to the tab; save immediately when you leave it.
  useEffect(() => {
    const onFocus = () => void store.pull();
    const onVisibility = () => (document.visibilityState === 'hidden' ? void store.flush() : void store.pull());
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.hasPendingWork) e.preventDefault();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (data) document.title = `${data.project.name} · Log book`;
  }, [data]);

  if (!status.ready) {
    return (
      <div className="empty" style={{ marginTop: '20vh' }}>
        Loading log book…
      </div>
    );
  }

  if (!data) {
    return (
      <>
        <WelcomePage onCreated={switchProject} />
        <Toasts />
      </>
    );
  }

  const page = PAGES.find((p) => p.path === route.path) ?? PAGES.find((p) => p.path === HOME)!;
  const Page = page.component;

  return (
    <ProjectContext.Provider value={data}>
      <AppActionsContext.Provider value={actions}>
        <EntryEditorContext.Provider value={editor}>
          <div className="app">
            <header className="topbar">
              <div className="topbar-inner">
                <div className="brand">
                  <span className="brand-mark" aria-hidden="true">
                    <NotebookPen size={16} />
                  </span>
                  <select
                    className="project-select"
                    aria-label="Project"
                    value={data.project.id}
                    onChange={(e) => (e.target.value === '__new' ? setCreatingProject(true) : switchProject(e.target.value))}
                  >
                    {ws.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    <option value="__new">＋ New project…</option>
                  </select>
                </div>
                <nav className="nav" aria-label="Main">
                  {PAGES.map((p) => (
                    <a key={p.path} href={href(p.path)} aria-current={p === page ? 'page' : undefined}>
                      <p.icon size={16} />
                      <span>{p.label}</span>
                    </a>
                  ))}
                </nav>
                <div className="topbar-actions">
                  <SaveIndicator status={status} />
                  <ThemeButton />
                  {isLockedSite() && (
                    <button className="btn ghost icon" onClick={logout} title="Log out" aria-label="Log out">
                      <LogOut size={18} />
                    </button>
                  )}
                  <button className="btn primary hide-mobile" onClick={() => editor.openNew()}>
                    <Plus size={16} /> Entry <kbd>N</kbd>
                  </button>
                </div>
              </div>
            </header>

            <main className={page.wide ? 'wide' : ''}>
              <Page />
            </main>

            <button className="fab" onClick={() => editor.openNew()} aria-label="New log entry">
              <Plus size={26} />
            </button>
          </div>

          {editing && (
            <Modal
              title={editing.isNew ? 'New log entry' : 'Edit log entry'}
              onClose={() => setEditing(null)}
              dismissOnBackdrop={false}
              footer={
                <>
                  <span className="small muted grow hide-mobile">
                    <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save · <kbd>Esc</kbd> to cancel
                  </span>
                  <button className="btn" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button className="btn primary" type="submit" form="entry-form">
                    {editing.isNew ? 'Add entry' : 'Save changes'}
                  </button>
                </>
              }
            >
              <EntryForm formId="entry-form" initial={editing.entry} isNew={editing.isNew} onDone={() => setEditing(null)} />
            </Modal>
          )}

          {creatingProject && (
            <NewProjectDialog
              current={data}
              onClose={() => setCreatingProject(false)}
              onCreated={(id) => {
                setCreatingProject(false);
                switchProject(id);
                navigate('/settings');
              }}
            />
          )}

          <Toasts />
        </EntryEditorContext.Provider>
      </AppActionsContext.Provider>
    </ProjectContext.Provider>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function timeAgo(ms: number, now: number): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const now = useNow(15_000);
  const toFile = status.target !== 'none';
  const last = toFile ? status.lastFileSave : status.lastLocalSave;
  let cls = toFile ? '' : 'browser';
  let text: string;
  if (status.error) {
    cls = 'error';
    text = 'Not saved to file';
  } else if (status.saving || status.pending) {
    cls = 'saving';
    text = 'Saving…';
  } else if (last) {
    text = `Last saved ${timeAgo(last, now)}`;
  } else {
    text = 'Nothing to save yet';
  }
  const where = toFile ? status.targetLabel : 'this browser only';
  return (
    <button className={`save-indicator ${cls}`} onClick={() => navigate('/settings')} title={status.error ?? `Saving to ${where}. Click for backup options.`}>
      <span className="dot" aria-hidden="true" />
      <span>{text}</span>
      <span className="hide-mobile muted">· {where}</span>
    </button>
  );
}

function ThemeButton() {
  const mode = useThemeMode();
  const next = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  return (
    <button className="btn ghost icon" onClick={() => setThemeMode(next)} title={`Theme: ${mode} (click for ${next})`} aria-label={`Theme: ${mode}. Switch to ${next}`}>
      <Icon size={18} />
    </button>
  );
}
