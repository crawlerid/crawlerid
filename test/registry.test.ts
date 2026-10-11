import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRegistry } from '../scripts/gen-data.mjs';
import { parseLogLine } from '../src/logs.js';
import { crawlers } from '../src/registry.js';

const registry = JSON.parse(readFileSync(new URL('../data/crawlers.json', import.meta.url), 'utf8'));

describe('data/crawlers.json', () => {
  it('passes validation', () => {
    expect(validateRegistry(registry)).toEqual([]);
  });

  it('catches common mistakes', () => {
    const broken = structuredClone(registry);
    broken.crawlers.push({ ...broken.crawlers[0], docs: 'http://example.com', category: 'bots' });
    const errors = validateRegistry(broken);
    expect(errors.join('\n')).toMatch(/duplicate id/);
    expect(errors.join('\n')).toMatch(/already used/);
    expect(errors.join('\n')).toMatch(/"docs" must be an https/);
    expect(errors.join('\n')).toMatch(/"category" must be one of/);
  });

  it('ships every entry in the generated module', () => {
    expect(crawlers.map((c) => c.id)).toEqual(registry.crawlers.map((c: { id: string }) => c.id));
  });

  it('only sends IP lists over plain HTTP where the operator publishes it that way', () => {
    const http = crawlers.flatMap((c) => c.verification.ipRanges).filter((u) => u.startsWith('http:'));
    expect([...new Set(http)]).toEqual(['http://search.developer.apple.com/applebot.json']);
  });
});

describe('parseLogLine', () => {
  it('reads the combined log format', () => {
    const line =
      '66.249.66.1 - - [11/Oct/2026:06:25:14 +0000] "GET /robots.txt HTTP/1.1" 200 412 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"';
    expect(parseLogLine(line)).toEqual({
      ip: '66.249.66.1',
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });
  });

  it('handles IPv6 clients and escaped quotes', () => {
    const line = '2001:db8::1 - - [11/Oct/2026:06:25:14 +0000] "GET /a\\"b HTTP/2.0" 404 0 "-" "odd \\"agent\\""';
    expect(parseLogLine(line)).toEqual({ ip: '2001:db8::1', userAgent: 'odd "agent"' });
  });

  it('ignores other formats', () => {
    expect(parseLogLine('{"ip":"1.2.3.4"}')).toBeNull();
    expect(parseLogLine('')).toBeNull();
  });
});
