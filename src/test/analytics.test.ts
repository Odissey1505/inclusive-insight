import { describe, it, expect } from 'vitest';
import { computeMetrics, emptyDataset, generateInsights, periodRange, previousRange, timeSeries, bySubject, heatmap, summaryText, ratio } from '../analytics/engine';
import type { Observation, Task, Subject } from '../types/models';

const subj = (id: string, name: string): Subject => ({ id, name, templateKey: 'custom', color: '#000', order: 0, hidden: false, ownerId: 'u', createdAt: 0, updatedAt: 0 });
const obs = (id: string, date: string, p: Partial<Observation> = {}): Observation => ({
  id, ownerId: 'u', createdAt: 0, updatedAt: 0, studentId: 's', date, lessonNumber: 1, subjectId: 'w', topic: '', duration: null,
  mode: 'standard', status: 'final', behaviors: [], engagement: null, taskStart: null, supportLevels: [], attention: null,
  attentionMinutes: null, communication: [], motivation: [], supportEffect: null, strategyIds: [], interactions: {},
  context: { before: '', action: '', after: '', support: '', result: '' }, notes: '', wentWell: '', difficulties: '', helped: '', nextTime: '', subjectFields: {}, ...p,
});
const task = (id: string, oid: string, date: string, p: Partial<Task> = {}): Task => ({
  id, ownerId: 'u', createdAt: 0, updatedAt: 0, studentId: 's', observationId: oid, date, subjectId: 'w', type: 'written', title: '',
  offered: null, completed: null, unit: '', support: null, participation: null, result: null, comment: '', order: 0, ...p,
});

