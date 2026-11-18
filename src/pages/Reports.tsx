import { useEffect, useState } from 'react';
import { FileText, FileDown, FileSpreadsheet, FileType2, Sheet, RefreshCw, CalendarRange, Wand2, AlertTriangle } from 'lucide-react';
import { refresh, syncStore } from '../cloud/sync';
import { TABLE_LABELS } from '../cloud/migration';
import type { OwnerTable } from '../db/repositories';
import { useSession } from '../hooks/useApp';
import { buildReportData, defaultInclude, REPORT_TYPES, type ReportData, type ReportInclude, type ReportType, SUBJECT_HEAD, OBS_HEAD, ACH_HEAD } from '../reports/reportData';
import { periodRange, type DateRange } from '../analytics/engine';
import { Badge, Button, Card, ChipGroup, Input, PageHeader, Select, Textarea, Toggle } from '../components/ui';
import { useToast } from '../components/ui/feedback';
import { cn, todayISO } from '../lib/utils';
import { endOfWeek, startOfWeek, startOfMonth, endOfMonth, parseISO, format } from 'date-fns';

const INCLUDE_LABELS: [keyof ReportInclude, string][] = [
  ['summary', 'Автоматичний підсумок'], ['metrics', 'Основні показники'], ['charts', 'Графіки'], ['subjects', 'Таблиця предметів'],
  ['categories', 'Категорії (підтримка, поведінка, стратегії)'], ['insights', 'Висновки за правилами'], ['observations', 'Журнал спостережень'],
  ['notes', 'Нотатки'], ['achievements', 'Досягнення'], ['iep', 'Цілі ІПР'],
];

function rangeFor(type: ReportType, anchor: string): DateRange {
  const d = parseISO(anchor);
  const iso = (x: Date) => format(x, 'yyyy-MM-dd');
  switch (type) {
    case 'daily': return { from: anchor, to: anchor };
    case 'weekly': return { from: iso(startOfWeek(d, { weekStartsOn: 1 })), to: iso(endOfWeek(d, { weekStartsOn: 1 })) };
    case 'monthly': return { from: iso(startOfMonth(d)), to: iso(endOfMonth(d)) };
    case 'semester': return periodRange('semester', undefined, d);
    case 'year': case 'iep': case 'team': return periodRange('year', undefined, d);
    default: return periodRange('last30', undefined, d);
  }
}

