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
  // 1.2 Smart Schedule — historical snapshot of the scheduled lesson (never rewritten automatically)
  startTime?: string | null; // 'HH:MM'
  endTime?: string | null;
  scheduleKey?: string | null; // 'slot:<id>' | 'extra:<id>' | 'manual:<id>'
  periodId?: ID | null;
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

/* ------------------------------------------------------------------ */
/* 1.2 Smart Schedule: weekly template + validity period + exceptions  */
/* ------------------------------------------------------------------ */

/** A date-bounded schedule (e.g. "І семестр 2026/2027") for one student. */
export interface SchedulePeriod extends Base {
  studentId: ID;
  name: string;
  academicYear: string;
  startDate: ISODate;
  endDate: ISODate;
  /** ISO weekdays with lessons: 1 = Monday … 7 = Sunday */
  weekdays: number[];
  description: string;
  archived: boolean;
  basedOnId?: ID | null;
}

/**
 * One lesson of the weekly template. Changing the template mid-period never
 * rewrites history: the old slot gets `effectiveTo`, the new version gets `effectiveFrom`.
 */
export interface ScheduleSlot extends Base {
  studentId: ID;
  periodId: ID;
  weekday: number; // 1..7
  lessonNumber: number;
  subjectId: ID;
  startTime: string | null; // 'HH:MM'
  endTime: string | null;
  notes: string;
  effectiveFrom: ISODate | null; // null = from period start
  effectiveTo: ISODate | null; // null = until period end
}

export type ScheduleOverrideType = 'slot' | 'extra' | 'day';
export type DayOffKind = 'vacation' | 'weekend' | 'holiday' | 'other';

/** Exception for one date, stored separately from the weekly template. */
export interface ScheduleOverride extends Base {
  studentId: ID;
  periodId: ID;
  date: ISODate;
  type: ScheduleOverrideType;
  /** 'slot': which template lesson is changed on this date */
  slotId: ID | null;
  cancelled?: boolean;
  /** lesson took place but no observation was made */
  skipped?: boolean;
  subjectId?: ID | null;
  lessonNumber?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  note?: string;
  reason?: string;
  /** 'day': no lessons at all */
  dayOff?: DayOffKind | null;
  /** 'day': shortened lessons, times recomputed from the first lesson */
  shortened?: { duration: number; breakMinutes: number; firstStart?: string | null } | null;
}
