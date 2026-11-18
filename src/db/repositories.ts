import { db } from './database';
import { uid, todayISO } from '../lib/utils';
import { DEFAULT_STRATEGIES, DEFAULT_SUBJECTS, SUBJECT_TEMPLATES } from '../lib/catalog';
import type {
  UserProfile, Student, Subject, Lesson, Observation, Task, ObsEvent, Strategy, StrategyUse,
  IEPGoal, IEPMeasurement, Achievement, Template, Settings, ID, ISODate,
} from '../types/models';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const now = () => Date.now();

function stamp<T extends object>(ownerId: ID, data: T, existing?: { id: string; createdAt: number }) {
  return {
    ...data,
    id: existing?.id ?? (data as any).id ?? uid(),
    ownerId,
    createdAt: existing?.createdAt ?? (data as any).createdAt ?? now(),
    updatedAt: now(),
  };
}

/** Tables that hold per-owner data (everything except users/settings/drafts). */
export const OWNER_TABLES = [
  'students', 'subjects', 'lessons', 'observations', 'tasks', 'events', 'strategies',
  'strategyUses', 'iepGoals', 'iepMeasurements', 'achievements', 'templates',
] as const;
export type OwnerTable = (typeof OWNER_TABLES)[number];

/** Tables that hold per-student data. */
const STUDENT_TABLES = ['lessons', 'observations', 'tasks', 'events', 'strategyUses', 'iepGoals', 'iepMeasurements', 'achievements'] as const;

/* ------------------------------------------------------------------ */
/* Users (local workspaces — NOT authentication)                       */
/* ------------------------------------------------------------------ */

const AVATARS = ['🌿', '🌼', '📚', '🦉', '🌈', '🍀', '⭐', '🐝', '🍎', '🎈'];
const COLORS = ['#5B9BD5', '#8CCFB5', '#E8B04A', '#ECA5A0', '#C59BD8', '#6CC3D5'];

export const usersRepo = {
  list: () => db.users.orderBy('lastActiveAt').reverse().toArray(),
  get: (id: ID) => db.users.get(id),
  async create(name: string): Promise<UserProfile> {
    const count = await db.users.count();
    const user: UserProfile = {
      id: uid('u'),
      name: name.trim(),
      avatar: AVATARS[count % AVATARS.length],
      color: COLORS[count % COLORS.length],
      createdAt: now(),
      lastActiveAt: now(),
    };
    await db.users.add(user);
    await bootstrapOwner(user.id);
    return user;
  },
  async update(id: ID, patch: Partial<Pick<UserProfile, 'name' | 'avatar' | 'color'>>) {
    await db.users.update(id, patch);
  },
  async touch(id: ID) {
    await db.users.update(id, { lastActiveAt: now() });
    await settingsRepo.setApp({ lastUserId: id });
  },
  /** Removes the profile and every record it owns. */
  async remove(id: ID) {
    await db.transaction('rw', [db.users, db.settings, db.drafts, ...OWNER_TABLES.map((t) => db.table(t))], async () => {
      for (const t of OWNER_TABLES) await db.table(t).where('ownerId').equals(id).delete();
      await db.drafts.where('ownerId').equals(id).delete();
      await db.settings.delete(`user:${id}`);
      await db.users.delete(id);
      const app = await db.settings.get('app');
      if (app?.lastUserId === id) await db.settings.put({ ...app, lastUserId: null });
    });
  },
};

/**
 * Seeds default subjects and strategies for a fresh workspace.
 * In cloud mode `idFor` gives deterministic ids, so two devices that seed at the
 * same time produce the same records instead of duplicates.
 */
