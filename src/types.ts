/** A calendar date with no time zone, e.g. "2026-10-09". Compare with < and > directly. */
export type ISODate = string;
/** A moment in time, e.g. "2026-10-01T08:15:00.000Z". Used for last-writer-wins merging. */
export type Timestamp = string;

export interface Stamped {
  id: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Project extends Stamped {
  name: string;
  description: string;
  organisation: string;
  course: string;
  group: string;
  supervisor: string;
  /** Week 1 of the log book is the week containing this date. Blank = use ISO week numbers. */
  startDate: ISODate | '';
  /** e.g. https://github.com/me/repo, used to turn commit hashes into links. */
  repoUrl: string;
  entryTypes: string[];
  /** 1 = weeks start on Monday, 0 = Sunday. */
  weekStartsOn: 0 | 1;
}

export interface Member extends Stamped {
  projectId: string;
  name: string;
  role: string;
  colour: string;
  /** Archived members keep their entries but disappear from pickers. */
  archived: boolean;
}

export type FeatureStatus = 'Not started' | 'In progress' | 'Blocked' | 'Done';

export interface Feature extends Stamped {
  projectId: string;
  name: string;
  description: string;
  status: FeatureStatus;
  ownerIds: string[];
  colour: string;
  order: number;
}

export interface Task extends Stamped {
  projectId: string;
  name: string;
  featureId: string | null;
  assigneeIds: string[];
  /** Planned dates. Actual dates are worked out from linked log entries. */
  start: ISODate;
  end: ISODate;
  /** 0-100 */
  progress: number;
  /** Finish-to-start: this task should start after each of these ends. */
  dependsOn: string[];
  milestone: boolean;
  notes: string;
}

export interface Link {
  label: string;
  url: string;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Path inside data/, e.g. "assets/mfz0abcd-x7k2p9.png" */
  file: string;
}

export interface Entry extends Stamped {
  projectId: string;
  date: ISODate;
  authorId: string;
  featureId: string | null;
  taskId: string | null;
  hours: number;
  type: string;
  did: string;
  problems: string;
  fixes: string;
  result: string;
  next: string;
  tags: string[];
  links: Link[];
  attachments: AttachmentRef[];
}

/** A narrative paragraph saved against a log book week (team-wide or for one member). */
export interface WeekNote extends Stamped {
  projectId: string;
  weekStart: ISODate;
  memberId: string | null;
  narrative: string;
}

export type CollectionName = 'projects' | 'members' | 'features' | 'tasks' | 'entries' | 'weekNotes';

export interface Tombstone {
  id: string;
  collection: CollectionName;
  deletedAt: Timestamp;
}

export interface Workspace {
  schemaVersion: 1;
  projects: Project[];
  members: Member[];
  features: Feature[];
  tasks: Task[];
  entries: Entry[];
  weekNotes: WeekNote[];
  tombstones: Tombstone[];
}

export type RecordOf<C extends CollectionName> = Workspace[C][number];
