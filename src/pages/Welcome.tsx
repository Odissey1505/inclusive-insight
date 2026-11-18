import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ShieldAlert, Plus, HardDrive, Cloud, Mail, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cloudConfig } from '../cloud/config';
import { signIn, signUp, requestPasswordReset } from '../cloud/auth';
import { db } from '../db/database';
import { usersRepo } from '../db/repositories';
import { useApp } from '../hooks/useApp';
import { Button, Modal, Segmented } from '../components/ui';
import { useToast } from '../components/ui/feedback';
import { fmtDate } from '../lib/utils';

export default function Welcome() {
  const { mode } = useApp();
  return mode === 'cloud' ? <CloudWelcome /> : <LocalWelcome />;
}

function Shell({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-mint/25 blur-3xl" />
      <div className="pointer-events-none absolute right-1/4 top-10 h-40 w-40 rounded-full bg-sun/30 blur-3xl" />
      <div className="animate-in relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-mint text-white shadow-lift">
            <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="8" r="3" fill="currentColor" stroke="none" /><path d="M6 19c1-4 3.5-6 6-6s5 2 6 6" /></svg>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">Inclusive Insight</h1>
          <p className="mt-1 font-medium italic text-muted">Your Inclusive Education Companion</p>
        </div>
        <div className="card p-6 sm:p-8">{children}</div>
        {footer}
      </div>
    </div>
  );
}