export async function bootstrapOwner(ownerId: ID, idFor?: (kind: 'subject' | 'strategy', key: string) => Promise<string>) {
  const hasSubjects = await db.subjects.where('ownerId').equals(ownerId).count();
  if (!hasSubjects) {
    const rows: Subject[] = [];
    for (const [i, s] of DEFAULT_SUBJECTS.entries()) {
      const id = idFor ? await idFor('subject', s.templateKey) : uid();
      rows.push(stamp(ownerId, { ...s, id, order: i, hidden: false }) as Subject);
    }
    await db.subjects.bulkAdd(rows);
  }
  const hasStrategies = await db.strategies.where('ownerId').equals(ownerId).count();
  if (!hasStrategies) {
    const rows: Strategy[] = [];
    for (const s of DEFAULT_STRATEGIES) {
      const id = idFor ? await idFor('strategy', s.name) : uid();
      rows.push(stamp(ownerId, { ...s, id, isDefault: true }) as Strategy);
    }
    await db.strategies.bulkAdd(rows);
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const settingsRepo = {
  async getApp(): Promise<Settings> {
    return (await db.settings.get('app')) ?? { id: 'app' };
  },
  async setApp(patch: Partial<Settings>) {
    const cur = await settingsRepo.getApp();
    await db.settings.put({ ...cur, ...patch, id: 'app', updatedAt: now() });
  },
  async getUser(ownerId: ID): Promise<Settings> {
    return (
      (await db.settings.get(`user:${ownerId}`)) ?? {
        id: `user:${ownerId}`, ownerId, theme: 'light', compact: false, animations: true, activeStudentId: null,
      }
    );
  },
  async setUser(ownerId: ID, patch: Partial<Settings>) {
    const cur = await settingsRepo.getUser(ownerId);
    await db.settings.put({ ...cur, ...patch, id: `user:${ownerId}`, ownerId, updatedAt: now() });
  },
};

/* ------------------------------------------------------------------ */
/* Students                                                            */
/* ------------------------------------------------------------------ */

export type StudentInput = Omit<Student, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: ID };

export const studentsRepo = {
  list: (ownerId: ID) => db.students.where('ownerId').equals(ownerId).toArray(),
  get: (id: ID) => db.students.get(id),
  async save(ownerId: ID, input: StudentInput): Promise<Student> {
    const existing = input.id ? await db.students.get(input.id) : undefined;
    const rec = stamp(ownerId, input, existing) as Student;
    await db.students.put(rec);
    return rec;
  },
  async remove(id: ID) {
    await db.transaction('rw', [db.students, ...STUDENT_TABLES.map((t) => db.table(t))], async () => {
      for (const t of STUDENT_TABLES) await db.table(t).where('studentId').equals(id).delete();
      await db.students.delete(id);
    });
  },
};

export function emptyStudent(): StudentInput {
  return {
    name: '', grade: '1 клас', schoolYear: currentSchoolYearLabel(), startDate: todayISO(),
    strengths: '', interests: '', needs: '', effectiveStrategies: '', notes: '',
  };
}

export function currentSchoolYearLabel(d = new Date()) {
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
}

/* ------------------------------------------------------------------ */
/* Subjects & templates                                                */
/* ------------------------------------------------------------------ */

export const subjectsRepo = {
  async list(ownerId: ID) {
    const all = await db.subjects.where('ownerId').equals(ownerId).toArray();
    return all.sort((a, b) => a.order - b.order);
  },
  async save(ownerId: ID, input: Partial<Subject> & { name: string }) {
    const existing = input.id ? await db.subjects.get(input.id) : undefined;
    const order = existing?.order ?? (await db.subjects.where('ownerId').equals(ownerId).count());
    const rec = stamp(ownerId, {
      templateKey: 'custom', color: '#A0AEC0', hidden: false, ...existing, ...input, order,
    }, existing) as Subject;
    await db.subjects.put(rec);
    return rec;
  },
  async reorder(ids: ID[]) {
    await db.transaction('rw', db.subjects, async () => {
      for (let i = 0; i < ids.length; i++) await db.subjects.update(ids[i], { order: i, updatedAt: now() });
    });
  },
  async isUsed(id: ID) {
    return (await db.observations.where('subjectId').equals(id).count()) > 0;
  },
  async remove(id: ID) {
    await db.subjects.delete(id);
  },
};

export const templatesRepo = {
  async get(ownerId: ID, kind: Template['kind'], key: string): Promise<Template | undefined> {
    return db.templates.where('[ownerId+kind+key]').equals([ownerId, kind, key]).first();
  },
  async listAll(ownerId: ID) {
    return db.templates.where('ownerId').equals(ownerId).toArray();
  },
  async save(ownerId: ID, kind: Template['kind'], key: string, patch: Partial<Pick<Template, 'options' | 'hiddenOptions'>>) {
    const existing = await templatesRepo.get(ownerId, kind, key);
    const rec = stamp(ownerId, { kind, key, options: [], hiddenOptions: [], ...existing, ...patch }, existing) as Template;
    await db.templates.put(rec);
    return rec;
  },
  /** Template fields for a subject; a saved template overrides the default list. */
  subjectFields(subject: Subject | undefined, tpl: Template | undefined): string[] {
    if (tpl) return tpl.options;
    if (!subject) return [];
    return SUBJECT_TEMPLATES[subject.templateKey] ?? [];
  },
};

/* ------------------------------------------------------------------ */
/* Lessons                                                             */
/* ------------------------------------------------------------------ */

export const lessonsRepo = {
  listForDate: (studentId: ID, date: ISODate) =>
    db.lessons.where('[studentId+date]').equals([studentId, date]).sortBy('number'),
  listRange: (studentId: ID, from: ISODate, to: ISODate) =>
    db.lessons.where('[studentId+date]').between([studentId, from], [studentId, to], true, true).toArray(),
  async save(ownerId: ID, input: Omit<Lesson, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: ID }) {
    const existing = input.id ? await db.lessons.get(input.id) : undefined;
    const rec = stamp(ownerId, input, existing) as Lesson;
    await db.lessons.put(rec);
    return rec;
  },
  async remove(id: ID) {
    await db.transaction('rw', db.lessons, db.observations, async () => {
      await db.observations.filter((o) => o.lessonId === id).modify({ lessonId: undefined });
      await db.lessons.delete(id);
    });
  },
};

