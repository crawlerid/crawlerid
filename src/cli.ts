#!/usr/bin/env node
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { VERSION } from './generated/registry.js';
import { parseLogLine } from './logs.js';
import { nodeResolver } from './node.js';
import { bundledRanges, fetchRanges } from './ranges.js';
import { crawlers, getCrawler, identify } from './registry.js';
import { robotsTxt, type RobotsRule } from './robots.js';
import { CATEGORIES, type Category, type Crawler, type RangeSnapshot, type VerificationResult } from './types.js';
import { createVerifier } from './verify.js';

const HELP = `crawlerid ${VERSION} - identify and verify web crawlers and AI agents

Usage:
  crawlerid identify <user-agent>              Which crawler does this User-Agent claim to be?
  crawlerid verify --ua <user-agent> --ip <ip> Is it really that crawler?
  crawlerid logs <file|->                      Audit crawler traffic in a combined-format access log
  crawlerid robots --disallow <list>           Generate robots.txt groups
  crawlerid list [--category <category>]       List known crawlers

Options:
  --dns            Also use forward-confirmed reverse DNS (verify, logs)
  --live           Download fresh IP ranges instead of the bundled snapshot (verify, logs)
  --ranges <file>  Use an IP range snapshot from disk, e.g. one saved by fetchRanges() (verify, logs)
  --json           Machine-readable output
  --disallow <l>   Comma-separated categories, crawler ids or tokens to block (robots)
  --allow <l>      Comma-separated crawler ids or tokens to exempt (robots)
  --sitemap <url>  Sitemap URL to append, repeatable (robots)
  --no-comments    Omit comments (robots)
  -h, --help       Show this help
  -v, --version    Show the version

Categories: ${CATEGORIES.join(', ')}

Examples:
  crawlerid verify --ua "Mozilla/5.0 (compatible; GPTBot/1.1)" --ip 20.15.240.64 --live
  crawlerid logs /var/log/nginx/access.log --dns
  crawlerid robots --disallow ai-training --allow Applebot-Extended > robots-ai.txt
`;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, text: string): string => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const STATUS_STYLE: Record<VerificationResult['status'], [number, string]> = {
  verified: [32, 'verified'],
  failed: [31, 'FAILED'],
  unverifiable: [33, 'unverifiable'],
  unknown: [90, 'unknown'],
};

function describe(crawler: Crawler): string {
  return `${crawler.name} (${crawler.operator}, ${crawler.category})`;
}

function fail(message: string): never {
  process.stderr.write(`crawlerid: ${message}\n`);
  process.exit(2);
}

async function loadRanges(live: boolean, file?: string): Promise<RangeSnapshot> {
  const base: RangeSnapshot = file ? (JSON.parse(readFileSync(file, 'utf8')) as RangeSnapshot) : bundledRanges;
  if (!live) return base;
  const { snapshot, errors } = await fetchRanges({ previous: base });
  for (const { url, error } of errors) process.stderr.write(`warning: could not refresh ${url}: ${error}\n`);
  return snapshot;
}

