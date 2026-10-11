#!/usr/bin/env node
// Release gate: refuses to publish with an empty, stale or incomplete IP range
// snapshot. Run by the release workflow before `npm publish`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_AGE_DAYS = 45;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(root, 'data/ip-ranges.json'), 'utf8'));
const { crawlers } = JSON.parse(readFileSync(join(root, 'data/crawlers.json'), 'utf8'));

const problems = [];
if (!snapshot.generatedAt) {
  problems.push('data/ip-ranges.json has never been generated. Run `npm run data:update` and commit the result.');
} else {
  const ageDays = (Date.now() - Date.parse(snapshot.generatedAt)) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS) problems.push(`snapshot is ${Math.round(ageDays)} days old (max ${MAX_AGE_DAYS}). Run \`npm run data:update\`.`);
}
const sources = [...new Set(crawlers.flatMap((c) => c.verification.ipRanges))];
for (const url of sources) {
  if (!snapshot.sources[url]?.prefixes?.length) problems.push(`no IP data for ${url}`);
}

if (problems.length > 0) {
  console.error(`Snapshot check failed:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`Snapshot OK: ${sources.length} sources, generated ${snapshot.generatedAt}.`);
