import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { Button, Modal, Input } from './index';
import { cn } from '../../lib/utils';

/* ------------------------------- Toasts ------------------------------- */

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string; action?: { label: string; run: () => void } }

const ToastCtx = createContext<(text: string, kind?: ToastKind, action?: ToastItem['action']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/* ------------------------------ Confirm ------------------------------- */

interface ConfirmOpts { title: string; text?: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const toast = useCallback((text: string, kind: ToastKind = 'success', action?: ToastItem['action']) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => { setTyped(''); setConfirm({ ...o, resolve }); }), []);
  const close = (v: boolean) => { confirm?.resolve(v); setConfirm(null); };

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={cn('animate-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border bg-card p-3.5 shadow-lift',
              t.kind === 'error' ? 'border-coral' : t.kind === 'info' ? 'border-primary/40' : 'border-mint')}>
              {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-mint-dark" /> : t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-dark" /> : <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
              <p className="flex-1 text-sm">{t.text}</p>
              {t.action && <button className="text-sm font-bold text-primary" onClick={() => { t.action!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
              <button aria-label="Закрити" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <Modal open={!!confirm} onClose={() => close(false)} title={confirm?.title ?? ''} size="sm"
          footer={<>
            <Button variant="secondary" onClick={() => close(false)}>Скасувати</Button>
            <Button variant={confirm?.danger ? 'danger' : 'primary'} disabled={!!confirm?.requireText && typed.trim() !== confirm.requireText} onClick={() => close(true)}>{confirm?.confirmLabel ?? 'Підтвердити'}</Button>
          </>}>
          <div className="space-y-3 text-sm text-muted">
            {confirm?.text}
            {confirm?.requireText && (
              <Input label={<>Для підтвердження введіть <b className="text-ink">{confirm.requireText}</b></>} value={typed} onChange={(e) => setTyped(e.target.value)} />
            )}
          </div>
        </Modal>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
