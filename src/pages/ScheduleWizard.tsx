import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, CopyPlus, GripVertical, Plus, Save, Trash2, Clock, Wand2, CalendarClock, AlertTriangle,
} from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { Badge, Button, Card, Input, Modal, PageHeader, PageSkeleton, Segmented, Select, Textarea, Toggle } from '../components/ui';
import { useToast } from '../components/ui/feedback';
import { NewSubjectInline } from '../components/schedule';
import { currentSchoolYearLabel } from '../db/repositories';
import { scheduleRepo, emptyPeriod, type PeriodInput } from '../schedule/scheduleRepo';
import {
  addDaysISO, autoTimes, findOverlaps, localTodayISO, overlapResolutions, periodProblem, slotsProblem, templateAt, timeRange, WEEKDAYS, type SlotDraft,
} from '../schedule/scheduleEngine';
import { cn, fmtDate, uid } from '../lib/utils';
import type { SchedulePeriod } from '../types/models';

interface Row { key: string; id?: string; lessonNumber: number; subjectId: string; startTime: string; endTime: string; notes: string }
type Week = Record<number, Row[]>;
const STEPS = ['Загальне', 'Дні тижня', 'Уроки', 'Перегляд', 'Збереження'];

function suggestSemester(today: string) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (m >= 8) return { name: `І семестр ${y}/${y + 1}`, start: `${y}-09-01`, end: `${y}-12-31`, year: `${y}/${y + 1}` };
  return { name: `ІІ семестр ${y - 1}/${y}`, start: `${y}-01-12`, end: `${y}-05-31`, year: `${y - 1}/${y}` };
}

const toRows = (drafts: SlotDraft[]): Week => {
  const w: Week = {};
  for (const d of [...drafts].sort((a, b) => a.lessonNumber - b.lessonNumber)) {
    (w[d.weekday] ??= []).push({ key: uid(), id: d.id, lessonNumber: d.lessonNumber, subjectId: d.subjectId, startTime: d.startTime ?? '', endTime: d.endTime ?? '', notes: d.notes ?? '' });
  }
  return w;
};