/* ------------------------- Cloud (Supabase Auth) ------------------------- */
function CloudWelcome() {
  const { authNotice, clearAuthNotice } = useApp();
  const [tab, setTab] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const go = (t: typeof tab) => { setTab(t); setError(''); setInfo(''); clearAuthNotice(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Введіть коректний email.');
    if (tab !== 'reset' && password.length < (tab === 'up' ? 8 : 1)) return setError(tab === 'up' ? 'Пароль має містити щонайменше 8 символів.' : 'Введіть пароль.');
    if (tab === 'up' && password !== password2) return setError('Паролі не збігаються.');
    if (tab === 'up' && name.trim().length < 2) return setError("Введіть ім'я (щонайменше 2 символи) — воно відображатиметься в інтерфейсі.");
    setBusy(true);
    try {
      if (tab === 'in') await signIn(email, password);
      else if (tab === 'up') {
        const needsConfirm = await signUp(email, password, name);
        if (needsConfirm) { setInfo('Акаунт створено. Ми надіслали лист для підтвердження email — перейдіть за посиланням у ньому, потім увійдіть.'); setTab('in'); setPassword(''); setPassword2(''); }
      } else {
        await requestPasswordReset(email);
        setInfo('Якщо такий акаунт існує, ми надіслали лист із посиланням для зміни пароля. Відкрийте його в цьому ж браузері.');
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <Shell footer={
      <p className="mt-5 flex items-start gap-2 px-2 text-xs text-muted">
        <Cloud className="mt-0.5 h-4 w-4 shrink-0" />
        Дані зберігаються у вашому захищеному акаунті Supabase і доступні на ноутбуці, телефоні й планшеті після входу. Для учнів використовуйте псевдоніми.
      </p>}>
      <p className="mb-5 text-center text-lg font-semibold">Вітаємо! Увійдіть до свого робочого простору</p>
      {tab !== 'reset' && (
        <Segmented className="mb-4 w-full [&>button]:flex-1" value={tab} onChange={(v) => go(v as 'in' | 'up')}
          options={[{ key: 'in', label: 'Увійти' }, { key: 'up', label: 'Зареєструватися' }]} />
      )}
      {authNotice && (
        <p className={'mb-4 flex gap-2 rounded-2xl p-3 text-sm ' + (authNotice.kind === 'error' ? 'bg-coral-soft text-coral-dark' : 'bg-mint-soft text-mint-dark')} role="status">
          {authNotice.kind === 'error' ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}<span className="text-ink">{authNotice.message}</span>
        </p>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        {tab === 'up' && (
          <div>
            <label htmlFor="name" className="label">Ваше ім'я</label>
            <input id="name" className="input h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="Наприклад: Олена" maxLength={60} autoComplete="given-name" />
          </div>
        )}
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoFocus className="input h-12 text-base" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@school.ua" autoComplete="email" inputMode="email" />
        </div>
        {tab !== 'reset' && (
          <div>
            <label htmlFor="password" className="label">Пароль</label>
            <input id="password" type="password" className="input h-12 text-base" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'up' ? 'new-password' : 'current-password'} />
          </div>
        )}
        {tab === 'up' && (
          <div>
            <label htmlFor="password2" className="label">Повторіть пароль</label>
            <input id="password2" type="password" className="input h-12 text-base" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </div>
        )}
        {error && <p className="rounded-xl bg-coral-soft p-2.5 text-sm text-coral-dark" role="alert">{error}</p>}
        {info && <p className="flex gap-2 rounded-xl bg-mint-soft p-2.5 text-sm text-ink" role="status"><Mail className="h-4 w-4 shrink-0 text-mint-dark" />{info}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy} icon={<ArrowRight className="h-5 w-5" />}>
          {tab === 'in' ? 'Увійти' : tab === 'up' ? 'Зареєструватися' : 'Надіслати лист'}
        </Button>
        {tab === 'in' && <button type="button" onClick={() => go('reset')} className="w-full text-sm font-semibold text-primary hover:underline">Забули пароль?</button>}
        {tab === 'reset' && <button type="button" onClick={() => go('in')} className="w-full text-sm text-muted hover:text-ink">← Повернутися до входу</button>}
      </form>
    </Shell>
  );
}

/* ------------------------- Local mode (1.0) ------------------------- */
function LocalWelcome() {
  const { login } = useApp();
  const toast = useToast();
  const users = useLiveQuery(() => db.users.orderBy('lastActiveAt').reverse().toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const showForm = creating || users.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return toast("Введіть ім'я (щонайменше 2 символи)", 'error');
    if (users.some((u) => u.name.toLowerCase() === n.toLowerCase())) return toast('Профіль з таким іменем уже існує на цьому пристрої', 'error');
    setBusy(true);
    try {
      const u = await usersRepo.create(n);
      setWarn(u.id);
    } catch (err) {
      toast('Не вдалося створити профіль: ' + (err as Error).message, 'error');
    }
    setBusy(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-mint/25 blur-3xl" />
      <div className="pointer-events-none absolute right-1/4 top-10 h-40 w-40 rounded-full bg-sun/30 blur-3xl" />

      <div className="animate-in relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-mint text-white shadow-lift">
            <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="8" r="3" fill="currentColor" stroke="none" /><path d="M6 19c1-4 3.5-6 6-6s5 2 6 6" /></svg>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">Inclusive Insight</h1>
          <p className="mt-1 font-medium italic text-muted">Your Inclusive Education Companion</p>
        </div>

        <div className="card p-6 sm:p-8">
          <p className="mb-5 text-center text-lg font-semibold">Вітаємо! Увійдіть до свого робочого простору</p>

          {!showForm && (
            <div className="space-y-2">
              {users.map((u) => (
                <button key={u.id} onClick={() => login(u.id)}
                  className="focus-ring group flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-3 text-left transition hover:border-primary hover:shadow-soft">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl text-xl" style={{ background: u.color + '33' }}>{u.avatar}</span>
                  <span className="flex-1">
                    <span className="block font-bold">{u.name}</span>
                    <span className="block text-xs text-muted">Останній вхід: {fmtDate(new Date(u.lastActiveAt).toISOString().slice(0, 10))}</span>
                  </span>
                  <ArrowRight className="h-5 w-5 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}
              <Button variant="secondary" className="mt-2 w-full" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Створити новий профіль</Button>
            </div>
          )}

          {showForm && (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="name" className="label">Ваше ім'я</label>
                <input id="name" autoFocus className="input h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="Наприклад: Олена" maxLength={60} autoComplete="given-name" />
              </div>
              <Button type="submit" size="lg" className="w-full" loading={busy} icon={<ArrowRight className="h-5 w-5" />}>Продовжити</Button>
              {users.length > 0 && <button type="button" onClick={() => setCreating(false)} className="w-full text-sm text-muted hover:text-ink">← До списку профілів</button>}
            </form>
          )}
        </div>

        <p className="mt-5 flex items-start gap-2 px-2 text-xs text-muted">
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0" />
          Це локальний робочий простір, а не захищений вхід. Усі дані зберігаються лише в цьому браузері на цьому пристрої.
        </p>
        {cloudConfig.problem && (
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-coral-soft px-3 py-2 text-xs text-coral-dark" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Хмарну синхронізацію вимкнено: {cloudConfig.problem}
          </p>
        )}
      </div>

      <Modal open={!!warn} onClose={() => warn && login(warn)} title="Важливо знати перед початком" size="sm"
        footer={<Button onClick={() => warn && login(warn)}>Зрозуміло, продовжити</Button>}>
        <div className="space-y-3 text-sm">
          <div className="flex gap-3 rounded-2xl bg-sun-soft p-3">
            <ShieldAlert className="h-5 w-5 shrink-0 text-sun-dark" />
            <p>Вхід за іменем — <b>не захист паролем</b>. Будь-хто з доступом до цього браузера може відкрити будь-який профіль.</p>
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-muted">
            <li>Дані зберігаються лише в цьому браузері й не передаються в інтернет.</li>
            <li>Очищення даних браузера або приватний режим можуть їх видалити.</li>
            <li>Для учнів використовуйте псевдоніми замість повних імен.</li>
            <li>Регулярно створюйте резервні копії в «Налаштуваннях».</li>
          </ul>
        </div>
      </Modal>
    </div>
  );
}
