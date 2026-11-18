import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { settingsRepo, usersRepo, bootstrapOwner } from '../db/repositories';
import type { Settings, Strategy, Student, Subject, UserProfile } from '../types/models';

interface AppState {
  ready: boolean;
  user: UserProfile | null;
  settings: Settings;
  students: Student[];
  student: Student | null;
  subjects: Subject[];
  visibleSubjects: Subject[];
  strategies: Strategy[];
  login: (id: string) => Promise<void>;
  logout: () => Promise<void>;
  setStudent: (id: string | null) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  subjectName: (id?: string | null) => string;
  subjectColor: (id?: string | null) => string;
}

const Ctx = createContext<AppState | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** Same as useApp but asserts a logged-in user (for pages behind the welcome screen). */
export function useSession() {
  const a = useApp();
  return a as AppState & { user: UserProfile };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const app = await settingsRepo.getApp();
      const id = app.lastUserId && (await db.users.get(app.lastUserId)) ? app.lastUserId : null;
      if (id) await bootstrapOwner(id);
      setUserId(id);
    })().catch(() => setUserId(null));
  }, []);

  const user = useLiveQuery(() => (userId ? db.users.get(userId) : undefined), [userId]) ?? null;
  const settings = useLiveQuery(() => (userId ? settingsRepo.getUser(userId) : Promise.resolve({ id: 'none' } as Settings)), [userId]) ?? ({ id: 'none' } as Settings);
  const students = useLiveQuery(() => (userId ? db.students.where('ownerId').equals(userId).toArray() : []), [userId]) ?? [];
  const subjects = useLiveQuery(async () => (userId ? (await db.subjects.where('ownerId').equals(userId).toArray()).sort((a, b) => a.order - b.order) : []), [userId]) ?? [];
  const strategies = useLiveQuery(() => (userId ? db.strategies.where('ownerId').equals(userId).toArray() : []), [userId]) ?? [];

  const activeStudents = students.filter((s) => !s.archived);
  const student = activeStudents.find((s) => s.id === settings.activeStudentId) ?? activeStudents.find((s) => !s.isDemo) ?? activeStudents[0] ?? null;

  // Theme / compact / motion
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.theme ?? 'light';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply();
    root.classList.toggle('compact', !!settings.compact);
    root.classList.toggle('reduce-motion', settings.animations === false);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, settings.compact, settings.animations]);

  const login = useCallback(async (id: string) => {
    await bootstrapOwner(id);
    await usersRepo.touch(id);
    setUserId(id);
  }, []);
  const logout = useCallback(async () => {
    await settingsRepo.setApp({ lastUserId: null });
    setUserId(null);
  }, []);
  const setStudent = useCallback(async (id: string | null) => {
    if (userId) await settingsRepo.setUser(userId, { activeStudentId: id });
  }, [userId]);
  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    if (userId) await settingsRepo.setUser(userId, patch);
  }, [userId]);

  const value = useMemo<AppState>(() => ({
    ready: userId !== undefined && (!userId || !!user),
    user, settings, students, student, subjects, strategies,
    visibleSubjects: subjects.filter((s) => !s.hidden),
    login, logout, setStudent, updateSettings,
    subjectName: (id) => subjects.find((s) => s.id === id)?.name ?? '—',
    subjectColor: (id) => subjects.find((s) => s.id === id)?.color ?? '#A0AEC0',
  }), [userId, user, settings, students, student, subjects, strategies, login, logout, setStudent, updateSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