export default function Reports() {
  const { user, students, student, subjects, mode } = useSession();
  const [dataIssues, setDataIssues] = useState<string[]>([]);
  const [ackIssues, setAckIssues] = useState(false);
  const toast = useToast();
  const [type, setType] = useState<ReportType>('weekly');
  const [studentId, setStudentId] = useState(student!.id);
  const [anchor, setAnchor] = useState(todayISO());
  const [range, setRange] = useState<DateRange>(rangeFor('weekly', todayISO()));
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [include, setInclude] = useState<ReportInclude>(defaultInclude('weekly'));
  const [author, setAuthor] = useState(user.name);
  const [data, setData] = useState<ReportData | null>(null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { setRange(rangeFor(type, anchor)); setInclude(defaultInclude(type)); }, [type, anchor]);

  const generate = async () => {
    if (range.to < range.from) return toast('Кінцева дата раніше за початкову', 'error');
    if (type === 'subject' && !subjectIds.length) return toast('Оберіть хоча б один предмет', 'error');
    const owned = students.find((x) => x.id === studentId && x.ownerId === user.id);
    if (!owned) return toast('Обраний учень не належить до вашого акаунта', 'error');
    setBusy('gen');
    try {
      // Cloud: make sure the report is built from the latest cloud data and say so if it is not.
      if (mode === 'cloud') {
        if (navigator.onLine) await refresh();
        const st = syncStore.get();
        const issues: string[] = [];
        if (!st.online || st.connection === 'offline') issues.push('Немає з’єднання з хмарою — використано дані, збережені на цьому пристрої' + (st.lastPullAt ? ` (оновлено ${new Date(st.lastPullAt).toLocaleString('uk-UA')})` : '') + '.');
        else if (!st.pullComplete) issues.push(`Не вдалося завантажити з хмари: ${st.failedTables.map((t) => TABLE_LABELS[t as OwnerTable] ?? t).join(', ') || 'частину даних'}.`);
        if (st.pending) issues.push(`${st.pending} змін ще не надіслано в хмару (вони враховані у звіті, але інші пристрої їх ще не бачать).`);
        if (st.failed) issues.push(`${st.failed} змін не вдалося зберегти в хмарі.`);
        if (st.conflicts) issues.push(`${st.conflicts} записів мають невирішені конфлікти версій — у звіті використано версію з цього пристрою.`);
        setDataIssues(issues);
        setAckIssues(false);
      }
      const d = await buildReportData({ type, studentId, range, subjectIds, include, authorName: author });
      setData(d);
      setSummary(d.summary);
      setTimeout(() => document.getElementById('report-preview')?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      toast('Не вдалося сформувати звіт: ' + (e as Error).message, 'error');
    }
    setBusy(null);
  };

  const exportAs = async (fmt: 'pdf' | 'docx' | 'xlsx' | 'csv') => {
    if (!data) return;
    if (dataIssues.length && !ackIssues) return toast('Дані для звіту можуть бути неповними — підтвердьте, що формуєте звіт із наявних даних', 'error');
    setBusy(fmt);
    try {
      const ex = await import('../reports/exporters');
      const r = { ...data, summary, include, authorName: author };
      if (fmt === 'pdf') await ex.exportPdf(r);
      if (fmt === 'docx') await ex.exportDocx(r);
      if (fmt === 'xlsx') await ex.exportXlsx(r);
      if (fmt === 'csv') ex.exportCsv(r);
      toast(`Файл ${fmt.toUpperCase()} створено на вашому пристрої`);
    } catch (e) {
      toast('Помилка експорту: ' + (e as Error).message, 'error');
    }
    setBusy(null);
  };

  const showAnchor = ['daily', 'weekly', 'monthly', 'semester', 'year'].includes(type);
  const r = data;

  return (
    <div className="animate-in space-y-5">
      <PageHeader title="Звіти" icon={<FileText className="h-5 w-5" />} subtitle="Формуються локально з ваших записів — без сервера" />

      <Card title="1. Тип звіту">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {REPORT_TYPES.map((t) => (
            <button key={t.key} onClick={() => { setType(t.key); setData(null); }}
              className={cn('focus-ring rounded-2xl border p-3 text-left transition', type === t.key ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/40')}>
              <div className="text-sm font-bold">{t.label}</div>
              <div className="text-xs text-muted">{t.hint}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="2. Налаштування">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Учень" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {students.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}{s.isDemo ? ' (демо)' : ''}</option>)}
          </Select>
          {showAnchor && <Input label={type === 'daily' ? 'День' : 'Будь-яка дата в періоді'} type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />}
          <Input label="Початок" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input label="Кінець" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <Input label="Склав(ла)" value={author} onChange={(e) => setAuthor(e.target.value)} className={showAnchor ? '' : 'lg:col-span-2'} />
        </div>
        <div className="mt-4">
          <span className="label">Предмети {type !== 'subject' && <span className="font-normal text-muted">(порожньо — усі)</span>}</span>
          <ChipGroup options={subjects.map((s) => ({ key: s.id, label: s.name }))} value={subjectIds} onChange={setSubjectIds} />
        </div>
        <div className="mt-4">
          <span className="label">Розділи звіту</span>
          <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDE_LABELS.map(([k, l]) => <Toggle key={k} checked={include[k]} onChange={(v) => setInclude({ ...include, [k]: v })} label={l} />)}
          </div>
        </div>
        <Button className="mt-4" size="lg" icon={data ? <RefreshCw className="h-5 w-5" /> : <Wand2 className="h-5 w-5" />} loading={busy === 'gen'} onClick={generate}>
          {data ? 'Оновити попередній перегляд' : 'Сформувати звіт'}
        </Button>
      </Card>

      {r && (
        <div id="report-preview" className="space-y-4">
          <Card title="3. Експорт" subtitle="Підсумок можна відредагувати перед експортом. Українські символи підтримуються у всіх форматах.">
            {dataIssues.length > 0 && (
              <div className="mb-3 rounded-2xl bg-sun-soft p-3 text-sm" role="alert">
                <p className="mb-1 flex items-center gap-2 font-semibold text-sun-dark"><AlertTriangle className="h-4 w-4" />Дані можуть бути неповними</p>
                <ul className="list-disc space-y-0.5 pl-5 text-ink">{dataIssues.map((i) => <li key={i}>{i}</li>)}</ul>
                <label className="mt-2 flex items-center gap-2 text-ink"><input type="checkbox" checked={ackIssues} onChange={(e) => setAckIssues(e.target.checked)} />Розумію, сформувати звіт із наявних даних</label>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button icon={<FileDown className="h-4 w-4" />} loading={busy === 'pdf'} onClick={() => exportAs('pdf')}>PDF</Button>
              <Button variant="secondary" icon={<FileType2 className="h-4 w-4" />} loading={busy === 'docx'} onClick={() => exportAs('docx')}>DOCX</Button>
              <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === 'xlsx'} onClick={() => exportAs('xlsx')}>XLSX</Button>
              <Button variant="secondary" icon={<Sheet className="h-4 w-4" />} loading={busy === 'csv'} onClick={() => exportAs('csv')}>CSV (журнал)</Button>
            </div>
          </Card>

          {/* Paper preview */}
          <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-white p-6 text-[#25344A] shadow-lift sm:p-10">
            <div className="text-xs font-bold text-[#5B9BD5]">Inclusive Insight</div>
            <h2 className="mt-1 text-xl font-extrabold">{r.title}</h2>
            {r.isDemo && <Badge tone="coral" className="mt-1">ДЕМОНСТРАЦІЙНІ ДАНІ</Badge>}
            <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              <div><b>Учень:</b> {r.student.name}</div><div><b>Період:</b> {r.periodLabel}</div>
              <div><b>Клас:</b> {r.student.grade}</div><div><b>Предмети:</b> {r.subjectsLabel}</div>
            </div>
            {include.summary && (
              <section className="mt-5">
                <h3 className="mb-1 font-bold text-[#3F7FBA]">Підсумок <span className="text-xs font-normal text-[#718096]">(редагується)</span></h3>
                <Textarea aria-label="Підсумок звіту" rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} className="!bg-white !text-[#25344A]" />
                <button className="mt-1 text-xs font-semibold text-[#3F7FBA]" onClick={() => setSummary(r.summary)}>Відновити автоматичний текст</button>
              </section>
            )}
            {include.metrics && <PreviewTable title="Основні показники" head={['Показник', 'Значення', 'Основа']} rows={r.metrics.map((m) => [m.label, m.value, m.basis])} />}
            {include.charts && r.charts.map((c) => (
              <section key={c.title} className="mt-5">
                <h3 className="mb-2 text-sm font-bold">{c.title}</h3>
                {c.labels.map((l, i) => (
                  <div key={l} className="mb-1 flex items-center gap-2 text-xs">
                    <span className="w-40 truncate text-right">{l}</span>
                    <span className="h-3 flex-1 rounded bg-[#EEF3F8]"><span className="block h-3 rounded" style={{ width: `${(c.values[i] / Math.max(...c.values, c.suffix === '%' ? 100 : 1)) * 100}%`, background: c.colors?.[i] ?? '#5B9BD5' }} /></span>
                    <span className="w-10">{c.values[i]}{c.suffix}</span>
                  </div>
                ))}
              </section>
            ))}
            {include.subjects && r.subjectRows.length > 0 && <PreviewTable title="Порівняння предметів" head={SUBJECT_HEAD} rows={r.subjectRows} />}
            {include.categories && r.categoryTables.map((t) => <PreviewTable key={t.title} title={t.title} head={['Категорія', 'Кількість', 'Примітка']} rows={t.rows} />)}
            {include.insights && r.insights.length > 0 && (
              <section className="mt-5"><h3 className="mb-1 font-bold text-[#3F7FBA]">Спостереження за даними</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">{r.insights.map((i) => <li key={i.id}>{i.text} <span className="text-[#718096]">({i.basis})</span></li>)}</ul></section>
            )}
            {include.observations && r.observationRows.length > 0 && <PreviewTable title="Журнал спостережень" head={OBS_HEAD} rows={r.observationRows} small />}
            {include.notes && r.noteRows.length > 0 && <PreviewTable title="Нотатки" head={['Урок', 'Нотатка']} rows={r.noteRows} />}
            {include.achievements && r.achievementRows.length > 0 && <PreviewTable title="Досягнення" head={ACH_HEAD} rows={r.achievementRows} />}
            {include.iep && r.goals.length > 0 && (
              <section className="mt-5"><h3 className="mb-2 font-bold text-[#3F7FBA]">Цілі ІПР</h3>
                {r.goals.map((g) => (
                  <div key={g.goal.id} className="mb-3 text-sm">
                    <div className="font-bold">{g.goal.title}</div>
                    <div className="text-xs text-[#718096]">Напрям: {g.goal.area} · Критерій: {g.goal.criterion || '—'}</div>
                    <div className="text-xs">Останнє вимірювання: {g.latest} · вимірювань за період: {g.measurements.length}</div>
                  </div>
                ))}
              </section>
            )}
            {!r.metrics[0] || r.metrics[0].value === '0' ? <p className="mt-5 flex items-center gap-2 rounded-xl bg-[#FDF6E4] p-3 text-sm"><CalendarRange className="h-4 w-4" />За обраний період спостережень не знайдено.</p> : null}
            <p className="mt-6 text-xs text-[#718096]">Дані є педагогічними спостереженнями й не є медичним чи психологічним висновком.</p>
            <div className="mt-8 flex justify-between text-sm"><span>Дата: {r.generatedAt}</span><span>Підпис: ____________________</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewTable({ title, head, rows, small }: { title: string; head: string[]; rows: string[][]; small?: boolean }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 font-bold text-[#3F7FBA]">{title}</h3>
      <div className="overflow-x-auto">
        <table className={cn('w-full border-collapse', small ? 'text-[11px]' : 'text-xs')}>
          <thead><tr>{head.map((h) => <th key={h} className="border border-[#E5ECF3] bg-[#EAF4FF] px-2 py-1.5 text-left">{h}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="whitespace-pre-wrap border border-[#E5ECF3] px-2 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
