/**
 * The only data module the UI imports. Everything about where data lives stays behind this file.
 */
import { useSyncExternalStore } from 'react';
import { openLocalDb } from './localDb.ts';
import { LogbookStore, type SaveStatus } from './store.ts';
import { dataScope } from './fileTargets.ts';
import type { Workspace } from '../types.ts';

export const store = new LogbookStore({ db: openLocalDb(), scope: dataScope });

export function useWorkspace(): Workspace {
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(store.subscribe, store.getStatus);
}

export type { SaveStatus } from './store.ts';
export type { Changes } from './changes.ts';
export { combineChanges } from './changes.ts';
export * from './factories.ts';
export { selectProject, type ProjectData } from './select.ts';
export { extractProject, parseWorkspace, serializeWorkspace, DEFAULT_ENTRY_TYPES, FEATURE_STATUSES, PALETTE } from './workspace.ts';
export { parseLogbookText } from './merge.ts';
export { getDataKeys, setDataKeys } from './fileTargets.ts';
