// Domain models for Inclusive Insight. Every record carries ownerId (local profile).
export type ID = string;
export type ISODate = string; // yyyy-MM-dd

export interface Base {
  id: ID;
  ownerId: ID;
  createdAt: number;
  updatedAt: number;
  isDemo?: boolean;
}

export interface UserProfile {
  id: ID;
  name: string;
  avatar: string; // emoji
  color: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface Student extends Base {
  name: string;
  grade: string;
  schoolYear: string;
  startDate: ISODate;
  strengths: string;
  interests: string;
  needs: string;
  effectiveStrategies: string;
  notes: string;
  archived?: boolean;
}

export interface Subject extends Base {
  name: string;
  templateKey: string; // reading | writing | math | english | world | art | tech | music | pe | other | custom
  color: string;
  order: number;
  hidden: boolean;
}

export interface Lesson extends Base {
  studentId: ID;
  date: ISODate;
  number: number;
  subjectId: ID;
  topic: string;
}

export type ObservationMode = 'quick' | 'standard' | 'detailed';
export type ObservationStatus = 'draft' | 'final';
export type InteractionLevel = 'active' | 'partial' | 'minimal' | 'none';

export interface ObservationContext {
  before: string;
  action: string;
  after: string;
  support: string;
  result: string;
}

export interface Observation extends Base {
  studentId: ID;
  lessonId?: ID;
  date: ISODate;
  lessonNumber: number | null;
  subjectId: ID;
  topic: string;
  duration: number | null;
  mode: ObservationMode;
  status: ObservationStatus;
  behaviors: string[];
  engagement: string | null;
  taskStart: string | null;
  supportLevels: string[];
  attention: string | null;
  attentionMinutes: number | null;
  communication: string[];
  motivation: string[];
  supportEffect: string | null;
  strategyIds: string[];
  interactions: Record<string, InteractionLevel>;
  context: ObservationContext;
  notes: string;
  wentWell: string;
  difficulties: string;
  helped: string;
  nextTime: string;
  subjectFields: Record<string, string>; // template field -> rating key
}

export interface Task extends Base {
  studentId: ID;
  observationId: ID;
  date: ISODate;
  subjectId: ID;
  type: string;
  title: string;
  offered: number | null;
  completed: number | null;
  unit: string;
  support: string | null;
  participation: string | null; // active | partial | none | null(not assessed)
  result: string | null; // full | partial | not_done | null(unknown)
  comment: string;
  order: number;
}

export interface ObsEvent extends Base {
  studentId: ID;
  observationId: ID;
  date: ISODate;
  subjectId: ID;
  type: string;
  tags: string[];
  description: string;
  time: string;
}

export interface Strategy extends Base {
  name: string;
  description: string;
  isDefault: boolean;
  hidden?: boolean;
}

export interface StrategyUse extends Base {
  studentId: ID;
  strategyId: ID;
  observationId?: ID;
  date: ISODate;
  subjectId?: ID;
  result: string | null; // helped | partial | no_effect | unknown
  comment: string;
}

export interface IEPGoal extends Base {
  studentId: ID;
  title: string;
  area: string;
  baseline: string;
  expected: string;
  criterion: string;
  startDate: ISODate;
  endDate: ISODate;
  notes: string;
  status: 'active' | 'achieved' | 'paused';
  unit: string; // optional measure unit, e.g. "слів", "%", "хв"
  targetValue: number | null; // numeric target makes a % meaningful
  linkedObservationIds: ID[];
  summary: string;
}

export interface IEPMeasurement extends Base {
  studentId: ID;
  goalId: ID;
  date: ISODate;
  value: number | null;
  comment: string;
  criterionMet: boolean;
  observationId?: ID;
}

export interface Achievement extends Base {
  studentId: ID;
  date: ISODate;
  category: string;
  title: string;
  description: string;
  subjectId?: ID;
  goalId?: ID;
  includeInReports: boolean;
}

export interface Template extends Base {
  kind: 'subject' | 'category';
  key: string; // subject templateKey/subjectId or category key
  options: string[]; // custom options / template fields
  hiddenOptions: string[];
}

export interface Settings {
  id: string; // 'app' or `user:${ownerId}`
  ownerId?: ID;
  theme?: 'light' | 'dark' | 'system';
  compact?: boolean;
  animations?: boolean;
  activeStudentId?: ID | null;
  lastUserId?: ID | null;
  privacyAck?: boolean;
  lastBackupAt?: number;
  updatedAt?: number;
}

export interface Draft {
  key: string;
  ownerId: ID;
  data: unknown;
  updatedAt: number;
}