/* ------------------------------------------------------------------ */
/* Observations (with tasks, events, strategy uses)                    */
/* ------------------------------------------------------------------ */

export type TaskInput = Omit<Task, 'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'studentId' | 'observationId' | 'date' | 'subjectId' | 'order'> & { id?: ID };
export type EventInput = Omit<ObsEvent, 'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'studentId' | 'observationId' | 'date' | 'subjectId'> & { id?: ID };

export type ObservationInput = Omit<Observation, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & {
  id?: ID;
  tasks: TaskInput[];
  events: EventInput[];
};

export function emptyObservation(studentId: ID, subjectId: ID, date = todayISO()): ObservationInput {
  return {
    studentId, date, lessonNumber: null, subjectId, topic: '', duration: null, mode: 'standard', status: 'final',
    behaviors: [], engagement: null, taskStart: null, supportLevels: [], attention: null, attentionMinutes: null,
    communication: [], motivation: [], supportEffect: null, strategyIds: [], interactions: {},
    context: { before: '', action: '', after: '', support: '', result: '' },
    notes: '', wentWell: '', difficulties: '', helped: '', nextTime: '', subjectFields: {},
    tasks: [], events: [],
  };
}

export const observationsRepo = {
  get: (id: ID) => db.observations.get(id),
  listForStudent: (studentId: ID) => db.observations.where('studentId').equals(studentId).toArray(),
  listRange: (studentId: ID, from: ISODate, to: ISODate) =>
    db.observations.where('[studentId+date]').between([studentId, from], [studentId, to], true, true).toArray(),
  tasksFor: (observationId: ID) => db.tasks.where('observationId').equals(observationId).sortBy('order'),
  eventsFor: (observationId: ID) => db.events.where('observationId').equals(observationId).toArray(),

  async loadFull(id: ID): Promise<ObservationInput | undefined> {
    const o = await db.observations.get(id);
    if (!o) return undefined;
    const [tasks, events] = await Promise.all([observationsRepo.tasksFor(id), observationsRepo.eventsFor(id)]);
    return { ...o, tasks, events };
  },

  /** Saves an observation and synchronises its child records in one transaction. */
  async save(ownerId: ID, input: ObservationInput): Promise<Observation> {
    const { tasks, events, ...obsData } = input;
    return db.transaction(
      'rw',
      [db.observations, db.tasks, db.events, db.strategyUses, db.lessons, db.students],
      async () => {
        const existing = obsData.id ? await db.observations.get(obsData.id) : undefined;
        const isDemo = existing?.isDemo ?? (await db.students.get(obsData.studentId))?.isDemo;
        const obs = stamp(ownerId, { ...obsData, isDemo }, existing) as Observation;

        // Link or create the lesson slot for (date, number, subject)
        if (obs.status === 'final' && obs.lessonNumber) {
          const sameDay = await db.lessons.where('[studentId+date]').equals([obs.studentId, obs.date]).toArray();
          let lesson = sameDay.find((l) => l.id === obs.lessonId) ?? sameDay.find((l) => l.number === obs.lessonNumber);
          if (lesson) {
            await db.lessons.update(lesson.id, {
              number: obs.lessonNumber, subjectId: obs.subjectId, topic: obs.topic || lesson.topic, updatedAt: now(),
            });
          } else {
            lesson = stamp(ownerId, {
              studentId: obs.studentId, date: obs.date, number: obs.lessonNumber, subjectId: obs.subjectId, topic: obs.topic, isDemo,
            }) as Lesson;
            await db.lessons.add(lesson);
          }
          obs.lessonId = lesson.id;
        }
        await db.observations.put(obs);

        // Replace children
        await db.tasks.where('observationId').equals(obs.id).delete();
        await db.events.where('observationId').equals(obs.id).delete();
        await db.strategyUses.where('observationId').equals(obs.id).delete();

        const common = { studentId: obs.studentId, observationId: obs.id, date: obs.date, subjectId: obs.subjectId, isDemo };
        await db.tasks.bulkAdd(tasks.map((t, i) => stamp(ownerId, { ...t, ...common, order: i, id: t.id ?? uid() }) as Task));
        await db.events.bulkAdd(events.map((e) => stamp(ownerId, { ...e, ...common, id: e.id ?? uid() }) as ObsEvent));
        await db.strategyUses.bulkAdd(
          obs.strategyIds.map((sid) => stamp(ownerId, {
            studentId: obs.studentId, strategyId: sid, observationId: obs.id, date: obs.date,
            subjectId: obs.subjectId, result: obs.supportEffect, comment: obs.helped, isDemo,
          }) as StrategyUse),
        );
        return obs;
      },
    );
  },

  async remove(id: ID) {
    await db.transaction('rw', [db.observations, db.tasks, db.events, db.strategyUses, db.iepGoals, db.iepMeasurements], async () => {
      await db.tasks.where('observationId').equals(id).delete();
      await db.events.where('observationId').equals(id).delete();
      await db.strategyUses.where('observationId').equals(id).delete();
      await db.iepMeasurements.filter((m) => m.observationId === id).modify({ observationId: undefined });
      const goals = await db.iepGoals.filter((g) => g.linkedObservationIds?.includes(id)).toArray();
      for (const g of goals) await db.iepGoals.update(g.id, { linkedObservationIds: g.linkedObservationIds.filter((x) => x !== id) });
      await db.observations.delete(id);
    });
  },

  /** Copy of an observation as a new draft (date = today, no lesson link). */
  async duplicate(ownerId: ID, id: ID): Promise<Observation | undefined> {
    const full = await observationsRepo.loadFull(id);
    if (!full) return undefined;
    const { id: _id, lessonId: _l, createdAt: _c, updatedAt: _u, ownerId: _o, ...rest } = full as any;
    return observationsRepo.save(ownerId, {
      ...rest,
      date: todayISO(),
      status: 'draft',
      tasks: full.tasks.map(({ id: _t, ...t }: any) => t),
      events: full.events.map(({ id: _e, ...e }: any) => e),
    });
  },
};