function splitList(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ua: { type: 'string' },
      ip: { type: 'string' },
      dns: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      ranges: { type: 'string' },
      json: { type: 'boolean', default: false },
      category: { type: 'string' },
      disallow: { type: 'string', multiple: true },
      allow: { type: 'string', multiple: true },
      sitemap: { type: 'string', multiple: true },
      'no-comments': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.version) return void process.stdout.write(`${VERSION}\n`);
  const [command, ...rest] = positionals;
  if (values.help || !command) return void process.stdout.write(HELP);

  switch (command) {
    case 'identify': {
      const ua = values.ua ?? rest.join(' ');
      if (!ua) fail('identify needs a User-Agent string');
      const crawler = identify(ua);
      if (values.json) return void process.stdout.write(`${JSON.stringify(crawler, null, 2)}\n`);
      process.stdout.write(crawler ? `${describe(crawler)}\n${crawler.docs}\n` : 'No known crawler.\n');
      return;
    }

    case 'verify': {
      if (!values.ua || !values.ip) fail('verify needs --ua and --ip');
      const verifier = createVerifier({
        ranges: await loadRanges(values.live, values.ranges),
        ...(values.dns ? { resolver: nodeResolver() } : {}),
      });
      const res = await verifier.verify({ userAgent: values.ua, ip: values.ip });
      if (values.json) {
        return void process.stdout.write(`${JSON.stringify({ ...res, crawler: res.crawler?.id ?? null }, null, 2)}\n`);
      }
      const [color, label] = STATUS_STYLE[res.status];
      const detail = [res.method && `via ${res.method}`, res.reason, res.hostname].filter(Boolean).join(', ');
      process.stdout.write(
        `${paint(color, label)}  ${res.crawler ? describe(res.crawler) : 'not a known crawler'}${detail ? `  [${detail}]` : ''}\n`,
      );
      if (res.reason === 'no-range-data') {
        process.stdout.write('Tip: the bundled snapshot has no data for this crawler; retry with --live.\n');
      } else if (res.reason === 'dns-resolver-required') {
        process.stdout.write('Tip: this crawler is verified via reverse DNS; retry with --dns.\n');
      }
      process.exitCode = res.status === 'failed' ? 1 : 0;
      return;
    }

    case 'logs': {
      const file = rest[0];
      if (!file) fail('logs needs a file path, or - for stdin');
      await auditLogs(file, await loadRanges(values.live, values.ranges), values.dns, values.json);
      return;
    }

    case 'robots': {
      const categories: Partial<Record<Category, RobotsRule>> = {};
      const overrides: Record<string, RobotsRule> = {};
      for (const item of splitList(values.disallow)) {
        if (CATEGORIES.includes(item as Category)) categories[item as Category] = 'disallow';
        else if (getCrawler(item)) overrides[item] = 'disallow';
        else fail(`unknown category or crawler "${item}"`);
      }
      for (const item of splitList(values.allow)) overrides[item] = 'allow';
      if (Object.keys(categories).length === 0 && Object.keys(overrides).length === 0) {
        fail('robots needs --disallow, e.g. --disallow ai-training');
      }
      process.stdout.write(
        robotsTxt({
          categories,
          crawlers: overrides,
          sitemaps: values.sitemap ?? [],
          comments: !values['no-comments'],
        }),
      );
      return;
    }

    case 'list': {
      const category = values.category as Category | undefined;
      if (category && !CATEGORIES.includes(category)) fail(`unknown category "${category}"`);
      const list = category ? crawlers.filter((c) => c.category === category) : [...crawlers];
      if (values.json) return void process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
      const rows = list.map((c) => [
        c.id,
        c.operator,
        c.category,
        c.verification.ipRanges.length > 0 ? 'ip' : c.verification.reverseDns.length > 0 ? 'dns' : '-',
      ]);
      printTable(['id', 'operator', 'category', 'verify'], rows);
      return;
    }

    default:
      fail(`unknown command "${command}". Run crawlerid --help.`);
  }
}

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  process.stdout.write(`${line(header)}\n${line(widths.map((w) => '-'.repeat(w)))}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
}

async function auditLogs(file: string, ranges: RangeSnapshot, dns: boolean, json: boolean): Promise<void> {
  const input = file === '-' ? process.stdin : createReadStream(file);
  const pairs = new Map<string, { crawler: Crawler; ip: string; requests: number }>();
  let lines = 0;
  let parsed = 0;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    lines++;
    const entry = parseLogLine(line);
    if (!entry) continue;
    parsed++;
    const crawler = identify(entry.userAgent);
    if (!crawler) continue;
    const key = `${crawler.id}|${entry.ip}`;
    const pair = pairs.get(key);
    if (pair) pair.requests++;
    else pairs.set(key, { crawler, ip: entry.ip, requests: 1 });
  }
  if (lines > 0 && parsed === 0) {
    fail('no lines matched the combined log format ("ip - - [date] \\"request\\" status bytes \\"referer\\" \\"ua\\"")');
  }

  const verifier = createVerifier({ ranges, ...(dns ? { resolver: nodeResolver() } : {}) });
  const queue = [...pairs.values()];
  const totals = new Map<string, { crawler: Crawler; requests: number; ips: Set<string>; byStatus: Record<string, number> }>();
  const spoofers = new Map<string, number>();
  const reasons = new Set<string>();
  const worker = async (): Promise<void> => {
    for (let pair = queue.pop(); pair; pair = queue.pop()) {
      const res = await verifier.verify({ userAgent: pair.crawler.userAgents[0] ?? '', ip: pair.ip });
      let t = totals.get(pair.crawler.id);
      if (!t) {
        t = { crawler: pair.crawler, requests: 0, ips: new Set(), byStatus: {} };
        totals.set(pair.crawler.id, t);
      }
      t.requests += pair.requests;
      t.ips.add(pair.ip);
      t.byStatus[res.status] = (t.byStatus[res.status] ?? 0) + pair.requests;
      if (res.status === 'failed') spoofers.set(pair.ip, (spoofers.get(pair.ip) ?? 0) + pair.requests);
      if (res.reason) reasons.add(res.reason);
    }
  };
  await Promise.all(Array.from({ length: dns ? 16 : 1 }, worker));

  const sorted = [...totals.values()].sort((a, b) => b.requests - a.requests);
  if (json) {
    const report = {
      lines,
      parsed,
      crawlers: sorted.map((t) => ({
        id: t.crawler.id,
        operator: t.crawler.operator,
        category: t.crawler.category,
        requests: t.requests,
        uniqueIps: t.ips.size,
        verified: t.byStatus.verified ?? 0,
        failed: t.byStatus.failed ?? 0,
        unverifiable: t.byStatus.unverifiable ?? 0,
      })),
      topFailedIps: [...spoofers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([ip, requests]) => ({ ip, requests })),
    };
    return void process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(`${parsed} of ${lines} lines parsed; ${sorted.reduce((n, t) => n + t.requests, 0)} requests claim to be a known crawler.\n\n`);
  printTable(
    ['crawler', 'operator', 'category', 'requests', 'verified', 'FAILED', 'unverifiable'],
    sorted.map((t) => [
      t.crawler.name,
      t.crawler.operator,
      t.crawler.category,
      String(t.requests),
      String(t.byStatus.verified ?? 0),
      String(t.byStatus.failed ?? 0),
      String(t.byStatus.unverifiable ?? 0),
    ]),
  );
  if (spoofers.size > 0) {
    process.stdout.write('\nTop IPs that failed verification (likely spoofed User-Agents):\n');
    for (const [ip, n] of [...spoofers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      process.stdout.write(`  ${ip.padEnd(40)} ${n} requests\n`);
    }
  }
  if (reasons.has('no-range-data')) {
    process.stdout.write('\nTip: the IP range snapshot is missing some crawlers; add --live to download the official lists.\n');
  }
  if (reasons.has('dns-resolver-required')) {
    process.stdout.write('\nTip: add --dns to verify crawlers that publish reverse DNS instead of IP lists.\n');
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`crawlerid: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});
