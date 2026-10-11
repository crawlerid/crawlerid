#!/usr/bin/env node
// Validates data/crawlers.json and data/ip-ranges.json, then writes the typed
// modules in src/generated/ that the library imports. Run by build and test.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const CATEGORIES = ['search', 'ai-training', 'ai-search', 'ai-assistant', 'ai-agent', 'ads', 'preview', 'fetcher', 'other'];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN = /^[A-Za-z0-9_-]+$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const KEYS = new Set(['id', 'name', 'operator', 'category', 'userAgents', 'robotsTokens', 'respectsRobotsTxt', 'docs', 'verification', 'notes']);

export function validateRegistry(registry) {
  const errors = [];
  if (registry.version !== 1) errors.push('crawlers.json: "version" must be 1');
  if (!Array.isArray(registry.crawlers)) return [...errors, 'crawlers.json: "crawlers" must be an array'];

  const ids = new Set();
  const uaTokens = new Map();
  registry.crawlers.forEach((c, i) => {
    const at = `crawlers[${i}]${c && c.id ? ` (${c.id})` : ''}`;
    const err = (msg) => errors.push(`${at}: ${msg}`);
    if (!c || typeof c !== 'object') return err('must be an object');
    for (const key of Object.keys(c)) if (!KEYS.has(key)) err(`unknown field "${key}"`);
    if (typeof c.id !== 'string' || !ID.test(c.id)) err('"id" must be lowercase-kebab-case');
    else if (ids.has(c.id)) err(`duplicate id "${c.id}"`);
    else ids.add(c.id);
    for (const field of ['name', 'operator']) {
      if (typeof c[field] !== 'string' || c[field].trim() === '') err(`"${field}" is required`);
    }
    if (!CATEGORIES.includes(c.category)) err(`"category" must be one of ${CATEGORIES.join(', ')}`);
    for (const field of ['userAgents', 'robotsTokens']) {
      if (!Array.isArray(c[field])) err(`"${field}" must be an array`);
      else for (const t of c[field]) if (typeof t !== 'string' || !TOKEN.test(t)) err(`invalid token in "${field}": ${JSON.stringify(t)}`);
    }
    if (Array.isArray(c.userAgents) && Array.isArray(c.robotsTokens) && c.userAgents.length + c.robotsTokens.length === 0) {
      err('needs at least one userAgents or robotsTokens entry');
    }
    for (const t of Array.isArray(c.userAgents) ? c.userAgents : []) {
      const key = String(t).toLowerCase();
      if (uaTokens.has(key)) err(`User-Agent token "${t}" is already used by "${uaTokens.get(key)}"`);
      else uaTokens.set(key, c.id);
    }
    if (![true, false, null].includes(c.respectsRobotsTxt)) err('"respectsRobotsTxt" must be true, false or null');
    if (typeof c.docs !== 'string' || !/^https:\/\//.test(c.docs)) err('"docs" must be an https:// link to the operator\'s documentation');
    const v = c.verification;
    if (!v || typeof v !== 'object' || !Array.isArray(v.ipRanges) || !Array.isArray(v.reverseDns)) {
      err('"verification" must have "ipRanges" and "reverseDns" arrays');
    } else {
      for (const key of Object.keys(v)) if (!['ipRanges', 'reverseDns'].includes(key)) err(`unknown verification field "${key}"`);
      for (const url of v.ipRanges) {
        try {
          if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
        } catch {
          err(`invalid ipRanges URL ${JSON.stringify(url)}`);
        }
      }
      for (const host of v.reverseDns) if (typeof host !== 'string' || !HOST.test(host)) err(`invalid reverseDns suffix ${JSON.stringify(host)} (lowercase, no leading dot)`);
      if (Array.isArray(c.userAgents) && c.userAgents.length === 0 && v.ipRanges.length + v.reverseDns.length > 0) {
        err('robots.txt-only tokens cannot have verification data');
      }
    }
    if (c.notes !== undefined && (typeof c.notes !== 'string' || c.notes.trim() === '')) err('"notes" must be a non-empty string');
  });
  return errors;
}

export function validateSnapshot(snapshot) {
  const errors = [];
  if (snapshot.generatedAt !== null && typeof snapshot.generatedAt !== 'string') errors.push('ip-ranges.json: "generatedAt" must be a string or null');
  if (!snapshot.sources || typeof snapshot.sources !== 'object') return [...errors, 'ip-ranges.json: "sources" must be an object'];
  for (const [url, source] of Object.entries(snapshot.sources)) {
    if (!Array.isArray(source.prefixes)) errors.push(`ip-ranges.json: ${url} has no "prefixes" array`);
    if (typeof source.fetchedAt !== 'string') errors.push(`ip-ranges.json: ${url} has no "fetchedAt"`);
  }
  return errors;
}

function main() {
  const registry = read('data/crawlers.json');
  const rangesPath = join(root, 'data/ip-ranges.json');
  if (!existsSync(rangesPath)) writeFileSync(rangesPath, `${JSON.stringify({ generatedAt: null, sources: {} }, null, 2)}\n`);
  const snapshot = read('data/ip-ranges.json');
  const { version } = read('package.json');

  const errors = [...validateRegistry(registry), ...validateSnapshot(snapshot)];
  if (errors.length > 0) {
    console.error(`Data validation failed:\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }

  const banner = '// Generated by scripts/gen-data.mjs from data/*.json. Do not edit.\n';
  const crawlers = registry.crawlers.map(({ notes, ...rest }) => (notes ? { ...rest, notes } : rest));
  const out = join(root, 'src/generated');
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'registry.ts'),
    `${banner}import type { Crawler } from '../types.js';\n\nexport const VERSION = ${JSON.stringify(version)};\n\n` +
      `export const crawlers: readonly Crawler[] = ${JSON.stringify(crawlers, null, 2)};\n`,
  );
  writeFileSync(
    join(out, 'ip-ranges.ts'),
    `${banner}import type { RangeSnapshot } from '../types.js';\n\nexport const snapshot: RangeSnapshot = ${JSON.stringify(snapshot)};\n`,
  );
  const sources = Object.keys(snapshot.sources).length;
  console.log(`gen-data: ${crawlers.length} crawlers, ${sources} IP range sources (snapshot ${snapshot.generatedAt ?? 'empty'})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
