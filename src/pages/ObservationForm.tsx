import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Zap, ClipboardList, Layers, Plus, Trash2, Save, FilePlus2, FileClock, X, RotateCcw, ListChecks, Copy } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { db } from '../db/database';
import {
  draftsRepo, emptyObservation, observationsRepo, templatesRepo, type ObservationInput, type TaskInput,
} from '../db/repositories';
import {
  ATTENTION, BEHAVIORS, COMMUNICATION, ENGAGEMENT, EVENT_TYPES, INTERACTIONS, INTERACTION_LEVELS, MOTIVATION, PARTICIPATION,
  SUBJECT_FIELD_RATINGS, SUPPORT_EFFECT, SUPPORT_LEVELS, TASK_RESULTS, TASK_START, TASK_TYPES, UNITS, type Option,
} from '../lib/catalog';
import { Badge, Button, Card, ChipGroup, IconButton, Input, PageSkeleton, SaveIndicator, Segmented, Select, Textarea } from '../components/ui';
import { useCloudSaveFeedback } from '../components/cloud';
import { useSyncStatus } from '../hooks/useSync';
import { CloudOff } from 'lucide-react';
import { useConfirm, useToast } from '../components/ui/feedback';
import { cn, debounce, fmtDate, todayISO } from '../lib/utils';
import type { ObservationMode } from '../types/models';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Section({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('card p-4 sm:p-5', className)}>
      <h2 className="section-title">{title}</h2>
      {hint && <p className="hint mb-3 mt-0.5">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

const emptyTask = (): TaskInput => ({ type: 'written', title: '', offered: null, completed: null, unit: 'слів', support: null, participation: null, result: null, comment: '' });

export default function ObservationForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { user, student, visibleSubjects, subjects, strategies, mode: appMode } = useSession();
  const sync = useSyncStatus();
  const saveFeedback = useCloudSaveFeedback();
  const isEdit = !!id;
  const draftKey = isEdit ? `edit:${id}` : `new:${user.id}:${student!.id}`;

  const [form, setForm] = useState<ObservationInput | null>(null);
  const [baseline, setBaseline] = useState<string>('');
  const [restore, setRestore] = useState<{ data: ObservationInput; at: number } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [busy, setBusy] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const templates = useLiveQuery(() => templatesRepo.listAll(user.id), [user.id]) ?? [];

  /* ---------- initial load ---------- */
  useEffect(() => {
    const key = `${draftKey}|${params.get('lesson') ?? ''}|${params.get('date') ?? ''}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    (async () => {
      let initial: ObservationInput | undefined;
      if (isEdit) {
        initial = await observationsRepo.loadFull(id!);
        if (!initial) {
          toast('Запис не знайдено', 'error');
          return nav('/journal');
        }
      } else {
        initial = emptyObservation(student!.id, params.get('subject') ?? visibleSubjects[0]?.id ?? '', params.get('date') ?? todayISO());
        const m = params.get('mode') as ObservationMode | null;
        if (m && ['quick', 'standard', 'detailed'].includes(m)) initial.mode = m;
        const lessonId = params.get('lesson');
        if (lessonId) {
          const l = await db.lessons.get(lessonId);
          if (l) Object.assign(initial, { lessonId: l.id, date: l.date, lessonNumber: l.number, subjectId: l.subjectId, topic: l.topic });
        }
        if (initial.mode === 'quick' && !initial.events.length) initial.events = [{ type: 'learning', tags: [], description: '', time: '' }];
      }
      setForm(initial);
      setBaseline(JSON.stringify(initial));
      const d = await draftsRepo.get(draftKey);
      if (d && (!isEdit || d.updatedAt > ((initial as any).updatedAt ?? 0))) {
        const data = d.data as ObservationInput;
        if (JSON.stringify(data) !== JSON.stringify(initial)) setRestore({ data, at: d.updatedAt });
      }
    })();
  }, [draftKey, id, isEdit, params, student, visibleSubjects, nav, toast]);

  /* ---------- autosave ---------- */
  const autosave = useMemo(() => debounce(async (data: ObservationInput) => {
    try {
      await draftsRepo.put(user.id, draftKey, data);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, 700), [draftKey, user.id]);
  useEffect(() => () => autosave.cancel(), [autosave]);

  const dirty = form ? JSON.stringify(form) !== baseline : false;
  const update = useCallback((patch: Partial<ObservationInput>) => {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, ...patch };
      setSaveState('saving');
      autosave(next);
      return next;
    });
  }, [autosave]);

  /* ---------- custom category options from templates ---------- */
  const catOptions = useCallback((key: string, defaults: Option[]) => {
    const t = templates.find((x) => x.kind === 'category' && x.key === key);
    return {
      options: [...defaults, ...(t?.options ?? []).map((label) => ({ key: `c:${label}`, label }))],
      hidden: t?.hiddenOptions ?? [],
    };
  }, [templates]);

  const subject = subjects.find((s) => s.id === form?.subjectId);
  const subjectTpl = templates.find((t) => t.kind === 'subject' && t.key === subject?.id);
  const subjectFields = templatesRepo.subjectFields(subject, subjectTpl);

  /* ---------- save ---------- */
  const validate = (f: ObservationInput) => {
    if (!f.date) return 'Вкажіть дату';
    if (!f.subjectId) return 'Оберіть предмет';
    for (const t of f.tasks) {
      if (t.offered !== null && t.completed !== null && t.completed > t.offered * 10) return `Перевірте кількість у завданні «${t.title || 'без назви'}»`;
      if ((t.offered !== null && t.offered < 0) || (t.completed !== null && t.completed < 0)) return 'Кількість не може бути від’ємною';
    }
    return null;
  };

  const doSave = async (status: 'final' | 'draft', next?: 'journal' | 'next' | 'stay') => {
    if (!form) return;
    const err = validate(form);
    if (err) return toast(err, 'error');
    setBusy(true);
    setSaveState('saving');
    autosave.cancel();
    try {
      const saved = await observationsRepo.save(user.id, { ...form, status: isEdit && status === 'draft' && form.status === 'final' ? 'draft' : status });
      await draftsRepo.remove(draftKey);
      setSaveState('saved');
      saveFeedback(status === 'draft' ? 'Чернетку збережено' : 'Спостереження збережено');
      if (next === 'next') {
        const dayLessons = await db.lessons.where('[studentId+date]').equals([form.studentId, form.date]).sortBy('number');
        const curNum = saved.lessonNumber ?? 0;
        const nl = dayLessons.find((l) => l.number > curNum && l.id !== saved.lessonId);
        const fresh = emptyObservation(form.studentId, nl?.subjectId ?? form.subjectId, form.date);
        Object.assign(fresh, { mode: form.mode, lessonNumber: nl?.number ?? (curNum ? curNum + 1 : null), lessonId: nl?.id, topic: nl?.topic ?? '' });
        if (fresh.mode === 'quick') fresh.events = [{ type: 'learning', tags: [], description: '', time: '' }];
        if (isEdit) {
          nav(`/observation/new?date=${form.date}${nl ? `&lesson=${nl.id}` : ''}&mode=${form.mode}`);
        } else {
          setForm(fresh);
          setBaseline(JSON.stringify(fresh));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else if (next !== 'stay') {
        setBaseline(JSON.stringify(form));
        nav(isEdit ? `/journal/${saved.id}` : '/journal');
      }
    } catch (e) {
      setSaveState('error');
      toast('Помилка збереження: ' + (e as Error).message + '. Форму не закрито — спробуйте ще раз.', 'error');
    }
    setBusy(false);
  };

  // Ctrl/Cmd+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSave('final');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cancel = async () => {
    if (dirty && !(await confirm({ title: 'Скасувати зміни?', text: 'Незбережені зміни та автозбережена чернетка цієї форми будуть видалені.', danger: true, confirmLabel: 'Скасувати зміни' }))) return;
    autosave.cancel();
    await draftsRepo.remove(draftKey);
    nav(-1);
  };

  if (!form) return <PageSkeleton />;
  const mode = form.mode;
  const detailed = mode === 'detailed';
  const quick = mode === 'quick';

  const setTask = (i: number, patch: Partial<TaskInput>) => {
    const tasks = form.tasks.map((t, j) => {
      if (j !== i) return t;
      const nt = { ...t, ...patch };
      // Suggest a result from numbers if the user hasn't chosen one explicitly
      if (('offered' in patch || 'completed' in patch) && nt.offered !== null && nt.completed !== null && nt.offered > 0 && !('result' in patch)) {
        nt.result = nt.completed >= nt.offered ? 'full' : nt.completed > 0 ? 'partial' : 'not_done';
      }
      return nt;
    });
    update({ tasks });
  };
  const num = (v: string) => (v === '' ? null : Math.max(0, Number(v)));

  const behaviorOpts = catOptions('behaviors', BEHAVIORS);
  const commOpts = catOptions('communication', COMMUNICATION);
  const motivOpts = catOptions('motivation', MOTIVATION);
  const supportOpts = catOptions('supportLevels', SUPPORT_LEVELS);
  const quickEvent = form.events[0];

  return (
    <div className="animate-in mx-auto max-w-4xl pb-24">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{isEdit ? 'Редагування спостереження' : 'Нове спостереження'}</h1>
          <p className="text-sm text-muted">
            {student!.name} · {fmtDate(form.date)}
            {form.status === 'draft' && isEdit && <Badge tone="sun" className="ml-2">чернетка</Badge>}
          </p>
        </div>
        <Segmented<ObservationMode> value={mode} onChange={(m) => update({ mode: m, events: m === 'quick' && !form.events.length ? [{ type: 'learning', tags: [], description: '', time: '' }] : form.events })}
          options={[
            { key: 'quick', label: <span className="inline-flex items-center gap-1.5"><Zap className="h-4 w-4" />Швидкий</span> },
            { key: 'standard', label: <span className="inline-flex items-center gap-1.5"><ClipboardList className="h-4 w-4" />Стандартний</span> },
            { key: 'detailed', label: <span className="inline-flex items-center gap-1.5"><Layers className="h-4 w-4" />Детальний</span> },
          ]} />
      </div>

      {restore && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary-soft p-3 text-sm">
          <RotateCcw className="h-5 w-5 text-primary" />
          <span className="flex-1">Знайдено автозбережену чернетку від {new Date(restore.at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</span>
          <Button size="sm" onClick={() => { setForm(restore.data); setRestore(null); }}>Відновити</Button>
          <Button size="sm" variant="ghost" onClick={async () => { await draftsRepo.remove(draftKey); setRestore(null); }}>Почати заново</Button>
        </div>
      )}

      <div className="space-y-4">
        {/* General */}
        <Section title="Загальна інформація">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input label="Дата" type="date" value={form.date} max="2100-12-31" onChange={(e) => update({ date: e.target.value, lessonId: undefined })} required />
            {!quick && <Input label="№ уроку" type="number" min={1} max={12} inputMode="numeric" value={form.lessonNumber ?? ''} onChange={(e) => update({ lessonNumber: e.target.value ? Number(e.target.value) : null })} />}
            <Select label="Предмет" className={quick ? 'col-span-1 sm:col-span-3' : 'col-span-2'} value={form.subjectId} onChange={(e) => update({ subjectId: e.target.value, subjectFields: {} })} required>
              {!form.subjectId && <option value="">Оберіть…</option>}
              {[...visibleSubjects, ...(subject && subject.hidden ? [subject] : [])].map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            {!quick && <Input label="Тема" className="col-span-2 sm:col-span-3" value={form.topic} onChange={(e) => update({ topic: e.target.value })} placeholder="Тема уроку" />}
            {detailed && <Input label="Тривалість, хв" type="number" min={1} max={240} inputMode="numeric" value={form.duration ?? ''} onChange={(e) => update({ duration: e.target.value ? Number(e.target.value) : null })} />}
          </div>
        </Section>

        {quick && (
          <>
            <Section title="Тип події">
              <ChipGroup multiple={false} options={EVENT_TYPES} value={quickEvent?.type ?? null}
                onChange={(v) => update({ events: [{ ...(quickEvent ?? { tags: [], description: '', time: '' }), type: v ?? 'other' }, ...form.events.slice(1)] })} />
            </Section>
            <Section title="Швидкий вибір характеристики" hint="Можна обрати кілька. Це педагогічні спостереження, не діагнози.">
              <ChipGroup options={behaviorOpts.options} hidden={behaviorOpts.hidden} value={form.behaviors} onChange={(v) => update({ behaviors: v })} allowCustom />
            </Section>
            <Section title="Нотатка (необов'язково)">
              <Textarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Що саме сталося?" rows={3} aria-label="Нотатка" />
            </Section>
          </>
        )}

        {!quick && (
          <>
            <Section title="Поведінка" hint="Множинний вибір. Відмітки описують спостережувану поведінку й не є медичними чи психологічними висновками.">
              <ChipGroup options={behaviorOpts.options} hidden={behaviorOpts.hidden} value={form.behaviors} onChange={(v) => update({ behaviors: v })} allowCustom />
            </Section>

            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Навчальна залученість">
                <ChipGroup multiple={false} options={ENGAGEMENT} value={form.engagement} onChange={(v) => update({ engagement: v })} />
              </Section>
              <Section title="Початок завдання">
                <ChipGroup multiple={false} options={TASK_START} value={form.taskStart} onChange={(v) => update({ taskStart: v })} />
              </Section>
            </div>

            {/* Tasks */}
            <Section title="Виконання завдань" hint="Додайте кожне завдання окремо. Відсоток рахується лише в межах одного завдання — різні одиниці не змішуються.">
              <div className="space-y-3">
                {form.tasks.map((t, i) => {
                  const pctDone = t.offered && t.completed !== null ? Math.round((t.completed / t.offered) * 100) : null;
                  return (
                    <div key={i} className="rounded-2xl border border-line bg-bg/60 p-3 sm:p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-bold"><ListChecks className="h-4 w-4 text-primary" />Завдання {i + 1}
                          {pctDone !== null && <Badge tone={pctDone >= 100 ? 'mint' : pctDone > 0 ? 'blue' : 'gray'}>{t.completed} з {t.offered} {t.unit} · {pctDone}%</Badge>}
                        </span>
                        <div className="flex">
                          <IconButton label="Дублювати завдання" onClick={() => update({ tasks: [...form.tasks.slice(0, i + 1), { ...t }, ...form.tasks.slice(i + 1)] })}><Copy className="h-4 w-4" /></IconButton>
                          <IconButton label="Видалити завдання" onClick={() => update({ tasks: form.tasks.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></IconButton>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                        <Select label="Тип" className="col-span-2 sm:col-span-2" value={t.type} onChange={(e) => setTask(i, { type: e.target.value })}>
                          {TASK_TYPES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </Select>
                        <Input label="Назва" className="col-span-2 sm:col-span-4" value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} placeholder="Напр.: написати слова за зразком" />
                        <Input label="Запропоновано" type="number" min={0} inputMode="numeric" className="col-span-1 sm:col-span-2" value={t.offered ?? ''} onChange={(e) => setTask(i, { offered: num(e.target.value) })} />
                        <Input label="Виконано" type="number" min={0} inputMode="numeric" className="col-span-1 sm:col-span-2" value={t.completed ?? ''} onChange={(e) => setTask(i, { completed: num(e.target.value) })} />
                        <div className="col-span-2 sm:col-span-2">
                          <Input label="Одиниця" list="units" value={t.unit} onChange={(e) => setTask(i, { unit: e.target.value })} />
                        </div>
                        <Select label="Рівень підтримки" className="col-span-2 sm:col-span-3" value={t.support ?? ''} onChange={(e) => setTask(i, { support: e.target.value || null })}>
                          <option value="">Не зазначено</option>
                          {SUPPORT_LEVELS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </Select>
                        <div className="col-span-2 sm:col-span-3">
                          <span className="label">Участь</span>
                          <ChipGroup multiple={false} options={PARTICIPATION} value={t.participation} onChange={(v) => setTask(i, { participation: v })} />
                        </div>
                        <div className="col-span-2 sm:col-span-6">
                          <span className="label">Результат</span>
                          <ChipGroup multiple={false} options={TASK_RESULTS} value={t.result} onChange={(v) => setTask(i, { result: v })} />
                        </div>
                        <Input label="Коментар" className="col-span-2 sm:col-span-6" value={t.comment} onChange={(e) => setTask(i, { comment: e.target.value })} placeholder="Необов'язково" />
                      </div>
                    </div>
                  );
                })}
                <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                <Button variant="soft" icon={<Plus className="h-4 w-4" />} onClick={() => update({ tasks: [...form.tasks, emptyTask()] })}>Додати завдання</Button>
              </div>
            </Section>

            <Section title="Рівень підтримки на уроці" hint="Які види підтримки застосовувалися загалом.">
              <ChipGroup options={supportOpts.options} hidden={supportOpts.hidden} value={form.supportLevels} onChange={(v) => update({ supportLevels: v })} allowCustom />
            </Section>

            <Section title="Стратегії та їх ефективність">
              <span className="label">Застосовані стратегії</span>
              <ChipGroup options={strategies.filter((s) => !s.hidden || form.strategyIds.includes(s.id)).map((s) => ({ key: s.id, label: s.name }))} value={form.strategyIds} onChange={(v) => update({ strategyIds: v })} />
              <span className="label mt-4">Ефективність підтримки</span>
              <ChipGroup multiple={false} options={SUPPORT_EFFECT} value={form.supportEffect} onChange={(v) => update({ supportEffect: v })} />
            </Section>
          </>
        )}

        {detailed && (
          <>
            <Section title="Увага">
              <ChipGroup multiple={false} options={ATTENTION} value={form.attention} onChange={(v) => update({ attention: v })} />
              <Input label="Тривалість роботи над завданням, хв (необов'язково)" type="number" min={0} max={120} inputMode="numeric" className="mt-3 max-w-xs" value={form.attentionMinutes ?? ''} onChange={(e) => update({ attentionMinutes: e.target.value ? Number(e.target.value) : null })} />
            </Section>
            <Section title="Комунікація">
              <ChipGroup options={commOpts.options} hidden={commOpts.hidden} value={form.communication} onChange={(v) => update({ communication: v })} allowCustom />
            </Section>
            <Section title="Мотивація" hint="Що допомогло залучити учня?">
              <ChipGroup options={motivOpts.options} hidden={motivOpts.hidden} value={form.motivation} onChange={(v) => update({ motivation: v })} allowCustom />
            </Section>
            <Section title="Взаємодія" hint="Оберіть рівень участі для кожного виду взаємодії.">
              <div className="space-y-3">
                {INTERACTIONS.map((it) => (
                  <div key={it.key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-semibold">{it.label}</span>
                    <Segmented size="sm" value={(form.interactions[it.key] ?? 'unset') as any}
                      onChange={(v: string) => {
                        const next = { ...form.interactions };
                        if (v === 'unset') delete next[it.key]; else next[it.key] = v as any;
                        update({ interactions: next });
                      }}
                      options={[{ key: 'unset', label: '—' }, ...INTERACTION_LEVELS.map((l) => ({ key: l.key, label: l.label }))] as any} />
                  </div>
                ))}
              </div>
            </Section>
            {subjectFields.length > 0 && (
              <Section title={`Предметний шаблон: ${subject?.name}`} hint="Оцініть лише те, що спостерігалося. Шаблон можна змінити в Налаштуваннях.">
                <div className="space-y-2.5">
                  {subjectFields.map((f) => (
                    <div key={f} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-medium">{f}</span>
                      <Segmented size="sm" value={(form.subjectFields[f] ?? 'unset') as any}
                        onChange={(v: string) => {
                          const next = { ...form.subjectFields };
                          if (v === 'unset') delete next[f]; else next[f] = v;
                          update({ subjectFields: next });
                        }}
                        options={[{ key: 'unset', label: '—' }, ...SUBJECT_FIELD_RATINGS.map((l) => ({ key: l.key, label: l.label }))] as any} />
                    </div>
                  ))}
                </div>
              </Section>
            )}
            <Section title="Контекст ситуації" hint="Необов'язково. Корисно для опису окремої події (до — дія — після).">
              <div className="grid gap-3 sm:grid-cols-2">
                <Textarea label="Що відбувалося перед подією" rows={2} value={form.context.before} onChange={(e) => update({ context: { ...form.context, before: e.target.value } })} />
                <Textarea label="Що саме робив або говорив учень" rows={2} value={form.context.action} onChange={(e) => update({ context: { ...form.context, action: e.target.value } })} />
                <Textarea label="Що відбулося після" rows={2} value={form.context.after} onChange={(e) => update({ context: { ...form.context, after: e.target.value } })} />
                <Textarea label="Яка підтримка застосовувалася" rows={2} value={form.context.support} onChange={(e) => update({ context: { ...form.context, support: e.target.value } })} />
                <Textarea label="Який спостерігався результат" rows={2} className="sm:col-span-2" value={form.context.result} onChange={(e) => update({ context: { ...form.context, result: e.target.value } })} />
              </div>
            </Section>
            <Section title="Події уроку" hint="Окремі події з коротким описом.">
              <div className="space-y-3">
                {form.events.map((ev, i) => (
                  <div key={i} className="grid gap-2 rounded-2xl border border-line bg-bg/60 p-3 sm:grid-cols-[180px_100px_1fr_auto]">
                    <Select aria-label="Тип події" value={ev.type} onChange={(e) => update({ events: form.events.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
                      {EVENT_TYPES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </Select>
                    <Input aria-label="Час" type="time" value={ev.time} onChange={(e) => update({ events: form.events.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })} />
                    <Input aria-label="Опис" placeholder="Опис події" value={ev.description} onChange={(e) => update({ events: form.events.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                    <IconButton label="Видалити подію" onClick={() => update({ events: form.events.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></IconButton>
                  </div>
                ))}
                <Button variant="soft" icon={<Plus className="h-4 w-4" />} onClick={() => update({ events: [...form.events, { type: 'learning', tags: [], description: '', time: '' }] })}>Додати подію</Button>
              </div>
            </Section>
          </>
        )}

        {!quick && (
          <Section title="Нотатки">
            <Textarea label="Додаткові спостереження" rows={4} value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
            {detailed && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Textarea label="Що вдалося?" rows={2} value={form.wentWell} onChange={(e) => update({ wentWell: e.target.value })} />
                <Textarea label="Які труднощі виникли?" rows={2} value={form.difficulties} onChange={(e) => update({ difficulties: e.target.value })} />
                <Textarea label="Що допомогло?" rows={2} value={form.helped} onChange={(e) => update({ helped: e.target.value })} />
                <Textarea label="На що звернути увагу наступного разу?" rows={2} value={form.nextTime} onChange={(e) => update({ nextTime: e.target.value })} />
              </div>
            )}
          </Section>
        )}

        {quick && (
          <Card className="bg-primary-soft/40">
            <p className="text-sm text-muted">Потрібно більше полів? Перемкніться на <button className="font-semibold text-primary underline" onClick={() => update({ mode: 'standard' })}>стандартний</button> або <button className="font-semibold text-primary underline" onClick={() => update({ mode: 'detailed' })}>детальний</button> режим — уже введені дані збережуться.</p>
          </Card>
        )}
      </div>

      {/* Sticky actions */}
      <div className="safe-bottom fixed inset-x-0 bottom-[64px] z-20 border-t border-line bg-card/95 backdrop-blur lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-2.5">
          <SaveIndicator state={saveState} />
          {appMode === 'cloud' && (!sync.online || sync.connection === 'offline') && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sun-dark" role="status"><CloudOff className="h-3.5 w-3.5" />Офлайн: запис збережеться на пристрої й надішлеться пізніше</span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={cancel}>Скасувати</Button>
            <Button variant="secondary" size="sm" icon={<FileClock className="h-4 w-4" />} onClick={() => doSave('draft')} loading={busy}>Чернетка</Button>
            <Button variant="secondary" size="sm" className="hidden sm:inline-flex" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => doSave('final', 'next')} loading={busy}>Зберегти й наступний</Button>
            <Button size="sm" icon={<Save className="h-4 w-4" />} onClick={() => doSave('final')} loading={busy}>Зберегти</Button>
          </div>
          <Button variant="secondary" size="sm" className="w-full sm:hidden" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => doSave('final', 'next')} loading={busy}>Зберегти й додати наступний урок</Button>
        </div>
      </div>
    </div>
  );
}
