import { createContext, useContext } from 'react';
import type { ProjectData } from '../data/index.ts';
import type { Entry } from '../types.ts';

export const ProjectContext = createContext<ProjectData | null>(null);

/** The project currently shown, with its members, features, tasks and entries. */
export function useProject(): ProjectData {
  const data = useContext(ProjectContext);
  if (!data) throw new Error('useProject() used outside a project');
  return data;
}

export interface EntryEditor {
  /** Open quick-add, optionally pre-filled (e.g. with a task). */
  openNew(preset?: Partial<Entry>): void;
  openEdit(entry: Entry): void;
}

export const EntryEditorContext = createContext<EntryEditor>({ openNew() {}, openEdit() {} });

export interface AppActions {
  switchProject(id: string): void;
  newProject(): void;
}

export const AppActionsContext = createContext<AppActions>({ switchProject() {}, newProject() {} });

export function useAppActions(): AppActions {
  return useContext(AppActionsContext);
}

export function useEntryEditor(): EntryEditor {
  return useContext(EntryEditorContext);
}
