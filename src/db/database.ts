import Dexie, { type Table } from 'dexie';
import type {
  UserProfile, Student, Subject, Lesson, Observation, Task, ObsEvent, Strategy, StrategyUse,
  IEPGoal, IEPMeasurement, Achievement, Template, Settings, Draft, SchedulePeriod, ScheduleSlot, ScheduleOverride,
} from '../types/models';
import type { OutboxEntry, VersionEntry, ConflictEntry } from '../cloud/types';

export const DB_NAME = 'inclusive-insight';
export const SCHEMA_VERSION = 4;

/**
 * Local IndexedDB storage. The repositories in ./repositories.ts are the only
 * place the UI touches data, so this class can later be swapped for a remote
 * implementation (Inclusive Insight 2.0) without rewriting pages.
 */
export class InsightDB extends Dexie {
  users!: Table<UserProfile, string>;
  students!: Table<Student, string>;
  subjects!: Table<Subject, string>;
  lessons!: Table<Lesson, string>;
  observations!: Table<Observation, string>;
  tasks!: Table<Task, string>;
  events!: Table<ObsEvent, string>;
  strategies!: Table<Strategy, string>;
  strategyUses!: Table<StrategyUse, string>;
  iepGoals!: Table<IEPGoal, string>;
  iepMeasurements!: Table<IEPMeasurement, string>;
  achievements!: Table<Achievement, string>;
  templates!: Table<Template, string>;
  settings!: Table<Settings, string>;
  drafts!: Table<Draft, string>;
  // Cloud sync bookkeeping (1.1). Never part of backups or analytics.
  outbox!: Table<OutboxEntry, number>;
  // Smart Schedule (1.2)
  schedulePeriods!: Table<SchedulePeriod, string>;
  scheduleSlots!: Table<ScheduleSlot, string>;
  scheduleOverrides!: Table<ScheduleOverride, string>;
  versions!: Table<VersionEntry, string>;
  conflicts!: Table<ConflictEntry, string>;

  constructor(name = DB_NAME) {
    super(name);
    // v1 — initial schema
    this.version(1).stores({
      users: 'id, name, lastActiveAt',
      students: 'id, ownerId, [ownerId+isDemo]',
      subjects: 'id, ownerId, order',
      lessons: 'id, ownerId, studentId, [studentId+date], date',
      observations: 'id, ownerId, studentId, [studentId+date], date, subjectId, status',
      tasks: 'id, ownerId, studentId, observationId, [studentId+date]',
      events: 'id, ownerId, studentId, observationId, [studentId+date]',
      strategies: 'id, ownerId',
      strategyUses: 'id, ownerId, studentId, strategyId, observationId',
      iepGoals: 'id, ownerId, studentId',
      iepMeasurements: 'id, ownerId, goalId, studentId',
      achievements: 'id, ownerId, studentId, [studentId+date]',
      templates: 'id, ownerId, [ownerId+kind+key]',
      settings: 'id, ownerId',
    });
    // v2 — autosave drafts table + isDemo index on observations (migration example)
    this.version(2)
      .stores({
        drafts: 'key, ownerId, updatedAt',
        observations: 'id, ownerId, studentId, [studentId+date], date, subjectId, status, isDemo',
      })
      .upgrade(async (tx) => {
        await tx.table('observations').toCollection().modify((o: Observation) => {
          if (!o.status) o.status = 'final';
          if (!o.interactions) o.interactions = {};
          if (!o.strategyIds) o.strategyIds = [];
        });
      });
    // v3 — Inclusive Insight 1.1: cloud sync queue, known server versions, conflicts.
    // Existing tables and records are untouched.
    this.version(3).stores({
      outbox: '++seq, uid, key, state',
      versions: 'key, uid',
      conflicts: 'key, uid',
    });
    // v4 — Inclusive Insight 1.2: Smart Schedule (weekly template + period + exceptions).
    // New tables only; existing records are untouched.
    this.version(4).stores({
      schedulePeriods: 'id, ownerId, studentId',
      scheduleSlots: 'id, ownerId, studentId, periodId',
      scheduleOverrides: 'id, ownerId, studentId, periodId, [studentId+date], date',
    });
  }
}

export let db = new InsightDB();

/** Used by tests to get a fresh database. */
export function resetDbInstance(name = DB_NAME) {
  db.close();
  db = new InsightDB(name);
  return db;
}
