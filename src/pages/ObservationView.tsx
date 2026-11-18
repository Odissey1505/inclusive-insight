import type { ReactNode } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Pencil, Copy, Trash2, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { db } from '../db/database';
import { observationsRepo } from '../db/repositories';
import { INTERACTIONS, labelOf } from '../lib/catalog';
import { Badge, Button, Card, EmptyState, PageSkeleton } from '../components/ui';
import { useConfirm, useToast } from '../components/ui/feedback';
import { fmtDate } from '../lib/utils';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[220px_1fr]">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
const list = (cat: string, xs: string[]) => (xs.length ? <div className="flex flex-wrap gap-1.5">{xs.map((x) => <Badge key={x} tone="gray">{labelOf(cat, x)}</Badge>)}</div> : <span className="text-muted">—</span>);

export default function ObservationView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, student, subjectName, strategies } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const o = await observationsRepo.get(id!);
    if (!o) return { o: null };
    const [tasks, events, all, goals] = await Promise.all([
      observationsRepo.tasksFor(o.id), observationsRepo.eventsFor(o.id),
      db.observations.where('studentId').equals(o.studentId).toArray(),
      db.iepGoals.where('studentId').equals(o.studentId).filter((g) => g.linkedObservationIds?.includes(o.id)).toArray(),
    ]);
    const sorted = all.sort((a, b) => (a.date === b.date ? (a.lessonNumber ?? 0) - (b.lessonNumber ?? 0) : a.date < b.date ? -1 : 1));
    const idx = sorted.findIndex((x) => x.id === o.id);
    return { o, tasks, events, goals, prev: sorted[idx - 1], next: sorted[idx + 1] };
  }, [id]);

  if (!data) return <PageSkeleton />;
  const { o } = data;
  if (!o) return <Card><EmptyState icon={<History className="h-7 w-7" />} title="Запис не знайдено" action={<Button onClick={() => nav('/journal')}>До журналу</Button>} /></Card>;
  if (o.studentId !== student!.id) return <Card><EmptyState icon={<History className="h-7 w-7" />} title="Запис належить іншому учню" text="Оберіть відповідного учня у верхньому меню." /></Card>;

  const ctx = o.context;
  const hasCtx = Object.values(ctx).some(Boolean);
  return (
    <div className="animate-in mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => nav('/journal')}>Журнал</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<ChevronLeft className="h-4 w-4" />} disabled={!data.prev} onClick={() => nav(`/journal/${data.prev!.id}`)}>Попередній</Button>
          <Button variant="secondary" size="sm" disabled={!data.next} onClick={() => nav(`/journal/${data.next!.id}`)}>Наступний <ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold capitalize text-muted">{fmtDate(o.date, 'EEEE, d MMMM yyyy')}{o.lessonNumber ? ` · ${o.lessonNumber} урок` : ''}</p>
            <h1 className="text-2xl font-extrabold">{subjectName(o.subjectId)}</h1>
            {o.topic && <p className="text-muted">{o.topic}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {o.status === 'draft' && <Badge tone="sun">чернетка — не враховується в аналітиці</Badge>}
              <Badge tone="gray">{o.mode === 'quick' ? 'швидкий запис' : o.mode === 'detailed' ? 'детальне' : 'стандартне'}</Badge>
              {o.isDemo && <Badge tone="sun">демо</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => nav(`/observation/${o.id}/edit`)}>Редагувати</Button>
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={async () => { const d = await observationsRepo.duplicate(user.id, o.id); if (d) { toast('Копію створено як чернетку'); nav(`/observation/${d.id}/edit`); } }}>Дублювати</Button>
            <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
              if (await confirm({ title: 'Видалити спостереження?', text: 'Разом із завданнями та подіями. Дію неможливо скасувати.', danger: true, confirmLabel: 'Видалити' })) {
                await observationsRepo.remove(o.id); toast('Запис видалено'); nav('/journal');
              }
            }}>Видалити</Button>
          </div>
        </div>
      </Card>

      <Card title="Спостереження">
        <dl className="divide-y divide-line">
          <Row label="Поведінка">{list('behaviors', o.behaviors)}</Row>
          <Row label="Навчальна залученість">{labelOf('engagement', o.engagement)}</Row>
          <Row label="Початок завдання">{labelOf('taskStart', o.taskStart)}</Row>
          <Row label="Рівень підтримки">{list('support', o.supportLevels)}</Row>
          <Row label="Стратегії">{o.strategyIds.length ? o.strategyIds.map((s) => strategies.find((x) => x.id === s)?.name ?? '—').join(', ') : '—'}</Row>
          <Row label="Ефективність підтримки">{labelOf('supportEffect', o.supportEffect)}</Row>
          {(o.attention || o.attentionMinutes) && <Row label="Увага">{labelOf('attention', o.attention)}{o.attentionMinutes ? ` · ${o.attentionMinutes} хв над завданням` : ''}</Row>}
          {o.communication.length > 0 && <Row label="Комунікація">{list('communication', o.communication)}</Row>}
          {o.motivation.length > 0 && <Row label="Мотивація">{list('motivation', o.motivation)}</Row>}
          {Object.keys(o.interactions).length > 0 && <Row label="Взаємодія">{INTERACTIONS.filter((i) => o.interactions[i.key]).map((i) => `${i.label}: ${labelOf('interactionLevel', o.interactions[i.key])}`).join('; ')}</Row>}
          {Object.keys(o.subjectFields).length > 0 && <Row label="Предметний шаблон">{Object.entries(o.subjectFields).map(([k, v]) => `${k}: ${labelOf('rating', v)}`).join('; ')}</Row>}
          {o.duration && <Row label="Тривалість">{o.duration} хв</Row>}
        </dl>
      </Card>

      <Card title={`Завдання (${data.tasks!.length})`}>
        {data.tasks!.length === 0 ? <p className="text-sm text-muted">Завдання не фіксувалися.</p> : (
          <div className="space-y-2">
            {data.tasks!.map((t) => (
              <div key={t.id} className="rounded-xl bg-bg p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 font-semibold">{t.title || labelOf('taskType', t.type)} <Badge tone="gray">{labelOf('taskType', t.type)}</Badge>
                  {t.offered !== null && t.completed !== null && <Badge tone="blue">{t.completed} з {t.offered} {t.unit}{t.offered ? ` · ${Math.round((t.completed / t.offered) * 100)}%` : ''}</Badge>}
                </div>
                <div className="mt-1 text-muted">Підтримка: {labelOf('support', t.support)} · Участь: {labelOf('participation', t.participation)} · Результат: {labelOf('taskResult', t.result)}</div>
                {t.comment && <div className="mt-1">{t.comment}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.events!.length > 0 && (
        <Card title="Події">
          <ul className="space-y-2 text-sm">{data.events!.map((e) => <li key={e.id} className="rounded-xl bg-bg p-3"><b>{labelOf('eventType', e.type)}</b>{e.time && ` · ${e.time}`}{e.tags.length > 0 && ` · ${e.tags.map((t) => labelOf('behaviors', t)).join(', ')}`}{e.description && <div className="text-muted">{e.description}</div>}</li>)}</ul>
        </Card>
      )}

      {(o.notes || o.wentWell || o.difficulties || o.helped || o.nextTime || hasCtx) && (
        <Card title="Нотатки та контекст">
          <dl className="divide-y divide-line">
            {o.notes && <Row label="Додаткові спостереження"><span className="whitespace-pre-wrap">{o.notes}</span></Row>}
            {o.wentWell && <Row label="Що вдалося">{o.wentWell}</Row>}
            {o.difficulties && <Row label="Труднощі">{o.difficulties}</Row>}
            {o.helped && <Row label="Що допомогло">{o.helped}</Row>}
            {o.nextTime && <Row label="Наступного разу">{o.nextTime}</Row>}
            {ctx.before && <Row label="Перед подією">{ctx.before}</Row>}
            {ctx.action && <Row label="Дії / слова учня">{ctx.action}</Row>}
            {ctx.after && <Row label="Після">{ctx.after}</Row>}
            {ctx.support && <Row label="Застосована підтримка">{ctx.support}</Row>}
            {ctx.result && <Row label="Результат">{ctx.result}</Row>}
          </dl>
        </Card>
      )}

      <Card title="Історія запису">
        <ul className="space-y-1 text-sm text-muted">
          <li>Створено: {new Date(o.createdAt).toLocaleString('uk-UA')}</li>
          <li>Останнє редагування: {new Date(o.updatedAt).toLocaleString('uk-UA')}</li>
          {data.goals!.length > 0 && <li>Прив'язано до цілей ІПР: {data.goals!.map((g) => <Link key={g.id} className="font-semibold text-primary" to={`/iep?goal=${g.id}`}>{g.title}</Link>)}</li>}
        </ul>
      </Card>
    </div>
  );
}
