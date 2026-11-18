/** Local side of a cloud account: profile row, first-time seeding. */
import { db } from '../db/database';
import { bootstrapOwner, settingsRepo } from '../db/repositories';
import { stableUuid } from './tables';

/** Makes sure the signed-in Supabase user has a local profile row (id = auth uid). */
export async function ensureLocalAccount(uid: string, fallbackName: string) {
  const existing = await db.users.get(uid);
  if (!existing) {
    await db.users.put({ id: uid, name: fallbackName, avatar: '🌿', color: '#5B9BD5', createdAt: Date.now(), lastActiveAt: Date.now() });
  } else {
    await db.users.update(uid, { lastActiveAt: Date.now() });
  }
  await settingsRepo.setApp({ lastUserId: uid });
}

/**
 * Seeds default subjects & strategies — only after the first successful download,
 * so an account that already has them in the cloud never gets duplicates.
 */
export async function seedAccountDefaults(uid: string) {
  await bootstrapOwner(uid, (kind, key) => stableUuid(`${uid}:seed:${kind}:${key}`));
}
