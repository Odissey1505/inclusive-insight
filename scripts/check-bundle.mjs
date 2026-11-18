// Fails if a Supabase secret key (sb_secret_… or a service_role JWT) is present in the build output.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|json|webmanifest|map)$/.test(f)) files.push(p);
  }
})(dir);

let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) {
    console.error(`::error::Secret key (sb_secret_…) found in ${f}`);
    bad++;
  }
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') {
        console.error(`::error::service_role JWT found in ${f}`);
        bad++;
      }
    } catch {
      /* not a JWT */
    }
  }
}
if (bad) process.exit(1);
console.log(`No Supabase secret keys in ${files.length} build files.`);
