import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '../ui';

/** Registers the service worker (app shell only) and offers a controlled update. */
export function PwaUpdater() {
  const [need, setNeed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [update, setUpdate] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      const fn = registerSW({
        immediate: true,
        onNeedRefresh: () => setNeed(true),
        onOfflineReady: () => { setOffline(true); setTimeout(() => setOffline(false), 5000); },
      });
      setUpdate(() => fn);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!need && !offline) return null;
  return (
    <div className="animate-in fixed inset-x-4 bottom-24 z-[55] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-primary/30 bg-card p-3.5 shadow-lift lg:bottom-6 lg:left-auto lg:right-6" role="status">
      <RefreshCw className="h-5 w-5 shrink-0 text-primary" />
      <p className="flex-1 text-sm">{need ? 'Доступна нова версія додатка. Ваші дані не зміняться.' : 'Додаток готовий до роботи без інтернету.'}</p>
      {need && <Button size="sm" onClick={() => update?.(true)}>Оновити</Button>}
      <button aria-label="Закрити" onClick={() => { setNeed(false); setOffline(false); }} className="text-muted"><X className="h-4 w-4" /></button>
    </div>
  );
}
