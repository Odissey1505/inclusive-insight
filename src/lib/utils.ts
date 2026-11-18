import { format, parseISO, isValid } from 'date-fns';
import { uk } from 'date-fns/locale';

export function uid(prefix = ''): string {
  const c: Crypto | undefined = (globalThis as any).crypto;
  const id = c && 'randomUUID' in c ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${id}` : id;
}

export const todayISO = () => format(new Date(), 'yyyy-MM-dd');
export const toISO = (d: Date) => format(d, 'yyyy-MM-dd');

export function fmtDate(iso: string | undefined | null, pattern = 'd MMMM yyyy'): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isValid(d) ? format(d, pattern, { locale: uk }) : iso;
}

export function fmtDateShort(iso: string | undefined | null): string {
  return fmtDate(iso, 'd MMM');
}

export function fmtWeekday(iso: string): string {
  return fmtDate(iso, 'EEEE');
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

export function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v}%`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function countBy<T>(items: T[], key: (t: T) => string | string[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k === null || k === undefined) continue;
    for (const kk of Array.isArray(k) ? k : [k]) m.set(kk, (m.get(kk) || 0) + 1);
  }
  return m;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(s: string) {
  return s.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/_+/g, '_').slice(0, 60);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => t && clearTimeout(t);
  return d;
}