/* ------------------------------------------------------------------ */
/* Strategies                                                          */
/* ------------------------------------------------------------------ */

export const strategiesRepo = {
  list: (ownerId: ID) => db.strategies.where('ownerId').equals(ownerId).toArray(),
  async save(ownerId: ID, input: Partial<Strategy> & { name: string }) {
    const existing = input.id ? await db.strategies.get(input.id) : undefined;
    const rec = stamp(ownerId, { description: '', isDefault: false, ...existing, ...input }, existing) as Strategy;
    await db.strategies.put(rec);
    return rec;
  },
  async remove(id: ID) {
    await db.transaction('rw', db.strategies, db.strategyUses, db.observations, async () => {
      await db.strategyUses.where('strategyId').equals(id).delete();
      await db.observations.filter((o) => o.strategyIds?.includes(id)).modify((o) => {
        o.strategyIds = o.strategyIds.filter((x) => x !== id);
      });
      await db.strategies.delete(id);
    });
  },
  usesForStudent: (studentId: ID) => db.strategyUses.where('studentId').equals(studentId).toArray(),
  async addManualUse(ownerId: ID, input: Omit<StrategyUse, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) {
    const rec = stamp(ownerId, input) as StrategyUse;
    await db.strategyUses.add(rec);
    return rec;
  },
  removeUse: (id: ID) => db.strategyUses.delete(id),
};

/* ------------------------------------------------------------------ */
/* IEP                                                                 */
/* ------------------------------------------------------------------ */

export type GoalInput = Omit<IEPGoal, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: ID };

