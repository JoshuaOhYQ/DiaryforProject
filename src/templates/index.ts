import type { ProjectTemplate } from './template.ts';
import { piperTemplate } from './piper.ts';

export { instantiateTemplate, type ProjectTemplate } from './template.ts';

const blankTemplate: ProjectTemplate = {
  key: 'blank',
  label: 'Blank project',
  description: 'No members, features or tasks. Add your own on the Team and Gantt pages.',
  project: { name: 'New project' },
  members: [],
  features: [],
  tasks: [],
};

const engineeringTemplate: ProjectTemplate = {
  key: 'engineering',
  label: 'Engineering design project',
  description: 'Typical work packages for a student design project. Rename or delete any of them.',
  project: { name: 'New design project' },
  members: [],
  features: [
    { name: 'Research & requirements' },
    { name: 'Design' },
    { name: 'Hardware' },
    { name: 'Software' },
    { name: 'Integration & testing' },
    { name: 'Report & presentation' },
  ],
  tasks: [],
};

export const TEMPLATES: ProjectTemplate[] = [piperTemplate, engineeringTemplate, blankTemplate];
