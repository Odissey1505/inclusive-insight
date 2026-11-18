/** Supabase Auth helpers: sign-in/up, password reset, e-mail link handling. */
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { appBaseUrl } from './config';

export type AuthNotice = { kind: 'confirmed' | 'recovery' | 'error'; message: string } | null;

/** Readable Ukrainian messages for Supabase Auth errors. */
export function authErrorText(e: unknown): string {
  const err = e as { message?: string; code?: string; status?: number };
  const m = (err?.message ?? '').toLowerCase();
  const code = err?.code ?? '';
  if (code === 'invalid_credentials' || m.includes('invalid login credentials')) return 'Невірний email або пароль.';
  if (code === 'email_not_confirmed' || m.includes('email not confirmed')) return 'Email ще не підтверджено. Відкрийте лист від Supabase і перейдіть за посиланням.';
  if (code === 'user_already_exists' || m.includes('already registered')) return 'Користувач із таким email уже зареєстрований. Увійдіть або відновіть пароль.';
  if (code === 'weak_password' || m.includes('password should')) return 'Пароль надто простий: щонайменше 8 символів, бажано літери й цифри.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || m.includes('rate limit')) return 'Забагато спроб. Зачекайте кілька хвилин і повторіть.';
  if (code === 'same_password') return 'Новий пароль має відрізнятися від попереднього.';
  if (code === 'signup_disabled') return 'Реєстрацію нових користувачів вимкнено в налаштуваннях Supabase.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Немає з’єднання з сервером. Перевірте інтернет.';
  if (m.includes('invalid email') || code === 'email_address_invalid') return 'Перевірте правильність email.';
  return err?.message || 'Не вдалося виконати дію. Спробуйте ще раз.';
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(authErrorText(error));
}

/** Returns true when the account still needs e-mail confirmation. */
export async function signUp(email: string, password: string, displayName: string): Promise<boolean> {
  const { data, error } = await supabase().auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: displayName.trim() }, emailRedirectTo: `${appBaseUrl()}?ii=confirmed` },
  });
  if (error) throw new Error(authErrorText(error));
  // Supabase returns a user without identities when the e-mail is already taken (enumeration protection).
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('Користувач із таким email уже зареєстрований. Увійдіть або відновіть пароль.');
  }
  return !data.session;
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${appBaseUrl()}?ii=recovery` });
  if (error) throw new Error(authErrorText(error));
}

export async function updatePassword(password: string) {
  const { error } = await supabase().auth.updateUser({ password });
  if (error) throw new Error(authErrorText(error));
}

export async function signOut() {
  const { error } = await supabase().auth.signOut({ scope: 'local' });
  if (error) throw new Error(authErrorText(error));
}

export function displayNameOf(session: Session | null): string {
  const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const n = typeof meta.display_name === 'string' ? meta.display_name.trim() : '';
  return n || (session?.user?.email ?? '').split('@')[0] || 'Користувач';
}

/**
 * Restores the session (including ?code=… from e-mail links, handled by
 * supabase-js with PKCE), reads our ?ii=… marker or error parameters, then
 * removes them from the address bar so HashRouter keeps working.
 */
export async function initAuth(): Promise<{ session: Session | null; notice: AuthNotice }> {
  const url = new URL(window.location.href);
  const marker = url.searchParams.get('ii');
  const hadCode = url.searchParams.has('code');
  const hashParams = new URLSearchParams(url.hash.startsWith('#/') ? '' : url.hash.replace(/^#/, ''));
  const errorDescription = url.searchParams.get('error_description') || hashParams.get('error_description');

  const { data, error } = await supabase().auth.getSession();
  const session = data.session;
  let notice: AuthNotice = null;
  if (errorDescription) {
    notice = { kind: 'error', message: /expired|invalid/i.test(errorDescription) ? 'Посилання з листа застаріло або вже використане. Запросіть новий лист.' : errorDescription };
  } else if (marker === 'recovery') {
    notice = session ? { kind: 'recovery', message: 'Введіть новий пароль.' } : { kind: 'error', message: 'Не вдалося відкрити посилання для відновлення. Відкрийте його в тому ж браузері, де запитували лист, або запросіть новий.' };
  } else if (marker === 'confirmed') {
    notice = session ? { kind: 'confirmed', message: 'Email підтверджено. Ласкаво просимо!' } : { kind: 'confirmed', message: 'Email підтверджено. Тепер увійдіть зі своїм паролем.' };
  } else if (hadCode && !session) {
    notice = { kind: 'error', message: error ? authErrorText(error) : 'Посилання відкрито в іншому браузері або воно застаріло. Увійдіть з паролем.' };
  }
  if (marker || hadCode || errorDescription || (url.hash && !url.hash.startsWith('#/'))) {
    window.history.replaceState(null, '', url.pathname + (url.hash.startsWith('#/') ? url.hash : '#/'));
  }
  return { session, notice };
}
