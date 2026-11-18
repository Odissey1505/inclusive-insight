// Default option catalogs. Keys are stable (used in stored data & analytics);
// labels are what the user sees. Custom user options are stored as "c:<label>".

export interface Option {
  key: string;
  label: string;
  tone?: 'positive' | 'neutral' | 'attention';
}

const o = (key: string, label: string, tone?: Option['tone']): Option => ({ key, label, tone });

export const DEFAULT_SUBJECTS: { name: string; templateKey: string; color: string }[] = [
  { name: 'Читання', templateKey: 'reading', color: '#5B9BD5' },
  { name: 'Письмо', templateKey: 'writing', color: '#8CCFB5' },
  { name: 'Математика', templateKey: 'math', color: '#F4D38B' },
  { name: 'Англійська мова', templateKey: 'english', color: '#ECA5A0' },
  { name: 'Я досліджую світ', templateKey: 'world', color: '#7FB8A4' },
  { name: 'Мистецтво', templateKey: 'art', color: '#C59BD8' },
  { name: 'Дизайн і технології', templateKey: 'tech', color: '#E8B07A' },
  { name: 'Музика', templateKey: 'music', color: '#86A8E7' },
  { name: 'Фізична культура', templateKey: 'pe', color: '#6CC3D5' },
  { name: 'Інше', templateKey: 'other', color: '#A0AEC0' },
];

export const BEHAVIORS: Option[] = [
  o('calm', 'Спокійний', 'positive'),
  o('interested', 'Зацікавлений', 'positive'),
  o('joyful', 'Радісний', 'positive'),
  o('active', 'Активний', 'positive'),
  o('distracted', 'Відволікається', 'attention'),
  o('tired', 'Втомлений', 'attention'),
  o('excited', 'Збуджений', 'attention'),
  o('irritated', 'Роздратований', 'attention'),
  o('upset', 'Засмучений', 'attention'),
  o('tense', 'Напружений', 'attention'),
  o('needs_reminders', 'Потребує нагадувань', 'neutral'),
  o('leaves_seat', 'Підводиться з місця', 'neutral'),
  o('asks_break', 'Просить перерву', 'neutral'),
  o('refuses_task', 'Відмовляється від завдання', 'attention'),
  o('accepts_support', 'Приймає підтримку', 'positive'),
  o('returns_to_work', 'Повертається до роботи', 'positive'),
  o('shows_independence', 'Проявляє самостійність', 'positive'),
  o('other', 'Інше', 'neutral'),
];

export const ENGAGEMENT: Option[] = [
  o('active', 'Активно працював'),
  o('most', 'Працював більшу частину уроку'),
  o('part', 'Виконував частину завдань'),
  o('episodic', 'Долучався епізодично'),
  o('none', 'Не долучався до завдань'),
  o('not_observed', 'Не спостерігалося'),
];

export const TASK_START: Option[] = [
  o('independent', 'Самостійно'),
  o('after_instruction', 'Після інструкції'),
  o('after_repeat', 'Після повторення'),
  o('after_model', 'Після показу зразка'),
  o('after_stepwise', 'Після покрокової підтримки'),
  o('not_started', 'Не розпочав'),
  o('not_assessed', 'Не оцінювалося'),
];

export const SUPPORT_LEVELS: Option[] = [
  o('none', 'Без допомоги'),
  o('general', 'Загальна інструкція'),
  o('repeat', 'Повторення інструкції'),
  o('verbal', 'Словесна підказка'),
  o('visual', 'Візуальна підказка'),
  o('model', 'Показ зразка'),
  o('stepwise', 'Покрокова допомога'),
  o('other', 'Інша доречна підтримка'),
];

export const ATTENTION: Option[] = [
  o('holds', 'Утримує увагу'),
  o('periodic', 'Періодично відволікається'),
  o('frequent_redirect', 'Часто потребує перенаправлення'),
  o('self_returns', 'Самостійно повертається до роботи'),
  o('returns_after_reminder', 'Повертається після нагадування'),
  o('not_assessed', 'Не оцінювалося'),
];

export const COMMUNICATION: Option[] = [
  o('single_words', 'Використовує окремі слова'),
  o('short_phrases', 'Використовує короткі фрази'),
  o('answers', 'Відповідає на запитання'),
  o('asks', 'Ставить запитання'),
  o('asks_help', 'Просить допомогу'),
  o('reports_needs', 'Повідомляє про потреби'),
  o('gestures', 'Використовує жести'),
  o('initiates', 'Ініціює спілкування'),
  o('peers', 'Спілкується з однокласниками'),
  o('joint_activity', 'Бере участь у спільній діяльності'),
];

