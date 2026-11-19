import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  PlusCircle, Zap, CalendarDays, BarChart3, FileText, BookOpen, ClipboardCheck, Activity, CheckCircle2, Footprints, Award,
  Plus, ShieldAlert, CalendarClock, Settings2, PenSquare,
} from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { useDataset } from '../hooks/useData';
import { db } from '../db/database';
import { settingsRepo } from '../db/repositories';
import { computeMetrics, periodRange, timeSeries, type Ratio } from '../analytics/engine';
import { Badge, Button, Card, EmptyState, PageSkeleton, StatCard } from '../components/ui';
import { TrendChart, DonutChart, SERIES } from '../components/charts';
import { LessonModal } from '../components/shared/LessonModal';
import { DayEditor, DayLessons, LessonActions, lessonHref } from '../components/schedule';
import { useDaySchedule } from '../schedule/useSchedule';
import type { ResolvedLesson } from '../schedule/scheduleEngine';
import { SUPPORT_LEVELS, labelOf } from '../lib/catalog';
import { fmtDate, fmtPct, todayISO, cn } from '../lib/utils';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Доброї ночі' : h < 12 ? 'Доброго ранку' : h < 18 ? 'Доброго дня' : 'Доброго вечора';
};
const ratioHint = (r: Ratio, what: string) => (r.den ? `${r.num} з ${r.den} ${what}${r.lowData ? ' · мало даних' : ''}` : 'немає оцінених записів');

export default function Dashboard() {
  const { user, student, mode } = useSession();
  const nav = useNavigate();
  const today = todayISO();
  const week = useMemo(() => periodRange('last7'), []);
  const month = useMemo(() => periodRange('last30'), []);
  const curWeek = useMemo(() => periodRange('week'), []);
  const ds7 = useDataset(student!.id, week);
  const ds30 = useDataset(student!.id, month);
  const [lessonModal, setLessonModal] = useState(false);
  const [dayEditor, setDayEditor] = useState(false);
  const [activeLesson, setActiveLesson] = useState<ResolvedLesson | null>(null);
  // Today's lessons come from the Smart Schedule engine (template + exceptions + observations).
  const todayDay = useDaySchedule(student!.id, today);
  const appSettings = useLiveQuery(() => settingsRepo.getUser(user.id), [user.id]);
  const achievementsRecent = useLiveQuery(() => db.achievements.where('studentId').equals(student!.id).reverse().sortBy('date').then((a) => a.slice(0, 4)), [student!.id]);

  if (!ds7 || !ds30 || !todayDay) return <PageSkeleton />;

  const m7 = computeMetrics(ds7);
  const m30 = computeMetrics(ds30);
  const weekAchievements = ds30.achievements.filter((a) => a.date >= curWeek.from && a.date <= curWeek.to).length;
  const series7 = timeSeries(ds7, week, 'day');
  const series30 = timeSeries(ds30, month, 'week');
  const todayLessons = todayDay.lessons.filter((l) => !l.cancelled);
  const todayFilled = todayLessons.filter((l) => l.status === 'filled').length;
  const nextToFill = todayLessons.find((l) => !l.observation && l.status !== 'skipped');
  const nextNumber = Math.max(0, ...todayDay.lessons.map((l) => l.number ?? 0)) + 1;

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

      {backupOld && mode !== 'cloud' && !student!.isDemo && ds30.observations.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sun bg-sun-soft p-3 text-sm">
          <ShieldAlert className="h-5 w-5 text-sun-dark" />
          <span className="flex-1">Дані зберігаються лише в цьому браузері. {appSettings?.lastBackupAt ? 'Остання резервна копія понад 2 тижні тому.' : 'Резервну копію ще не створено.'}</span>
          <Button size="sm" variant="secondary" onClick={() => nav('/settings#backup')}>Створити копію</Button>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Уроків сьогодні" value={todayLessons.length} icon={<BookOpen className="h-4 w-4" />} hint={todayDay.period ? 'за розкладом' : 'розклад не налаштовано'} />
        <StatCard label="Заповнено" value={todayLessons.length ? `${todayFilled}/${todayLessons.length}` : '—'} icon={<ClipboardCheck className="h-4 w-4" />} tone="mint" hint="спостережень сьогодні" />
        <StatCard label="Залученість" value={fmtPct(m7.engagement.pct)} icon={<Activity className="h-4 w-4" />} hint={ratioHint(m7.engagement, 'уроків, 7 дн.')} lowData={m7.engagement.lowData && m7.engagement.den > 0} />
        <StatCard label="Завершення" value={fmtPct(m7.completion.pct)} icon={<CheckCircle2 className="h-4 w-4" />} tone="mint" hint={ratioHint(m7.completion, 'завдань, 7 дн.')} lowData={m7.completion.lowData && m7.completion.den > 0} />
        <StatCard label="Самостійність" value={fmtPct(m7.independence.pct)} icon={<Footprints className="h-4 w-4" />} tone="sun" hint={ratioHint(m7.independence, 'завдань, 7 дн.')} lowData={m7.independence.lowData && m7.independence.den > 0} />
        <StatCard label="Досягнення" value={weekAchievements} icon={<Award className="h-4 w-4" />} tone="coral" hint="за цей тиждень" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Today's lessons (Smart Schedule) */}
        <Card className="lg:col-span-2" title="Уроки сьогодні"
          subtitle={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {todayDay.period ? <Badge tone="blue"><CalendarClock className="h-3 w-3" />{todayDay.period.name}</Badge> : <Badge tone="gray">Розклад не налаштовано</Badge>}
            <span className="capitalize">{fmtDate(today, 'EEEE, d MMMM')}</span>
            {todayLessons.length > 0 && <span>· {todayLessons.length} уроків · заповнено {todayFilled}</span>}
          </span>}
          action={<Link to="/schedule" className="hidden text-sm font-semibold text-primary hover:underline sm:inline">Переглянути розклад</Link>}>
          <DayLessons day={todayDay} />
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            {nextToFill && <Button size="sm" icon={<PenSquare className="h-4 w-4" />} onClick={() => nav(lessonHref(nextToFill))}>Заповнити журнал</Button>}
            {todayDay.period
              ? <Button size="sm" variant="secondary" icon={<Settings2 className="h-4 w-4" />} onClick={() => setDayEditor(true)}>Змінити уроки на сьогодні</Button>
              : <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setLessonModal(true)}>Додати урок</Button>}
            <Button size="sm" variant="ghost" icon={<CalendarClock className="h-4 w-4" />} onClick={() => nav('/schedule')}>Переглянути розклад</Button>
          </div>
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

      <LessonModal open={lessonModal} lesson={null} date={today} nextNumber={nextNumber} onClose={() => setLessonModal(false)} />
      <DayEditor day={dayEditor ? todayDay : null} onClose={() => setDayEditor(false)} onOpenLesson={(l) => { setDayEditor(false); setActiveLesson(l); }} />
      <LessonActions lesson={activeLesson} day={todayDay} onClose={() => setActiveLesson(null)} />
    </div>
  );
}
