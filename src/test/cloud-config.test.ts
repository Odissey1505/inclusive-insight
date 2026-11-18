import { describe, it, expect } from 'vitest';
import { looksLikeSecretKey, normalizeSupabaseUrl, parseCloudConfig } from '../cloud/config';
import { SPEC_BY_LOCAL, toRemote, fromRemote, sameContent, stableUuid } from '../cloud/tables';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Placeholder values only — never real project data in tests.
const URL_OK = 'https://example-project.supabase.co';
const KEY_OK = 'sb_publishable_test_placeholder_key';
const ANON_JWT = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon' })}.sig`;
const SERVICE_JWT = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role' })}.sig`;

describe('cloud configuration', () => {
  it('refuses secret and service_role keys, accepts publishable/anon keys', () => {
    expect(looksLikeSecretKey('sb_secret_abc123')).toBe(true);
    expect(looksLikeSecretKey(SERVICE_JWT)).toBe(true);
    expect(looksLikeSecretKey(ANON_JWT)).toBe(false);
    expect(looksLikeSecretKey('sb_publishable_abc123')).toBe(false);
  });

  it('normalizes the project URL copied with /rest/v1/', () => {
    expect(normalizeSupabaseUrl('https://abc.supabase.co/rest/v1/')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl(' https://abc.supabase.co/ ')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl('https://abc.supabase.co/auth/v1')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl(undefined)).toBe('');
  });

  it('valid configuration → cloud mode', () => {
    const c = parseCloudConfig({ VITE_SUPABASE_URL: URL_OK + '/rest/v1/', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK });
    expect(c).toEqual({ url: URL_OK, key: KEY_OK, enabled: true, configured: true, problem: null });
  });

  it('legacy anon key is accepted as a fallback variable', () => {
    const c = parseCloudConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: ANON_JWT });
    expect(c.enabled).toBe(true);
    expect(c.key).toBe(ANON_JWT);
  });

  it('no configuration → local mode without an error', () => {
    for (const env of [{}, { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }, { VITE_SUPABASE_URL: '  ' }]) {
      const c = parseCloudConfig(env);
      expect(c.enabled).toBe(false);
      expect(c.configured).toBe(false);
      expect(c.problem).toBeNull();
    }
  });

  it('incomplete or invalid configuration → local mode with a readable problem', () => {
    const onlyUrl = parseCloudConfig({ VITE_SUPABASE_URL: URL_OK });
    expect(onlyUrl.enabled).toBe(false);
    expect(onlyUrl.problem).toMatch(/лише одну/);
    const onlyKey = parseCloudConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK });
    expect(onlyKey.enabled).toBe(false);
    expect(onlyKey.problem).toMatch(/лише одну/);
    const badUrl = parseCloudConfig({ VITE_SUPABASE_URL: 'http://example-project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK });
    expect(badUrl.enabled).toBe(false);
    expect(badUrl.problem).toMatch(/https/);
  });

  it('a secret key never enables the cloud', () => {
    for (const key of ['sb_secret_abcdefghijklmnop', SERVICE_JWT]) {
      const c = parseCloudConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: key });
      expect(c.enabled).toBe(false);
      expect(c.problem).toMatch(/секретний/);
    }
  });

  it('localhost is allowed for development', () => {
    expect(parseCloudConfig({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }).enabled).toBe(true);
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
