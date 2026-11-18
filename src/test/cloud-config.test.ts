import { describe, it, expect } from 'vitest';
import { looksLikeSecretKey, normalizeSupabaseUrl, cloudConfig } from '../cloud/config';
import { SPEC_BY_LOCAL, toRemote, fromRemote, sameContent, stableUuid } from '../cloud/tables';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('cloud configuration', () => {
  it('refuses secret and service_role keys, accepts publishable/anon keys', () => {
    expect(looksLikeSecretKey('sb_secret_abc123')).toBe(true);
    expect(looksLikeSecretKey(`${b64({ alg: 'HS256' })}.${b64({ role: 'service_role' })}.sig`)).toBe(true);
    expect(looksLikeSecretKey(`${b64({ alg: 'HS256' })}.${b64({ role: 'anon' })}.sig`)).toBe(false);
    expect(looksLikeSecretKey('sb_publishable_abc123')).toBe(false);
  });
  it('normalizes the project URL copied with /rest/v1/', () => {
    expect(normalizeSupabaseUrl('https://abc.supabase.co/rest/v1/')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl(' https://abc.supabase.co/ ')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl('https://abc.supabase.co/auth/v1')).toBe('https://abc.supabase.co');
  });
  it('the committed project configuration is valid', () => {
    expect(cloudConfig.problem).toBeNull();
    expect(cloudConfig.enabled).toBe(true);
    expect(cloudConfig.url).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  });
});

describe('table mapping', () => {
  it('keeps the record shape in data and extracts relation columns', () => {
    const uid = '00000000-0000-4000-8000-000000000001';
    const obs = { id: '00000000-0000-4000-8000-000000000002', ownerId: uid, isDemo: false, studentId: '00000000-0000-4000-8000-000000000003', lessonId: 'not-a-uuid', subjectId: '00000000-0000-4000-8000-000000000004', date: '2026-11-18', status: 'final', topic: 'Т', behaviors: ['calm'] };
    const row = toRemote(SPEC_BY_LOCAL.get('observations')!, uid, obs) as any;
    expect(row).toMatchObject({ id: obs.id, user_id: uid, student_id: obs.studentId, lesson_id: null, subject_id: obs.subjectId, date: '2026-11-18', status: 'final' });
    expect(row.data.ownerId).toBeUndefined();
    expect(row.data.isDemo).toBeUndefined();
    const back = fromRemote(uid, { id: obs.id, data: row.data });
    expect(back).toMatchObject({ id: obs.id, ownerId: uid, studentId: obs.studentId, lessonId: 'not-a-uuid', topic: 'Т', behaviors: ['calm'] });
  });
  it('content comparison ignores timestamps', () => {
    expect(sameContent({ a: 1, createdAt: 1, updatedAt: 2 }, { a: 1, createdAt: 5, updatedAt: 9 })).toBe(true);
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false);
  });
  it('stable UUIDs are deterministic and valid', async () => {
    const a = await stableUuid('x');
    expect(a).toBe(await stableUuid('x'));
    expect(a).not.toBe(await stableUuid('y'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
