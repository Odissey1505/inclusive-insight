/** Cloud & synchronization UI (Inclusive Insight 1.1). */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Cloud, CloudOff, CloudAlert, RefreshCw, LogOut, Download, UploadCloud, AlertTriangle, Check, GitMerge, Loader2, KeyRound, FileClock,
} from 'lucide-react';
import { db } from '../../db/database';
import { useApp, useSession } from '../../hooks/useApp';
import { useSyncStatus } from '../../hooks/useSync';
import {
  refresh, listConflicts, resolveKeepLocal, resolveTakeRemote, listFailed, retryFailed, discardFailed, unsentFor, waitForIdle, schedulePush,
} from '../../cloud/sync';
import { findLegacyProfiles, importLegacyProfile, verifyImport, TABLE_LABELS, type LegacyProfile } from '../../cloud/migration';
import { updatePassword } from '../../cloud/auth';
import { cloudConfig } from '../../cloud/config';
import { buildBackup } from '../../services/backup';
import { usersRepo, type OwnerTable } from '../../db/repositories';
import { Badge, Button, Card, Input, Modal, Toggle } from '../ui';
import { useConfirm, useToast } from '../ui/feedback';
import { cn, downloadBlob, safeFileName } from '../../lib/utils';
import type { ConflictEntry, OutboxEntry } from '../../cloud/types';