export const iepRepo = {
  goals: (studentId: ID) => db.iepGoals.where('studentId').equals(studentId).toArray(),
  getGoal: (id: ID) => db.iepGoals.get(id),
  async saveGoal(ownerId: ID, input: GoalInput) {
    const existing = input.id ? await db.iepGoals.get(input.id) : undefined;
    const isDemo = existing?.isDemo ?? (await db.students.get(input.studentId))?.isDemo;
    const rec = stamp(ownerId, { ...input, isDemo }, existing) as IEPGoal;
    await db.iepGoals.put(rec);
    return rec;
  },
  async removeGoal(id: ID) {
    await db.transaction('rw', db.iepGoals, db.iepMeasurements, db.achievements, async () => {
      await db.iepMeasurements.where('goalId').equals(id).delete();
      await db.achievements.filter((a) => a.goalId === id).modify({ goalId: undefined });
      await db.iepGoals.delete(id);
    });
  },
  measurements: (goalId: ID) => db.iepMeasurements.where('goalId').equals(goalId).sortBy('date'),
  measurementsForStudent: (studentId: ID) => db.iepMeasurements.where('studentId').equals(studentId).toArray(),
  async saveMeasurement(ownerId: ID, input: Omit<IEPMeasurement, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: ID }) {
    const existing = input.id ? await db.iepMeasurements.get(input.id) : undefined;
    const rec = stamp(ownerId, input, existing) as IEPMeasurement;
    await db.iepMeasurements.put(rec);
    return rec;
  },
  removeMeasurement: (id: ID) => db.iepMeasurements.delete(id),
};

export function emptyGoal(studentId: ID): GoalInput {
  return {
    studentId, title: '', area: 'Самостійність', baseline: '', expected: '', criterion: '', startDate: todayISO(),
    endDate: todayISO(), notes: '', status: 'active', unit: '', targetValue: null, linkedObservationIds: [], summary: '',
  };
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

export type AchievementInput = Omit<Achievement, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: ID };

export const achievementsRepo = {
  list: (studentId: ID) => db.achievements.where('studentId').equals(studentId).toArray(),
  async save(ownerId: ID, input: AchievementInput) {
    const existing = input.id ? await db.achievements.get(input.id) : undefined;
    const isDemo = existing?.isDemo ?? (await db.students.get(input.studentId))?.isDemo;
    const rec = stamp(ownerId, { ...input, isDemo }, existing) as Achievement;
    await db.achievements.put(rec);
    return rec;
  },
  remove: (id: ID) => db.achievements.delete(id),
};

/* ------------------------------------------------------------------ */
/* Drafts (autosave)                                                   */
/* ------------------------------------------------------------------ */

export const draftsRepo = {
  get: (key: string) => db.drafts.get(key),
  put: (ownerId: ID, key: string, data: unknown) => db.drafts.put({ key, ownerId, data, updatedAt: now() }),
  remove: (key: string) => db.drafts.delete(key),
};

/* ------------------------------------------------------------------ */
/* Integrity check                                                     */
/* ------------------------------------------------------------------ */

export interface IntegrityReport {
  counts: Record<string, number>;
  problems: string[];
}

export async function checkIntegrity(ownerId: ID, fix = false): Promise<IntegrityReport> {
  const counts: Record<string, number> = {};
  const problems: string[] = [];
  for (const t of OWNER_TABLES) counts[t] = await db.table(t).where('ownerId').equals(ownerId).count();

  const studentIds = new Set((await studentsRepo.list(ownerId)).map((s) => s.id));
  const obsIds = new Set((await db.observations.where('ownerId').equals(ownerId).primaryKeys()) as string[]);
  const goalIds = new Set((await db.iepGoals.where('ownerId').equals(ownerId).primaryKeys()) as string[]);

  for (const t of STUDENT_TABLES) {
    const orphans = await db.table(t).where('ownerId').equals(ownerId).filter((r: any) => !studentIds.has(r.studentId)).toArray();
    if (orphans.length) {
      problems.push(`${t}: ${orphans.length} запис(ів) без учня`);
      if (fix) await db.table(t).bulkDelete(orphans.map((r: any) => r.id));
    }
  }
  for (const t of ['tasks', 'events'] as const) {
    const orphans = await db.table(t).where('ownerId').equals(ownerId).filter((r: any) => !obsIds.has(r.observationId)).toArray();
    if (orphans.length) {
      problems.push(`${t}: ${orphans.length} запис(ів) без спостереження`);
      if (fix) await db.table(t).bulkDelete(orphans.map((r: any) => r.id));
    }
  }
  const mOrphans = await db.iepMeasurements.where('ownerId').equals(ownerId).filter((m) => !goalIds.has(m.goalId)).toArray();
  if (mOrphans.length) {
    problems.push(`iepMeasurements: ${mOrphans.length} вимірювань без цілі`);
    if (fix) await db.iepMeasurements.bulkDelete(mOrphans.map((m) => m.id));
  }
  return { counts, problems };
}
