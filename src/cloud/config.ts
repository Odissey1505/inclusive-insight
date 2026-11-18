/**
 * Supabase configuration from build-time env (Vite):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  (or legacy VITE_SUPABASE_ANON_KEY)
 * Without them the app runs in the 1.0 local mode.
 * A secret / service_role key is refused even if someone puts it into the env.
 */
const env = import.meta.env as Record<string, string | undefined>;

export function looksLikeSecretKey(key: string): boolean {
  if (/^sb_secret_/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') return true;
    } catch {
      /* not a JWT */
    }
  }
  return false;
}

/** Accepts the URL with or without a trailing /rest/v1 or /auth/v1 — the client adds API paths itself. */
export function normalizeSupabaseUrl(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/i, '').replace(/\/+$/, '');
}

export interface CloudConfig {
  url: string;
  key: string;
  /** true only for a complete, valid, non-secret configuration */
  enabled: boolean;
  /** at least one of the variables was provided */
  configured: boolean;
  /** human-readable reason why a provided configuration was rejected */
  problem: string | null;
}

/**
 * Pure parser: same input → same result, no dependency on the machine it runs on.
 * Tested with valid and missing configurations independently of the CI environment.
 */
export function parseCloudConfig(env: Record<string, string | undefined>): CloudConfig {
  const url = normalizeSupabaseUrl(env.VITE_SUPABASE_URL);
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  let problem: string | null = null;
  if (!url && !key) problem = null;
  else if (!url || !key) problem = 'Задано лише одну зі змінних VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.';
  else if (!/^https:\/\/[^/]+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) problem = 'VITE_SUPABASE_URL має вигляд https://<project-ref>.supabase.co';
  else if (looksLikeSecretKey(key)) problem = 'У конфігурації виявлено секретний (service_role) ключ. Він ніколи не повинен потрапляти у frontend — використано локальний режим.';
  const enabled = !!url && !!key && !problem;
  return { url, key, enabled, configured: !!(url || key), problem };
}

/** Configuration of this build (from .env / CI variables via Vite). Without it the app runs in local mode. */
export const cloudConfig: CloudConfig = parseCloudConfig(env);

/** Address of the app itself (used for auth e-mail redirects). Works under any GitHub Pages sub-path. */
export function appBaseUrl(): string {
  return window.location.origin + window.location.pathname;
}