const fmtTime = (t: number | null) => (t ? new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const ENTITY: Record<string, string> = {
  students: 'Учень', subjects: 'Предмет', lessons: 'Урок', observations: 'Спостереження', tasks: 'Завдання', events: 'Подія',
  strategies: 'Стратегія', strategyUses: 'Застосування стратегії', iepGoals: 'Ціль ІПР', iepMeasurements: 'Вимірювання ІПР',
  achievements: 'Досягнення', templates: 'Шаблон',
};

/* ------------------------------------------------------------------ */
/* Header indicator                                                    */
/* ------------------------------------------------------------------ */

export function SyncIndicator() {
  const { mode } = useApp();
  const s = useSyncStatus();
  const [conflictsOpen, setConflictsOpen] = useState(false);
  if (mode !== 'cloud') return null;
  let tone = 'text-mint-dark dark:text-mint';
  let icon: ReactNode = <Cloud className="h-4 w-4" />;
  let label = 'Збережено у хмарі';
  if (s.conflicts) {
    tone = 'text-coral-dark';
    icon = <GitMerge className="h-4 w-4" />;
    label = `Конфлікти: ${s.conflicts}`;
  } else if (s.authExpired) {
    tone = 'text-coral-dark';
    icon = <CloudAlert className="h-4 w-4" />;
    label = 'Потрібен повторний вхід';
  } else if (!s.online || s.connection === 'offline') {
    tone = 'text-sun-dark';
    icon = <CloudOff className="h-4 w-4" />;
    label = s.pending ? `Офлайн · ${s.pending} у черзі` : 'Офлайн';
  } else if (s.failed || s.connection === 'error') {
    tone = 'text-coral-dark';
    icon = <CloudAlert className="h-4 w-4" />;
    label = s.failed ? `Помилка синхронізації · ${s.failed}` : 'Помилка з’єднання';
  } else if (s.busy !== 'idle' || s.pending) {
    tone = 'text-primary-dark';
    icon = <Loader2 className="h-4 w-4 animate-spin" />;
    label = s.busy === 'pulling' ? 'Оновлення…' : `Зберігається${s.pending ? ` · ${s.pending}` : ''}…`;
  }
  const common = cn('focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-card px-2.5 text-xs font-semibold', tone);
  return (
    <>
      {s.conflicts ? (
        <button className={common} onClick={() => setConflictsOpen(true)} title={label} aria-label={label}>{icon}<span className="hidden md:inline">{label}</span></button>
      ) : (
        <Link to="/settings#cloud" className={common} title={label} aria-label={`Синхронізація: ${label}`} role="status">{icon}<span className="hidden md:inline">{label}</span></Link>
      )}
      <ConflictCenter open={conflictsOpen} onClose={() => setConflictsOpen(false)} />
    </>
  );
}

/** Banners shown above every page: expired session, conflicts, local 1.0 data to import. */
export function CloudBanners() {
  const { mode, user, logout } = useApp();
  const s = useSyncStatus();
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const legacy = useLiveQuery(() => (mode === 'cloud' && user ? findLegacyProfiles(user.id) : Promise.resolve([])), [mode, user?.id]) ?? [];
  const dismissed = useLiveQuery(() => db.settings.get('app').then((a) => !!(a as any)?.legacyBannerDismissed), []) ?? true;
  if (mode !== 'cloud' || !user) return null;
  const notImported = legacy.filter((l) => !l.importedTo.some((x) => x.uid === user.id));
  return (
    <div className="mb-4 space-y-2 empty:hidden">
      {s.authExpired && (
        <Banner tone="coral" icon={<KeyRound className="h-5 w-5" />} action={<Button size="sm" onClick={() => logout()}>Увійти знову</Button>}>
          Сесія завершилась. Зміни збережено на пристрої й буде надіслано після повторного входу.
        </Banner>
      )}
      {s.conflicts > 0 && (
        <Banner tone="coral" icon={<GitMerge className="h-5 w-5" />} action={<Button size="sm" onClick={() => setConflictsOpen(true)}>Переглянути</Button>}>
          Деякі записи змінено на іншому пристрої одночасно з вашими змінами ({s.conflicts}). Оберіть, яку версію залишити.
        </Banner>
      )}
      {notImported.length > 0 && !dismissed && (
        <Banner tone="blue" icon={<UploadCloud className="h-5 w-5" />}
          action={<div className="flex gap-2"><Button size="sm" onClick={() => setImportOpen(true)}>Перенести</Button>
            <Button size="sm" variant="ghost" onClick={() => db.settings.get('app').then((a) => db.settings.put({ ...(a ?? { id: 'app' }), legacyBannerDismissed: true } as any))}>Пізніше</Button></div>}>
          На цьому пристрої є записи з версії 1.0 ({notImported.map((l) => l.user.name).join(', ')}). Їх можна перенести у ваш хмарний акаунт.
        </Banner>
      )}
      <ConflictCenter open={conflictsOpen} onClose={() => setConflictsOpen(false)} />
      <LegacyImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function Banner({ tone, icon, children, action }: { tone: 'coral' | 'blue' | 'sun'; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  const tones = { coral: 'bg-coral-soft text-coral-dark', blue: 'bg-primary-soft text-primary-dark', sun: 'bg-sun-soft text-sun-dark' };
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl p-3 text-sm sm:flex-row sm:items-center', tones[tone])} role="status">
      <span className="flex flex-1 items-start gap-2.5">{icon}<span className="text-ink">{children}</span></span>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

const SKIP_FIELDS = new Set(['id', 'ownerId', 'createdAt', 'updatedAt']);
function short(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function diff(a: Record<string, unknown> | null, b: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].filter((k) => !SKIP_FIELDS.has(k) && JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null));
}
function titleOf(c: ConflictEntry) {
  const d = (c.local ?? c.remote?.data ?? {}) as Record<string, any>;
  return d.name || d.title || d.topic || (d.date ? `від ${d.date}` : c.rowId.slice(0, 8));
}

export function ConflictCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSyncStatus();
  const [items, setItems] = useState<ConflictEntry[]>([]);
  const toast = useToast();
  useEffect(() => {
    if (open) void listConflicts().then(setItems);
  }, [open, s.conflicts]);
  const act = async (fn: (k: string) => Promise<void>, key: string, msg: string) => {
    await fn(key);
    setItems(await listConflicts());
    toast(msg);
  };
  return (
    <Modal open={open} onClose={onClose} title="Конфлікти синхронізації" size="lg">
      {items.length === 0 ? <p className="text-sm text-muted">Конфліктів немає.</p> : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Ці записи змінено на іншому пристрої, поки на цьому пристрої були незбережені в хмарі зміни. Нічого не перезаписано автоматично.</p>
          {items.map((c) => {
            const fields = c.kind === 'modified' ? diff(c.local, c.remote?.data ?? null) : [];
            return (
              <article key={c.key} className="rounded-2xl border border-line p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="gray">{ENTITY[c.table] ?? c.table}</Badge>
                  <b className="text-sm">{titleOf(c)}</b>
                </div>
                {c.kind === 'modified' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead><tr className="text-muted"><th className="py-1 pr-2">Поле</th><th className="py-1 pr-2">На цьому пристрої</th><th className="py-1">У хмарі</th></tr></thead>
                      <tbody>{fields.slice(0, 12).map((f) => (
                        <tr key={f} className="border-t border-line align-top"><td className="py-1 pr-2 font-semibold">{f}</td>
                          <td className="py-1 pr-2">{short(c.local?.[f])}</td><td className="py-1">{short(c.remote?.data?.[f])}</td></tr>
                      ))}</tbody>
                    </table>
                    {fields.length === 0 && <p className="text-xs text-muted">Відрізняються лише службові поля.</p>}
                  </div>
                )}
                {c.kind === 'remote-deleted' && <p className="text-sm">Запис <b>видалено на іншому пристрої</b>, а тут його змінено.</p>}
                {c.kind === 'local-delete' && <p className="text-sm">Ви видалили запис, але на іншому пристрої його тим часом <b>змінили</b>.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => act(resolveKeepLocal, c.key, 'Залишено версію з цього пристрою')}>
                    {c.kind === 'remote-deleted' ? 'Відновити мою версію' : c.kind === 'local-delete' ? 'Все одно видалити' : 'Залишити мою версію'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => act(resolveTakeRemote, c.key, 'Застосовано версію з хмари')}>
                    {c.kind === 'remote-deleted' ? 'Погодитися з видаленням' : 'Взяти версію з хмари'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Sign out                                                            */
/* ------------------------------------------------------------------ */

export function LogoutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useSession();
  const [unsent, setUnsent] = useState(0);
  const [clearLocal, setClearLocal] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) void unsentFor(user.id).then((n) => {
      setUnsent(n);
      setClearLocal(n === 0);
    });
  }, [open, user.id]);
  return (
    <Modal open={open} onClose={onClose} title="Вийти з акаунта?" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button>
        <Button loading={busy} icon={<LogOut className="h-4 w-4" />} onClick={async () => { setBusy(true); await logout({ clearLocal }); setBusy(false); onClose(); }}>Вийти</Button></>}>
      <div className="space-y-3 text-sm">
        {unsent > 0 && (
          <p className="flex gap-2 rounded-2xl bg-sun-soft p-3"><AlertTriangle className="h-5 w-5 shrink-0 text-sun-dark" />
            <span>Є {unsent} не надісланих у хмару змін або конфліктів. Якщо видалити локальну копію, їх буде втрачено. Рекомендуємо спершу підключитися до інтернету.</span></p>
        )}
        <Toggle checked={clearLocal} onChange={setClearLocal} label="Видалити копію даних з цього пристрою"
          description="Рекомендовано на спільному комп’ютері. Дані в хмарі не зміняться; після входу їх буде завантажено знову." />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* New password after a recovery e-mail                                */
/* ------------------------------------------------------------------ */

export function PasswordRecoveryModal() {
  const { mode, recoveryMode, setRecoveryMode, user } = useApp();
  const toast = useToast();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (mode !== 'cloud' || !user) return null;
  const save = async () => {
    setErr('');
    if (p1.length < 8) return setErr('Пароль має містити щонайменше 8 символів.');
    if (p1 !== p2) return setErr('Паролі не збігаються.');
    setBusy(true);
    try {
      await updatePassword(p1);
      toast('Пароль змінено');
      setRecoveryMode(false);
      setP1(''); setP2('');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Modal open={recoveryMode} onClose={() => setRecoveryMode(false)} title="Новий пароль" size="sm"
      footer={<><Button variant="secondary" onClick={() => setRecoveryMode(false)}>Пізніше</Button><Button loading={busy} onClick={save}>Зберегти пароль</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Input label="Новий пароль" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
        <Input label="Повторіть пароль" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
        {err && <p className="text-sm text-coral-dark" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Import of local 1.0 records                                         */
/* ------------------------------------------------------------------ */

export function LegacyImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const s = useSyncStatus();
  const [list, setList] = useState<LegacyProfile[] | null>(null);
  const [pick, setPick] = useState<string>('');
  const [includeDemo, setIncludeDemo] = useState(false);
  const [backupDone, setBackupDone] = useState(false);
  const [phase, setPhase] = useState<'choose' | 'running' | 'done'>('choose');
  const [report, setReport] = useState<{ copied: number; skipped: number; ok: boolean; missing: number; pending: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('choose'); setReport(null); setBackupDone(false); setIncludeDemo(false);
    void findLegacyProfiles(user.id).then((l) => { setList(l); setPick(l[0]?.user.id ?? ''); });
  }, [open, user.id]);

  const sel = list?.find((l) => l.user.id === pick);
  const tables = (Object.keys(TABLE_LABELS) as OwnerTable[]).filter((t) => (sel?.counts[t] ?? 0) + (includeDemo ? sel?.demoCounts[t] ?? 0 : 0) > 0);

  const backup = async () => {
    if (!sel) return;
    const b = await buildBackup(sel.user.id);
    downloadBlob(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), `inclusive-insight-local-backup_${safeFileName(sel.user.name)}_${new Date().toISOString().slice(0, 10)}.json`);
    setBackupDone(true);
  };

  const run = async () => {
    if (!sel) return;
    const n = sel.total + (includeDemo ? sel.demoTotal : 0);
    if (!(await confirm({ title: `Перенести ${n} записів у хмару?`, text: 'Записи буде скопійовано у ваш акаунт. Локальні записи залишаться на пристрої, доки ви окремо не видалите їх.', confirmLabel: 'Перенести' }))) return;
    setPhase('running');
    try {
      const r = await importLegacyProfile(sel.user.id, user.id, { includeDemo });
      schedulePush(0);
      const state = await waitForIdle(120000);
      await refresh();
      const v = await verifyImport(user.id, r.idMap);
      setReport({ copied: Object.values(r.copied).reduce((a, b) => a + (b ?? 0), 0), skipped: r.skippedExisting, ok: v.ok, missing: v.missing, pending: state !== 'cloud' });
      setPhase('done');
    } catch (e) {
      toast('Перенесення не вдалося: ' + (e as Error).message, 'error');
      setPhase('choose');
    }
  };

  const removeLocal = async () => {
    if (!sel) return;
    if (await confirm({ title: `Видалити локальний профіль «${sel.user.name}»?`, text: 'Буде видалено локальні записи версії 1.0 з цього пристрою. Хмарні копії не зміняться.', danger: true, confirmLabel: 'Видалити локальні записи', requireText: sel.user.name })) {
      await usersRepo.remove(sel.user.id);
      toast('Локальні записи видалено');
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={phase === 'running' ? () => undefined : onClose} title="Перенесення локальних записів у хмару" size="md"
      footer={phase === 'choose' ? <><Button variant="secondary" onClick={onClose}>Скасувати</Button>
        <Button disabled={!sel || !s.online} icon={<UploadCloud className="h-4 w-4" />} onClick={run}>Перенести</Button></>
        : phase === 'done' ? <><Button variant="ghost" className="text-coral-dark" onClick={removeLocal}>Видалити локальні записи…</Button><Button onClick={onClose}>Готово</Button></> : undefined}>
      {list === null ? <p className="text-sm text-muted">Пошук локальних записів…</p> : list.length === 0 ? (
        <p className="text-sm text-muted">На цьому пристрої немає локальних записів версії 1.0.</p>
      ) : phase === 'running' ? (
        <div className="flex items-center gap-3 py-6 text-sm"><Loader2 className="h-5 w-5 animate-spin text-primary" />Копіювання та надсилання в хмару… ({s.pending} у черзі). Не закривайте сторінку.</div>
      ) : phase === 'done' && report ? (
        <div className="space-y-3 text-sm">
          <p className={cn('flex items-center gap-2 font-semibold', report.ok ? 'text-mint-dark' : 'text-sun-dark')}>
            {report.ok ? <Check className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            {report.ok ? 'Перенесення завершено й перевірено.' : report.pending ? 'Записи скопійовано, частина ще очікує надсилання — синхронізація продовжиться автоматично.' : `Не підтверджено ${report.missing} записів — перевірте розділ «Хмара».`}
          </p>
          <p>Скопійовано: <b>{report.copied}</b>{report.skipped ? <> · уже були перенесені раніше: <b>{report.skipped}</b></> : null}</p>
          <p className="text-muted">Локальні записи версії 1.0 залишились на пристрої. Видаліть їх, лише якщо впевнені, що все на місці.</p>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {list.length > 1 && (
            <div className="space-y-1">{list.map((l) => (
              <label key={l.user.id} className="flex items-center gap-2"><input type="radio" checked={pick === l.user.id} onChange={() => setPick(l.user.id)} />
                {l.user.avatar} <b>{l.user.name}</b> <span className="text-muted">· {l.total} записів</span></label>
            ))}</div>
          )}
          {sel && (
            <>
              {sel.importedTo.some((x) => x.uid === user.id) && <p className="rounded-xl bg-primary-soft p-2.5 text-primary-dark">Цей профіль уже переносився. Повторне перенесення не створить дублікатів — буде додано лише нові записи.</p>}
              <div className="rounded-2xl border border-line">
                <table className="w-full text-left text-sm"><tbody>
                  {tables.map((t) => (
                    <tr key={t} className="border-b border-line last:border-0"><td className="px-3 py-1.5">{TABLE_LABELS[t]}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{(sel.counts[t] ?? 0) + (includeDemo ? sel.demoCounts[t] ?? 0 : 0)}</td></tr>
                  ))}
                </tbody></table>
              </div>
              <p className="text-xs text-muted">Предмети та стратегії з однаковими назвами об’єднуються з вашими. Зв’язки між учнями, уроками, завданнями, стратегіями й цілями зберігаються.</p>
              {sel.demoTotal > 0 && <Toggle checked={includeDemo} onChange={setIncludeDemo} label={`Також перенести демонстраційні дані (${sel.demoTotal})`} description="За замовчуванням демодані залишаються лише на цьому пристрої." />}
              <div className="flex items-center gap-2 rounded-2xl bg-bg p-3">
                <span className="flex-1">Перед перенесенням рекомендуємо зберегти резервну копію локальних записів.</span>
                <Button size="sm" variant="secondary" icon={backupDone ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />} onClick={backup}>{backupDone ? 'Збережено' : 'Резервна копія'}</Button>
              </div>
              {!s.online && <p className="text-coral-dark">Немає інтернету — перенесення стане доступним після підключення.</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Settings → Cloud & Synchronization                                  */
/* ------------------------------------------------------------------ */

export function CloudSettings({ onExportBackup }: { onExportBackup: () => void }) {
  const { user, email } = useSession();
  const s = useSyncStatus();
  const toast = useToast();
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const drafts = useLiveQuery(() => db.drafts.where('ownerId').equals(user.id).count(), [user.id]) ?? 0;
  const legacy = useLiveQuery(() => findLegacyProfiles(user.id), [user.id]) ?? [];
  const failed = useLiveQuery(() => listFailed(), [user.id, s.failed]) ?? [];
  const host = (() => { try { return new URL(cloudConfig.url).host; } catch { return '—'; } })();

  const connection = !s.online || s.connection === 'offline' ? <Badge tone="sun">офлайн</Badge>
    : s.connection === 'error' ? <Badge tone="coral">помилка</Badge>
    : s.connection === 'ok' ? <Badge tone="mint">підключено</Badge> : <Badge tone="gray">перевірка…</Badge>;
  const realtime = s.realtime === 'on' ? <Badge tone="mint">увімкнено</Badge> : s.realtime === 'connecting' ? <Badge tone="gray">підключення…</Badge>
    : s.realtime === 'error' ? <Badge tone="sun">недоступно — оновлення при поверненні до додатка</Badge> : <Badge tone="gray">вимкнено</Badge>;

  return (
    <Card title="Хмара та синхронізація" subtitle="Supabase · дані доступні на всіх ваших пристроях після входу">
      <div id="cloud" className="scroll-mt-32" />
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row k="Акаунт">{email ?? '—'}</Row>
        <Row k="Авторизація">{s.authExpired ? <Badge tone="coral">сесія завершилась</Badge> : <Badge tone="mint">виконано вхід</Badge>}</Row>
        <Row k="Сервер">{host}</Row>
        <Row k="Підключення">{connection}</Row>
        <Row k="Миттєве оновлення (Realtime)">{realtime}</Row>
        <Row k="Останнє оновлення з хмари">{fmtTime(s.lastPullAt)}{!s.pullComplete && s.lastPullAt ? <Badge tone="sun" className="ml-1">частково</Badge> : null}</Row>
        <Row k="Не надіслано змін">{s.pending ? <Badge tone="sun">{s.pending}</Badge> : <Badge tone="mint">0</Badge>}</Row>
        <Row k="Локальні чернетки форм">{drafts ? <span className="inline-flex items-center gap-1"><FileClock className="h-4 w-4 text-muted" />{drafts} — лише на цьому пристрої</span> : '0'}</Row>
      </dl>
      {s.lastError && <p className="mt-3 rounded-xl bg-coral-soft p-2.5 text-sm text-coral-dark" role="alert">{s.lastError}</p>}
      {s.failedTables.length > 0 && <p className="mt-2 text-sm text-sun-dark">Не вдалося завантажити: {s.failedTables.map((t) => TABLE_LABELS[t as OwnerTable] ?? t).join(', ')}.</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button icon={<RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />} disabled={refreshing || !s.online} onClick={async () => {
          setRefreshing(true); await refresh(); schedulePush(0); setRefreshing(false);
          const st = (await import('../../cloud/sync')).syncStore.get();
          toast(st.pullComplete ? 'Дані оновлено з хмари' : 'Не вдалося оновити всі дані', st.pullComplete ? 'success' : 'error');
        }}>Оновити дані</Button>
        <Button variant="secondary" icon={<UploadCloud className="h-4 w-4" />} disabled={legacy.length === 0} onClick={() => setImportOpen(true)}>
          Імпортувати локальні записи{legacy.length ? ` (${legacy.length})` : ''}
        </Button>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={onExportBackup}>Експортувати резервну копію</Button>
        {s.conflicts > 0 && <Button variant="secondary" icon={<GitMerge className="h-4 w-4" />} onClick={() => setConflictsOpen(true)}>Конфлікти ({s.conflicts})</Button>}
        <Button variant="ghost" icon={<LogOut className="h-4 w-4" />} onClick={() => setLogoutOpen(true)}>Вийти з акаунта</Button>
      </div>

      {failed.length > 0 && <FailedList items={failed} />}

      <p className="mt-4 text-xs text-muted">
        Записи зберігаються в хмарі й кешуються на пристрої для швидкої роботи та офлайн-режиму. Без інтернету зміни потрапляють у чергу й надсилаються автоматично,
        щойно з’явиться з’єднання; якщо той самий запис змінено на іншому пристрої, з’явиться запит на вибір версії. Демодані не синхронізуються.
      </p>
      <ConflictCenter open={conflictsOpen} onClose={() => setConflictsOpen(false)} />
      <LogoutDialog open={logoutOpen} onClose={() => setLogoutOpen(false)} />
      <LegacyImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </Card>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5"><dt className="text-muted">{k}</dt><dd className="font-semibold">{children}</dd></div>;
}

function FailedList({ items }: { items: OutboxEntry[] }) {
  const confirm = useConfirm();
  return (
    <div className="mt-4 rounded-2xl border border-coral/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <b className="text-sm text-coral-dark">Зміни, які не вдалося надіслати ({items.length})</b>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => retryFailed()}>Повторити всі</Button>
      </div>
      <ul className="divide-y divide-line text-sm">
        {items.slice(0, 20).map((e) => (
          <li key={e.seq} className="flex items-start gap-2 py-1.5">
            <span className="flex-1"><b>{ENTITY[e.table] ?? e.table}</b> · {e.op === 'delete' ? 'видалення' : 'збереження'}<span className="block text-xs text-muted">{e.lastError}</span></span>
            <Button size="sm" variant="ghost" onClick={async () => {
              if (await confirm({ title: 'Відкинути цю зміну?', text: 'Зміну на цьому пристрої буде скасовано, запис відновиться з хмари.', danger: true, confirmLabel: 'Відкинути' })) await discardFailed(e.seq!);
            }}>Відкинути</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Toast after an explicit save: tells honestly whether the record reached the cloud. */
export function useCloudSaveFeedback() {
  const { mode } = useApp();
  const toast = useToast();
  return (localText = 'Збережено') => {
    if (mode !== 'cloud') return toast(localText);
    void waitForIdle(6000).then((r) => {
      if (r === 'cloud') toast(`${localText} · у хмарі`);
      else if (r === 'pending') toast('Збережено на цьому пристрої. Буде надіслано в хмару, щойно з’явиться інтернет.', 'info');
      else if (r === 'error') toast('Збережено на пристрої, але не вдалося надіслати в хмару. Див. Налаштування → Хмара.', 'error');
      else toast(localText);
    });
  };
}
