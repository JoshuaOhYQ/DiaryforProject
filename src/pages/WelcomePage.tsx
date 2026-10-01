import { useState } from 'react';
import { GitMerge, NotebookPen, RotateCcw } from 'lucide-react';
import { createProject } from '../app/projects.ts';
import { mergeFromFile, restoreFromFile, SaveTargetPanel } from '../components/BackupControls.tsx';
import { TemplatePicker } from '../components/NewProjectDialog.tsx';
import { TEMPLATES } from '../templates/index.ts';

/** Shown when there are no projects yet (first run, or everything was deleted). */
export function WelcomePage({ onCreated }: { onCreated: (id: string) => void }) {
  const [choice, setChoice] = useState(TEMPLATES[0].key);
  const [name, setName] = useState('');
  const template = TEMPLATES.find((t) => t.key === choice)!;

  return (
    <div className="welcome stack-lg">
      <div className="row">
        <div className="brand-mark" style={{ width: 40, height: 40, borderRadius: 10 }}>
          <NotebookPen size={22} />
        </div>
        <div>
          <h1 style={{ margin: 0 }}>Project log book</h1>
          <p className="muted" style={{ margin: 0 }}>
            Log work as you do it, link it to a Gantt chart, and print weekly log book pages.
          </p>
        </div>
      </div>

      <section className="card card-pad stack">
        <h2>Start a project</h2>
        <TemplatePicker options={TEMPLATES} value={choice} onChange={setChoice} />
        <div className="row">
          <input className="grow" aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} placeholder={template.project.name ?? 'Project name'} />
          <button className="btn primary" onClick={() => onCreated(createProject(template, name.trim() ? { name: name.trim() } : {}))}>
            Create project
          </button>
        </div>
      </section>

      <section className="card card-pad stack">
        <h2>Already have a log book?</h2>
        <div className="row">
          <button className="btn" onClick={restoreFromFile}>
            <RotateCcw size={16} /> Restore a backup (.json)
          </button>
          <button className="btn" onClick={mergeFromFile}>
            <GitMerge size={16} /> Add from a logbook.json
          </button>
        </div>
        <SaveTargetPanel />
      </section>
    </div>
  );
}