export const MOTIVATION: Option[] = [
  o('topic', 'Цікава тема'),
  o('drawing', 'Малювання'),
  o('game', 'Гра'),
  o('pictures', 'Картинки'),
  o('cards', 'Картки'),
  o('choice', 'Можливість вибору'),
  o('short_tasks', 'Короткі завдання'),
  o('praise', 'Позитивне підкріплення'),
  o('movement_break', 'Рухова перерва'),
  o('visual_schedule', 'Візуальний розклад'),
  o('other', 'Інше'),
];

export const SUPPORT_EFFECT: Option[] = [
  o('helped', 'Допомогла'),
  o('partial', 'Частково допомогла'),
  o('no_effect', 'Не було помітного ефекту'),
  o('unknown', 'Неможливо оцінити'),
];

export const INTERACTIONS: Option[] = [
  o('teacher', 'З учителем'),
  o('assistant', 'З асистентом'),
  o('peers', 'З однокласниками'),
  o('pair', 'Під час парної роботи'),
  o('group', 'Під час групової роботи'),
];

export const INTERACTION_LEVELS: Option[] = [
  o('active', 'Активно'),
  o('partial', 'Частково'),
  o('minimal', 'Мінімально'),
  o('none', 'Не брав участі'),
];

export const TASK_RESULTS: Option[] = [
  o('full', 'Виконано'),
  o('partial', 'Частково'),
  o('not_done', 'Не виконано'),
];

export const PARTICIPATION: Option[] = [
  o('active', 'Брав участь'),
  o('partial', 'Частково'),
  o('none', 'Не брав участі'),
];

export const TASK_TYPES: Option[] = [
  o('written', 'Письмове'),
  o('oral', 'Усне'),
  o('reading', 'Читання'),
  o('counting', 'Лічба / обчислення'),
  o('practical', 'Практичне'),
  o('creative', 'Творче'),
  o('motor', 'Рухове'),
  o('game', 'Ігрове'),
  o('other', 'Інше'),
];

export const UNITS = ['слів', 'літер', 'складів', 'речень', 'прикладів', 'задач', 'рядків', 'вправ', 'малюнків', 'хвилин', 'одиниць'];

export const EVENT_TYPES: Option[] = [
  o('learning', 'Навчальна подія'),
  o('behavior', 'Поведінкова подія'),
  o('communication', 'Комунікація'),
  o('emotional', 'Емоційний прояв'),
  o('social', 'Взаємодія'),
  o('support', 'Застосування підтримки'),
  o('success', 'Успіх'),
  o('other', 'Інше'),
];

export const SUBJECT_FIELD_RATINGS: Option[] = [
  o('independent', 'Самостійно'),
  o('with_support', 'З підтримкою'),
  o('emerging', 'Пробував'),
  o('not_done', 'Не вдалося'),
];

export const SUBJECT_TEMPLATES: Record<string, string[]> = {
  writing: ['Літери', 'Склади', 'Слова', 'Списування', 'Робота за зразком', 'Орієнтування в рядку', 'Кількість написаного', 'Необхідна підтримка'],
  reading: ['Розпізнавання літер', 'Читання складів', 'Читання слів', 'Читання речень', 'Розуміння прочитаного', 'Відповіді на запитання'],
  math: ['Лічба', 'Розпізнавання чисел', 'Порівняння', 'Додавання', 'Віднімання', 'Прості задачі', 'Запис чисел', 'Робота за зразком'],
  english: ['Розпізнавання літер', 'Слова', 'Прості інструкції', 'Повторення', 'Читання', 'Письмо', 'Участь в усних вправах'],
  world: ["Природні об'єкти", 'Пори року', 'Практичні завдання', 'Правила безпеки', 'Самообслуговування', 'Комунікація', 'Участь в обговоренні'],
  art: ['Малювання', 'Розфарбовування', 'Робота в межах контуру', 'Творчість', 'Використання матеріалів'],
  tech: ['Ножиці', 'Клей', 'Папір', 'Пластилін', 'Послідовність дій', 'Робота за зразком', 'Завершення виробу'],
  music: ['Слухання', 'Спів', 'Ритм', 'Рухи', 'Участь'],
  pe: ['Рухові вправи', 'Координація', 'Рівновага', "М'яч", 'Рухливі ігри', 'Дотримання правил'],
  other: [],
  custom: [],
};