export default function ScheduleWizard() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const fromId = params.get('from');
  const nav = useNavigate();
  const toast = useToast();
  const { user, student, students, visibleSubjects, subjectName, subjectColor } = useSession();
  const today = localTodayISO();
  const allPeriods = useLiveQuery(() => scheduleRepo.listPeriods(student!.id), [student!.id]);

  const [step, setStep] = useState(0);
  const [p, setP] = useState<PeriodInput | null>(null);
  const [existing, setExisting] = useState<SchedulePeriod | null>(null);
  const [week, setWeek] = useState<Week>({});
  const [dayTab, setDayTab] = useState(1);
  const [autoNum, setAutoNum] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [overlap, setOverlap] = useState<{ other: SchedulePeriod; options: ReturnType<typeof overlapResolutions> } | null>(null);
  const [effective, setEffective] = useState<{ open: boolean; date: string }>({ open: false, date: today });
  const [newSubjectFor, setNewSubjectFor] = useState<string | null>(null);
  const loaded = useRef(false);

  /* ---------- load ---------- */
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      if (id) {
        const per = await scheduleRepo.getPeriod(id);
        if (!per) return nav('/schedule?tab=manage');
        const slots = await scheduleRepo.listSlots(per.studentId);
        const ref = today < per.startDate ? per.startDate : today > per.endDate ? per.endDate : today;
        setExisting(per);
        setP({ ...per });
        setWeek(toRows(templateAt(per, slots, ref)));
        setDayTab(per.weekdays[0] ?? 1);
        setAutoNum(false);
        return;
      }
      const sug = suggestSemester(today);
      const base = emptyPeriod(student!.id, sug.start, sug.end);
      base.name = sug.name;
      base.academicYear = sug.year || currentSchoolYearLabel();
      if (fromId) {
        const src = await scheduleRepo.getPeriod(fromId);
        if (src) {
          base.weekdays = [...src.weekdays];
          base.basedOnId = src.id;
          base.studentId = src.studentId;
          base.name = '';
          base.startDate = addDaysISO(src.endDate, 1);
          base.endDate = addDaysISO(src.endDate, 140);
          base.academicYear = src.academicYear;
          setWeek(toRows(await scheduleRepo.templateOf(src.id)));
          setAutoNum(false);
        }
      }
      setP(base);
      setDayTab(base.weekdays[0] ?? 1);
    })();
  }, [id, fromId, nav, student, today]);

  /* ---------- derived ---------- */
  const drafts: SlotDraft[] = useMemo(() => (p ? p.weekdays.flatMap((wd) => (week[wd] ?? []).map((r) => ({
    id: r.id, weekday: wd, lessonNumber: r.lessonNumber, subjectId: r.subjectId, startTime: r.startTime || null, endTime: r.endTime || null, notes: r.notes.trim(),
  }))) : []), [p, week]);
  const maxNumber = Math.max(0, ...drafts.map((d) => d.lessonNumber));
  const [bells, setBells] = useState<Record<number, { start: string; end: string }>>({});
  const [even, setEven] = useState({ first: '08:30', duration: '35', breakMin: '10' });
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const dragFrom = useRefIndex();

  if (!p || !allPeriods) return <PageSkeleton />;

  /* ---------- editing helpers ---------- */
  const setDay = (wd: number, rows: Row[]) => setWeek((w) => ({ ...w, [wd]: autoNum ? rows.map((r, i) => ({ ...r, lessonNumber: i + 1 })) : rows }));
  const rows = week[dayTab] ?? [];
  const updateRow = (key: string, patch: Partial<Row>) => setDay(dayTab, rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    // keep the time grid in place when reordering: times stay with positions
    const times = rows.map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
    setDay(dayTab, next.map((r, i) => ({ ...r, ...(times[i] ?? {}) })));
  };
  const addRow = () => {
    const last = rows[rows.length - 1];
    const n = (last?.lessonNumber ?? 0) + 1;
    const bell = bells[n];
    setDay(dayTab, [...rows, { key: uid(), lessonNumber: n, subjectId: visibleSubjects[0]?.id ?? '', startTime: bell?.start ?? '', endTime: bell?.end ?? '', notes: '' }]);
  };
  const validateStep = (s: number): string | null => {
    if (s === 0) return periodProblem(p) ?? (!p.studentId ? 'Оберіть учня' : null);
    if (s === 1) return p.weekdays.length ? null : 'Оберіть хоча б один навчальний день';
    if (s === 2) return drafts.length ? slotsProblem(drafts) : 'Додайте хоча б один урок';
    return null;
  };
  const go = (s: number) => {
    for (let i = 0; i < s; i++) {
      const e = validateStep(i);
      if (e) {
        setStep(i);
        setErr(e);
        return;
      }
    }
    setErr('');
    setStep(s);
  };

  /* ---------- save ---------- */
  const save = async (adjust: { id: string; startDate: string; endDate: string }[] = [], override?: { startDate: string; endDate: string }, effectiveDate?: string) => {
    const per = { ...p, ...(override ?? {}) };
    const e = periodProblem(per) ?? slotsProblem(drafts);
    if (e) return setErr(e);
    // overlap with another active schedule of the same student
    const others = allPeriods.map((x) => adjust.find((a) => a.id === x.id) ? { ...x, ...adjust.find((a) => a.id === x.id)! } : x);
    const over = findOverlaps(others, { id: existing?.id ?? 'new', studentId: per.studentId, startDate: per.startDate, endDate: per.endDate, archived: per.archived });
    if (over.length) {
      setOverlap({ other: over[0], options: overlapResolutions(over[0], per) });
      return;
    }
    // changing an active schedule: choose from which date the change applies
    const started = existing && existing.startDate < today;
    if (started && !effectiveDate) {
      setEffective({ open: true, date: today > per.endDate ? per.endDate : today });
      return;
    }
    setBusy(true);
    try {
      await scheduleRepo.savePeriod(user.id, per, drafts, { effectiveDate: effectiveDate ?? per.startDate, adjust });
      toast(existing ? 'Розклад оновлено' : 'Розклад збережено — уроки з’являться на відповідні дати');
      nav('/schedule');
    } catch (ex) {
      setErr((ex as Error).message);
    }
    setBusy(false);
  };

  const studentName = students.find((s) => s.id === p.studentId)?.name ?? '';

  return (
    <div className="animate-in mx-auto max-w-5xl">
      <PageHeader title={existing ? `Редагування: ${existing.name}` : fromId ? 'Новий розклад на основі попереднього' : 'Новий розклад'}
        subtitle={studentName} icon={<CalendarClock className="h-5 w-5" />}
        actions={<Button variant="secondary" onClick={() => nav('/schedule?tab=manage')}>Скасувати</Button>} />

      <ol className="mb-5 flex flex-wrap gap-2" aria-label="Кроки">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}
              className={cn('focus-ring flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                i === step ? 'border-primary bg-primary text-white' : i < step ? 'border-mint bg-mint-soft text-mint-dark' : 'border-line bg-card text-muted')}>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/30 text-xs">{i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card title="Крок 1. Загальна інформація">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Назва розкладу" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="Наприклад: І семестр 2026/2027" list="schedule-names" />
            <datalist id="schedule-names">
              {['І семестр', 'ІІ семестр', 'Тимчасовий розклад', 'Скорочений розклад'].map((n) => <option key={n} value={`${n}${n.includes('семестр') ? ` ${p.academicYear}` : ''}`} />)}
            </datalist>
            <Input label="Навчальний рік" value={p.academicYear} onChange={(e) => setP({ ...p, academicYear: e.target.value })} placeholder="2026/2027" />
            <Input label="Початкова дата" type="date" value={p.startDate} onChange={(e) => setP({ ...p, startDate: e.target.value })} />
            <Input label="Кінцева дата" type="date" value={p.endDate} min={p.startDate} onChange={(e) => setP({ ...p, endDate: e.target.value })} />
            <Select label="Учень" value={p.studentId} onChange={(e) => setP({ ...p, studentId: e.target.value })} disabled={!!existing}>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${s.grade}` : ''}</option>)}
            </Select>
            <Textarea className="sm:col-span-2" label="Опис (необов’язково)" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
          </div>
          <p className="mt-3 text-xs text-muted">Дати — лише пропозиція: вкажіть фактичні межі навчального періоду. Розклад застосовується тільки в цих межах.</p>
        </Card>
      )}

      {step === 1 && (
        <Card title="Крок 2. Дні тижня" subtitle="За замовчуванням навчальні дні — понеділок–п’ятниця">
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const on = p.weekdays.includes(d.n);
              return (
                <button key={d.n} aria-pressed={on} onClick={() => setP({ ...p, weekdays: on ? p.weekdays.filter((x) => x !== d.n) : [...p.weekdays, d.n].sort() })}
                  className={cn('focus-ring flex min-w-[120px] items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition', on ? 'border-primary bg-primary-soft text-primary-dark dark:text-primary' : 'border-line bg-card text-muted')}>
                  <span className={cn('flex h-5 w-5 items-center justify-center rounded-md border', on ? 'border-primary bg-primary text-white' : 'border-line')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                  {d.label}{d.n > 5 && <span className="text-xs font-normal">(необов’язково)</span>}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card title="Крок 3. Уроки" subtitle="Предмет обирається зі списку Inclusive Insight. Порядок змінюється перетягуванням або стрілками.">
            <Segmented<string> className="mb-3" value={String(dayTab)} onChange={(v) => setDayTab(Number(v))}
              options={p.weekdays.map((wd) => ({ key: String(wd), label: <span>{WEEKDAYS[wd - 1].short} <span className="text-xs opacity-70">{(week[wd] ?? []).length}</span></span> }))} />
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <Toggle checked={autoNum} onChange={(v) => { setAutoNum(v); if (v) setWeek((w) => Object.fromEntries(Object.entries(w).map(([k, r]) => [k, r.map((x, i) => ({ ...x, lessonNumber: i + 1 }))]))); }}
                label="Автоматична нумерація" />
            </div>
            {rows.length === 0 && <p className="rounded-xl bg-bg p-4 text-center text-sm text-muted">У цей день уроків ще немає.</p>}
            <ul className="space-y-2">
              {rows.map((r, i) => (
                <li key={r.key} draggable onDragStart={() => (dragFrom.current = i)} onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}
                  className="rounded-2xl border border-line bg-card p-2.5" style={{ borderLeft: `4px solid ${subjectColor(r.subjectId)}` }}>
                  <div className="grid grid-cols-[auto_64px_1fr] items-end gap-2 sm:grid-cols-[auto_64px_1fr_132px_132px_1fr_auto]">
                    <span className="flex h-11 cursor-grab items-center text-muted" title="Перетягніть, щоб змінити порядок"><GripVertical className="h-5 w-5" /></span>
                    <Input label="№" type="number" min={0} max={20} value={r.lessonNumber} disabled={autoNum} onChange={(e) => updateRow(r.key, { lessonNumber: Number(e.target.value) })} />
                    <Select label="Предмет" value={r.subjectId} onChange={(e) => (e.target.value === '__new' ? setNewSubjectFor(r.key) : updateRow(r.key, { subjectId: e.target.value }))}>
                      {!r.subjectId && <option value="">Оберіть…</option>}
                      {visibleSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      <option value="__new">+ Новий предмет…</option>
                    </Select>
                    <div className="col-span-2 col-start-2 grid grid-cols-2 gap-2 sm:contents">
                      <Input label="Початок" type="time" value={r.startTime} onChange={(e) => updateRow(r.key, { startTime: e.target.value })} />
                      <Input label="Кінець" type="time" value={r.endTime} onChange={(e) => updateRow(r.key, { endTime: e.target.value })} />
                    </div>
                    <Input className="col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto" label="Примітка" value={r.notes} onChange={(e) => updateRow(r.key, { notes: e.target.value })} />
                    <div className="col-span-3 flex justify-end gap-1 sm:col-span-1">
                      <IconBtn label="Вище" onClick={() => move(i, i - 1)}><ArrowUp className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Нижче" onClick={() => move(i, i + 1)}><ArrowDown className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Дублювати урок" onClick={() => { const next = [...rows]; next.splice(i + 1, 0, { ...r, key: uid(), id: undefined, lessonNumber: r.lessonNumber + 1 }); setDay(dayTab, next); }}><CopyPlus className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Видалити урок" onClick={() => setDay(dayTab, rows.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </div>
                  {newSubjectFor === r.key && (
                    <div className="mt-2"><NewSubjectInline onCancel={() => setNewSubjectFor(null)} onCreated={(sid) => { updateRow(r.key, { subjectId: sid }); setNewSubjectFor(null); }} /></div>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={<Plus className="h-4 w-4" />} onClick={addRow}>Урок</Button>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card title="Копіювати день" subtitle={`${WEEKDAYS[dayTab - 1].label} → інші дні (їхні уроки буде замінено)`}>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {p.weekdays.filter((w) => w !== dayTab).map((w) => (
                  <button key={w} aria-pressed={copyTargets.includes(w)} onClick={() => setCopyTargets((t) => (t.includes(w) ? t.filter((x) => x !== w) : [...t, w]))}
                    className={cn('focus-ring rounded-full border px-3 py-1 text-sm font-semibold', copyTargets.includes(w) ? 'border-primary bg-primary-soft text-primary-dark' : 'border-line text-muted')}>{WEEKDAYS[w - 1].short}</button>
                ))}
              </div>
              <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} disabled={!copyTargets.length || !rows.length} onClick={() => {
                setWeek((w) => ({ ...w, ...Object.fromEntries(copyTargets.map((t) => [t, rows.map((r) => ({ ...r, key: uid(), id: undefined }))])) }));
                toast(`Скопійовано в: ${copyTargets.map((t) => WEEKDAYS[t - 1].short).join(', ')}`);
                setCopyTargets([]);
              }}>Копіювати</Button>
            </Card>
            <Card title="Однакова тривалість" subtitle="Час для всіх днів за порядком уроків">
              <div className="grid grid-cols-3 gap-2">
                <Input label="Перший" type="time" value={even.first} onChange={(e) => setEven({ ...even, first: e.target.value })} />
                <Input label="Урок, хв" type="number" min={5} max={120} value={even.duration} onChange={(e) => setEven({ ...even, duration: e.target.value })} />
                <Input label="Перерва" type="number" min={0} max={60} value={even.breakMin} onChange={(e) => setEven({ ...even, breakMin: e.target.value })} />
              </div>
              <Button size="sm" variant="secondary" className="mt-3" icon={<Wand2 className="h-4 w-4" />} onClick={() => {
                const d = Number(even.duration);
                const b = Number(even.breakMin);
                if (!even.first || !(d >= 5)) return toast('Вкажіть час першого уроку й тривалість', 'error');
                const times = autoTimes(even.first, 20, d, b);
                setWeek((w) => Object.fromEntries(Object.entries(w).map(([k, rs]) => [k, rs.map((r, i) => ({ ...r, startTime: times[i].startTime, endTime: times[i].endTime }))])));
                const bl: Record<number, { start: string; end: string }> = {};
                times.slice(0, Math.max(maxNumber, 6)).forEach((t, i) => (bl[i + 1] = { start: t.startTime, end: t.endTime }));
                setBells(bl);
                toast('Час уроків встановлено для всіх днів');
              }}>Застосувати</Button>
            </Card>
            <Card title="Масове редагування часу" subtitle="Дзвінки: однаковий час для уроку з тим самим номером">
              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {Array.from({ length: Math.max(maxNumber, 1) }, (_, i) => i + 1).map((n) => (
                  <div key={n} className="grid grid-cols-[28px_1fr_1fr] items-center gap-2">
                    <span className="text-sm font-bold text-muted">{n}</span>
                    <Input type="time" aria-label={`Початок уроку ${n}`} value={bells[n]?.start ?? ''} onChange={(e) => setBells({ ...bells, [n]: { start: e.target.value, end: bells[n]?.end ?? '' } })} />
                    <Input type="time" aria-label={`Кінець уроку ${n}`} value={bells[n]?.end ?? ''} onChange={(e) => setBells({ ...bells, [n]: { start: bells[n]?.start ?? '', end: e.target.value } })} />
                  </div>
                ))}
              </div>
              <Button size="sm" variant="secondary" className="mt-3" icon={<Clock className="h-4 w-4" />} onClick={() => {
                setWeek((w) => Object.fromEntries(Object.entries(w).map(([k, rs]) => [k, rs.map((r) => (bells[r.lessonNumber]?.start || bells[r.lessonNumber]?.end ? { ...r, startTime: bells[r.lessonNumber].start, endTime: bells[r.lessonNumber].end } : r))])));
                toast('Час оновлено в усіх днях');
              }}>Застосувати до всіх днів</Button>
            </Card>
          </div>
          {allPeriods.filter((x) => x.id !== existing?.id).length > 0 && (
            <Card title="Копіювати весь тижневий розклад" subtitle="З іншого розкладу (поточні уроки буде замінено)">
              <div className="flex flex-wrap gap-2">
                {allPeriods.filter((x) => x.id !== existing?.id).map((x) => (
                  <Button key={x.id} size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={async () => {
                    const src = await scheduleRepo.templateOf(x.id);
                    const rowsBy = toRows(src);
                    // keep ids of the schedule being edited where weekday+number match, so history versioning works
                    if (existing) for (const [wd, rs] of Object.entries(rowsBy)) for (const r of rs) r.id = (week[Number(wd)] ?? []).find((o) => o.lessonNumber === r.lessonNumber)?.id;
                    else for (const rs of Object.values(rowsBy)) for (const r of rs) r.id = undefined;
                    setWeek(rowsBy);
                    toast(`Скопійовано тиждень із «${x.name}»`);
                  }}>{x.name}</Button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {step === 3 && (
        <Card title="Крок 4. Попередній перегляд" subtitle={`${p.name} · ${fmtDate(p.startDate, 'd MMM yyyy')} — ${fmtDate(p.endDate, 'd MMM yyyy')}`}>
          <PreviewTable drafts={drafts} weekdays={p.weekdays} subjectName={subjectName} subjectColor={subjectColor} />
        </Card>
      )}

      {step === 4 && (
        <Card title="Крок 5. Збереження">
          <ul className="space-y-1.5 text-sm">
            <li><b>{p.name}</b> · {p.academicYear}</li>
            <li>Діє: {fmtDate(p.startDate, 'd MMMM yyyy')} — {fmtDate(p.endDate, 'd MMMM yyyy')}</li>
            <li>Навчальні дні: {p.weekdays.map((w) => WEEKDAYS[w - 1].short).join(', ')}</li>
            <li>Уроків на тиждень: {drafts.length}</li>
          </ul>
          <p className="mt-3 text-sm text-muted">Окремі записи на кожен урок не створюються: уроки на будь-яку дату обчислюються з тижневого шаблону. Зміни окремих днів зберігаються окремо.</p>
          <Button size="lg" className="mt-4" loading={busy} icon={<Save className="h-5 w-5" />} onClick={() => save()}>Зберегти розклад</Button>
        </Card>
      )}

      {err && <p className="mt-4 flex items-center gap-2 rounded-xl bg-coral-soft p-3 text-sm text-coral-dark" role="alert"><AlertTriangle className="h-4 w-4" />{err}</p>}

      <div className="mt-5 flex justify-between gap-2">
        <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} disabled={step === 0} onClick={() => { setErr(''); setStep(step - 1); }}>Назад</Button>
        {step < 4 && <Button icon={<ChevronRight className="h-4 w-4" />} onClick={() => go(step + 1)}>Далі</Button>}
      </div>

      <Modal open={!!overlap} onClose={() => setOverlap(null)} title="Дати перетинаються з іншим розкладом" size="sm"
        footer={<Button variant="secondary" onClick={() => setOverlap(null)}>Скасувати створення</Button>}>
        {overlap && (
          <div className="space-y-3 text-sm">
            <p>Розклад «<b>{overlap.other.name}</b>» ({fmtDate(overlap.other.startDate, 'd.MM.yyyy')} — {fmtDate(overlap.other.endDate, 'd.MM.yyyy')}) діє в ті самі дні. Для одного учня може діяти лише один основний розклад.</p>
            {overlap.options.map((o) => (
              <button key={o.kind} className="focus-ring w-full rounded-xl border border-line p-3 text-left hover:bg-primary-soft" onClick={() => {
                setOverlap(null);
                if (o.kind === 'trim-existing') void save([{ id: overlap.other.id, startDate: o.startDate, endDate: o.endDate }]);
                else {
                  setP({ ...p, startDate: o.startDate, endDate: o.endDate });
                  void save([], { startDate: o.startDate, endDate: o.endDate });
                }
              }}>
                <b>{o.label}</b>
                <span className="block text-xs text-muted">{o.kind === 'trim-existing' ? `«${overlap.other.name}»` : `«${p.name}»`}: {fmtDate(o.startDate, 'd.MM.yyyy')} — {fmtDate(o.endDate, 'd.MM.yyyy')}</span>
              </button>
            ))}
            {overlap.options.length === 0 && <p className="text-muted">Змініть дати на кроці 1 або архівуйте інший розклад.</p>}
          </div>
        )}
      </Modal>

      <Modal open={effective.open} onClose={() => setEffective({ ...effective, open: false })} title="З якої дати діють зміни?" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setEffective({ ...effective, open: false })}>Скасувати</Button>
          <Button loading={busy} onClick={() => { setEffective({ ...effective, open: false }); void save([], undefined, effective.date); }}>Зберегти</Button>
        </>}>
        <p className="mb-3 rounded-xl bg-sun-soft p-3 text-sm">Ця зміна може вплинути на майбутні уроки. Оберіть дату початку дії. Уроки до цієї дати залишаться за попередньою версією розкладу, наявні спостереження не зміняться.</p>
        <Input label="Діє з" type="date" value={effective.date} min={p.startDate} max={p.endDate} onChange={(e) => setEffective({ ...effective, date: e.target.value })} />
        {existing && <p className="mt-2 text-xs text-muted">Зміна дат чи назви розкладу діє одразу.</p>}
      </Modal>
    </div>
  );
}

function useRefIndex() {
  return useRef<number | null>(null);
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-primary-soft hover:text-ink">{children}</button>;
}

export function PreviewTable({ drafts, weekdays, subjectName, subjectColor }: { drafts: SlotDraft[]; weekdays: number[]; subjectName: (id: string) => string; subjectColor: (id: string) => string }) {
  const numbers = [...new Set(drafts.map((d) => d.lessonNumber))].sort((a, b) => a - b);
  if (!numbers.length) return <p className="text-sm text-muted">Уроків ще немає.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] table-fixed text-sm">
        <thead><tr><th className="w-10 p-2 text-left text-xs text-muted">№</th>{weekdays.map((w) => <th key={w} className="p-2 text-left">{WEEKDAYS[w - 1].label}</th>)}</tr></thead>
        <tbody>
          {numbers.map((n) => (
            <tr key={n} className="border-t border-line">
              <td className="p-2 font-bold text-muted">{n}</td>
              {weekdays.map((w) => {
                const d = drafts.find((x) => x.weekday === w && x.lessonNumber === n);
                return (
                  <td key={w} className="p-1.5 align-top">
                    {d && (
                      <div className="rounded-xl p-2" style={{ background: subjectColor(d.subjectId) + '30' }}>
                        <div className="truncate font-semibold">{subjectName(d.subjectId)}</div>
                        <div className="text-[11px] text-muted">{timeRange({ startTime: d.startTime, endTime: d.endTime })}</div>
                        {d.notes && <Badge tone="gray" className="mt-1">{d.notes}</Badge>}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
