import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Settings as SettingsIcon, Palette, UserCog, BookMarked, ListChecks, Database, ShieldCheck, Sun, Moon, Monitor, ArrowUp, ArrowDown, Eye, EyeOff,
  Plus, Trash2, Download, Upload, HardDrive, FlaskConical, Stethoscope, LogOut, Lock, RotateCcw, X, AlertTriangle, Check, Cloud,
} from 'lucide-react';
import { CloudSettings, LogoutDialog } from '../components/cloud';
import { useSession } from '../hooks/useApp';
import { db } from '../db/database';
import { usersRepo, subjectsRepo, templatesRepo, checkIntegrity, settingsRepo, OWNER_TABLES, type IntegrityReport } from '../db/repositories';
import { applyBackup, backupPreview, buildBackup, encryptBackup, parseBackup, type BackupFile, type ImportResult } from '../services/backup';
import { clearDemo, createDemo, hasDemo } from '../services/demo';
import { CATEGORY_CATALOGS, SUBJECT_TEMPLATES } from '../lib/catalog';
import { Badge, Button, Card, Input, Modal, PageHeader, Segmented, Select, Toggle, IconButton } from '../components/ui';
import { useConfirm, useToast } from '../components/ui/feedback';
import { cn, downloadBlob, fmtDate, safeFileName } from '../lib/utils';

const SECTIONS = [
  { id: 'appearance', label: 'Вигляд', icon: Palette },
  { id: 'profile', label: 'Профіль', icon: UserCog },
  { id: 'subjects', label: 'Предмети', icon: BookMarked },
  { id: 'templates', label: 'Шаблони', icon: ListChecks },
  { id: 'backup', label: 'Дані', icon: Database },
  { id: 'privacy', label: 'Приватність', icon: ShieldCheck },
];
const AVATARS = ['🌿', '🌼', '📚', '🦉', '🌈', '🍀', '⭐', '🐝', '🍎', '🎈', '🦊', '🐢', '🌻', '✏️', '🎨', '🧩'];
const COLORS = ['#5B9BD5', '#8CCFB5', '#E8B04A', '#ECA5A0', '#C59BD8', '#6CC3D5', '#A0AEC0', '#7FB8A4', '#E8B07A', '#86A8E7'];

