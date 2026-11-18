import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Target, Plus, Pencil, Trash2, CheckCircle2, Link2, Unlink, Wand2, Ruler, X } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { db } from '../db/database';
import { iepRepo, emptyGoal, type GoalInput } from '../db/repositories';
import { IEP_AREAS } from '../lib/catalog';
import { Badge, Button, Card, EmptyState, IconButton, Input, Modal, PageHeader, PageSkeleton, ProgressBar, Segmented, Select, Textarea, Toggle } from '../components/ui';
import { useConfirm, useToast } from '../components/ui/feedback';
import { NoChartData, SERIES } from '../components/charts';
import { cn, fmtDate, todayISO } from '../lib/utils';
import type { IEPGoal, IEPMeasurement } from '../types/models';

const STATUS: Record<IEPGoal['status'], { label: string; tone: 'blue' | 'mint' | 'gray' }> = {
  active: { label: 'Активна', tone: 'blue' },
  achieved: { label: 'Досягнута', tone: 'mint' },
  paused: { label: 'Призупинена', tone: 'gray' },
};

export function goalSummary(g: IEPGoal, ms: IEPMeasurement[]): string {
  if (!ms.length) return `Для цілі «${g.title}» вимірювань ще не зафіксовано.`;
  const sorted = [...ms].sort((a, b) => (a.date < b.date ? -1 : 1));
  const parts = [`За період ${fmtDate(sorted[0].date)} — ${fmtDate(sorted[sorted.length - 1].date)} зафіксовано ${ms.length} вимірювань.`];
  const nums = sorted.filter((m) => m.value !== null);
  if (nums.length >= 2) {
    parts.push(`Перше значення: ${nums[0].value} ${g.unit}, останнє: ${nums[nums.length - 1].value} ${g.unit}.`.replace(/\s+\./g, '.'));
  } else if (nums.length === 1) parts.push(`Значення: ${nums[0].value} ${g.unit}.`);
  const met = ms.filter((m) => m.criterionMet).length;
  parts.push(`Критерій досягнення відзначено в ${met} з ${ms.length} вимірювань.`);
  if (g.criterion) parts.push(`Критерій: ${g.criterion}.`);
  return parts.join(' ');
}

