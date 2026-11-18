import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Lightbulb, Plus, Pencil, Trash2, EyeOff, Eye, History, Search } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { strategiesRepo } from '../db/repositories';
import { strategyStats } from '../analytics/engine';
import { SUPPORT_EFFECT, labelOf } from '../lib/catalog';
import { Badge, Button, Card, ChipGroup, EmptyState, IconButton, Input, Modal, PageHeader, PageSkeleton, ProgressBar, Textarea } from '../components/ui';
import { useConfirm, useToast } from '../components/ui/feedback';
import { fmtDate, todayISO } from '../lib/utils';
import type { Strategy, StrategyUse } from '../types/models';

export default function Strategies() {
  const { user, student, strategies, subjectName } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<Partial<Strategy> | null>(null);
  const [detail, setDetail] = useState<Strategy | null>(null);
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [use, setUse] = useState({ date: todayISO(), result: 'helped' as string | null, comment: '' });
  const uses = useLiveQuery<StrategyUse[]>(() => (student ? strategiesRepo.usesForStudent(student.id) : Promise.resolve([] as StrategyUse[])), [student?.id]);
  const stats = useMemo(() => strategyStats(uses ?? []), [uses]);
  if (!uses) return <PageSkeleton />;

  const list = strategies
    .filter((s) => (showHidden || !s.hidden) && (!q || (s.name + s.description).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (stats.get(b.id)?.uses ?? 0) - (stats.get(a.id)?.uses ?? 0) || a.name.localeCompare(b.name, 'uk'));

  const save = async () => {
    if (!edit?.name?.trim()) return toast('Вкажіть назву стратегії', 'error');
    if (strategies.some((s) => s.name.toLowerCase() === edit.name!.trim().toLowerCase() && s.id !== edit.id)) return toast('Стратегія з такою назвою вже є', 'error');
    await strategiesRepo.save(user.id, { ...edit, name: edit.name.trim() } as any);
    setEdit(null);
    toast('Стратегію збережено');
  };

  const detailUses = detail ? uses.filter((u) => u.strategyId === detail.id).sort((a, b) => (a.date < b.date ? 1 : -1)) : [];

  return (
    <div className="animate-in">
      <PageHeader title="Бібліотека стратегій" icon={<Lightbulb className="h-5 w-5" />}
        subtitle={student ? `Статистика застосування для: ${student.name}` : 'Оберіть учня, щоб бачити статистику'}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ name: '', description: '' })}>Власна стратегія</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-10" placeholder="Пошук стратегії" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Пошук стратегії" />
        </div>
        <Button variant="ghost" size="sm" icon={showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => setShowHidden((v) => !v)}>{showHidden ? 'Сховати приховані' : 'Показати приховані'}</Button>
      </div>

      {list.length === 0 ? <Card><EmptyState icon={<Lightbulb className="h-7 w-7" />} title="Стратегій не знайдено" /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const st = stats.get(s.id);
            const helpedPct = st?.assessed ? Math.round((st.helped / st.assessed) * 100) : null;
            return (
              <article key={s.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold leading-snug">{s.name}</h3>
                  <div className="flex shrink-0">
                    <IconButton label="Редагувати" onClick={() => setEdit(s)}><Pencil className="h-4 w-4" /></IconButton>
                    {s.isDefault ? (
                      <IconButton label={s.hidden ? 'Показувати' : 'Приховати'} onClick={() => strategiesRepo.save(user.id, { ...s, hidden: !s.hidden })}>{s.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</IconButton>
                    ) : (
                      <IconButton label="Видалити" onClick={async () => { if (await confirm({ title: `Видалити «${s.name}»?`, text: 'Історію застосувань цієї стратегії також буде видалено.', danger: true, confirmLabel: 'Видалити' })) { await strategiesRepo.remove(s.id); toast('Стратегію видалено'); } }}><Trash2 className="h-4 w-4" /></IconButton>
                    )}
                  </div>
                </div>
                <div className="mb-2 flex gap-1.5">{s.isDefault ? <Badge tone="gray">базова</Badge> : <Badge tone="blue">власна</Badge>}{s.hidden && <Badge tone="sun">прихована</Badge>}</div>
                <p className="text-sm text-muted">{s.description || 'Опис не додано.'}</p>
                <div className="mt-auto pt-4">
                  <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Застосувань: <b className="text-ink">{st?.uses ?? 0}</b></span>
                    <span className="text-muted">{st?.lastDate ? `останнє ${fmtDate(st.lastDate, 'd MMM')}` : 'ще не застосовувалася'}</span></div>
                  {helpedPct !== null ? (
                    <>
                      <ProgressBar value={helpedPct} color="bg-mint-dark" />
                      <div className="mt-1 text-xs text-muted">Допомогла: {st!.helped} з {st!.assessed} оцінених · частково: {st!.partial}</div>
                    </>
                  ) : <div className="text-xs text-muted">Результат ще не оцінювався</div>}
                  <Button size="sm" variant="secondary" className="mt-3 w-full" icon={<History className="h-4 w-4" />} onClick={() => setDetail(s)} disabled={!student}>Історія та коментарі</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Редагувати стратегію' : 'Нова стратегія'} size="sm"
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Скасувати</Button><Button onClick={save}>Зберегти</Button></>}>
        {edit && <div className="space-y-3">
          <Input label="Назва" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Textarea label="Опис" rows={4} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Як саме застосовується" />
        </div>}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} size="lg">
        {detail && student && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-bg p-3">
              <div className="mb-2 text-sm font-semibold">Зафіксувати застосування вручну</div>
              <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                <Input type="date" aria-label="Дата" value={use.date} onChange={(e) => setUse({ ...use, date: e.target.value })} />
                <Input aria-label="Коментар" placeholder="Коментар (коли застосовувалася, як відреагував учень)" value={use.comment} onChange={(e) => setUse({ ...use, comment: e.target.value })} />
              </div>
              <div className="mt-2"><ChipGroup multiple={false} options={SUPPORT_EFFECT} value={use.result} onChange={(v) => setUse({ ...use, result: v })} /></div>
              <Button size="sm" className="mt-3" icon={<Plus className="h-4 w-4" />} onClick={async () => {
                await strategiesRepo.addManualUse(user.id, { studentId: student.id, strategyId: detail.id, date: use.date, result: use.result, comment: use.comment.trim(), isDemo: student.isDemo });
                setUse({ date: todayISO(), result: 'helped', comment: '' });
                toast('Застосування додано');
              }}>Додати</Button>
            </div>
            {detailUses.length === 0 ? <p className="text-sm text-muted">Ще немає застосувань. Стратегії також фіксуються з форми спостереження.</p> : (
              <ul className="divide-y divide-line">
                {detailUses.map((u) => (
                  <li key={u.id} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="w-20 shrink-0 text-muted">{fmtDate(u.date, 'dd.MM.yy')}</span>
                    <span className="flex-1">
                      <span className="font-semibold">{labelOf('supportEffect', u.result)}</span>
                      {u.subjectId && <span className="text-muted"> · {subjectName(u.subjectId)}</span>}
                      {u.comment && <span className="block text-muted">{u.comment}</span>}
                      {u.observationId && <Link to={`/journal/${u.observationId}`} className="text-xs font-semibold text-primary">Відкрити запис</Link>}
                    </span>
                    {!u.observationId && <IconButton label="Видалити" onClick={() => strategiesRepo.removeUse(u.id)}><Trash2 className="h-4 w-4" /></IconButton>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
