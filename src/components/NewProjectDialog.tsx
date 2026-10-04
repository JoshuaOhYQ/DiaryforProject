import { useState } from 'react';
import type { ProjectData } from '../data/index.ts';
import { TEMPLATES, type ProjectTemplate } from '../templates/index.ts';
import { createProject, templateFromProject } from '../app/projects.ts';
import { Modal } from './Modal.tsx';

interface Props {
  current: ProjectData | null;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export function NewProjectDialog({ current, onClose, onCreated }: Props) {
  const options: ProjectTemplate[] = current ? [templateFromProject(current), ...TEMPLATES] : TEMPLATES;
  const [choice, setChoice] = useState(options[options.length - 1].key);
  const [name, setName] = useState('');
  const template = options.find((t) => t.key === choice)!;

  function create() {
    const id = createProject(template, { name: name.trim() || template.project.name || 'New project' });
    onCreated(id);
  }

  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create}>
            Create project
          </button>
        </>
      }
    >
      <TemplatePicker options={options} value={choice} onChange={setChoice} />
      <div className="field" style={{ marginTop: '1rem' }}>
        <label htmlFor="np-name">Project name</label>
        <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={template.project.name || 'New project'} autoFocus />
      </div>
    </Modal>
  );
}

export function TemplatePicker({ options, value, onChange }: { options: ProjectTemplate[]; value: string; onChange: (key: string) => void }) {
  return (
    <div className="template-list" role="radiogroup" aria-label="Start from">
      {options.map((t) => (
        <button key={t.key} type="button" className="template-option" role="radio" aria-checked={value === t.key} onClick={() => onChange(t.key)}>
          <strong>{t.label}</strong>
          <span className="small muted">
            {t.description ||
              `${t.members.length} members, ${t.features.length} features. Tasks and entries are not copied.`}
          </span>
        </button>
      ))}
    </div>
  );
}
