#!/usr/bin/env node
// Downloads every official IP range list referenced in data/crawlers.json and
// rewrites data/ip-ranges.json, but only when the prefixes actually changed
// (so the scheduled workflow does not open timestamp-only pull requests).
// Requires a build first: `npm run data:update` does both.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRanges, rangeSources } from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(root, 'data/ip-ranges.json');
const previous = JSON.parse(readFileSync(path, 'utf8'));

const sources = rangeSources();
const { snapshot, errors } = await fetchRanges({ previous, sources });

const prefixesOf = (s) => Object.fromEntries(Object.entries(s.sources).map(([url, v]) => [url, [...v.prefixes]]));
const before = prefixesOf(previous);
const after = prefixesOf(snapshot);
const changed = sources.filter((url) => JSON.stringify(before[url] ?? null) !== JSON.stringify(after[url] ?? null));

for (const url of sources) {
  const n = after[url]?.length ?? 0;
  const failed = errors.find((e) => e.url === url);
  const mark = failed ? `FAILED (${failed.error})${before[url] ? ', kept previous data' : ''}` : changed.includes(url) ? 'changed' : 'unchanged';
  console.log(`${String(n).padStart(5)} prefixes  ${url}  ${mark}`);
}

if (errors.length === sources.length) {
  console.error('\nEvery source failed to download; leaving data/ip-ranges.json untouched.');
  process.exit(1);
}
if (changed.length === 0) {
  console.log('\nNo prefix changes.');
} else {
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`\nUpdated data/ip-ranges.json (${changed.length} source(s) changed).`);
}
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length > 0}\nfailed=${errors.length}\n`, { flag: 'a' });
}
