import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, BookOpenText, PlusCircle, CalendarDays, BarChart3, Target, Award, Lightbulb, FileText, UserRound,
  Settings as SettingsIcon, MoreHorizontal, X, FlaskConical, ChevronDown, LogOut, UserPlus, Users,
} from 'lucide-react';
import { useApp } from '../../hooks/useApp';
import { cn } from '../../lib/utils';
import { Badge, Button, EmptyState } from '../ui';
import { createDemo } from '../../services/demo';
import { useToast } from '../ui/feedback';
import { PwaUpdater } from './PwaUpdater';

export const NAV = [
  { to: '/', label: 'Головна', icon: LayoutDashboard, end: true },
  { to: '/journal', label: 'Журнал', icon: BookOpenText },
  { to: '/observation/new', label: 'Нове спостереження', icon: PlusCircle },
  { to: '/calendar', label: 'Календар', icon: CalendarDays },
  { to: '/analytics', label: 'Аналітика', icon: BarChart3 },
  { to: '/iep', label: 'Цілі ІПР', icon: Target },
  { to: '/achievements', label: 'Досягнення', icon: Award },
  { to: '/strategies', label: 'Стратегії', icon: Lightbulb },
  { to: '/reports', label: 'Звіти', icon: FileText },
  { to: '/student', label: 'Профіль учня', icon: UserRound },
  { to: '/settings', label: 'Налаштування', icon: SettingsIcon },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-mint text-white shadow-soft">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="8" r="3" fill="currentColor" stroke="none" /><path d="M6 19c1-4 3.5-6 6-6s5 2 6 6" /></svg>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-extrabold tracking-tight">Inclusive Insight</div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">версія 1.0</div>
      </div>
    </div>
  );
}

function StudentSwitcher() {
  const { students, student, setStudent } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const list = students.filter((s) => !s.archived);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="focus-ring flex max-w-[220px] items-center gap-2 rounded-xl border border-line bg-card px-3 py-1.5 text-left text-sm hover:border-primary/50" aria-haspopup="listbox" aria-expanded={open}>
        <Users className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate font-semibold">{student ? student.name : 'Оберіть учня'}</span>
        {student?.isDemo && <Badge tone="sun">демо</Badge>}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="animate-in absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-card p-1.5 shadow-lift" role="listbox">
            {list.map((s) => (
              <button key={s.id} role="option" aria-selected={s.id === student?.id} onClick={() => { setStudent(s.id); setOpen(false); }}
                className={cn('flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-primary-soft', s.id === student?.id && 'bg-primary-soft font-semibold')}>
                <span className="truncate">{s.name} <span className="text-xs text-muted">· {s.grade}</span></span>
                {s.isDemo && <Badge tone="sun">демо</Badge>}
              </button>
            ))}
            <button onClick={() => { setOpen(false); nav('/student?new=1'); }} className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-soft">
              <UserPlus className="h-4 w-4" /> Додати учня
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl text-lg" style={{ background: user.color + '33' }} aria-label={`Профіль ${user.name}`}>
        {user.avatar}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="animate-in absolute right-0 z-40 mt-2 w-60 rounded-2xl border border-line bg-card p-1.5 shadow-lift">
            <div className="px-3 py-2">
              <div className="text-sm font-bold">{user.name}</div>
              <div className="text-xs text-muted">Локальний робочий простір</div>
            </div>
            <button onClick={() => { setOpen(false); nav('/settings'); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-primary-soft"><SettingsIcon className="h-4 w-4" /> Налаштування</button>
            <button onClick={() => { setOpen(false); logout(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-primary-soft"><LogOut className="h-4 w-4" /> Змінити профіль</button>
          </div>
        </>
      )}
    </div>
  );
}

function MobileMore({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink/30 lg:hidden" onClick={onClose}>
      <div className="animate-in safe-bottom absolute inset-x-0 bottom-0 rounded-t-3xl bg-card p-4 shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-bold">Розділи</span>
          <button onClick={onClose} aria-label="Закрити" className="rounded-xl p-2 text-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={onClose}
              className={({ isActive }) => cn('flex flex-col items-center gap-1.5 rounded-2xl p-3 text-center text-xs font-semibold', isActive ? 'bg-primary-soft text-primary-dark dark:text-primary' : 'text-ink hover:bg-bg')}>
              <n.icon className="h-6 w-6" />{n.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const { student } = useApp();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  const mobile = [NAV[0], NAV[1], NAV[2], NAV[4]];
  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-card focus:p-3">Перейти до вмісту</a>
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-card px-3 py-5 lg:flex">
        <div className="px-2 pb-6"><Logo /></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto scrollbar-thin" aria-label="Головна навігація">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn('focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                isActive ? 'bg-primary-soft text-primary-dark dark:text-primary' : 'text-muted hover:bg-bg hover:text-ink')}>
              <n.icon className="h-[18px] w-[18px]" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl bg-bg p-3 text-xs text-muted">
          Дані зберігаються лише в цьому браузері. Регулярно створюйте резервні копії.
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="lg:hidden"><Logo /></div>
          <div className="hidden text-sm text-muted lg:block">{student?.isDemo && <Badge tone="sun"><FlaskConical className="h-3 w-3" /> Демонстраційні дані</Badge>}</div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block"><StudentSwitcher /></div>
            <UserMenu />
          </div>
        </div>
        <div className="px-4 pb-2 sm:hidden"><StudentSwitcher /></div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        <Outlet />
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur lg:hidden" aria-label="Мобільна навігація">
        <div className="grid grid-cols-5">
          {mobile.map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', i === 2 ? 'text-white' : isActive ? 'text-primary' : 'text-muted')}>
              {i === 2 ? <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lift"><PlusCircle className="h-6 w-6" /></span> : <n.icon className="h-6 w-6" />}
              <span className={i === 2 ? 'text-primary' : ''}>{i === 2 ? 'Запис' : n.label}</span>
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-muted">
            <MoreHorizontal className="h-6 w-6" />Ще
          </button>
        </div>
      </nav>
      <MobileMore open={more} onClose={() => setMore(false)} />
      <PwaUpdater />
    </div>
  );
}

/** Wraps pages that need an active student. */
export function RequireStudent({ children }: { children: ReactNode }) {
  const { student, user } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (student) return <>{children}</>;
  return (
    <div className="card">
      <EmptyState icon={<UserRound className="h-7 w-7" />} title="Почнімо з профілю учня"
        text="Усі спостереження, цілі та звіти прив'язуються до конкретного учня. Рекомендуємо використовувати псевдонім замість повного імені."
        action={<div className="flex flex-wrap justify-center gap-2">
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => nav('/student?new=1')}>Створити профіль учня</Button>
          <Button variant="secondary" loading={busy} icon={<FlaskConical className="h-4 w-4" />} onClick={async () => {
            setBusy(true);
            try { await createDemo(user!.id); toast('Демонстраційний режим увімкнено'); } catch (e) { toast('Не вдалося створити демодані: ' + (e as Error).message, 'error'); }
            setBusy(false);
          }}>Спробувати демо</Button>
        </div>} />
    </div>
  );
}
