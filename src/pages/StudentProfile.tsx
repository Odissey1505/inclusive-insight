import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { UserRound, UserPlus, Save, Trash2, Archive, ArchiveRestore, ShieldCheck, Check } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { db } from '../db/database';
import { studentsRepo, emptyStudent, type StudentInput } from '../db/repositories';
import { Badge, Button, Card, Input, PageHeader, Textarea, IconButton } from '../components/ui';
import { useConfirm, useToast } from '../components/ui/feedback';
import { cn, fmtDate } from '../lib/utils';

export default function StudentProfile() {
  const { user, students, student, setStudent } = useSession();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = params.get('new') === '1' || !student;
  const [form, setForm] = useState<StudentInput>(emptyStudent());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(isNew ? emptyStudent() : { ...student! });
  }, [isNew, student?.id]); // eslint-disable-line

  const stats = useLiveQuery(async () => {
    if (!student || isNew) return null;
    const obs = await db.observations.where('studentId').equals(student.id).toArray();
    const dates = obs.map((o) => o.date).sort();
    return { obs: obs.length, goals: await db.iepGoals.where('studentId').equals(student.id).count(), ach: await db.achievements.where('studentId').equals(student.id).count(), first: dates[0], last: dates[dates.length - 1] };
  }, [student?.id, isNew]);

  const save = async () => {
    if (form.name.trim().length < 1) return toast("Вкажіть ім'я або псевдонім", 'error');
    setSaving(true);
    try {
      const s = await studentsRepo.save(user.id, { ...form, name: form.name.trim() });
      if (isNew) {
        await setStudent(s.id);
        setParams({}, { replace: true });
        toast('Профіль учня створено');
        nav('/');
      } else toast('Профіль збережено');
    } catch (e) {
      toast('Помилка збереження: ' + (e as Error).message, 'error');
    }
    setSaving(false);
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirm({ title: `Видалити профіль «${name}»?`, text: 'Буде остаточно видалено всі спостереження, цілі ІПР, досягнення та звітні дані цього учня. Рекомендуємо спершу створити резервну копію.', danger: true, confirmLabel: 'Видалити назавжди', requireText: name });
    if (!ok) return;
    await studentsRepo.remove(id);
    toast('Профіль учня видалено');
  };

  const set = (k: keyof StudentInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="animate-in">
      <PageHeader title={isNew ? 'Новий профіль учня' : 'Профіль учня'} icon={<UserRound className="h-5 w-5" />}
        actions={!isNew ? <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setParams({ new: '1' })}>Додати учня</Button> : undefined} />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="flex gap-3 rounded-2xl border border-mint bg-mint-soft p-3.5 text-sm">
            <ShieldCheck className="h-5 w-5 shrink-0 text-mint-dark" />
            <p>Рекомендуємо використовувати <b>псевдонім або ініціали</b> замість повного імені дитини. Додаток не є захищеною системою обробки персональних даних.</p>
          </div>
          <Card title="Основне">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Ім'я або псевдонім" value={form.name} onChange={set('name')} placeholder="Напр.: Учень А. або «Сонечко»" autoFocus={isNew} />
              <Input label="Клас" value={form.grade} onChange={set('grade')} />
              <Input label="Навчальний рік" value={form.schoolYear} onChange={set('schoolYear')} placeholder="2026/2027" />
              <Input label="Дата початку спостережень" type="date" value={form.startDate} onChange={set('startDate')} />
            </div>
          </Card>
          <Card title="Педагогічний портрет" subtitle="Описуйте сильні сторони й потреби у педагогічних термінах, без діагнозів.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea label="Сильні сторони" value={form.strengths} onChange={set('strengths')} />
              <Textarea label="Інтереси" value={form.interests} onChange={set('interests')} />
              <Textarea label="Навчальні потреби" value={form.needs} onChange={set('needs')} />
              <Textarea label="Ефективні стратегії" value={form.effectiveStrategies} onChange={set('effectiveStrategies')} />
              <Textarea label="Додаткові нотатки" className="sm:col-span-2" value={form.notes} onChange={set('notes')} />
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" icon={<Save className="h-5 w-5" />} loading={saving} onClick={save}>{isNew ? 'Створити профіль' : 'Зберегти зміни'}</Button>
            {isNew && student && <Button size="lg" variant="ghost" onClick={() => setParams({})}>Скасувати</Button>}
          </div>
        </div>

        <div className="space-y-4">
          {stats && (
            <Card title="Коротко">
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-bg p-2"><dt className="text-xs text-muted">Записів</dt><dd className="text-xl font-extrabold">{stats.obs}</dd></div>
                <div className="rounded-xl bg-bg p-2"><dt className="text-xs text-muted">Цілей</dt><dd className="text-xl font-extrabold">{stats.goals}</dd></div>
                <div className="rounded-xl bg-bg p-2"><dt className="text-xs text-muted">Досягнень</dt><dd className="text-xl font-extrabold">{stats.ach}</dd></div>
              </dl>
              {stats.first && <p className="mt-2 text-xs text-muted">Записи: {fmtDate(stats.first)} — {fmtDate(stats.last)}</p>}
            </Card>
          )}
          <Card title="Усі учні">
            {students.length === 0 ? <p className="text-sm text-muted">Ще немає профілів.</p> : (
              <ul className="space-y-1.5">
                {students.map((s) => (
                  <li key={s.id} className={cn('flex items-center gap-2 rounded-xl border p-2', s.id === student?.id && !isNew ? 'border-primary bg-primary-soft' : 'border-line', s.archived && 'opacity-60')}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => { if (!s.archived) { setStudent(s.id); setParams({}); } }} disabled={s.archived}>
                      <div className="truncate text-sm font-semibold">{s.name}</div>
                      <div className="text-xs text-muted">{s.grade}{s.isDemo && ' · '}{s.isDemo && <Badge tone="sun">демо</Badge>}{s.archived && ' · в архіві'}</div>
                    </button>
                    {s.id === student?.id && !isNew && <Check className="h-4 w-4 text-primary" />}
                    {!s.isDemo && <IconButton label={s.archived ? 'Відновити з архіву' : 'В архів'} onClick={() => studentsRepo.save(user.id, { ...s, archived: !s.archived })}>{s.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</IconButton>}
                    <IconButton label="Видалити" onClick={() => remove(s.id, s.name)}><Trash2 className="h-4 w-4" /></IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
