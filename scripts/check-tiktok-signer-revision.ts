import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const expectedRevision = 'bcab9dcb7a6d060d111329bc3b531a7206e4e5f8';
const cargo = await readFile(resolve(import.meta.dir, '..', 'Cargo.toml'), 'utf8');
const requiredCrates = [
  'ttl-sign-core',
  'ttl-live-discovery',
  'ttl-live-events',
  'ttl-live-proto',
  'ttl-live-ws',
  'ttl-sign-headless',
  'ttl-sign-embedded',
];

const mismatches = requiredCrates.flatMap((crate) => {
  const line = cargo.match(new RegExp(`^${crate.replaceAll('-', '\\-')}\\s*=\\s*\\{[^\\n]+$`, 'm'))?.[0];
  const revision = line?.match(/\brev\s*=\s*"([0-9a-f]+)"/)?.[1];
  return revision === expectedRevision ? [] : [`${crate}: ${revision ?? 'missing'}`];
});

if (mismatches.length) {
  console.error(`tiktok-signer revision check failed (expected ${expectedRevision}):`);
  for (const mismatch of mismatches) console.error(`  ${mismatch}`);
  process.exit(1);
}

console.log(`All ${requiredCrates.length} tiktok-signer crates use ${expectedRevision}.`);
