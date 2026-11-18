// CI step: decide which Supabase configuration the build will use — BEFORE tests and build.
// Priority: repository Secrets → repository Variables → committed .env file.
// Values are never printed (they are also masked). A secret / service_role key stops the workflow.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

function readDotEnv(file = '.env') {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function isSecretKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

const env = process.env;
const dot = readDotEnv();
const sources = [
  ['repository secrets', env.SECRET_URL, env.SECRET_KEY],
  ['repository variables', env.VAR_URL, env.VAR_KEY],
  ['.env file', dot.VITE_SUPABASE_URL, dot.VITE_SUPABASE_PUBLISHABLE_KEY || dot.VITE_SUPABASE_ANON_KEY],
];
const chosen = sources.find(([, u, k]) => (u ?? '').trim() && (k ?? '').trim());
const partial = sources.find(([, u, k]) => !!(u ?? '').trim() !== !!(k ?? '').trim());

if (!chosen) {
  if (partial) console.log(`::warning::Only one of VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY is set in ${partial[0]}.`);
  console.log('::warning title=Supabase not configured::The site will be built in LOCAL mode (data only in the browser). Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY as repository Variables or Secrets (Settings → Secrets and variables → Actions), or commit the .env file.');
  process.exit(0);
}

const [source, rawUrl, rawKey] = chosen;
const url = rawUrl.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/i, '').replace(/\/+$/, '');
const key = rawKey.trim();
console.log(`::add-mask::${key}`);

if (isSecretKey(key)) {
  console.log(`::error title=Secret Supabase key::The key from ${source} is a secret / service_role key. Only the publishable (anon) key may be used in the frontend. Replace it and revoke the exposed secret key in Supabase.`);
  process.exit(1);
}
if (!/^https:\/\/[^/]+$/.test(url)) {
  console.log(`::error title=Invalid Supabase URL::VITE_SUPABASE_URL from ${source} must look like https://<project-ref>.supabase.co`);
  process.exit(1);
}

// Make the values available to all following steps (tests, build). .env needs no export: Vite reads it itself.
if (source !== '.env file' && env.GITHUB_ENV) {
  appendFileSync(env.GITHUB_ENV, `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`);
}
console.log(`Supabase: CLOUD mode, configuration from ${source} (values hidden).`);
