import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  PlusCircle, Zap, CalendarDays, BarChart3, FileText, BookOpen, ClipboardCheck, Activity, CheckCircle2, Footprints, Award,
  Pencil, Plus, Circle, CheckCircle, FileClock, Trash2, ShieldAlert,
} from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { useDataset } from '../hooks/useData';
import { db } from '../db/database';
import { lessonsRepo, settingsRepo } from '../db/repositories';
import { computeMetrics, periodRange, timeSeries, type Ratio } from '../analytics/engine';
import { Badge, Button, Card, EmptyState, IconButton, PageSkeleton, StatCard } from '../components/ui';
import { TrendChart, DonutChart, SERIES } from '../components/charts';
import { LessonModal } from '../components/shared/LessonModal';
import { useConfirm, useToast } from '../components/ui/feedback';
import { SUPPORT_LEVELS, labelOf } from '../lib/catalog';
import { fmtDate, fmtPct, todayISO, cn } from '../lib/utils';
import type { Lesson } from '../types/models';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Доброї ночі' : h < 12 ? 'Доброго ранку' : h < 18 ? 'Доброго дня' : 'Доброго вечора';
};
const ratioHint = (r: Ratio, what: string) => (r.den ? `${r.num} з ${r.den} ${what}${r.lowData ? ' · мало даних' : ''}` : 'немає оцінених записів');

