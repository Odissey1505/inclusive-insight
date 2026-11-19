import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { scheduleRepo } from './scheduleRepo';
import { resolveDay, resolveRange, type DaySchedule, type ScheduleData } from './scheduleEngine';

/** Live schedule data for a date range (re-computed after any local or synced change). */
export function useScheduleData(studentId: string | undefined, from: string, to: string): ScheduleData | undefined {
  return useLiveQuery(() => (studentId ? scheduleRepo.loadData(studentId, from, to) : undefined), [studentId, from, to]);
}

export function useScheduleRange(studentId: string | undefined, from: string, to: string): DaySchedule[] | undefined {
  const data = useScheduleData(studentId, from, to);
  return useMemo(() => (data && studentId ? resolveRange(from, to, studentId, data) : undefined), [data, studentId, from, to]);
}

export function useDaySchedule(studentId: string | undefined, date: string): DaySchedule | undefined {
  const data = useScheduleData(studentId, date, date);
  return useMemo(() => (data && studentId ? resolveDay(date, studentId, data) : undefined), [data, studentId, date]);
}
