import { addDays, format, isWeekend, subDays } from 'date-fns';
import { db } from '../db/database';
import { OWNER_TABLES, subjectsRepo, strategiesRepo, bootstrapOwner, settingsRepo } from '../db/repositories';
import { uid } from '../lib/utils';
import type {
  Student, Observation, Task, ObsEvent, StrategyUse, IEPGoal, IEPMeasurement, Achievement, Lesson, ID, Subject,
  SchedulePeriod, ScheduleSlot,
} from '../types/models';
import { autoTimes } from '../schedule/scheduleEngine';

/** Small deterministic PRNG so demo data is the same on every device. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_STUDENT_NAME = 'Марко';

export async function hasDemo(ownerId: ID) {
  return (await db.students.where('ownerId').equals(ownerId).filter((s) => !!s.isDemo).count()) > 0;
}

export async function clearDemo(ownerId: ID) {
  await db.transaction('rw', OWNER_TABLES.map((t) => db.table(t)), async () => {
    for (const t of OWNER_TABLES) {
      await db.table(t).where('ownerId').equals(ownerId).filter((r: any) => !!r.isDemo).delete();
    }
  });
  const s = await settingsRepo.getUser(ownerId);
  if (s.activeStudentId && !(await db.students.get(s.activeStudentId))) {
    const first = await db.students.where('ownerId').equals(ownerId).first();
    await settingsRepo.setUser(ownerId, { activeStudentId: first?.id ?? null });
  }
}

/** Creates a fictional student with ~7 weeks of synthetic records. All records are flagged isDemo. */
export async function createDemo(ownerId: ID, weeks = 7): Promise<Student> {
  await clearDemo(ownerId);
  await bootstrapOwner(ownerId);
  const r = rng(20260901);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const chance = (p: number) => r() < p;
  const t0 = Date.now();
  const base = (extra: object) => ({ id: uid(), ownerId, createdAt: t0, updatedAt: t0, isDemo: true, ...extra });

  const subjects = (await subjectsRepo.list(ownerId)).filter((s) => !s.hidden);
  const byKey = (k: string) => subjects.find((s) => s.templateKey === k) ?? subjects[0];
  const strategies = await strategiesRepo.list(ownerId);
  const strat = (name: string) => strategies.find((s) => s.name === name)?.id;

  const today = new Date();
  const start = subDays(today, weeks * 7);
  const student: Student = base({
    name: DEMO_STUDENT_NAME, grade: '1-А клас', schoolYear: `${today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1}/${today.getMonth() >= 7 ? today.getFullYear() + 1 : today.getFullYear()}`,
    startDate: format(start, 'yyyy-MM-dd'),
    strengths: 'Добре запам\'ятовує візуальну інформацію; любить малювати; охоче допомагає прибирати клас.',
    interests: 'Динозаври, машинки, конструктор, малювання фломастерами.',
    needs: 'Коротші інструкції; візуальні опори; рухові перерви кожні 10–15 хв.',
    effectiveStrategies: 'Візуальний зразок, коротке завдання, вибір між двома варіантами.',
    notes: 'Вигаданий учень для демонстрації можливостей додатка. Усі дані синтетичні.',
  }) as Student;

  const schedule: string[][] = [
    ['reading', 'math', 'world', 'art'],
    ['writing', 'math', 'english', 'pe'],
    ['reading', 'writing', 'music', 'world'],
    ['math', 'writing', 'tech', 'pe'],
    ['reading', 'english', 'math', 'art'],
  ];
  const topics: Record<string, string[]> = {
    reading: ['Звук і буква [м]', 'Читання складів ма-му-ми', 'Читання коротких слів', 'Казка «Колобок»', 'Звук і буква [л]'],
    writing: ['Елементи букв', 'Написання букви «а»', 'Списування складів', 'Письмо слів за зразком', 'Рядкова буква «м»'],
    math: ['Лічба до 10', 'Порівняння чисел', 'Додавання в межах 5', 'Віднімання в межах 5', 'Число та цифра 7'],
    english: ['Colours', 'Animals', 'Hello song', 'Numbers 1–5', 'Classroom commands'],
    world: ['Осінь у природі', 'Моя школа', 'Правила дорожнього руху', 'Овочі та фрукти'],
    art: ['Осіннє листя', 'Малюємо динозавра', 'Кольорова веселка'],
    tech: ['Аплікація з паперу', 'Ліпимо з пластиліну', 'Вирізання по контуру'],
    music: ['Слухаємо марш', 'Ритмічні оплески', 'Пісня про осінь'],
    pe: ['Ходьба та біг', 'Вправи з м\'ячем', 'Рухливі ігри'],
  };
  const taskTpl: Record<string, { type: string; title: string; unit: string; n: [number, number] }[]> = {
    reading: [{ type: 'reading', title: 'Прочитати склади', unit: 'складів', n: [4, 8] }, { type: 'reading', title: 'Прочитати слова', unit: 'слів', n: [3, 6] }],
    writing: [{ type: 'written', title: 'Написати слова за зразком', unit: 'слів', n: [3, 6] }, { type: 'written', title: 'Прописати літеру', unit: 'рядків', n: [2, 4] }],
    math: [{ type: 'counting', title: 'Розв\'язати приклади', unit: 'прикладів', n: [4, 8] }, { type: 'counting', title: 'Порівняти числа', unit: 'завдань', n: [3, 5] }],
    english: [{ type: 'oral', title: 'Назвати слова за картками', unit: 'слів', n: [3, 6] }],
    world: [{ type: 'practical', title: 'Розкласти картки за групами', unit: 'карток', n: [4, 8] }],
    art: [{ type: 'creative', title: 'Розфарбувати малюнок', unit: 'малюнків', n: [1, 1] }],
    tech: [{ type: 'practical', title: 'Виконати виріб за зразком', unit: 'виробів', n: [1, 1] }],
    music: [{ type: 'oral', title: 'Відтворити ритм', unit: 'вправ', n: [2, 4] }],
    pe: [{ type: 'motor', title: 'Виконати вправи', unit: 'вправ', n: [3, 5] }],
  };
  const supportByProgress = (p: number) => {
    // p in [0,1] — later dates need less support (synthetic positive trend)
    const x = r() + p * 0.55;
    if (x > 1.15) return 'none';
    if (x > 0.95) return 'general';
    if (x > 0.8) return 'verbal';
    if (x > 0.62) return 'visual';
    if (x > 0.45) return 'model';
    if (x > 0.3) return 'repeat';
    return 'stepwise';
  };

  const lessons: Lesson[] = [];
  const observations: Observation[] = [];
  const tasks: Task[] = [];
  const events: ObsEvent[] = [];
  const uses: StrategyUse[] = [];

  const totalDays = weeks * 7;
  for (let d = 0; d <= totalDays; d++) {
    const day = addDays(start, d);
    if (isWeekend(day)) continue;
    const iso = format(day, 'yyyy-MM-dd');
    const progress = d / totalDays;
    const plan = schedule[(day.getDay() + 6) % 7] ?? schedule[0];
    plan.forEach((key, idx) => {
      const subject: Subject = byKey(key);
      const topic = pick(topics[key] ?? ['Тема уроку']);
      const lesson: Lesson = base({ studentId: student.id, date: iso, number: idx + 1, subjectId: subject.id, topic }) as Lesson;
      lessons.push(lesson);
      // Not every lesson gets an observation (today: only the first two, rest show as "not filled")
      const isToday = d === totalDays;
      if ((isToday && idx > 1) || (!isToday && chance(0.12))) return;

      const sup = supportByProgress(progress);
      const engaged = sup === 'none' || sup === 'general' ? pick(['active', 'most']) : sup === 'stepwise' ? pick(['episodic', 'part', 'none']) : pick(['most', 'part', 'part', 'episodic']);
      const posBeh = ['calm', 'interested', 'joyful', 'accepts_support', 'returns_to_work'];
      const attBeh = ['distracted', 'tired', 'needs_reminders', 'leaves_seat', 'asks_break'];
      const behaviors = Array.from(new Set([pick(posBeh), ...(chance(0.55 - progress * 0.3) ? [pick(attBeh)] : []), ...(chance(progress * 0.5) ? ['shows_independence'] : [])]));
      const usedStrategies = [
        sup === 'visual' || sup === 'model' ? strat('Візуальний зразок') : undefined,
        sup === 'stepwise' ? strat('Покрокова допомога') : undefined,
        sup === 'repeat' || sup === 'verbal' ? strat('Повторення інструкції') : undefined,
        chance(0.25) ? strat('Рухова перерва') : undefined,
        chance(0.2) ? strat('Вибір між завданнями') : undefined,
        chance(0.3) ? strat('Позитивне підкріплення') : undefined,
      ].filter(Boolean) as string[];
      const effect = sup === 'stepwise' ? pick(['partial', 'helped', 'no_effect']) : pick(['helped', 'helped', 'partial', 'unknown']);
      const taskStart = sup === 'none' ? 'independent' : sup === 'general' ? 'after_instruction' : sup === 'repeat' || sup === 'verbal' ? 'after_repeat' : sup === 'visual' || sup === 'model' ? 'after_model' : chance(0.8) ? 'after_stepwise' : 'not_started';

      const obs: Observation = base({
        studentId: student.id, lessonId: lesson.id, date: iso, lessonNumber: idx + 1, subjectId: subject.id, topic,
        duration: 40, mode: chance(0.2) ? 'detailed' : 'standard', status: 'final',
        behaviors, engagement: chance(0.06) ? 'not_observed' : engaged, taskStart,
        supportLevels: Array.from(new Set([sup, ...(chance(0.3) ? [pick(['verbal', 'visual', 'repeat'])] : [])])),
        attention: pick(progress > 0.5 ? ['holds', 'self_returns', 'periodic', 'returns_after_reminder'] : ['periodic', 'frequent_redirect', 'returns_after_reminder', 'holds']),
        attentionMinutes: chance(0.4) ? 5 + Math.round(r() * 10 + progress * 8) : null,
        communication: Array.from(new Set([pick(['short_phrases', 'answers', 'single_words']), ...(chance(0.4) ? [pick(['asks_help', 'reports_needs', 'gestures', 'peers'])] : [])])),
        motivation: Array.from(new Set([pick(['pictures', 'game', 'praise', 'drawing', 'cards']), ...(chance(0.3) ? [pick(['choice', 'short_tasks', 'movement_break'])] : [])])),
        supportEffect: effect, strategyIds: usedStrategies,
        interactions: { assistant: pick(['active', 'partial']), teacher: pick(['partial', 'minimal', 'active']), ...(chance(0.4) ? { peers: pick(['partial', 'minimal']) } : {}) },
        context: { before: '', action: '', after: '', support: '', result: '' },
        notes: chance(0.35) ? pick([
          'Після рухової перерви швидше повернувся до роботи.',
          'Охоче працював із картками, сам попросив ще одне завдання.',
          'Наприкінці уроку втомився, завершили завдання усно.',
          'Допоміг однокласнику роздати зошити.',
          'Краще працював, коли бачив зразок перед собою.',
        ]) : '',
        wentWell: chance(0.3) ? 'Розпочав завдання після показу зразка.' : '',
        difficulties: chance(0.25) ? 'Важко утримувати рядок під час письма.' : '',
        helped: chance(0.25) ? 'Картка-зразок на парті.' : '',
        nextTime: chance(0.15) ? 'Підготувати візуальний розклад уроку.' : '',
        subjectFields: {},
      }) as Observation;
      observations.push(obs);

      for (const tt of taskTpl[key] ?? []) {
        if (!chance(0.85)) continue;
        const offered = tt.n[0] + Math.floor(r() * (tt.n[1] - tt.n[0] + 1));
        const tsup = supportByProgress(progress);
        const ratio = Math.min(1, Math.max(0, (tsup === 'none' ? 0.9 : tsup === 'stepwise' ? 0.35 : 0.6) + (r() - 0.5) * 0.5 + progress * 0.2));
        const done = Math.round(offered * ratio);
        const result = chance(0.07) ? null : done >= offered ? 'full' : done > 0 ? 'partial' : 'not_done';
        tasks.push(base({
          studentId: student.id, observationId: obs.id, date: iso, subjectId: subject.id, type: tt.type, title: tt.title,
          offered, completed: result === null ? null : done, unit: tt.unit, support: chance(0.05) ? null : tsup,
          participation: chance(0.08) ? null : done === 0 ? 'none' : ratio > 0.6 ? 'active' : 'partial',
          result, comment: '', order: 0,
        }) as Task);
      }
      if (chance(0.3)) {
        events.push(base({
          studentId: student.id, observationId: obs.id, date: iso, subjectId: subject.id,
          type: pick(['behavior', 'learning', 'communication', 'success', 'emotional']),
          tags: [pick(['asks_break', 'shows_independence', 'asks_help', 'returns_to_work', 'leaves_seat'])],
          description: pick(['Попросив перерву жестом-карткою.', 'Сам відкрив зошит на потрібній сторінці.', 'Підняв руку, щоб відповісти.', 'Вийшов із-за парти, повернувся після нагадування.']),
          time: '',
        }) as ObsEvent);
      }
      for (const sid of usedStrategies) {
        uses.push(base({ studentId: student.id, strategyId: sid, observationId: obs.id, date: iso, subjectId: subject.id, result: effect, comment: '' }) as StrategyUse);
      }
    });
  }

  const goals: IEPGoal[] = [
    base({
      studentId: student.id, title: 'Самостійно розпочинати письмове завдання після загальної інструкції', area: 'Самостійність',
      baseline: 'Розпочинає письмове завдання лише після покрокової допомоги.', expected: 'Розпочинає завдання протягом 1 хв після загальної інструкції.',
      criterion: 'У 4 з 5 послідовних уроків письма', startDate: student.startDate, endDate: format(addDays(today, 60), 'yyyy-MM-dd'),
      notes: '', status: 'active', unit: 'уроків із 5', targetValue: 4, linkedObservationIds: [], summary: '',
    }) as IEPGoal,
    base({
      studentId: student.id, title: 'Читати склади відкритого типу', area: 'Читання',
      baseline: 'Читає 2 склади з картки з підказкою.', expected: 'Читає 8 складів з картки самостійно.',
      criterion: '8 складів без помилок', startDate: student.startDate, endDate: format(addDays(today, 90), 'yyyy-MM-dd'),
      notes: 'Використовувати картки з картинками-підказками.', status: 'active', unit: 'складів', targetValue: 8, linkedObservationIds: [], summary: '',
    }) as IEPGoal,
    base({
      studentId: student.id, title: 'Повідомляти про потребу в перерві карткою', area: 'Саморегуляція',
      baseline: 'Виходить з-за парти без попередження.', expected: 'Показує картку «перерва» перед тим, як вийти.',
      criterion: 'Використовує картку щонайменше 3 рази на тиждень', startDate: student.startDate, endDate: format(addDays(today, 45), 'yyyy-MM-dd'),
      notes: '', status: 'active', unit: '', targetValue: null, linkedObservationIds: [], summary: '',
    }) as IEPGoal,
  ];
  const measurements: IEPMeasurement[] = [];
  for (let w = 0; w < weeks; w++) {
    const date = format(addDays(start, w * 7 + 4), 'yyyy-MM-dd');
    measurements.push(base({ studentId: student.id, goalId: goals[0].id, date, value: Math.min(5, Math.round(w * 0.6 + r())), comment: '', criterionMet: false }) as IEPMeasurement);
    measurements.push(base({ studentId: student.id, goalId: goals[1].id, date, value: Math.min(8, 2 + Math.round(w * 0.8 + r())), comment: w === weeks - 1 ? 'Помітний прогрес після роботи з картками.' : '', criterionMet: false }) as IEPMeasurement);
    if (w % 2 === 1) measurements.push(base({ studentId: student.id, goalId: goals[2].id, date, value: null, comment: `Використав картку ${1 + Math.floor(w / 2)} раз(и) за тиждень.`, criterionMet: w >= 5 }) as IEPMeasurement);
  }
  for (const m of measurements) {
    const g = goals.find((x) => x.id === m.goalId)!;
    if (g.targetValue !== null && m.value !== null) m.criterionMet = m.value >= g.targetValue;
  }
  goals[0].linkedObservationIds = observations.filter((o) => o.subjectId === byKey('writing').id).slice(-4).map((o) => o.id);

  const achievements: Achievement[] = [
    ['independence', 'Сам підготував робоче місце', 'Без нагадування дістав зошит і олівці на початку уроку.', 'writing', 0],
    ['communication', 'Попросив допомогу словами', 'Сказав «допоможіть, будь ласка» замість того, щоб відкласти завдання.', 'math', 1],
    ['learning', 'Прочитав 6 складів самостійно', 'Перший раз прочитав усі склади з картки без підказок.', 'reading', 1],
    ['social', 'Працював у парі до кінця завдання', 'Разом з однокласником склав пазл-картку.', 'world', undefined],
    ['self_regulation', 'Показав картку «перерва»', 'Скористався карткою замість того, щоб вийти з-за парти.', undefined, 2],
    ['new_skill', 'Вирізав фігуру по контуру', 'Вперше самостійно вирізав коло ножицями.', 'tech', undefined],
    ['initiative', 'Запропонував роздати картки', 'Сам зголосився допомогти вчителю.', 'english', undefined],
  ].map(([category, title, description, subj, goalIdx], i) => base({
    studentId: student.id, date: format(addDays(start, Math.round(((i + 1) / 8) * totalDays)), 'yyyy-MM-dd'),
    category, title, description, subjectId: subj ? byKey(subj as string).id : undefined,
    goalId: goalIdx !== undefined ? goals[goalIdx as number].id : undefined, includeInReports: true,
  }) as Achievement);

  // Smart Schedule for the demo student: the same weekly plan the demo lessons were generated from.
  const times = autoTimes('08:30', 6, 35, 10);
  const demoPeriod: SchedulePeriod = base({
    studentId: student.id, name: 'Демо-розклад', academicYear: student.schoolYear,
    startDate: format(start, 'yyyy-MM-dd'), endDate: format(addDays(today, 120), 'yyyy-MM-dd'),
    weekdays: [1, 2, 3, 4, 5], description: 'Демонстраційний тижневий розклад', archived: false, basedOnId: null,
  }) as SchedulePeriod;
  const demoSlots: ScheduleSlot[] = schedule.flatMap((plan, wdIdx) => plan.map((key, i) => base({
    studentId: student.id, periodId: demoPeriod.id, weekday: wdIdx + 1, lessonNumber: i + 1, subjectId: byKey(key).id,
    startTime: times[i].startTime, endTime: times[i].endTime, notes: '', effectiveFrom: null, effectiveTo: null,
  }) as ScheduleSlot));

  await db.transaction('rw', [db.students, db.lessons, db.observations, db.tasks, db.events, db.strategyUses, db.iepGoals, db.iepMeasurements, db.achievements, db.schedulePeriods, db.scheduleSlots], async () => {
    await db.students.add(student);
    await db.schedulePeriods.add(demoPeriod);
    await db.scheduleSlots.bulkAdd(demoSlots);
    await db.lessons.bulkAdd(lessons);
    await db.observations.bulkAdd(observations);
    await db.tasks.bulkAdd(tasks);
    await db.events.bulkAdd(events);
    await db.strategyUses.bulkAdd(uses);
    await db.iepGoals.bulkAdd(goals);
    await db.iepMeasurements.bulkAdd(measurements);
    await db.achievements.bulkAdd(achievements);
  });
  return student;
}
