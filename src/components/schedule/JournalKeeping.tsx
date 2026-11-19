import { useMemo } from 'react';
import { ClipboardList } from 'lucide-react';
import { Card } from '../ui';
import { useScheduleRange } from '../../schedule/useSchedule';
import { journalStats, localTodayISO } from '../../schedule/scheduleEngine';
import { cn } from '../../lib/utils';

/**
 * Administrative journal-keeping indicators from the Smart Schedule.
 * Deliberately separate from learning metrics: "80% filled" = completeness of the journal, not student success.
 */
export function JournalKeeping({ studentId, from, to }: { studentId: string; from: string; to: string }) {
  const days = useScheduleRange(studentId, from, to);
  const today = localTodayISO();
  const s = useMemo(() => (days ? journalStats(days, today) : null), [days, today]);
  if (!s) return null;
  const hasPlan = s.planned > 0;
  const tiles = [
    { label: 'Заплановано уроків', value: s.planned },
    { label: 'Проведено', value: s.held, hint: 'заплановані мінус скасовані' },
    { label: 'Скасовано', value: s.cancelled },
    { label: 'Є спостереження', value: s.withObservation, tone: 'mint' },
    { label: 'Немає спостереження', value: s.withoutObservation, hint: s.skipped ? `з них «не проводилося»: ${s.skipped}` : undefined },
    { label: 'Заповнення журналу', value: s.fillPct === null ? '—' : `${s.fillPct}%`, hint: s.held ? `${s.withObservation} з ${s.held} проведених` : 'немає проведених уроків', tone: 'blue' },
  ];
  return (
    <Card title={<span className="inline-flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" />Ведення журналу</span>}
      subtitle="Адміністративні показники за розкладом: повнота ведення журналу, а не навчальна активність чи успішність учня. Майбутні уроки не враховуються.">
      {!hasPlan ? (
        <p className="rounded-xl bg-bg p-4 text-sm text-muted">За цей період немає уроків за розкладом{s.daysWithoutSchedule ? ` (днів без налаштованого розкладу: ${s.daysWithoutSchedule})` : ''}. Налаштуйте розклад у розділі «Розклад», щоб бачити повноту ведення журналу.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {tiles.map((t) => (
              <div key={t.label} className={cn('rounded-2xl p-3', t.tone === 'mint' ? 'bg-mint-soft' : t.tone === 'blue' ? 'bg-primary-soft' : 'bg-bg')}>
                <div className="text-xs font-semibold text-muted">{t.label}</div>
                <div className="text-2xl font-extrabold">{t.value}</div>
                {t.hint && <div className="text-[11px] text-muted">{t.hint}</div>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Дні без занять (канікули, свята тощо): {s.daysOff}. Відсутність запису не означає відсутність участі учня — лише те, що спостереження не внесено.
            {s.daysWithoutSchedule ? ` Робочих днів без налаштованого розкладу: ${s.daysWithoutSchedule} (не враховано).` : ''}
          </p>
        </>
      )}
    </Card>
  );
}