export default function Dashboard() {
  const { user, student, subjectName, subjectColor } = useSession();
  const nav = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const today = todayISO();
  const week = useMemo(() => periodRange('last7'), []);
  const month = useMemo(() => periodRange('last30'), []);
  const curWeek = useMemo(() => periodRange('week'), []);
  const ds7 = useDataset(student!.id, week);
  const ds30 = useDataset(student!.id, month);
  const [lessonModal, setLessonModal] = useState<{ open: boolean; lesson?: Lesson | null }>({ open: false });

  const todayData = useLiveQuery(async () => {
    const [lessons, obs] = await Promise.all([
      lessonsRepo.listForDate(student!.id, today),
      db.observations.where('[studentId+date]').equals([student!.id, today]).toArray(),
    ]);
    return { lessons, obs };
  }, [student!.id, today]);
  const appSettings = useLiveQuery(() => settingsRepo.getUser(user.id), [user.id]);
  const achievementsRecent = useLiveQuery(() => db.achievements.where('studentId').equals(student!.id).reverse().sortBy('date').then((a) => a.slice(0, 4)), [student!.id]);

  if (!ds7 || !ds30 || !todayData) return <PageSkeleton />;

  const m7 = computeMetrics(ds7);
  const m30 = computeMetrics(ds30);
  const weekAchievements = ds30.achievements.filter((a) => a.date >= curWeek.from && a.date <= curWeek.to).length;
  const series7 = timeSeries(ds7, week, 'day');
  const series30 = timeSeries(ds30, month, 'week');
  const todayFinal = todayData.obs.filter((o) => o.status === 'final');

  // Merge planned lessons and today's observations into one list
  const rows = todayData.lessons.map((l) => {
    const o = todayData.obs.find((x) => x.lessonId === l.id) ?? todayData.obs.find((x) => !x.lessonId && x.lessonNumber === l.number && x.subjectId === l.subjectId);
    return { key: l.id, lesson: l, obs: o, number: l.number, subjectId: l.subjectId, topic: l.topic || o?.topic || '' };
  });
  for (const o of todayData.obs) {
    if (!rows.some((r) => r.obs?.id === o.id)) rows.push({ key: o.id, lesson: undefined as any, obs: o, number: o.lessonNumber ?? 0, subjectId: o.subjectId, topic: o.topic });
  }
  rows.sort((a, b) => a.number - b.number);
  const nextNumber = Math.max(0, ...rows.map((r) => r.number)) + 1;

  const supportDonut = SUPPORT_LEVELS.filter((s) => m30.supportCounts.get(s.key)).map((s, i) => ({ name: s.label, value: m30.supportCounts.get(s.key)!, color: SERIES[SUPPORT_LEVELS.indexOf(s) % 8] ?? SERIES[i] }));
  const backupOld = !appSettings?.lastBackupAt || Date.now() - appSettings.lastBackupAt > 14 * 864e5;

  const quick = [
    { label: 'Нове спостереження', icon: PlusCircle, to: '/observation/new', primary: true },
    { label: 'Швидкий запис', icon: Zap, to: '/observation/new?mode=quick' },
    { label: 'Відкрити календар', icon: CalendarDays, to: '/calendar' },
    { label: 'Переглянути аналітику', icon: BarChart3, to: '/analytics' },
    { label: 'Створити звіт', icon: FileText, to: '/reports' },
  ];

  return (
    <div className="animate-in space-y-5">
      {/* Hero */}
      <div className="gradient-hero relative overflow-hidden rounded-3xl border border-line p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-sun/30 blur-2xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold capitalize text-muted">{fmtDate(today, 'EEEE, d MMMM yyyy')}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{greeting()}, {user.name}!</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
              Учень: <b className="text-ink">{student!.name}</b> · {student!.grade}
              {student!.isDemo && <Badge tone="sun">демонстраційні дані</Badge>}
            </p>
          </div>
          <Button size="lg" icon={<PlusCircle className="h-5 w-5" />} onClick={() => nav('/observation/new')}>Нове спостереження</Button>
        </div>
      </div>

      {backupOld && !student!.isDemo && ds30.observations.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sun bg-sun-soft p-3 text-sm">
          <ShieldAlert className="h-5 w-5 text-sun-dark" />
          <span className="flex-1">Дані зберігаються лише в цьому браузері. {appSettings?.lastBackupAt ? 'Остання резервна копія понад 2 тижні тому.' : 'Резервну копію ще не створено.'}</span>
          <Button size="sm" variant="secondary" onClick={() => nav('/settings#backup')}>Створити копію</Button>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Уроків сьогодні" value={rows.length} icon={<BookOpen className="h-4 w-4" />} hint="у розкладі та записах" />
        <StatCard label="Заповнено" value={`${todayFinal.length}/${Math.max(rows.length, todayFinal.length)}`} icon={<ClipboardCheck className="h-4 w-4" />} tone="mint" hint="спостережень сьогодні" />
        <StatCard label="Залученість" value={fmtPct(m7.engagement.pct)} icon={<Activity className="h-4 w-4" />} hint={ratioHint(m7.engagement, 'уроків, 7 дн.')} lowData={m7.engagement.lowData && m7.engagement.den > 0} />
        <StatCard label="Завершення" value={fmtPct(m7.completion.pct)} icon={<CheckCircle2 className="h-4 w-4" />} tone="mint" hint={ratioHint(m7.completion, 'завдань, 7 дн.')} lowData={m7.completion.lowData && m7.completion.den > 0} />
        <StatCard label="Самостійність" value={fmtPct(m7.independence.pct)} icon={<Footprints className="h-4 w-4" />} tone="sun" hint={ratioHint(m7.independence, 'завдань, 7 дн.')} lowData={m7.independence.lowData && m7.independence.den > 0} />
        <StatCard label="Досягнення" value={weekAchievements} icon={<Award className="h-4 w-4" />} tone="coral" hint="за цей тиждень" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Today's lessons */}
        <Card className="lg:col-span-2" title="Сьогоднішні уроки" subtitle={fmtDate(today)}
          action={<Button size="sm" variant="soft" icon={<Plus className="h-4 w-4" />} onClick={() => setLessonModal({ open: true, lesson: null })}>Додати урок</Button>}>
          {rows.length === 0 ? (
            <EmptyState icon={<BookOpen className="h-7 w-7" />} title="На сьогодні уроків немає" text="Додайте урок до розкладу або одразу створіть спостереження."
              action={<Button onClick={() => nav('/observation/new')}>Створити спостереження</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const status = !r.obs ? 'empty' : r.obs.status === 'draft' ? 'draft' : 'done';
                return (
                  <li key={r.key} className="flex items-center gap-3 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold text-ink" style={{ background: subjectColor(r.subjectId) + '40' }}>{r.number || '—'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{subjectName(r.subjectId)}</div>
                      <div className="truncate text-xs text-muted">{r.topic || 'Тему не вказано'}</div>
                    </div>
                    <span className={cn('hidden items-center gap-1 text-xs font-semibold sm:inline-flex', status === 'done' ? 'text-mint-dark dark:text-mint' : status === 'draft' ? 'text-sun-dark' : 'text-muted')}>
                      {status === 'done' ? <CheckCircle className="h-4 w-4" /> : status === 'draft' ? <FileClock className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                      {status === 'done' ? 'Заповнено' : status === 'draft' ? 'Чернетка' : 'Не заповнено'}
                    </span>
                    {r.obs ? (
                      <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => nav(`/observation/${r.obs!.id}/edit`)}>Редагувати</Button>
                    ) : (
                      <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => nav(`/observation/new?lesson=${r.lesson.id}`)}>Заповнити</Button>
                    )}
                    {r.lesson && !r.obs && (
                      <IconButton label="Видалити урок з розкладу" onClick={async () => {
                        if (await confirm({ title: 'Видалити урок з розкладу?', text: 'Спостережень для цього уроку немає.', danger: true, confirmLabel: 'Видалити' })) {
                          await lessonsRepo.remove(r.lesson.id);
                          toast('Урок видалено');
                        }
                      }}><Trash2 className="h-4 w-4" /></IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Quick actions */}
        <Card title="Швидкі дії">
          <div className="grid gap-2">
            {quick.map((q) => (
              <Link key={q.to} to={q.to} className={cn('focus-ring flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-semibold transition',
                q.primary ? 'border-primary bg-primary text-white hover:bg-primary-dark' : 'border-line hover:border-primary/50 hover:bg-primary-soft/50')}>
                <q.icon className="h-5 w-5" />{q.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card title="Навчальна активність за тиждень" subtitle={`Останні 7 днів · ${m7.lessons} уроків, ${m7.tasks} завдань`}>
          <TrendChart data={series7} height={230} series={[
            { key: 'participation', label: 'Участь у завданнях', color: SERIES[0] },
            { key: 'completion', label: 'Завершені завдання', color: SERIES[2] },
          ]} onPointClick={(p) => nav(`/journal?from=${p.from}&to=${p.to}`)} />
        </Card>
        <Card title="Динаміка самостійності" subtitle="Частка завдань без допомоги, за тижнями (30 днів)">
          <TrendChart data={series30} height={230} series={[{ key: 'independence', label: 'Самостійність', color: SERIES[0] }]}
            onPointClick={(p) => nav(`/journal?from=${p.from}&to=${p.to}`)} />
        </Card>
        <Card title="Розподіл рівнів підтримки" subtitle={`30 днів · ${[...m30.supportCounts.values()].reduce((a, b) => a + b, 0)} завдань з відміткою`}>
          <DonutChart data={supportDonut} height={240} />
        </Card>
        <Card title="Останні досягнення" action={<Link to="/achievements" className="text-sm font-semibold text-primary">Усі</Link>}>
          {!achievementsRecent?.length ? (
            <EmptyState icon={<Award className="h-7 w-7" />} title="Досягнень поки немає" text="Фіксуйте навіть невеликі позитивні зміни." action={<Button size="sm" onClick={() => nav('/achievements?new=1')}>Додати досягнення</Button>} />
          ) : (
            <ul className="space-y-2">
              {achievementsRecent.map((a) => (
                <li key={a.id} className="flex items-start gap-3 rounded-xl bg-bg p-3">
                  <Award className="mt-0.5 h-5 w-5 shrink-0 text-sun-dark" />
                  <div className="min-w-0">
                    <div className="font-semibold">{a.title}</div>
                    <div className="text-xs text-muted">{fmtDate(a.date)} · {labelOf('achievement', a.category)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <LessonModal open={lessonModal.open} lesson={lessonModal.lesson} date={today} nextNumber={nextNumber} onClose={() => setLessonModal({ open: false })} />
    </div>
  );
}