export default function Settings() {
  const loc = useLocation();
  const { mode } = useSession();
  const sections = mode === 'cloud' ? [{ id: 'cloud', label: 'Хмара', icon: Cloud }, ...SECTIONS] : SECTIONS;
  const goBackup = () => document.getElementById('backup')?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => {
    const id = loc.hash.replace('#', '') || '';
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, [loc.hash]);
  return (
    <div className="animate-in">
      <PageHeader title="Налаштування" icon={<SettingsIcon className="h-5 w-5" />} />
      <nav className="no-print sticky top-[56px] z-10 -mx-4 mb-4 flex gap-1 overflow-x-auto bg-bg/90 px-4 py-2 backdrop-blur scrollbar-thin sm:top-14" aria-label="Розділи налаштувань">
        {sections.map((s) => (
          <a key={s.id} href={`#/settings#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }); }}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-1.5 text-sm font-semibold hover:border-primary/50">
            <s.icon className="h-4 w-4 text-primary" />{s.label}
          </a>
        ))}
      </nav>
      <div className="space-y-5">
        {mode === 'cloud' && <CloudSettings onExportBackup={goBackup} />}
        <Appearance />
        <Profile />
        <Subjects />
        <Templates />
        <DataManagement />
        <Privacy />
      </div>
    </div>
  );
}

/* --------------------------- Appearance --------------------------- */
function Appearance() {
  const { settings, updateSettings } = useSession();
  return (
    <Card title="Вигляд" className="scroll-mt-32" >
      <div id="appearance" className="scroll-mt-32" />
      <span className="label">Тема</span>
      <Segmented value={settings.theme ?? 'light'} onChange={(v) => updateSettings({ theme: v })} options={[
        { key: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun className="h-4 w-4" />Світла</span> },
        { key: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon className="h-4 w-4" />Темна</span> },
        { key: 'system', label: <span className="inline-flex items-center gap-1.5"><Monitor className="h-4 w-4" />Системна</span> },
      ]} />
      <div className="mt-3 divide-y divide-line">
        <Toggle checked={!!settings.compact} onChange={(v) => updateSettings({ compact: v })} label="Компактний режим" description="Трохи менший текст і відступи" />
        <Toggle checked={settings.animations !== false} onChange={(v) => updateSettings({ animations: v })} label="Анімації" description="Системне налаштування «зменшити рух» враховується завжди" />
      </div>
    </Card>
  );
}

/* ----------------------------- Profile ----------------------------- */
function Profile() {
  const { user, logout, mode, email } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [name, setName] = useState(user.name);
  useEffect(() => setName(user.name), [user.name]);
  return (
    <Card title="Профіль користувача">
      <div id="profile" className="scroll-mt-32" />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="flex items-end gap-2">
            <Input label="Ім'я" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            <Button disabled={!name.trim() || name === user.name} onClick={async () => { await usersRepo.update(user.id, { name: name.trim() }); toast("Ім'я змінено"); }}>Зберегти</Button>
          </div>
          {mode === 'cloud' && <p className="mt-2 text-sm text-muted">Обліковий запис: <b className="text-ink">{email}</b>. Ім’я лише відображається в інтерфейсі й не використовується для входу.</p>}
          {mode === 'cloud' ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => setLogoutOpen(true)}>Вийти з акаунта</Button>
              <LogoutDialog open={logoutOpen} onClose={() => setLogoutOpen(false)} />
            </div>
          ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => logout()}>Перемкнути профіль</Button>
            <Button variant="ghost" className="text-coral-dark" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
              if (await confirm({ title: 'Видалити локальний профіль?', text: 'Буде видалено профіль і ВСІ його дані: учнів, спостереження, цілі, досягнення. Спершу створіть резервну копію.', danger: true, confirmLabel: 'Видалити профіль', requireText: user.name })) {
                await usersRepo.remove(user.id);
                await logout();
              }
            }}>Видалити профіль</Button>
          </div>
          )}
        </div>
        <div>
          <span className="label">Аватар</span>
          <div className="flex flex-wrap gap-1.5">
            {AVATARS.map((a) => <button key={a} onClick={() => usersRepo.update(user.id, { avatar: a })} aria-label={`Аватар ${a}`} className={cn('focus-ring h-10 w-10 rounded-xl text-xl transition', user.avatar === a ? 'bg-primary-soft ring-2 ring-primary' : 'bg-bg hover:bg-primary-soft')}>{a}</button>)}
          </div>
          <span className="label mt-3">Колір</span>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => <button key={c} onClick={() => usersRepo.update(user.id, { color: c })} aria-label={`Колір ${c}`} className={cn('focus-ring h-8 w-8 rounded-full', user.color === c && 'ring-2 ring-ink ring-offset-2 ring-offset-card')} style={{ background: c }} />)}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------- Subjects ----------------------------- */
function Subjects() {
  const { user, subjects } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [newName, setNewName] = useState('');
  const move = async (i: number, d: -1 | 1) => {
    const ids = subjects.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await subjectsRepo.reorder(ids);
  };
  return (
    <Card title="Предмети" subtitle="Перейменування, приховування, порядок відображення та кольори">
      <div id="subjects" className="scroll-mt-32" />
      <ul className="divide-y divide-line">
        {subjects.map((s, i) => (
          <li key={s.id} className={cn('flex flex-wrap items-center gap-2 py-2', s.hidden && 'opacity-60')}>
            <input type="color" aria-label={`Колір ${s.name}`} value={s.color} onChange={(e) => subjectsRepo.save(user.id, { ...s, color: e.target.value })} className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent" />
            <input className="input h-10 min-w-[160px] flex-1 py-1.5" defaultValue={s.name} aria-label="Назва предмета"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) { subjectsRepo.save(user.id, { ...s, name: v }); toast('Предмет перейменовано'); } else e.target.value = s.name; }} />
            {s.hidden && <Badge tone="gray">прихований</Badge>}
            <IconButton label="Вище" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
            <IconButton label="Нижче" disabled={i === subjects.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
            <IconButton label={s.hidden ? 'Показати' : 'Приховати'} onClick={() => subjectsRepo.save(user.id, { ...s, hidden: !s.hidden })}>{s.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</IconButton>
            <IconButton label="Видалити" onClick={async () => {
              if (await subjectsRepo.isUsed(s.id)) return toast('Предмет використовується в записах — його можна лише приховати', 'info');
              if (await confirm({ title: `Видалити предмет «${s.name}»?`, danger: true, confirmLabel: 'Видалити' })) { await subjectsRepo.remove(s.id); toast('Предмет видалено'); }
            }}><Trash2 className="h-4 w-4" /></IconButton>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newName.trim()) return; await subjectsRepo.save(user.id, { name: newName.trim() }); setNewName(''); toast('Предмет додано'); }}>
        <Input aria-label="Новий предмет" placeholder="Новий предмет" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" icon={<Plus className="h-4 w-4" />}>Додати</Button>
      </form>
    </Card>
  );
}

/* ----------------------------- Templates ----------------------------- */
function Templates() {
  const { user, subjects } = useSession();
  const toast = useToast();
  const templates = useLiveQuery(() => templatesRepo.listAll(user.id), [user.id]) ?? [];
  const [cat, setCat] = useState('behaviors');
  const [subjId, setSubjId] = useState(subjects[0]?.id ?? '');
  const [opt, setOpt] = useState('');
  const [field, setField] = useState('');
  useEffect(() => { if (!subjId && subjects[0]) setSubjId(subjects[0].id); }, [subjects, subjId]);

  const catTpl = templates.find((t) => t.kind === 'category' && t.key === cat);
  const catDef = CATEGORY_CATALOGS[cat];
  const subject = subjects.find((s) => s.id === subjId);
  const subjTpl = templates.find((t) => t.kind === 'subject' && t.key === subjId);
  const fields = templatesRepo.subjectFields(subject, subjTpl);

  return (
    <Card title="Шаблони спостережень" subtitle="Власні варіанти відповідей, приховування стандартних і поля предметних шаблонів">
      <div id="templates" className="scroll-mt-32" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <Select label="Категорія" value={cat} onChange={(e) => setCat(e.target.value)}>
            {Object.entries(CATEGORY_CATALOGS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
          </Select>
          <p className="hint mt-2">Натисніть на стандартний варіант, щоб приховати або показати його у формі.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {catDef.options.map((o) => {
              const hidden = catTpl?.hiddenOptions.includes(o.key);
              return (
                <button key={o.key} onClick={() => templatesRepo.save(user.id, 'category', cat, { hiddenOptions: hidden ? catTpl!.hiddenOptions.filter((x) => x !== o.key) : [...(catTpl?.hiddenOptions ?? []), o.key] })}
                  className={cn('focus-ring inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium', hidden ? 'border-dashed border-line text-muted line-through' : 'border-line bg-bg')}>
                  {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{o.label}
                </button>
              );
            })}
            {(catTpl?.options ?? []).map((o) => (
              <span key={o} className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold">{o}
                <button aria-label={`Видалити ${o}`} onClick={() => templatesRepo.save(user.id, 'category', cat, { options: catTpl!.options.filter((x) => x !== o) })}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const v = opt.trim();
            if (!v) return;
            if (catDef.options.some((o) => o.label.toLowerCase() === v.toLowerCase()) || catTpl?.options.includes(v)) return toast('Такий варіант уже є', 'info');
            await templatesRepo.save(user.id, 'category', cat, { options: [...(catTpl?.options ?? []), v] });
            setOpt('');
          }}>
            <Input aria-label="Власний варіант" placeholder="Власний варіант відповіді" value={opt} onChange={(e) => setOpt(e.target.value)} />
            <Button type="submit" variant="secondary" icon={<Plus className="h-4 w-4" />}>Додати</Button>
          </form>
        </div>
        <div>
          <Select label="Предметний шаблон" value={subjId} onChange={(e) => setSubjId(e.target.value)}>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <p className="hint mt-2">Поля з’являються в детальному режимі форми для обраного предмета.</p>
          <ul className="mt-2 space-y-1">
            {fields.length === 0 && <li className="text-sm text-muted">Полів немає — додайте власні.</li>}
            {fields.map((f, i) => (
              <li key={f + i} className="flex items-center gap-2 rounded-xl bg-bg px-3 py-1.5 text-sm">
                <span className="flex-1">{f}</span>
                <IconButton label="Видалити поле" onClick={() => templatesRepo.save(user.id, 'subject', subjId, { options: fields.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></IconButton>
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const v = field.trim(); if (!v) return; await templatesRepo.save(user.id, 'subject', subjId, { options: [...fields, v] }); setField(''); }}>
            <Input aria-label="Нове поле" placeholder="Нове поле шаблону" value={field} onChange={(e) => setField(e.target.value)} />
            <Button type="submit" variant="secondary" icon={<Plus className="h-4 w-4" />}>Додати</Button>
          </form>
          {subjTpl && subject && (SUBJECT_TEMPLATES[subject.templateKey]?.length ?? 0) > 0 && (
            <Button variant="ghost" size="sm" className="mt-2" icon={<RotateCcw className="h-4 w-4" />} onClick={async () => { await db.templates.delete(subjTpl.id); toast('Відновлено стандартний шаблон'); }}>Відновити стандартний шаблон</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* -------------------------- Data management -------------------------- */
function DataManagement() {
  const { user, student, setStudent, mode: appMode } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [encrypt, setEncrypt] = useState(false);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [importText, setImportText] = useState<string | null>(null);
  const [needPwd, setNeedPwd] = useState(false);
  const [importPwd, setImportPwd] = useState('');
  const [parsed, setParsed] = useState<{ backup: BackupFile; warnings: string[] } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean; supported: boolean } | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const demoActive = useLiveQuery(() => hasDemo(user.id), [user.id]);
  const userSettings = useLiveQuery(() => settingsRepo.getUser(user.id), [user.id]);

  const doExport = async () => {
    if (encrypt && (pwd.length < 6 || pwd !== pwd2)) return toast(pwd.length < 6 ? 'Пароль має містити щонайменше 6 символів' : 'Паролі не збігаються', 'error');
    setBusy('export');
    try {
      const b = await buildBackup(user.id);
      const payload = encrypt ? await encryptBackup(b, pwd) : b;
      const name = `inclusive-insight-backup_${safeFileName(user.name)}_${new Date().toISOString().slice(0, 10)}${encrypt ? '_encrypted' : ''}.json`;
      downloadBlob(new Blob([JSON.stringify(payload, null, encrypt ? 0 : 1)], { type: 'application/json' }), name);
      await settingsRepo.setUser(user.id, { lastBackupAt: Date.now() });
      setPwd(''); setPwd2('');
      toast('Резервну копію збережено на ваш пристрій');
    } catch (e) {
      toast('Помилка експорту: ' + (e as Error).message, 'error');
    }
    setBusy(null);
  };

  const resetImport = () => { setImportText(null); setNeedPwd(false); setImportPwd(''); setParsed(null); setErrors([]); setResult(null); setMode('merge'); if (fileRef.current) fileRef.current.value = ''; };

  const onFile = async (f: File) => {
    resetImport();
    if (f.size > 50 * 1024 * 1024) return toast('Файл завеликий', 'error');
    const text = await f.text();
    setImportText(text);
    const r = await parseBackup(text);
    if (r.status === 'needs-password') setNeedPwd(true);
    else if (r.status === 'error') setErrors(r.errors);
    else setParsed({ backup: r.backup, warnings: r.warnings });
  };
  const decrypt = async () => {
    if (!importText) return;
    setBusy('decrypt');
    const r = await parseBackup(importText, importPwd);
    setBusy(null);
    if (r.status === 'error') setErrors(r.errors);
    else if (r.status === 'ok') { setErrors([]); setNeedPwd(false); setParsed({ backup: r.backup, warnings: r.warnings }); }
  };
  const doImport = async () => {
    if (!parsed) return;
    const ok = await confirm({
      title: mode === 'replace' ? 'Замінити всі дані профілю?' : 'Об’єднати дані?',
      text: mode === 'replace' ? 'Усі поточні дані цього профілю буде видалено й замінено вмістом файлу. Рекомендуємо спершу зробити резервну копію.' : 'Нові записи буде додано. Записи з однаковим ID оновляться, лише якщо у файлі вони новіші.',
      danger: mode === 'replace', confirmLabel: mode === 'replace' ? 'Замінити' : 'Імпортувати',
    });
    if (!ok) return;
    setBusy('import');
    try {
      const r = await applyBackup(user.id, parsed.backup, mode);
      setResult(r);
      const first = await db.students.where('ownerId').equals(user.id).first();
      if (!student && first) await setStudent(first.id);
      toast(`Імпорт завершено: додано ${r.added}, оновлено ${r.updated}, пропущено ${r.skipped}`);
    } catch (e) {
      toast('Імпорт не вдався, дані не змінено: ' + (e as Error).message, 'error');
    }
    setBusy(null);
  };

  const checkStorage = async () => {
    const s = navigator.storage;
    if (!s?.estimate) return setStorage({ supported: false });
    const est = await s.estimate();
    const persisted = s.persisted ? await s.persisted() : undefined;
    setStorage({ usage: est.usage, quota: est.quota, persisted, supported: true });
  };
  const requestPersist = async () => {
    if (!navigator.storage?.persist) return toast('Браузер не підтримує запит на постійне сховище', 'info');
    const ok = await navigator.storage.persist();
    toast(ok ? 'Браузер дозволив постійне зберігання' : 'Браузер відхилив запит (спробуйте встановити додаток на головний екран)', ok ? 'success' : 'info');
    checkStorage();
  };
  const mb = (n?: number) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} МБ`);
  const prev = parsed ? backupPreview(parsed.backup) : null;

  return (
    <Card title="Керування даними · Backup & Restore">
      <div id="backup" className="scroll-mt-32" />
      {appMode === 'cloud' ? (
        <div className="mb-4 flex gap-3 rounded-2xl border border-line bg-bg p-3.5 text-sm">
          <Cloud className="h-5 w-5 shrink-0 text-primary" />
          <p className="text-muted">Основна копія ваших даних — у хмарі Supabase. Резервний JSON-файл — додатковий захист і спосіб перенести дані в інший акаунт. {userSettings?.lastBackupAt ? `Остання копія: ${fmtDate(new Date(userSettings.lastBackupAt).toISOString().slice(0, 10))}.` : 'Копій ще не створено.'}</p>
        </div>
      ) : (
      <div className="mb-4 flex gap-3 rounded-2xl border border-sun bg-sun-soft p-3.5 text-sm">
        <AlertTriangle className="h-5 w-5 shrink-0 text-sun-dark" />
        <div>
          <p className="font-semibold">Дані зберігаються лише в цьому браузері.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            <li>Інший пристрій не отримає їх автоматично.</li>
            <li>Очищення даних браузера може їх видалити; приватний режим не підходить для тривалого збереження.</li>
            <li>Регулярний експорт резервних копій є необхідним. {userSettings?.lastBackupAt ? `Остання копія: ${fmtDate(new Date(userSettings.lastBackupAt).toISOString().slice(0, 10))}.` : 'Копій ще не створено.'}</li>
          </ul>
        </div>
      </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Export */}
        <div className="rounded-2xl border border-line p-4">
          <h3 className="mb-2 flex items-center gap-2 font-bold"><Download className="h-4 w-4 text-primary" />Експорт резервної копії</h3>
          <p className="mb-3 text-sm text-muted">Усі дані профілю «{user.name}» у файлі JSON. Незашифрований файл може містити чутливу інформацію — зберігайте його обережно.</p>
          <Toggle checked={encrypt} onChange={setEncrypt} label={<span className="inline-flex items-center gap-1.5"><Lock className="h-4 w-4" />Зашифрувати паролем</span>} description="AES-GCM 256 + PBKDF2 (Web Crypto). Пароль ніде не зберігається — без нього відновлення неможливе." />
          {encrypt && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input type="password" label="Пароль" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
              <Input type="password" label="Повторіть пароль" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" />
            </div>
          )}
          <Button className="mt-3" icon={<Download className="h-4 w-4" />} loading={busy === 'export'} onClick={doExport}>Завантажити копію</Button>
        </div>

        {/* Import */}
        <div className="rounded-2xl border border-line p-4">
          <h3 className="mb-2 flex items-center gap-2 font-bold"><Upload className="h-4 w-4 text-primary" />Імпорт резервної копії</h3>
          <p className="mb-3 text-sm text-muted">Перевіряються версія, структура й контрольна сума. Перед імпортом буде показано вміст файлу.</p>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>Обрати файл…</Button>
          {needPwd && (
            <div className="mt-3 flex items-end gap-2">
              <Input type="password" label="Файл зашифровано. Введіть пароль" value={importPwd} onChange={(e) => setImportPwd(e.target.value)} className="flex-1" />
              <Button loading={busy === 'decrypt'} onClick={decrypt}>Розшифрувати</Button>
            </div>
          )}
          {errors.length > 0 && <ul className="mt-3 space-y-1 rounded-xl bg-coral-soft p-3 text-sm text-coral-dark">{errors.map((e) => <li key={e}>• {e}</li>)}</ul>}
        </div>
      </div>

      {/* Storage & integrity & demo */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-line p-4">
          <h3 className="mb-2 flex items-center gap-2 font-bold"><HardDrive className="h-4 w-4 text-primary" />Стан сховища</h3>
          {storage && (storage.supported ? (
            <ul className="mb-3 space-y-1 text-sm">
              <li>Використано: <b>{mb(storage.usage)}</b> з {mb(storage.quota)}</li>
              <li>Постійне сховище: {storage.persisted ? <Badge tone="mint">увімкнено</Badge> : <Badge tone="sun">не гарантовано</Badge>}</li>
            </ul>
          ) : <p className="mb-3 text-sm text-muted">Браузер не надає інформацію про сховище.</p>)}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={checkStorage}>Перевірити</Button>
            <Button size="sm" variant="secondary" onClick={requestPersist}>Запросити постійне сховище</Button>
          </div>
        </div>
        <div className="rounded-2xl border border-line p-4">
          <h3 className="mb-2 flex items-center gap-2 font-bold"><Stethoscope className="h-4 w-4 text-primary" />Перевірка бази</h3>
          {integrity && (
            <div className="mb-3 text-sm">
              <p className="text-muted">{OWNER_TABLES.map((t) => `${t}: ${integrity.counts[t]}`).join(' · ')}</p>
              {integrity.problems.length ? <ul className="mt-2 text-coral-dark">{integrity.problems.map((p) => <li key={p}>• {p}</li>)}</ul> : <p className="mt-2 flex items-center gap-1 font-semibold text-mint-dark"><Check className="h-4 w-4" />Проблем не знайдено</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={async () => setIntegrity(await checkIntegrity(user.id))}>Перевірити</Button>
            {integrity?.problems.length ? <Button size="sm" onClick={async () => { await checkIntegrity(user.id, true); setIntegrity(await checkIntegrity(user.id)); toast('Осиротілі записи видалено'); }}>Виправити</Button> : null}
          </div>
        </div>
        <div className="rounded-2xl border border-line p-4">
          <h3 className="mb-2 flex items-center gap-2 font-bold"><FlaskConical className="h-4 w-4 text-primary" />Демонстраційний режим</h3>
          <p className="mb-3 text-sm text-muted">Вигаданий учень із синтетичними даними (~7 тижнів). Демодані позначені й не змішуються з реальними.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={demoActive ? 'secondary' : 'primary'} loading={busy === 'demo'} onClick={async () => {
              setBusy('demo');
              try { const s = await createDemo(user.id); await setStudent(s.id); toast(demoActive ? 'Демодані скинуто й створено заново' : 'Демонстраційний режим увімкнено'); } catch (e) { toast((e as Error).message, 'error'); }
              setBusy(null);
            }}>{demoActive ? 'Скинути демодані' : 'Увімкнути демо'}</Button>
            {demoActive && <Button size="sm" variant="ghost" onClick={async () => {
              if (await confirm({ title: 'Очистити демонстраційні дані?', text: 'Реальні записи не буде змінено.', confirmLabel: 'Очистити' })) { await clearDemo(user.id); toast('Демодані видалено'); }
            }}>Очистити демо</Button>}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-coral/50 p-4">
        <h3 className="mb-1 font-bold text-coral-dark">Видалення даних</h3>
        <p className="mb-3 text-sm text-muted">Видаляє всіх учнів і всі записи цього профілю (предмети та стратегії буде відновлено до стандартних).</p>
        <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
          if (!(await confirm({ title: 'Видалити всі дані профілю?', text: 'Дію неможливо скасувати. Спершу створіть резервну копію.', danger: true, confirmLabel: 'Видалити все', requireText: 'ВИДАЛИТИ' }))) return;
          await db.transaction('rw', [...OWNER_TABLES.map((t) => db.table(t)), db.drafts], async () => {
            for (const t of OWNER_TABLES) await db.table(t).where('ownerId').equals(user.id).delete();
            await db.drafts.where('ownerId').equals(user.id).delete();
          });
          const { bootstrapOwner } = await import('../db/repositories');
          await bootstrapOwner(user.id);
          await setStudent(null);
          toast('Усі дані профілю видалено');
        }}>Видалити всі дані профілю</Button>
      </div>

      <Modal open={!!parsed} onClose={resetImport} title="Попередній перегляд резервної копії" size="md"
        footer={result ? <Button onClick={resetImport}>Готово</Button> : <><Button variant="secondary" onClick={resetImport}>Скасувати</Button><Button variant={mode === 'replace' ? 'danger' : 'primary'} loading={busy === 'import'} onClick={doImport}>{mode === 'replace' ? 'Замінити дані' : 'Об’єднати дані'}</Button></>}>
        {prev && !result && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-bg p-2.5"><dt className="text-xs text-muted">Профіль у файлі</dt><dd className="font-semibold">{prev.profile || '—'}</dd></div>
              <div className="rounded-xl bg-bg p-2.5"><dt className="text-xs text-muted">Створено</dt><dd className="font-semibold">{new Date(prev.exportedAt).toLocaleString('uk-UA')}</dd></div>
              <div className="rounded-xl bg-bg p-2.5"><dt className="text-xs text-muted">Учні</dt><dd className="font-semibold">{prev.students.join(', ') || '—'}</dd></div>
              <div className="rounded-xl bg-bg p-2.5"><dt className="text-xs text-muted">Спостереження</dt><dd className="font-semibold">{prev.observations}{prev.from ? ` (${fmtDate(prev.from, 'dd.MM.yy')} — ${fmtDate(prev.to, 'dd.MM.yy')})` : ''}</dd></div>
            </dl>
            <p className="text-xs text-muted">{Object.entries(prev.counts).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')} · схема v{prev.schemaVersion}</p>
            {parsed!.warnings.length > 0 && <ul className="rounded-xl bg-sun-soft p-3 text-xs">{parsed!.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>}
            <div>
              <span className="label">Спосіб імпорту</span>
              <Segmented value={mode} onChange={setMode} options={[{ key: 'merge', label: 'Об’єднати' }, { key: 'replace', label: 'Замінити' }]} />
              <p className="hint mt-1.5">{mode === 'merge' ? 'Дублікати за ID: залишається новіша версія запису.' : 'Поточні дані профілю буде повністю замінено.'}</p>
              {appMode === 'cloud' && <p className="mt-2 rounded-xl bg-sun-soft p-2.5 text-xs text-ink">Ви працюєте з хмарним акаунтом: імпортовані зміни {mode === 'replace' ? '(включно з видаленням поточних записів) ' : ''}буде також надіслано в хмару й на всі ваші пристрої.</p>}
            </div>
          </div>
        )}
        {result && (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-semibold text-mint-dark"><Check className="h-5 w-5" />Імпорт завершено</p>
            <p>Додано: <b>{result.added}</b> · Оновлено: <b>{result.updated}</b> · Пропущено: <b>{result.skipped}</b>{result.conflicts ? ` · Конфліктів з іншими профілями: ${result.conflicts}` : ''}</p>
            <ul className="text-xs text-muted">{Object.entries(result.perTable).filter(([, v]) => v.added + v.updated + v.skipped).map(([k, v]) => <li key={k}>{k}: +{v.added} / ↻{v.updated} / ={v.skipped}</li>)}</ul>
          </div>
        )}
      </Modal>
    </Card>
  );
}

/* ------------------------------ Privacy ------------------------------ */
function Privacy() {
  const { mode } = useSession();
  return (
    <Card title="Приватність">
      <div id="privacy" className="scroll-mt-32" />
      <div className="grid gap-3 text-sm md:grid-cols-2">
        {mode === 'cloud' ? (
          <>
            <div className="rounded-2xl bg-bg p-4"><h3 className="mb-1 font-bold">Хмарне збереження</h3><p className="text-muted">Записи зберігаються у вашому проєкті Supabase. Правила Row Level Security дозволяють кожному акаунту бачити й змінювати лише власні записи. На пристрої лишається копія для швидкої роботи та офлайн-режиму. Service Worker кешує лише файли додатка. Трекерів немає.</p></div>
            <div className="rounded-2xl bg-bg p-4"><h3 className="mb-1 font-bold">Вхід і спільні комп’ютери</h3><p className="text-muted">Вхід виконується за email і паролем (Supabase Auth). На спільному комп’ютері виходьте з акаунта й видаляйте копію даних з пристрою: дані в хмарі при цьому не зміняться.</p></div>
          </>
        ) : (
          <>
        <div className="rounded-2xl bg-bg p-4"><h3 className="mb-1 font-bold">Локальне збереження</h3><p className="text-muted">Усі записи зберігаються в IndexedDB цього браузера. Додаток не має сервера, не використовує трекерів і не передає дані стороннім сервісам. Service Worker кешує лише файли додатка, а не ваші записи.</p></div>
        <div className="rounded-2xl bg-bg p-4"><h3 className="mb-1 font-bold">Немає справжньої авторизації</h3><p className="text-muted">Вхід за іменем — це перемикач робочих просторів, а не захист. Профілі на одному пристрої не захищені один від одного. Не залишайте додаток відкритим на спільному комп’ютері.</p></div>
          </>
        )}
        <div className="rounded-2xl bg-bg p-4"><h3 className="mb-1 font-bold">Псевдоніми</h3><p className="text-muted">Використовуйте псевдоніми чи ініціали замість повних імен дітей. Для роботи з реальними персональними даними потрібні належний технічний захист, правові підстави та погодження з адміністрацією закладу.</p></div>
        <div className="rounded-2xl bg-bg p-4"><h3 className="mb-1 font-bold">Резервні копії</h3><p className="text-muted">Файл копії містить усі записи профілю. Шифруйте його паролем, якщо зберігаєте на флешці чи в хмарі. Пароль не зберігається у файлі — його неможливо відновити.</p></div>
      </div>
    </Card>
  );
}
