import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Session } from '@supabase/supabase-js';
import { db } from '../db/database';
import { settingsRepo, usersRepo, bootstrapOwner } from '../db/repositories';
import type { Settings, Strategy, Student, Subject, UserProfile } from '../types/models';
import { cloudConfig } from '../cloud/config';
import { supabase } from '../cloud/supabase';
import { supabaseRemote } from '../cloud/remote';
import { initAuth, displayNameOf, signOut, type AuthNotice } from '../cloud/auth';
import { startSync, stopSync, clearLocalAccountData } from '../cloud/sync';
import { ensureLocalAccount, seedAccountDefaults } from '../cloud/account';
import { useSyncStatus } from './useSync';

interface AppState {
  ready: boolean;
  user: UserProfile | null;
  settings: Settings;
  students: Student[];
  student: Student | null;
  subjects: Subject[];
  visibleSubjects: Subject[];
  strategies: Strategy[];
  /** 'cloud' = Supabase account; 'local' = 1.0 workspaces (no Supabase config). */
  mode: 'cloud' | 'local';
  email: string | null;
  authNotice: AuthNotice;
  clearAuthNotice: () => void;
  recoveryMode: boolean;
  setRecoveryMode: (v: boolean) => void;
  login: (id: string) => Promise<void>;
  logout: (opts?: { clearLocal?: boolean }) => Promise<void>;
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
  const cloud = cloudConfig.enabled;
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null>(null);
  const [authNotice, setAuthNotice] = useState<AuthNotice>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const currentUid = useRef<string | null>(null);
  const activatingUid = useRef<string | null>(null);
  const signInScreenShown = useRef(false);
  const sync = useSyncStatus();

  // Local mode (1.0): remembered workspace.
  useEffect(() => {
    if (cloud) return;
    (async () => {
      const app = await settingsRepo.getApp();
      const id = app.lastUserId && (await db.users.get(app.lastUserId)) ? app.lastUserId : null;
      if (id) await bootstrapOwner(id);
      setUserId(id);
    })().catch(() => setUserId(null));
  }, [cloud]);

  // Cloud mode: Supabase session → local account → sync engine.
  useEffect(() => {
    if (!cloud) return;
    let alive = true;
    const activate = async (s: Session | null, explicitSignIn = false) => {
      if (!alive) return;
      const uid = s?.user?.id ?? null;
      setSession(s);
      if (uid === currentUid.current || (uid && uid === activatingUid.current)) {
        if (!uid) {
          signInScreenShown.current = true;
          setUserId(null);
        }
        return;
      }
      activatingUid.current = uid;
      stopSync();
      currentUid.current = null;
      setUserId(null); // unmount pages of the previous account first
      if (!uid) {
        signInScreenShown.current = true;
        return;
      }
      await ensureLocalAccount(uid, displayNameOf(s));
      if (!alive || activatingUid.current !== uid) return;
      // After an explicit sign-in from the welcome screen → Dashboard. A restored session keeps the current route.
      if (explicitSignIn && signInScreenShown.current && window.location.hash !== '#/') window.location.hash = '#/';
      signInScreenShown.current = false;
      activatingUid.current = null;
      currentUid.current = uid;
      setUserId(uid);
      void startSync(uid, supabaseRemote);
    };
    initAuth()
      .then(({ session: s, notice }) => {
        setAuthNotice(notice);
        if (notice?.kind === 'recovery') setRecoveryMode(true);
        return activate(s);
      })
      .catch(() => alive && setUserId(null));
    const { data } = supabase().auth.onAuthStateChange((event, s) => {
      // Defer: supabase-js recommends not awaiting other calls inside this callback.
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
        if (event === 'INITIAL_SESSION') return;
        void activate(s, event === 'SIGNED_IN');
      }, 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      stopSync();
    };
  }, [cloud]);

  // Default subjects/strategies are created only once the cloud copy is known.
  useEffect(() => {
    if (cloud && userId && sync.uid === userId && sync.initialPullDone) void seedAccountDefaults(userId);
  }, [cloud, userId, sync.uid, sync.initialPullDone]);

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
  const logout = useCallback(async (opts: { clearLocal?: boolean } = {}) => {
    const uid = userId;
    if (cloud) {
      stopSync(); // stop first: clearing the device copy must never delete anything in the cloud
      currentUid.current = null;
      signInScreenShown.current = true;
      try {
        await signOut();
      } catch {
        /* offline sign-out still clears the local session */
      }
      if (opts.clearLocal && uid) await clearLocalAccountData(uid);
      setSession(null);
    }
    await settingsRepo.setApp({ lastUserId: null });
    window.location.hash = '#/';
    setUserId(null);
  }, [cloud, userId]);
  const setStudent = useCallback(async (id: string | null) => {
    if (userId) await settingsRepo.setUser(userId, { activeStudentId: id });
  }, [userId]);
  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    if (userId) await settingsRepo.setUser(userId, patch);
  }, [userId]);

  const hasCache = subjects.length > 0;
  const cloudReady = !cloud || !userId || hasCache || sync.initialPullDone || sync.connection === 'offline' || sync.connection === 'error';
  const clearAuthNotice = useCallback(() => setAuthNotice(null), []);

  const value = useMemo<AppState>(() => ({
    ready: userId !== undefined && (!userId || !!user) && cloudReady,
    mode: cloud ? 'cloud' : 'local',
    email: session?.user?.email ?? null,
    authNotice, clearAuthNotice, recoveryMode, setRecoveryMode,
    user, settings, students, student, subjects, strategies,
    visibleSubjects: subjects.filter((s) => !s.hidden),
    login, logout, setStudent, updateSettings,
    subjectName: (id) => subjects.find((s) => s.id === id)?.name ?? '—',
    subjectColor: (id) => subjects.find((s) => s.id === id)?.color ?? '#A0AEC0',
  }), [userId, user, settings, students, student, subjects, strategies, login, logout, setStudent, updateSettings, cloud, cloudReady, session, authNotice, clearAuthNotice, recoveryMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