describe('analytics engine', () => {
  it('handles an empty dataset without errors', () => {
    const m = computeMetrics(emptyDataset());
    expect(m.lessons).toBe(0);
    expect(m.completion.pct).toBeNull();
    expect(m.independence.pct).toBeNull();
    expect(generateInsights(emptyDataset(), null, { subjects: [], strategies: [] })[0].id).toBe('nodata');
    expect(summaryText(emptyDataset(), { subjects: [], strategies: [], studentName: '', range: { from: '2026-01-01', to: '2026-01-02' } })).toMatch(/не зафіксовано/);
  });

  it('single record', () => {
    const ds = { ...emptyDataset(), observations: [obs('o1', '2026-10-01', { taskStart: 'independent' })], tasks: [task('t1', 'o1', '2026-10-01', { result: 'full', support: 'none' })] };
    const m = computeMetrics(ds);
    expect(m.lessons).toBe(1);
    expect(m.completion).toMatchObject({ num: 1, den: 1, pct: 100, lowData: true });
    expect(m.independentStart.pct).toBe(100);
    const ins = generateInsights(ds, null, { subjects: [], strategies: [] });
    expect(ins.some((i) => i.id === 'lowdata')).toBe(true);
  });

  it('excludes missing values from denominators (never as zeros)', () => {
    const ds = {
      ...emptyDataset(),
      observations: [obs('o1', '2026-10-01', { engagement: 'active' }), obs('o2', '2026-10-02', { engagement: 'not_observed' }), obs('o3', '2026-10-03')],
      tasks: [
        task('a', 'o1', '2026-10-01', { result: 'full', support: 'verbal', participation: 'active' }),
        task('b', 'o1', '2026-10-01', { result: null, support: null, participation: null }),
        task('c', 'o2', '2026-10-02', { result: 'not_done', support: 'none', participation: 'none' }),
        task('d', 'o3', '2026-10-03', { result: 'partial', support: 'none', participation: 'partial' }),
      ],
    };
    const m = computeMetrics(ds);
    expect(m.completion).toMatchObject({ num: 1, den: 3 });
    expect(m.completionAny).toMatchObject({ num: 2, den: 3 });
    expect(m.independence).toMatchObject({ num: 2, den: 3 });
    expect(m.participation).toMatchObject({ num: 2, den: 3 });
    expect(m.engagement).toMatchObject({ num: 1, den: 1 });
  });

  it('zero tasks gives null percentages, not 0%', () => {
    const m = computeMetrics({ ...emptyDataset(), observations: [obs('o1', '2026-10-01')] });
    expect(m.tasks).toBe(0);
    expect(m.completion.pct).toBeNull();
    expect(m.participation.pct).toBeNull();
  });

  it('ignores drafts', () => {
    const m = computeMetrics({ ...emptyDataset(), observations: [obs('o1', '2026-10-01', { status: 'draft' })] });
    expect(m.lessons).toBe(0);
  });

  it('does not mix units', () => {
    const m = computeMetrics({
      ...emptyDataset(),
      observations: [obs('o1', '2026-10-01')],
      tasks: [
        task('a', 'o1', '2026-10-01', { offered: 5, completed: 3, unit: 'слів' }),
        task('b', 'o1', '2026-10-01', { offered: 10, completed: 10, unit: 'прикладів' }),
        task('c', 'o1', '2026-10-01', { offered: 5, completed: 5, unit: 'слів' }),
      ],
    });
    const words = m.volumeByUnit.find((u) => u.unit === 'слів')!;
    expect(words).toMatchObject({ offered: 10, completed: 8, tasks: 2 });
    expect(m.volumeByUnit).toHaveLength(2);
  });

  it('counts repeated events', () => {
    const m = computeMetrics({
      ...emptyDataset(),
      observations: [obs('o1', '2026-10-01', { behaviors: ['distracted', 'calm'] }), obs('o2', '2026-10-02', { behaviors: ['distracted'] })],
    });
    expect(m.behaviorCounts.get('distracted')).toBe(2);
    expect(m.behaviorCounts.get('calm')).toBe(1);
  });

  it('subjects and periods', () => {
    const ds = {
      ...emptyDataset(),
      observations: [obs('o1', '2026-10-01', { subjectId: 'w' }), obs('o2', '2026-10-08', { subjectId: 'm' })],
      tasks: [task('a', 'o1', '2026-10-01', { result: 'full', subjectId: 'w' }), task('b', 'o2', '2026-10-08', { result: 'not_done', subjectId: 'm' })],
    };
    const rows = bySubject(ds, [subj('w', 'Письмо'), subj('m', 'Математика'), subj('x', 'Порожній')]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.subjectId === 'w')!.completion.pct).toBe(100);
    expect(rows.find((r) => r.subjectId === 'm')!.completion.pct).toBe(0);
    const series = timeSeries(ds, { from: '2026-10-01', to: '2026-10-08' });
    expect(series).toHaveLength(8);
    expect(series[1].completion).toBeNull(); // no data → null, not zero
    expect(series[0].completion).toBe(100);
    const hm = heatmap(ds, 'completion');
    expect(hm.size).toBe(2);
    expect(hm.get('2026-10-02')).toBeUndefined();
  });

  it('period helpers', () => {
    const ref = new Date(2026, 10, 18); // 18 Nov 2026
    expect(periodRange('last7', undefined, ref)).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    expect(periodRange('year', undefined, ref)).toEqual({ from: '2026-09-01', to: '2027-05-31' });
    expect(periodRange('semester', undefined, new Date(2027, 1, 3))).toEqual({ from: '2027-01-01', to: '2027-05-31' });
    expect(previousRange({ from: '2026-11-12', to: '2026-11-18' })).toEqual({ from: '2026-11-05', to: '2026-11-11' });
  });

  it('ratio denominators', () => {
    expect(ratio(0, 0).pct).toBeNull();
    expect(ratio(1, 3).pct).toBe(33);
    expect(ratio(6, 8)).toMatchObject({ pct: 75, lowData: false });
  });

  it('insight compares periods with correct counts', () => {
    const cur = { ...emptyDataset(), observations: ['1', '2', '3', '4'].map((i) => obs(`c${i}`, '2026-11-1' + i, { taskStart: 'independent' })) };
    const prev = { ...emptyDataset(), observations: ['1', '2', '3'].map((i) => obs(`p${i}`, '2026-11-0' + i, { taskStart: i === '1' ? 'independent' : 'after_model' })) };
    const ins = generateInsights(cur, prev, { subjects: [], strategies: [] });
    const up = ins.find((i) => i.id === 'start-up');
    expect(up?.text).toContain('4 проти 1');
  });
});