export const IEP_AREAS = [
  'Читання', 'Письмо', 'Математика', 'Англійська', 'Я досліджую світ', 'Мистецтво', 'Технології', 'Фізкультура',
  'Мовленнєвий розвиток', 'Увага', "Пам'ять", 'Комунікація', 'Самостійність', 'Саморегуляція',
];

export const ACHIEVEMENT_CATEGORIES: (Option & { icon: string; color: string })[] = [
  { key: 'independence', label: 'Самостійність', icon: 'Footprints', color: '#5B9BD5' },
  { key: 'communication', label: 'Комунікація', icon: 'MessageCircle', color: '#8CCFB5' },
  { key: 'learning', label: 'Навчання', icon: 'BookOpen', color: '#E8B04A' },
  { key: 'social', label: 'Соціальна взаємодія', icon: 'Users', color: '#ECA5A0' },
  { key: 'new_skill', label: 'Нове вміння', icon: 'Sparkles', color: '#C59BD8' },
  { key: 'self_regulation', label: 'Саморегуляція', icon: 'Leaf', color: '#6CC3D5' },
  { key: 'initiative', label: 'Ініціативність', icon: 'Rocket', color: '#F0A868' },
];

export const DEFAULT_STRATEGIES: { name: string; description: string }[] = [
  { name: 'Повторення інструкції', description: 'Повторити інструкцію коротко, тими самими словами, після встановлення зорового контакту.' },
  { name: 'Візуальний зразок', description: 'Показати готовий зразок або картку з прикладом виконання.' },
  { name: 'Покрокова допомога', description: 'Розбити завдання на короткі кроки й супроводжувати кожен крок.' },
  { name: 'Коротке завдання', description: 'Зменшити обсяг завдання, щоб учень міг завершити його успішно.' },
  { name: 'Вибір між завданнями', description: 'Запропонувати вибір із двох прийнятних варіантів.' },
  { name: 'Рухова перерва', description: 'Коротка рухова пауза для повернення уваги.' },
  { name: 'Візуальний розклад', description: 'Показати послідовність дій уроку за допомогою картинок.' },
  { name: 'Позитивне підкріплення', description: 'Конкретна похвала за дію або зусилля одразу після них.' },
  { name: 'Використання інтересів', description: 'Вбудувати в завдання тему або предмет, що цікавить учня.' },
  { name: 'Таймер', description: 'Візуальний таймер для позначення тривалості роботи або перерви.' },
  { name: 'Зміна формату роботи', description: 'Змінити спосіб виконання: усно замість письмово, картки замість зошита тощо.' },
];

export const CATEGORY_CATALOGS: Record<string, { title: string; options: Option[] }> = {
  behaviors: { title: 'Поведінка', options: BEHAVIORS },
  communication: { title: 'Комунікація', options: COMMUNICATION },
  motivation: { title: 'Мотивація', options: MOTIVATION },
  supportLevels: { title: 'Рівень підтримки', options: SUPPORT_LEVELS },
};

const ALL: Record<string, Option[]> = {
  behaviors: BEHAVIORS, engagement: ENGAGEMENT, taskStart: TASK_START, support: SUPPORT_LEVELS,
  supportLevels: SUPPORT_LEVELS, attention: ATTENTION, communication: COMMUNICATION, motivation: MOTIVATION,
  supportEffect: SUPPORT_EFFECT, interactions: INTERACTIONS, interactionLevel: INTERACTION_LEVELS,
  taskResult: TASK_RESULTS, participation: PARTICIPATION, taskType: TASK_TYPES, eventType: EVENT_TYPES,
  rating: SUBJECT_FIELD_RATINGS, achievement: ACHIEVEMENT_CATEGORIES,
};

export function labelOf(catalog: keyof typeof ALL | string, key: string | null | undefined): string {
  if (!key) return '—';
  if (key.startsWith('c:')) return key.slice(2);
  const found = (ALL[catalog] || []).find((x) => x.key === key);
  return found ? found.label : key;
}

export function optionsOf(catalog: string): Option[] {
  return ALL[catalog] || [];
}
