import { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarClock, Settings2 } from 'lucide-react';
import { useSession } from '../../hooks/useApp';
import { Badge, Button, Card } from '../ui';
import { DayEditor, DayLessons, LessonActions } from '.';
import { useDaySchedule } from '../../schedule/useSchedule';
import { addDaysISO, localTodayISO, type ResolvedLesson } from '../../schedule/scheduleEngine';
import { fmtDate } from '../../lib/utils';

/** "Lessons by schedule" for one chosen date (Journal). */
export function ScheduledDay({ initialDate, onDateChange }: { initialDate?: string; onDateChange?: (d: string) => void }) {
  const { student } = useSession();
  const today = localTodayISO();
  const [date, setDateState] = useState(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today);
  const [edit, setEdit] = useState(false);
  const [active, setActive] = useState<ResolvedLesson | null>(null);
  const day = useDaySchedule(student!.id, date);
  const setDate = (d: string) => {
    if (!d) return;
    setDateState(d);
    onDateChange?.(d);
  };
  const lessons = day?.lessons.filter((l) => !l.cancelled && l.kind !== 'unscheduled') ?? [];
  const filled = lessons.filter((l) => l.observation).length;
  return (
    <Card className="mb-4" title={<span className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" />Уроки за розкладом</span>}
      subtitle={day?.period ? <span className="flex flex-wrap items-center gap-2"><Badge tone="blue">{day.period.name}</Badge>{lessons.length > 0 && <span>заповнено {filled} з {lessons.length}</span>}</span> : undefined}>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" aria-label="Попередній день" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setDate(addDaysISO(date, -1))} />
        <input type="date" className="input h-9 w-[150px] text-sm" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" />
        <Button size="sm" variant="ghost" aria-label="Наступний день" icon={<ChevronRight className="h-4 w-4" />} onClick={() => setDate(addDaysISO(date, 1))} />
        {date !== today && <Button size="sm" variant="secondary" onClick={() => setDate(today)}>Сьогодні</Button>}
        <span className="ml-1 text-sm font-semibold capitalize text-muted">{fmtDate(date, 'EEEE, d MMMM yyyy')}</span>
      </div>
      {day && <DayLessons day={day} compact />}
      {day?.period && (
        <div className="mt-2 border-t border-line pt-2">
          <Button size="sm" variant="ghost" icon={<Settings2 className="h-4 w-4" />} onClick={() => setEdit(true)}>Змінити уроки на цей день</Button>
        </div>
      )}
      <DayEditor day={edit && day ? day : null} onClose={() => setEdit(false)} onOpenLesson={(l) => { setEdit(false); setActive(l); }} />
      <LessonActions lesson={active} day={day ?? null} onClose={() => setActive(null)} />
    </Card>
  );
}
