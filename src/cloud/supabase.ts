import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloudConfig } from './config';

let client: SupabaseClient | null = null;

/**
 * The single Supabase client. PKCE flow keeps auth callbacks in the query
 * string (?code=…) so they never collide with HashRouter's #/ routes.
 * A dedicated storage key isolates this app's session from other apps on the
 * same origin (e.g. several projects on USERNAME.github.io).
 */
export function supabase(): SupabaseClient {
  if (!cloudConfig.enabled) throw new Error('Supabase не налаштовано');
  if (!client) {
    client = createClient(cloudConfig.url, cloudConfig.key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'inclusive-insight-auth',
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}
