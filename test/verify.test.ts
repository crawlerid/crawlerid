import { describe, expect, it, vi } from 'vitest';
import type { DnsResolver, RangeSnapshot } from '../src/types.js';
import { createVerifier, verifySync } from '../src/verify.js';

const UA = {
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  yandex: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  meta: 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

// Documentation-range addresses, not real crawler IPs.
const ranges: RangeSnapshot = {
  generatedAt: '2026-10-01T00:00:00.000Z',
  sources: {
    'https://openai.com/gptbot.json': {
      fetchedAt: '2026-10-01T00:00:00.000Z',
      prefixes: ['192.0.2.0/25', '2001:db8:1::/48'],
    },
    'https://developers.google.com/static/crawling/ipranges/common-crawlers.json': {
      fetchedAt: '2026-10-01T00:00:00.000Z',
      prefixes: ['198.51.100.0/27'],
    },
  },
};
const empty: RangeSnapshot = { generatedAt: null, sources: {} };

function fakeDns(ptr: Record<string, string[]>, forward: Record<string, string[]>): DnsResolver & {
  reverse: ReturnType<typeof vi.fn>;
  lookup: ReturnType<typeof vi.fn>;
} {
  return {
    reverse: vi.fn(async (ip: string) => ptr[ip] ?? []),
    lookup: vi.fn(async (host: string) => forward[host] ?? []),
  };
}

describe('verify with IP ranges', () => {
  const verifier = createVerifier({ ranges });

  it('verifies an IP inside the published list', async () => {
    const res = await verifier.verify({ userAgent: UA.gptbot, ip: '192.0.2.33' });
    expect(res).toMatchObject({ status: 'verified', method: 'ip-range' });
    expect(res.crawler?.id).toBe('gptbot');
  });

  it('verifies IPv6 and IPv4-mapped addresses', async () => {
    expect((await verifier.verify({ userAgent: UA.gptbot, ip: '2001:db8:1:ff::7' })).status).toBe('verified');
    expect((await verifier.verify({ userAgent: UA.gptbot, ip: '::ffff:192.0.2.33' })).status).toBe('verified');
  });

  it('fails a spoofed User-Agent from another IP', async () => {
    const res = await verifier.verify({ userAgent: UA.gptbot, ip: '203.0.113.9' });
    expect(res).toMatchObject({ status: 'failed', reason: 'ip-not-in-published-ranges' });
  });

  it('is unverifiable when the snapshot has no data for the crawler', async () => {
    const res = await createVerifier({ ranges: empty }).verify({ userAgent: UA.gptbot, ip: '192.0.2.33' });
    expect(res).toMatchObject({ status: 'unverifiable', reason: 'no-range-data' });
  });

  it('reports unknown User-Agents', async () => {
    expect(await verifier.verify({ userAgent: UA.chrome, ip: '192.0.2.33' })).toEqual({ status: 'unknown', crawler: null });
    expect((await verifier.verify({ userAgent: undefined, ip: '192.0.2.33' })).status).toBe('unknown');
  });

  it('rejects invalid IPs without throwing', async () => {
    for (const ip of ['nope', '', undefined, null, '999.1.1.1']) {
      expect(await verifier.verify({ userAgent: UA.gptbot, ip })).toMatchObject({ status: 'unverifiable', reason: 'invalid-ip' });
    }
  });

  it('marks crawlers without an official method as unverifiable', async () => {
    expect(await verifier.verify({ userAgent: UA.meta, ip: '192.0.2.1' })).toMatchObject({
      status: 'unverifiable',
      reason: 'no-official-method',
    });
  });

  it('swaps range data at runtime', async () => {
    const v = createVerifier({ ranges: empty });
    expect((await v.verify({ userAgent: UA.gptbot, ip: '192.0.2.33' })).status).toBe('unverifiable');
    v.setRanges(ranges);
    expect((await v.verify({ userAgent: UA.gptbot, ip: '192.0.2.33' })).status).toBe('verified');
  });
});

describe('verify with reverse DNS', () => {
  const ip = '198.51.100.200'; // outside the fixture's Google range
  const genuine = () =>
    fakeDns({ [ip]: ['crawl-198-51-100-200.googlebot.com.'] }, { 'crawl-198-51-100-200.googlebot.com': [ip] });

  it('verifies with forward-confirmed reverse DNS', async () => {
    const res = await createVerifier({ ranges: empty, resolver: genuine() }).verify({ userAgent: UA.googlebot, ip });
    expect(res).toMatchObject({ status: 'verified', method: 'reverse-dns', hostname: 'crawl-198-51-100-200.googlebot.com' });
  });

  it('prefers the IP list when the address is in it', async () => {
    const dns = genuine();
    const res = await createVerifier({ ranges, resolver: dns }).verify({ userAgent: UA.googlebot, ip: '198.51.100.7' });
    expect(res).toMatchObject({ status: 'verified', method: 'ip-range' });
    expect(dns.reverse).not.toHaveBeenCalled();
  });

  it('falls back to DNS when the IP is missing from the list', async () => {
    const res = await createVerifier({ ranges, resolver: genuine() }).verify({ userAgent: UA.googlebot, ip });
    expect(res).toMatchObject({ status: 'verified', method: 'reverse-dns' });
  });

  it.each([
    ['evil.example.com', 'ptr-hostname-mismatch'],
    ['crawl-1.googlebot.com.evil.example', 'ptr-hostname-mismatch'],
    ['notgooglebot.com', 'ptr-hostname-mismatch'],
  ])('fails when the PTR is %s', async (host, reason) => {
    const dns = fakeDns({ [ip]: [host] }, { [host]: [ip] });
    expect(await createVerifier({ ranges: empty, resolver: dns }).verify({ userAgent: UA.googlebot, ip })).toMatchObject({
      status: 'failed',
      reason,
    });
  });

  it('fails when the IP has no PTR record', async () => {
    const res = await createVerifier({ ranges: empty, resolver: fakeDns({}, {}) }).verify({ userAgent: UA.googlebot, ip });
    expect(res).toMatchObject({ status: 'failed', reason: 'no-ptr-record' });
  });

  it('fails when the forward lookup does not return the IP (forged PTR)', async () => {
    const dns = fakeDns({ [ip]: ['crawl-x.googlebot.com'] }, { 'crawl-x.googlebot.com': ['192.0.2.1'] });
    expect(await createVerifier({ ranges: empty, resolver: dns }).verify({ userAgent: UA.googlebot, ip })).toMatchObject({
      status: 'failed',
      reason: 'forward-dns-mismatch',
    });
  });

  it('treats DNS errors as unverifiable and does not cache them', async () => {
    const dns: DnsResolver = { reverse: vi.fn().mockRejectedValue(new Error('SERVFAIL')), lookup: vi.fn() };
    const v = createVerifier({ ranges: empty, resolver: dns });
    expect(await v.verify({ userAgent: UA.googlebot, ip })).toMatchObject({ status: 'unverifiable', reason: 'dns-error' });
    await v.verify({ userAgent: UA.googlebot, ip });
    expect(dns.reverse).toHaveBeenCalledTimes(2);
  });

  it('caches results and de-duplicates concurrent lookups', async () => {
    const dns = genuine();
    const v = createVerifier({ ranges: empty, resolver: dns });
    await Promise.all(Array.from({ length: 5 }, () => v.verify({ userAgent: UA.googlebot, ip })));
    await v.verify({ userAgent: UA.googlebot, ip: `::ffff:${ip}` });
    expect(dns.reverse).toHaveBeenCalledTimes(1);
  });

  it('can disable the cache', async () => {
    const dns = genuine();
    const v = createVerifier({ ranges: empty, resolver: dns, cacheSize: 0 });
    await v.verify({ userAgent: UA.googlebot, ip });
    await v.verify({ userAgent: UA.googlebot, ip });
    expect(dns.reverse).toHaveBeenCalledTimes(2);
  });

  it('verifies DNS-only crawlers such as YandexBot', async () => {
    const dns = fakeDns({ '203.0.113.5': ['spider-203-0-113-5.yandex.com'] }, { 'spider-203-0-113-5.yandex.com': ['203.0.113.5'] });
    const res = await createVerifier({ resolver: dns }).verify({ userAgent: UA.yandex, ip: '203.0.113.5' });
    expect(res).toMatchObject({ status: 'verified', method: 'reverse-dns' });
  });

  it('asks for a resolver when DNS is the only option', async () => {
    const res = await createVerifier({ ranges: empty }).verify({ userAgent: UA.yandex, ip: '203.0.113.5' });
    expect(res).toMatchObject({ status: 'unverifiable', reason: 'dns-resolver-required' });
  });
});

describe('verifySync', () => {
  it('verifies against IP ranges without touching DNS', () => {
    expect(verifySync({ userAgent: UA.gptbot, ip: '192.0.2.1' }, { ranges }).status).toBe('verified');
    expect(verifySync({ userAgent: UA.gptbot, ip: '203.0.113.1' }, { ranges }).status).toBe('failed');
  });

  it('fails an IP outside an authoritative list even if DNS could be tried', () => {
    expect(verifySync({ userAgent: UA.googlebot, ip: '203.0.113.1' }, { ranges })).toMatchObject({
      status: 'failed',
      reason: 'ip-not-in-published-ranges',
    });
  });

  it('reports DNS-only crawlers as unverifiable', () => {
    expect(verifySync({ userAgent: UA.yandex, ip: '203.0.113.1' }, { ranges })).toMatchObject({
      status: 'unverifiable',
      reason: 'dns-resolver-required',
    });
  });
});
