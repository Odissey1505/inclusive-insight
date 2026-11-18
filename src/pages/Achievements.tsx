import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Award, Plus, Pencil, Trash2, Footprints, MessageCircle, BookOpen, Users, Sparkles, Leaf, Rocket, FileText } from 'lucide-react';
import { useSession } from '../hooks/useApp';
import { achievementsRepo, iepRepo, type AchievementInput } from '../db/repositories';
import { ACHIEVEMENT_CATEGORIES } from '../lib/catalog';
import { Badge, Button, Card, EmptyState, IconButton, Input, Modal, PageHeader, PageSkeleton, Select, Textarea, Toggle } from '../components/ui';
import { useConfirm, useToast } from '../components/ui/feedback';
import { cn, fmtDate, todayISO } from '../lib/utils';
import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';

export const ACH_ICONS: Record<string, typeof Award> = { Footprints, MessageCircle, BookOpen, Users, Sparkles, Leaf, Rocket };
const catOf = (k: string) => ACHIEVEMENT_CATEGORIES.find((c) => c.key === k) ?? ACHIEVEMENT_CATEGORIES[0];

export default function Achievements() {
  const { user, student, subjects, subjectName } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [cat, setCat] = useState('');
  const [subj, setSubj] = useState('');
  const [editing, setEditing] = useState<AchievementInput | null>(null);
  const items = useLiveQuery(() => achievementsRepo.list(student!.id), [student!.id]);
  const goals = useLiveQuery(() => iepRepo.goals(student!.id), [student!.id]) ?? [];

  const blank = (): AchievementInput => ({ studentId: student!.id, date: todayISO(), category: 'independence', title: '', description: '', includeInReports: true });
  useEffect(() => { if (params.get('new')) { setEditing(blank()); setParams({}, { replace: true }); } }, []); // eslint-disable-line

  const grouped = useMemo(() => {
    const list = (items ?? []).filter((a) => (!cat || a.category === cat) && (!subj || a.subjectId === subj)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const m = new Map<string, typeof list>();
    for (const a of list) {
      const k = a.date.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [items, cat, subj]);

  if (!items) return <PageSkeleton />;

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) return toast('Опишіть досягнення коротко', 'error');
    await achievementsRepo.save(user.id, { ...editing, title: editing.title.trim() });
    setEditing(null);
    toast('Досягнення збережено');
  };

  const counts = new Map(ACHIEVEMENT_CATEGORIES.map((c) => [c.key, items.filter((a) => a.category === c.key).length]));

  return (
    <div className="animate-in">
      <PageHeader title="Щоденник досягнень" icon={<Award className="h-5 w-5" />} subtitle="Документовані позитивні зміни — без рейтингів і порівнянь з іншими"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(blank())}>Додати досягнення</Button>} />

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setCat('')} className={cn('focus-ring rounded-full border px-3.5 py-1.5 text-sm font-semibold', !cat ? 'border-primary bg-primary-soft text-primary-dark dark:text-primary' : 'border-line bg-card')}>Усі · {items.length}</button>
        {ACHIEVEMENT_CATEGORIES.map((c) => {
          const Icon = ACH_ICONS[c.icon];
          return (
            <button key={c.key} onClick={() => setCat(cat === c.key ? '' : c.key)}
              className={cn('focus-ring inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold', cat === c.key ? 'border-primary bg-primary-soft text-primary-dark dark:text-primary' : 'border-line bg-card')}>
              <Icon className="h-4 w-4" style={{ color: c.color }} />{c.label} · {counts.get(c.key)}
            </button>
          );
        })}
        <Select aria-label="Предмет" value={subj} onChange={(e) => setSubj(e.target.value)} className="w-auto py-1.5 text-sm">
          <option value="">Усі предмети</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {items.length === 0 ? (
        <Card><EmptyState icon={<Award className="h-7 w-7" />} title="Почніть щоденник досягнень" text="Навіть маленький крок — сам дістав зошит чи попросив допомогу словами — варто зафіксувати." action={<Button onClick={() => setEditing(blank())}>Додати перше досягнення</Button>} /></Card>
      ) : grouped.length === 0 ? (
        <Card><EmptyState icon={<Award className="h-7 w-7" />} title="Немає досягнень за обраним фільтром" /></Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([month, list]) => (
            <section key={month}>
              <h2 className="mb-2 px-1 text-sm font-bold capitalize text-muted">{format(parseISO(month + '-01'), 'LLLL yyyy', { locale: uk })}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((a) => {
                  const c = catOf(a.category);
                  const Icon = ACH_ICONS[c.icon];
                  const goal = goals.find((g) => g.id === a.goalId);
                  return (
                    <article key={a.id} className="card flex flex-col p-4 transition hover:shadow-lift">
                      <div className="mb-3 flex items-start justify-between">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: c.color + '26', color: c.color }}><Icon className="h-5 w-5" /></span>
                        <div className="flex">
                          <IconButton label="Редагувати" onClick={() => setEditing(a)}><Pencil className="h-4 w-4" /></IconButton>
                          <IconButton label="Видалити" onClick={async () => { if (await confirm({ title: 'Видалити досягнення?', danger: true, confirmLabel: 'Видалити' })) { await achievementsRepo.remove(a.id); toast('Видалено'); } }}><Trash2 className="h-4 w-4" /></IconButton>
                        </div>
                      </div>
                      <h3 className="font-bold leading-snug">{a.title}</h3>
                      {a.description && <p className="mt-1 text-sm text-muted">{a.description}</p>}
                      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-xs">
                        <span className="text-muted">{fmtDate(a.date)}</span>
                        <Badge tone="gray">{c.label}</Badge>
                        {a.subjectId && <Badge tone="blue">{subjectName(a.subjectId)}</Badge>}
                        {goal && <Badge tone="mint">ІПР: {goal.title.slice(0, 24)}{goal.title.length > 24 ? '…' : ''}</Badge>}
                        {a.includeInReports && <span title="Включається у звіти"><FileText className="h-3.5 w-3.5 text-muted" /></span>}
                        {a.isDemo && <Badge tone="sun">демо</Badge>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Редагувати досягнення' : 'Нове досягнення'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Скасувати</Button><Button onClick={save}>Зберегти</Button></>}>
        {editing && (
          <div className="space-y-3">
            <div>
              <span className="label">Категорія</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ACHIEVEMENT_CATEGORIES.map((c) => {
                  const Icon = ACH_ICONS[c.icon];
                  return (
                    <button key={c.key} type="button" onClick={() => setEditing({ ...editing, category: c.key })}
                      className={cn('focus-ring flex flex-col items-center gap-1 rounded-2xl border p-2.5 text-center text-xs font-semibold', editing.category === c.key ? 'border-primary bg-primary-soft' : 'border-line')}>
                      <Icon className="h-5 w-5" style={{ color: c.color }} />{c.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Input label="Що вдалося" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Напр.: самостійно розпочав завдання" />
            <Textarea label="Опис" rows={3} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Коротко: що сталося, за яких умов" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Дата" type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
              <Select label="Предмет" value={editing.subjectId ?? ''} onChange={(e) => setEditing({ ...editing, subjectId: e.target.value || undefined })}>
                <option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Select label="Ціль ІПР" value={editing.goalId ?? ''} onChange={(e) => setEditing({ ...editing, goalId: e.target.value || undefined })}>
                <option value="">—</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </Select>
            </div>
            <Toggle checked={editing.includeInReports} onChange={(v) => setEditing({ ...editing, includeInReports: v })} label="Додавати до звітів" />
          </div>
        )}
      </Modal>
    </div>
  );
}