export default function IEP() {
  const { user, student } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'all' | IEPGoal['status']>('all');
  const [editing, setEditing] = useState<GoalInput | null>(null);
  const goals = useLiveQuery(() => iepRepo.goals(student!.id), [student!.id]);
  const allMs = useLiveQuery(() => iepRepo.measurementsForStudent(student!.id), [student!.id]);
  const selectedId = params.get('goal');

  useEffect(() => {
    if (goals?.length && !selectedId) setParams({ goal: goals[0].id }, { replace: true });
  }, [goals, selectedId, setParams]);

  if (!goals || !allMs) return <PageSkeleton />;
  const list = goals.filter((g) => filter === 'all' || g.status === filter).sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'active' ? -1 : 1));
  const selected = goals.find((g) => g.id === selectedId) ?? null;

  const saveGoal = async () => {
    if (!editing) return;
    if (!editing.title.trim()) return toast('Вкажіть назву цілі', 'error');
    if (editing.endDate < editing.startDate) return toast('Дата завершення раніше за дату початку', 'error');
    const g = await iepRepo.saveGoal(user.id, { ...editing, title: editing.title.trim() });
    setEditing(null);
    setParams({ goal: g.id });
    toast('Ціль збережено');
  };

  return (
    <div className="animate-in">
      <PageHeader title="Моніторинг ІПР" icon={<Target className="h-5 w-5" />} subtitle="Цілі індивідуальної програми розвитку та вимірювання прогресу"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(emptyGoal(student!.id))}>Нова ціль</Button>} />

      {goals.length === 0 ? (
        <Card><EmptyState icon={<Target className="h-7 w-7" />} title="Цілей ІПР ще немає" text="Додайте ціль з початковим рівнем, очікуваним результатом і критерієм досягнення." action={<Button onClick={() => setEditing(emptyGoal(student!.id))}>Створити ціль</Button>} /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <div className="space-y-3">
            <Segmented value={filter} onChange={setFilter} options={[{ key: 'all', label: 'Усі' }, { key: 'active', label: 'Активні' }, { key: 'achieved', label: 'Досягнуті' }, { key: 'paused', label: 'Пауза' }]} size="sm" />
            {list.map((g) => {
              const ms = allMs.filter((m) => m.goalId === g.id).sort((a, b) => (a.date < b.date ? -1 : 1));
              const last = [...ms].reverse().find((m) => m.value !== null);
              const pctOfTarget = g.targetValue && last?.value != null ? Math.round((last.value / g.targetValue) * 100) : null;
              return (
                <button key={g.id} onClick={() => setParams({ goal: g.id })}
                  className={cn('card w-full p-4 text-left transition hover:shadow-lift', selectedId === g.id && 'ring-2 ring-primary')}>
                  <div className="mb-1 flex items-center gap-2"><Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge><span className="text-xs text-muted">{g.area}</span></div>
                  <div className="font-bold leading-snug">{g.title}</div>
                  <div className="mt-2 text-xs text-muted">{ms.length} вимірювань{last ? ` · останнє ${fmtDate(last.date, 'd MMM')}: ${last.value} ${g.unit}` : ''}</div>
                  {pctOfTarget !== null && <div className="mt-2 flex items-center gap-2"><ProgressBar value={pctOfTarget} color="bg-mint-dark" /><span className="text-xs font-semibold">{last!.value}/{g.targetValue}</span></div>}
                </button>
              );
            })}
          </div>
          {selected ? <GoalDetail goal={selected} measurements={allMs.filter((m) => m.goalId === selected.id)} onEdit={() => setEditing(selected)}
            onDelete={async () => {
              if (await confirm({ title: 'Видалити ціль?', text: 'Разом з усіма вимірюваннями цієї цілі.', danger: true, confirmLabel: 'Видалити' })) {
                await iepRepo.removeGoal(selected.id); setParams({}); toast('Ціль видалено');
              }
            }} /> : <Card><p className="text-sm text-muted">Оберіть ціль зі списку.</p></Card>}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Редагувати ціль' : 'Нова ціль ІПР'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Скасувати</Button><Button onClick={saveGoal}>Зберегти</Button></>}>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Назва цілі" className="sm:col-span-2" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Напр.: самостійно розпочинати письмове завдання" />
            <Select label="Напрям розвитку" value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value })}>{IEP_AREAS.map((a) => <option key={a}>{a}</option>)}</Select>
            <Select label="Статус" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as any })}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Textarea label="Початковий рівень" rows={2} value={editing.baseline} onChange={(e) => setEditing({ ...editing, baseline: e.target.value })} />
            <Textarea label="Очікуваний результат" rows={2} value={editing.expected} onChange={(e) => setEditing({ ...editing, expected: e.target.value })} />
            <Input label="Критерій досягнення" className="sm:col-span-2" value={editing.criterion} onChange={(e) => setEditing({ ...editing, criterion: e.target.value })} placeholder="Напр.: у 4 з 5 послідовних уроків" />
            <Input label="Початок періоду" type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} />
            <Input label="Кінець періоду" type="date" value={editing.endDate} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} />
            <div className="rounded-2xl bg-bg p-3 sm:col-span-2">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Ruler className="h-4 w-4 text-primary" />Методика вимірювання (необов'язково)</div>
              <p className="hint mb-3">Якщо задати одиницю й числове цільове значення, на графіку з'явиться цільова лінія, а прогрес відображатиметься як «значення / ціль». Без методики абстрактний відсоток не показується.</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Одиниця" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="слів, хв, уроків із 5…" />
                <Input label="Цільове значення" type="number" value={editing.targetValue ?? ''} onChange={(e) => setEditing({ ...editing, targetValue: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>
            <Textarea label="Нотатки" className="sm:col-span-2" rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function GoalDetail({ goal, measurements, onEdit, onDelete }: { goal: IEPGoal; measurements: IEPMeasurement[]; onEdit: () => void; onDelete: () => void }) {
  const { user, student, subjectName } = useSession();
  const toast = useToast();
  const [m, setM] = useState({ date: todayISO(), value: '', comment: '', criterionMet: false, observationId: '' });
  const [summary, setSummary] = useState(goal.summary);
  const [linkId, setLinkId] = useState('');
  useEffect(() => setSummary(goal.summary), [goal.id, goal.summary]);
  const recentObs = useLiveQuery(() => db.observations.where('studentId').equals(student!.id).filter((o) => o.status === 'final').reverse().sortBy('date').then((x) => x.slice(0, 60)), [student!.id]) ?? [];
  const linked = useLiveQuery(() => db.observations.bulkGet(goal.linkedObservationIds ?? []).then((x) => x.filter(Boolean) as any[]), [goal.linkedObservationIds?.join(',')]) ?? [];
  const sorted = useMemo(() => [...measurements].sort((a, b) => (a.date < b.date ? -1 : 1)), [measurements]);
  const chartData = sorted.filter((x) => x.value !== null).map((x) => ({ label: fmtDate(x.date, 'dd.MM'), value: x.value, met: x.criterionMet }));
  const last = [...sorted].reverse().find((x) => x.value !== null);

  const addMeasurement = async () => {
    const value = m.value === '' ? null : Number(m.value);
    if (value === null && !m.comment.trim() && !m.criterionMet) return toast('Вкажіть значення або коментар', 'error');
    const criterionMet = m.criterionMet || (goal.targetValue !== null && value !== null && value >= goal.targetValue);
    await iepRepo.saveMeasurement(user.id, { studentId: goal.studentId, goalId: goal.id, date: m.date, value, comment: m.comment.trim(), criterionMet, observationId: m.observationId || undefined, isDemo: goal.isDemo });
    setM({ date: todayISO(), value: '', comment: '', criterionMet: false, observationId: '' });
    toast('Вимірювання додано');
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone={STATUS[goal.status].tone}>{STATUS[goal.status].label}</Badge><Badge tone="gray">{goal.area}</Badge><span className="text-xs text-muted">{fmtDate(goal.startDate)} — {fmtDate(goal.endDate)}</span></div>
            <h2 className="text-xl font-extrabold">{goal.title}</h2>
          </div>
          <div className="flex gap-1">
            {goal.status !== 'achieved' && <Button size="sm" variant="soft" icon={<CheckCircle2 className="h-4 w-4" />} onClick={async () => { await iepRepo.saveGoal(user.id, { ...goal, status: 'achieved' }); toast('Ціль позначено як досягнуту'); }}>Досягнуто</Button>}
            <IconButton label="Редагувати" onClick={onEdit}><Pencil className="h-4 w-4" /></IconButton>
            <IconButton label="Видалити" onClick={onDelete}><Trash2 className="h-4 w-4" /></IconButton>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-bg p-3"><dt className="text-xs font-semibold text-muted">Початковий рівень</dt><dd>{goal.baseline || '—'}</dd></div>
          <div className="rounded-xl bg-bg p-3"><dt className="text-xs font-semibold text-muted">Очікуваний результат</dt><dd>{goal.expected || '—'}</dd></div>
          <div className="rounded-xl bg-bg p-3"><dt className="text-xs font-semibold text-muted">Критерій досягнення</dt><dd>{goal.criterion || '—'}</dd></div>
        </dl>
        {goal.notes && <p className="mt-3 text-sm text-muted">{goal.notes}</p>}
      </Card>

      <Card title="Прогрес" subtitle={goal.targetValue !== null ? `Ціль: ${goal.targetValue} ${goal.unit}${last ? ` · останнє: ${last.value} ${goal.unit}` : ''}` : 'Числову ціль не задано — показуються лише зафіксовані значення'}>
        {chartData.length === 0 ? <NoChartData text="Додайте вимірювання з числовим значенням, щоб побачити графік" /> : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'rgb(var(--c-muted))' }} tickLine={false} stroke="rgb(var(--c-line))" />
                <YAxis tick={{ fontSize: 12, fill: 'rgb(var(--c-muted))' }} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, (dataMax: number) => Math.max(dataMax, goal.targetValue ?? 0)]} />
                <Tooltip contentStyle={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-line))', borderRadius: 12 }} formatter={(v: any) => [`${v} ${goal.unit}`, 'Значення']} />
                {goal.targetValue !== null && <ReferenceLine y={goal.targetValue} stroke={SERIES[2]} strokeDasharray="5 4" label={{ value: `ціль ${goal.targetValue}`, fill: 'rgb(var(--c-muted))', fontSize: 11, position: 'insideTopRight' }} />}
                <Line type="monotone" dataKey="value" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, stroke: 'rgb(var(--c-card))', strokeWidth: 2, fill: SERIES[0] }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Вимірювання">
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-2xl bg-bg p-3 sm:grid-cols-6">
          <Input label="Дата" type="date" className="col-span-1 sm:col-span-2" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} />
          <Input label={`Значення${goal.unit ? `, ${goal.unit}` : ''}`} type="number" className="col-span-1 sm:col-span-1" value={m.value} onChange={(e) => setM({ ...m, value: e.target.value })} />
          <Select label="Спостереження" className="col-span-2 sm:col-span-3" value={m.observationId} onChange={(e) => setM({ ...m, observationId: e.target.value })}>
            <option value="">Без прив'язки</option>
            {recentObs.map((o) => <option key={o.id} value={o.id}>{fmtDate(o.date, 'dd.MM')} · {subjectName(o.subjectId)}{o.topic ? ` · ${o.topic}` : ''}</option>)}
          </Select>
          <Input label="Коментар" className="col-span-2 sm:col-span-4" value={m.comment} onChange={(e) => setM({ ...m, comment: e.target.value })} />
          <div className="col-span-2 flex items-end sm:col-span-2"><Toggle checked={m.criterionMet} onChange={(v) => setM({ ...m, criterionMet: v })} label="Критерій досягнуто" /></div>
          <Button className="col-span-2 sm:col-span-6" icon={<Plus className="h-4 w-4" />} onClick={addMeasurement}>Додати вимірювання</Button>
        </div>
        {sorted.length === 0 ? <p className="text-sm text-muted">Вимірювань ще немає.</p> : (
          <ul className="divide-y divide-line">
            {[...sorted].reverse().map((x) => (
              <li key={x.id} className="flex items-start gap-3 py-2.5 text-sm">
                <span className="w-20 shrink-0 text-muted">{fmtDate(x.date, 'dd.MM.yy')}</span>
                <span className="w-20 shrink-0 font-bold">{x.value !== null ? `${x.value} ${goal.unit}` : '—'}</span>
                <span className="flex-1">{x.comment}{x.observationId && <Link to={`/journal/${x.observationId}`} className="ml-2 text-xs font-semibold text-primary">запис</Link>}</span>
                {x.criterionMet && <Badge tone="mint">критерій</Badge>}
                <IconButton label="Видалити вимірювання" onClick={async () => { await iepRepo.removeMeasurement(x.id); toast('Вимірювання видалено'); }}><X className="h-4 w-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Пов'язані спостереження" subtitle="Записи журналу, що стосуються цієї цілі">
        <div className="mb-3 flex gap-2">
          <Select aria-label="Обрати спостереження" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            <option value="">Оберіть спостереження…</option>
            {recentObs.filter((o) => !goal.linkedObservationIds?.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{fmtDate(o.date, 'dd.MM')} · {subjectName(o.subjectId)}{o.topic ? ` · ${o.topic}` : ''}</option>)}
          </Select>
          <Button variant="secondary" icon={<Link2 className="h-4 w-4" />} disabled={!linkId} onClick={async () => { await iepRepo.saveGoal(user.id, { ...goal, linkedObservationIds: [...(goal.linkedObservationIds ?? []), linkId] }); setLinkId(''); toast('Спостереження прив\'язано'); }}>Прив'язати</Button>
        </div>
        {linked.length === 0 ? <p className="text-sm text-muted">Немає прив'язаних записів.</p> : (
          <ul className="space-y-1.5">
            {linked.map((o: any) => (
              <li key={o.id} className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2 text-sm">
                <Link to={`/journal/${o.id}`} className="flex-1 hover:text-primary">{fmtDate(o.date)} · <b>{subjectName(o.subjectId)}</b>{o.topic ? ` · ${o.topic}` : ''}</Link>
                <IconButton label="Відв'язати" onClick={() => iepRepo.saveGoal(user.id, { ...goal, linkedObservationIds: goal.linkedObservationIds.filter((i) => i !== o.id) })}><Unlink className="h-4 w-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Підсумок за ціллю">
        <Textarea aria-label="Підсумок" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Короткий підсумок прогресу…" />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Wand2 className="h-4 w-4" />} onClick={() => setSummary(goalSummary(goal, measurements))}>Сформувати чернетку за даними</Button>
          <Button size="sm" disabled={summary === goal.summary} onClick={async () => { await iepRepo.saveGoal(user.id, { ...goal, summary }); toast('Підсумок збережено'); }}>Зберегти підсумок</Button>
        </div>
      </Card>
    </div>
  );
}
