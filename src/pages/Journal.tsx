import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpenText, Plus, Search, Pencil, Copy, Trash2, Eye, LayoutList, Table2, Filter, X, Zap } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { db } from '../db/database';
import { observationsRepo } from '../db/repositories';
import { BEHAVIORS, labelOf } from '../lib/catalog';
import { Badge, Button, Card, EmptyState, IconButton, Input, PageHeader, PageSkeleton, Segmented, Select } from '../components/ui';
import { useConfirm, useToast } from '../components/ui/feedback';
import { fmtDate, cn, plural } from '../lib/utils';
import type { Observation, Task } from '../types/models';

type Sort = 'date_desc' | 'date_asc' | 'subject';

export function taskSummary(tasks: Task[]) {
  if (!tasks.length) return '—';
  return tasks.map((t) => (t.offered !== null && t.completed !== null ? `${t.completed}/${t.offered} ${t.unit}` : labelOf('taskResult', t.result))).join(' · ');
}

export default function Journal() {
  const { user, student, subjects, subjectName, subjectColor } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [subjectId, setSubjectId] = useState(params.get('subject') ?? '');
  const [status, setStatus] = useState('');
  const [behavior, setBehavior] = useState('');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [sort, setSort] = useState<Sort>('date_desc');
  const [view, setView] = useState<'cards' | 'table'>(() => (localStorage.getItem('ii.journalView') as any) || 'cards');
  const [showFilters, setShowFilters] = useState(!!(params.get('from') || params.get('to') || params.get('subject')));

  const data = useLiveQuery(async () => {
    const obs = await db.observations.where('studentId').equals(student!.id).toArray();
    const tasks = await db.tasks.where('studentId').equals(student!.id).toArray();
    const byObs = new Map<string, Task[]>();
    for (const t of tasks) byObs.set(t.observationId, [...(byObs.get(t.observationId) ?? []), t]);
    return { obs, byObs };
  }, [student!.id]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    let list = data.obs.filter((o) => {
      if (subjectId && o.subjectId !== subjectId) return false;
      if (status && o.status !== status) return false;
      if (behavior && !o.behaviors.includes(behavior)) return false;
      if (from && o.date < from) return false;
      if (to && o.date > to) return false;
      if (needle) {
        const hay = [o.topic, o.notes, o.wentWell, o.difficulties, o.helped, o.nextTime, subjectName(o.subjectId), ...o.behaviors.map((b) => labelOf('behaviors', b)), ...(data.byObs.get(o.id) ?? []).map((t) => t.title + ' ' + t.comment)].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    list = list.sort((a, b) => {
      if (sort === 'subject') return subjectName(a.subjectId).localeCompare(subjectName(b.subjectId), 'uk') || (a.date < b.date ? 1 : -1);
      const d = a.date === b.date ? (a.lessonNumber ?? 0) - (b.lessonNumber ?? 0) : a.date < b.date ? -1 : 1;
      return sort === 'date_asc' ? d : -d;
    });
    return list;
  }, [data, q, subjectId, status, behavior, from, to, sort, subjectName]);

  const groups = useMemo(() => {
    if (sort === 'subject') return [{ key: 'all', items: filtered }];
    const m = new Map<string, Observation[]>();
    for (const o of filtered) m.set(o.date, [...(m.get(o.date) ?? []), o]);
    return [...m.entries()].map(([key, items]) => ({ key, items }));
  }, [filtered, sort]);

  if (!data) return <PageSkeleton />;

  const remove = async (o: Observation) => {
    const ok = await confirm({ title: 'Видалити спостереження?', text: `${fmtDate(o.date)} · ${subjectName(o.subjectId)}. Також буде видалено завдання й події цього запису. Дію неможливо скасувати.`, danger: true, confirmLabel: 'Видалити' });
    if (!ok) return;
    await observationsRepo.remove(o.id);
    toast('Запис видалено');
  };
  const duplicate = async (o: Observation) => {
    const d = await observationsRepo.duplicate(user.id, o.id);
    if (d) toast('Створено копію як чернетку на сьогодні', 'success', { label: 'Відкрити', run: () => nav(`/observation/${d.id}/edit`) });
  };
  const activeFilters = [subjectId, status, behavior, from, to].filter(Boolean).length;
  const clearFilters = () => { setSubjectId(''); setStatus(''); setBehavior(''); setFrom(''); setTo(''); setParams({}); };

  const Actions = ({ o }: { o: Observation }) => (
    <div className="flex shrink-0">
      <IconButton label="Переглянути" onClick={() => nav(`/journal/${o.id}`)}><Eye className="h-4 w-4" /></IconButton>
      <IconButton label="Редагувати" onClick={() => nav(`/observation/${o.id}/edit`)}><Pencil className="h-4 w-4" /></IconButton>
      <IconButton label="Дублювати" onClick={() => duplicate(o)}><Copy className="h-4 w-4" /></IconButton>
      <IconButton label="Видалити" onClick={() => remove(o)} className="hover:text-coral-dark"><Trash2 className="h-4 w-4" /></IconButton>
    </div>
  );

  return (
    <div className="animate-in">
      <PageHeader title="Журнал спостережень" icon={<BookOpenText className="h-5 w-5" />} subtitle={`${data.obs.length} ${plural(data.obs.length, "запис", "записи", "записів")} · ${student!.name}`}
        actions={<>
          <Button variant="secondary" icon={<Zap className="h-4 w-4" />} onClick={() => nav('/observation/new?mode=quick')}>Швидкий запис</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => nav('/observation/new')}>Нове спостереження</Button>
        </>} />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-10" placeholder="Пошук за темою, нотатками, поведінкою, завданнями…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Пошук" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={showFilters ? 'soft' : 'secondary'} icon={<Filter className="h-4 w-4" />} onClick={() => setShowFilters((v) => !v)}>
              Фільтри{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
            <Select aria-label="Сортування" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto">
              <option value="date_desc">Спершу нові</option>
              <option value="date_asc">Спершу старі</option>
              <option value="subject">За предметом</option>
            </Select>
            <Segmented value={view} onChange={(v) => { setView(v); localStorage.setItem('ii.journalView', v); }} options={[
              { key: 'cards', label: <LayoutList className="h-4 w-4" aria-label="Картки" /> },
              { key: 'table', label: <Table2 className="h-4 w-4" aria-label="Таблиця" /> },
            ]} />
          </div>
        </div>
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 md:grid-cols-5">
            <Select label="Предмет" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Усі</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select label="Статус" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Усі</option>
              <option value="final">Збережені</option>
              <option value="draft">Чернетки</option>
            </Select>
            <Select label="Поведінка" value={behavior} onChange={(e) => setBehavior(e.target.value)}>
              <option value="">Будь-яка</option>
              {BEHAVIORS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </Select>
            <Input label="Від" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label="До" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            {activeFilters > 0 && <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={clearFilters} className="col-span-2 justify-self-start md:col-span-5">Скинути фільтри</Button>}
          </div>
        )}
      </Card>

      {data.obs.length === 0 ? (
        <Card><EmptyState icon={<BookOpenText className="h-7 w-7" />} title="Журнал поки порожній" text="Перше спостереження займе 30–90 секунд." action={<Button onClick={() => nav('/observation/new')}>Створити перше спостереження</Button>} /></Card>
      ) : filtered.length === 0 ? (
        <Card><EmptyState icon={<Search className="h-7 w-7" />} title="Нічого не знайдено" text="Змініть пошуковий запит або фільтри." action={<Button variant="secondary" onClick={() => { setQ(''); clearFilters(); }}>Скинути</Button>} /></Card>
      ) : view === 'table' ? (
        <Card className="overflow-hidden p-0 sm:p-0">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-bg text-xs uppercase tracking-wide text-muted">
                <tr>{['Дата', '№', 'Предмет', 'Тема', 'Поведінка', 'Навч. діяльність', 'Підтримка', 'Результат', 'Нотатки', ''].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="border-t border-line align-top hover:bg-bg/60">
                    <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(o.date, 'dd.MM.yy')}{o.status === 'draft' && <Badge tone="sun" className="ml-1">чернетка</Badge>}</td>
                    <td className="px-3 py-2.5">{o.lessonNumber ?? '—'}</td>
                    <td className="px-3 py-2.5 font-semibold"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: subjectColor(o.subjectId) }} />{subjectName(o.subjectId)}</td>
                    <td className="max-w-[160px] px-3 py-2.5">{o.topic || '—'}</td>
                    <td className="max-w-[180px] px-3 py-2.5 text-xs">{o.behaviors.map((b) => labelOf('behaviors', b)).join(', ') || '—'}</td>
                    <td className="px-3 py-2.5 text-xs">{labelOf('engagement', o.engagement)}</td>
                    <td className="max-w-[160px] px-3 py-2.5 text-xs">{o.supportLevels.map((s) => labelOf('support', s)).join(', ') || '—'}</td>
                    <td className="max-w-[160px] px-3 py-2.5 text-xs">{taskSummary(data.byObs.get(o.id) ?? [])}</td>
                    <td className="max-w-[200px] px-3 py-2.5 text-xs text-muted"><span className="line-clamp-2">{o.notes || '—'}</span></td>
                    <td className="px-1 py-1.5"><Actions o={o} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              {g.key !== 'all' && <h2 className="mb-2 px-1 text-sm font-bold capitalize text-muted">{fmtDate(g.key, 'EEEE, d MMMM yyyy')} <span className="font-medium">· {g.items.length}</span></h2>}
              <div className="grid gap-3">
                {g.items.map((o) => {
                  const tasks = data.byObs.get(o.id) ?? [];
                  return (
                    <article key={o.id} className="card flex gap-3 p-4 transition hover:shadow-lift">
                      <div className="w-1.5 shrink-0 rounded-full" style={{ background: subjectColor(o.subjectId) }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/journal/${o.id}`} className="font-bold hover:text-primary">{o.lessonNumber ? `${o.lessonNumber}. ` : ''}{subjectName(o.subjectId)}</Link>
                          {sort === 'subject' && <span className="text-xs text-muted">{fmtDate(o.date)}</span>}
                          {o.status === 'draft' && <Badge tone="sun">чернетка</Badge>}
                          {o.mode === 'quick' && <Badge tone="gray">швидкий запис</Badge>}
                          {o.isDemo && <Badge tone="sun">демо</Badge>}
                        </div>
                        {o.topic && <p className="text-sm text-muted">{o.topic}</p>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {o.engagement && <Badge tone="blue">{labelOf('engagement', o.engagement)}</Badge>}
                          {o.supportLevels.slice(0, 2).map((s) => <Badge key={s} tone="mint">{labelOf('support', s)}</Badge>)}
                          {o.behaviors.slice(0, 4).map((b) => <Badge key={b} tone={BEHAVIORS.find((x) => x.key === b)?.tone === 'attention' ? 'coral' : 'gray'}>{labelOf('behaviors', b)}</Badge>)}
                          {o.behaviors.length > 4 && <Badge tone="gray">+{o.behaviors.length - 4}</Badge>}
                        </div>
                        {tasks.length > 0 && <p className="mt-2 text-xs text-muted"><b className="text-ink">Завдання:</b> {taskSummary(tasks)}</p>}
                        {o.notes && <p className={cn('mt-1.5 line-clamp-2 text-sm')}>{o.notes}</p>}
                      </div>
                      <Actions o={o} />
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
