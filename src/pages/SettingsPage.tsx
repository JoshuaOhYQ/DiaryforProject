import { useState } from 'react';
import { Check, Download, FileUp, Plus, Trash2 } from 'lucide-react';
import type { Project } from '../types.ts';
import { useAppActions, useProject } from '../app/context.ts';
import { isLockedSite } from '../app/auth.ts';
import { toast } from '../app/toast.tsx';
import { DEFAULT_ENTRY_TYPES, store, useWorkspace } from '../data/index.ts';
import { BackupButtons, SaveTargetPanel } from '../components/BackupControls.tsx';
import { DeleteProjectDialog } from '../components/DeleteProjectDialog.tsx';
import { ImportDialog } from '../components/ImportDialog.tsx';
import { entriesToCsv } from '../lib/csv.ts';
import { downloadText, safeFileName } from '../lib/files.ts';
import { pluralise } from '../lib/text.ts';

export function SettingsPage() {
  const data = useProject();
  const ws = useWorkspace();
  const actions = useAppActions();
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Project | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Project details, other projects, saving, backups and imports.</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="card card-pad">
          <h2>Project details</h2>
          <ProjectForm key={data.project.id + data.project.updatedAt} project={data.project} />
        </section>

        <div className="stack">
          <section className="card card-pad" id="saving">
            <h2>Saving and sharing</h2>
            <SaveTargetPanel />
            <h3 style={{ marginTop: '1.1rem' }}>Backups</h3>
            <BackupButtons project={data.project} />
          </section>

          <section className="card card-pad">
            <h2>Import and export</h2>
            <div className="row">
              <button className="btn" onClick={() => setImporting(true)}>
                <FileUp size={16} /> Import markdown work log
              </button>
              <button className="btn" onClick={() => downloadText(entriesToCsv(data.entries, data), `${safeFileName(data.project.name)}-entries.csv`, 'text/csv')}>
                <Download size={16} /> All entries as CSV
              </button>
            </div>
          </section>

          <section className="card card-pad">
            <div className="section-title">
              <h2>Projects</h2>
              {!isLockedSite() && (
                <button className="btn small" onClick={actions.newProject}>
                  <Plus size={15} /> New project
                </button>
              )}
            </div>
            {ws.projects.map((p) => {
              const entries = ws.entries.filter((e) => e.projectId === p.id).length;
              const current = p.id === data.project.id;
              return (
                <div className="project-list-item" key={p.id}>
                  <div className="grow">
                    <strong>{p.name}</strong>
                    <div className="small muted">
                      {[p.organisation, p.course, p.group].filter(Boolean).join(' · ') || 'No details yet'} · {pluralise(entries, 'entry', 'entries')}
                    </div>
                  </div>
                  {current ? (
                    <span className="badge accent">
                      <Check size={12} /> Open
                    </span>
                  ) : (
                    <button className="btn small" onClick={() => actions.switchProject(p.id)}>
                      Open
                    </button>
                  )}
                  <button className="btn small danger" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                    <Trash2 size={15} /> Delete
                  </button>
                </div>
              );
            })}
            {isLockedSite() && (
              <p className="small muted" style={{ marginTop: '0.75rem' }}>
                Each project has its own password and only the projects you signed in to are listed. Use the project picker → <em>Open another project</em> to
                add one. New projects are created on the sign-in page with the admin password. To change a project’s password, run{' '}
                <code>npm run lock -- --password</code> in the repo.
              </p>
            )}
          </section>

          <section className="card card-pad danger-zone">
            <h2>Delete this project</h2>
            <p className="small muted">
              Removes “{data.project.name}” with all its entries, tasks, team and log book pages
              {isLockedSite() ? ', and takes it off the sign-in page. Only an admin can do this (admin password needed).' : '. You’ll be asked to type its name to confirm.'}
            </p>
            <div className="row">
              <button className="btn danger-solid" onClick={() => setDeleting(data.project)}>
                <Trash2 size={16} /> Delete project…
              </button>
            </div>
          </section>
        </div>
      </div>

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {deleting && <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function ProjectForm({ project }: { project: Project }) {
  const [p, setP] = useState(project);
  const [types, setTypes] = useState(project.entryTypes.join(', '));
  const set = (patch: Partial<Project>) => setP((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify({ ...p, entryTypes: null }) !== JSON.stringify({ ...project, entryTypes: null }) || types !== project.entryTypes.join(', ');

  function save() {
    const entryTypes = types
      .split(',')
      .map((t) => t.trim())
      .filter((t, i, all) => t && all.indexOf(t) === i);
    const name = p.name.trim() || 'Untitled project';
    store.put('projects', { ...p, name, entryTypes: entryTypes.length ? entryTypes : DEFAULT_ENTRY_TYPES, repoUrl: p.repoUrl.trim().replace(/\.git$/, '').replace(/\/+$/, '') });
    toast('Project details saved');
  }

  const text = (key: keyof Project, label: string, placeholder = '', hint = '') => (
    <div className="field">
      <label htmlFor={`p-${key}`}>{label}</label>
      <input id={`p-${key}`} value={String(p[key] ?? '')} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<Project>)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {text('name', 'Name')}
      <div className="field">
        <label htmlFor="p-description">Description</label>
        <textarea id="p-description" rows={2} value={p.description} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="grid-2">
        {text('organisation', 'University / organisation')}
        {text('course', 'Course / module')}
        {text('group', 'Group')}
        {text('supervisor', 'Supervisor')}
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="p-start">Log book week 1 starts</label>
          <input id="p-start" type="date" value={p.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          <span className="hint">Leave blank to number weeks by the calendar.</span>
        </div>
        <div className="field">
          <label htmlFor="p-week">Weeks start on</label>
          <select id="p-week" value={p.weekStartsOn} onChange={(e) => set({ weekStartsOn: e.target.value === '0' ? 0 : 1 })}>
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
          </select>
        </div>
      </div>
      {text('repoUrl', 'Code repository URL', 'https://github.com/you/repo', 'Lets you paste a commit hash as a link in entries.')}
      <div className="field">
        <label htmlFor="p-types">Entry types</label>
        <input id="p-types" value={types} onChange={(e) => setTypes(e.target.value)} />
        <span className="hint">Comma separated. Renaming a type does not change existing entries.</span>
      </div>
      <div className="row">
        <button className="btn primary" type="submit" disabled={!dirty}>
          Save details
        </button>
        {dirty && <span className="small muted">Unsaved changes</span>}
      </div>
    </form>
  );
}
