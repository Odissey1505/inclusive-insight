import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check, Plus, X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Option } from '../../lib/catalog';

/* ------------------------------- Button ------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint' | 'soft';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark shadow-soft',
  mint: 'bg-mint-dark text-white hover:brightness-95 shadow-soft',
  secondary: 'bg-card text-ink border border-line hover:border-primary/50 hover:bg-primary-soft/50',
  soft: 'bg-primary-soft text-primary-dark hover:brightness-95 dark:text-primary',
  ghost: 'text-muted hover:text-ink hover:bg-primary-soft/60',
  danger: 'bg-coral-dark text-white hover:brightness-95',
};

export function Button({
  variant = 'primary', size = 'md', icon, loading, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  const sizes = { sm: 'h-9 px-3 text-sm gap-1.5', md: 'h-11 px-4 text-[15px] gap-2', lg: 'h-14 px-6 text-base gap-2.5' };
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center rounded-xl font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size], VARIANTS[variant], className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={cn('focus-ring inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-primary-soft hover:text-ink disabled:opacity-40', className)}>
      {children}
    </button>
  );
}

/* -------------------------------- Card -------------------------------- */

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={cn('card p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="section-title">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------- Badge -------------------------------- */

const TONES = {
  blue: 'bg-primary-soft text-primary-dark dark:text-primary',
  mint: 'bg-mint-soft text-mint-dark dark:text-mint',
  sun: 'bg-sun-soft text-sun-dark dark:text-sun',
  coral: 'bg-coral-soft text-coral-dark dark:text-coral',
  gray: 'bg-line/60 text-muted',
};
export type Tone = keyof typeof TONES;
export function Badge({ tone = 'blue', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>{children}</span>;
}

/* --------------------------- Chips / options --------------------------- */

export function Chip({ selected, onClick, children, tone }: { selected: boolean; onClick: () => void; children: ReactNode; tone?: Option['tone'] }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cn(
        'focus-ring inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
        selected
          ? tone === 'attention' ? 'border-coral bg-coral-soft text-coral-dark dark:text-coral' : tone === 'positive' ? 'border-mint bg-mint-soft text-mint-dark dark:text-mint' : 'border-primary bg-primary-soft text-primary-dark dark:text-primary'
          : 'border-line bg-card text-ink hover:border-primary/40',
      )}>
      {selected && <Check className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export function ChipGroup({
  options, value, onChange, multiple = true, allowCustom, customLabel = 'Свій варіант', hidden = [],
}: {
  options: Option[]; value: string[] | string | null; onChange: (v: any) => void; multiple?: boolean;
  allowCustom?: boolean; customLabel?: string; hidden?: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const sel = Array.isArray(value) ? value : value ? [value] : [];
  const visible = options.filter((o) => !hidden.includes(o.key) || sel.includes(o.key));
  const customSelected = sel.filter((k) => k.startsWith('c:') && !options.some((o) => o.key === k));
  const toggle = (k: string) => {
    if (multiple) onChange(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]);
    else onChange(sel.includes(k) ? null : k);
  };
  const addCustom = () => {
    const t = text.trim();
    if (!t) return setAdding(false);
    const k = `c:${t}`;
    if (multiple) onChange(sel.includes(k) ? sel : [...sel, k]);
    else onChange(k);
    setText('');
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((o) => <Chip key={o.key} selected={sel.includes(o.key)} tone={o.tone} onClick={() => toggle(o.key)}>{o.label}</Chip>)}
      {customSelected.map((k) => <Chip key={k} selected onClick={() => toggle(k)}>{k.slice(2)}</Chip>)}
      {allowCustom && (adding ? (
        <span className="inline-flex items-center gap-1">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } if (e.key === 'Escape') setAdding(false); }}
            className="input h-10 w-44 py-1.5" placeholder="Введіть…" aria-label={customLabel} />
          <IconButton label="Додати" onClick={addCustom}><Check className="h-4 w-4" /></IconButton>
        </span>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="focus-ring inline-flex min-h-[40px] items-center gap-1 rounded-full border border-dashed border-line px-3.5 text-sm text-muted hover:border-primary hover:text-primary">
          <Plus className="h-3.5 w-3.5" /> {customLabel}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Segmented ------------------------------ */

export function Segmented<T extends string>({ options, value, onChange, className, size = 'md' }: { options: { key: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="tablist" className={cn('inline-flex flex-wrap rounded-xl border border-line bg-bg p-1', className)}>
      {options.map((o) => (
        <button key={o.key} role="tab" type="button" aria-selected={value === o.key} onClick={() => onChange(o.key)}
          className={cn('focus-ring rounded-lg font-semibold transition', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.key ? 'bg-card text-primary-dark shadow-soft dark:text-primary' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Fields -------------------------------- */

export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  );
}

export function Input({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const el = <input id={id} {...rest} className={cn('input', !label && className)} />;
  return label ? <Field label={label} hint={hint} htmlFor={id} className={className}>{el}</Field> : el;
}

export function Textarea({ label, hint, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const el = <textarea id={id} rows={3} {...rest} className={cn('input resize-y leading-relaxed', !label && className)} />;
  return label ? <Field label={label} hint={hint} htmlFor={id} className={className}>{el}</Field> : el;
}

export function Select({ label, hint, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const el = <select id={id} {...rest} className={cn('input appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', !label && className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23718096' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>{children}</select>;
  return label ? <Field label={label} hint={hint} htmlFor={id} className={className}>{el}</Field> : el;
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="hint block">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('focus-ring relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-primary' : 'bg-line')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

/* ------------------------------- Modal -------------------------------- */

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cn('animate-in flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-card shadow-lift sm:rounded-3xl', w)}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton label="Закрити" onClick={onClose}><X className="h-5 w-5" /></IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="safe-bottom flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ States --------------------------------- */

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">{icon}</div>
      <h3 className="text-base font-bold">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Завантаження">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function ProgressBar({ value, color = 'bg-primary', className }: { value: number | null; color?: string; className?: string }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-line/70', className)} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value !== null && <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3">
        {icon && <div className="hidden h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary sm:flex">{icon}</div>}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'blue', lowData }: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: Tone; lowData?: boolean }) {
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', TONES[tone])}>{icon}</span>
      </div>
      <div className="text-2xl font-extrabold">{value}</div>
      {hint && <div className={cn('text-xs', lowData ? 'text-sun-dark' : 'text-muted')}>{hint}</div>}
    </div>
  );
}

export function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return null;
  const map = {
    saving: { t: 'Зберігається…', c: 'text-muted', i: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    saved: { t: 'Збережено локально', c: 'text-mint-dark dark:text-mint', i: <Check className="h-3.5 w-3.5" /> },
    error: { t: 'Помилка збереження', c: 'text-coral-dark', i: <X className="h-3.5 w-3.5" /> },
  }[state];
  return <span role="status" className={cn('inline-flex items-center gap-1 text-xs font-semibold', map.c)}>{map.i}{map.t}</span>;
}
