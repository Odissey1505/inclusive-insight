import { db } from '../db/database';
import type { Dataset, DateRange } from './engine';

/** Loads final observations and linked records for one student in a date range. */
export async function loadDataset(studentId: string, range: DateRange): Promise<Dataset> {
  const between = <T,>(table: any) =>
    table.where('[studentId+date]').between([studentId, range.from], [studentId, range.to], true, true).toArray() as Promise<T[]>;
  const [observations, tasks, events, achievements] = await Promise.all([
    between<any>(db.observations),
    between<any>(db.tasks),
    between<any>(db.events),
    between<any>(db.achievements),
  ]);
  const finals = observations.filter((o) => o.status !== 'draft');
  const ids = new Set(finals.map((o) => o.id));
  const [uses, measurements] = await Promise.all([
    db.strategyUses.where('studentId').equals(studentId).filter((u) => u.date >= range.from && u.date <= range.to).toArray(),
    db.iepMeasurements.where('studentId').equals(studentId).filter((m) => m.date >= range.from && m.date <= range.to).toArray(),
  ]);
  return {
    observations: finals,
    tasks: tasks.filter((t) => ids.has(t.observationId)),
    events: events.filter((e) => ids.has(e.observationId)),
    strategyUses: uses.filter((u) => !u.observationId || ids.has(u.observationId)),
    achievements,
    measurements,
  };
}
