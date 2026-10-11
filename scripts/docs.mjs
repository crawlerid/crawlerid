#!/usr/bin/env node
// Regenerates the crawler table in README.md from data/crawlers.json.
// Run `npm run docs` after editing the registry; CI checks it is up to date.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { crawlers } = JSON.parse(readFileSync(join(root, 'data/crawlers.json'), 'utf8'));
const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');

const START = '<!-- crawlers:start -->';
const END = '<!-- crawlers:end -->';
const robots = { true: 'yes', false: 'no', null: '?' };
const verifyWith = (c) => {
  const ways = [];
  if (c.verification.ipRanges.length) ways.push('IP list');
  if (c.verification.reverseDns.length) ways.push('reverse DNS');
  if (c.userAgents.length === 0) return 'robots.txt token only';
  return ways.length ? ways.join(' + ') : 'none published';
};

const rows = crawlers.map((c) => {
  const token = (c.userAgents[0] ?? c.robotsTokens[0]).replace(/\|/g, '\\|');
  return `| [${c.name}](${c.docs}) | \`${token}\` | ${c.operator} | ${c.category} | ${robots[String(c.respectsRobotsTxt)]} | ${verifyWith(c)} |`;
});
const table = [
  START,
  '',
  `${crawlers.length} crawlers from ${new Set(crawlers.map((c) => c.operator)).size} operators. Each name links to the official source.`,
  '',
  '| Crawler | Token | Operator | Category | Obeys robots.txt | Verified with |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows,
  '',
  END,
].join('\n');

const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`README.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}
const next = readme.slice(0, start) + table + readme.slice(end + END.length);
const check = process.argv.includes('--check');
if (next === readme) {
  console.log('README crawler table is up to date.');
} else if (check) {
  console.error('README crawler table is out of date. Run `npm run docs` and commit the result.');
  process.exit(1);
} else {
  writeFileSync(readmePath, next);
  console.log('Updated the README crawler table.');
}
