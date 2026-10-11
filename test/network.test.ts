import { describe, expect, it, vi } from 'vitest';
import { createDohResolver, ptrName } from '../src/doh.js';
import { fetchRanges, rangeSources } from '../src/ranges.js';
import type { RangeSnapshot } from '../src/types.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchRanges', () => {
  const A = 'https://example.com/a.json';
  const B = 'https://example.com/b.json';
  const C = 'https://example.com/c.json';

  it('downloads lists, keeps creationTime and reports failures', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === A) return json({ creationTime: '2026-10-01T00:00:00Z', prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
      if (String(url) === B) return json({}, 503);
      return json({ nothing: 'here' });
    });
    const previous: RangeSnapshot = {
      generatedAt: '2026-09-01T00:00:00Z',
      sources: { [B]: { fetchedAt: '2026-09-01T00:00:00Z', prefixes: ['198.51.100.0/24'] } },
    };
    const { snapshot, errors } = await fetchRanges({ fetch: fetch as typeof globalThis.fetch, sources: [A, B, C], previous });

    expect(snapshot.sources[A]).toMatchObject({ creationTime: '2026-10-01T00:00:00Z', prefixes: ['192.0.2.0/24'] });
    expect(snapshot.sources[B]).toEqual(previous.sources[B]); // kept on failure
    expect(snapshot.sources[C]).toBeUndefined();
    expect(errors).toEqual([
      { url: B, error: 'HTTP 503' },
      { url: C, error: 'no IP prefixes found in response' },
    ]);
  });

  it('refers only to official sources from the registry', () => {
    const sources = rangeSources();
    expect(sources).toContain('https://openai.com/gptbot.json');
    expect(sources).toContain('https://claude.com/crawling/bots.json');
    expect(new Set(sources).size).toBe(sources.length);
  });
});

describe('DNS over HTTPS', () => {
  it('builds PTR names', () => {
    expect(ptrName('66.249.66.1')).toBe('1.66.249.66.in-addr.arpa');
    expect(ptrName('2001:db8::1')).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    );
    expect(() => ptrName('nope')).toThrow(TypeError);
  });

  it('resolves PTR, A and AAAA records', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const name = u.searchParams.get('name');
      const type = Number(u.searchParams.get('type'));
      if (type === 12 && name === '1.66.249.66.in-addr.arpa') {
        return json({ Status: 0, Answer: [{ type: 12, data: 'crawl-66-249-66-1.googlebot.com.' }] });
      }
      if (type === 1) return json({ Status: 0, Answer: [{ type: 5, data: 'alias.' }, { type: 1, data: '66.249.66.1' }] });
      if (type === 28) return json({ Status: 0 });
      return json({ Status: 3 });
    });
    const dns = createDohResolver({ fetch: fetch as typeof globalThis.fetch });
    expect(await dns.reverse('66.249.66.1')).toEqual(['crawl-66-249-66-1.googlebot.com']);
    expect(await dns.reverse('192.0.2.1')).toEqual([]); // NXDOMAIN
    expect(await dns.lookup('crawl-66-249-66-1.googlebot.com')).toEqual(['66.249.66.1']);
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/^https:\/\/cloudflare-dns\.com\/dns-query\?name=/);
  });

  it('throws on server errors so the verifier reports dns-error, not failed', async () => {
    const dns = createDohResolver({ fetch: (async () => json({ Status: 2 })) as typeof globalThis.fetch });
    await expect(dns.reverse('192.0.2.1')).rejects.toThrow(/status 2/);
    const down = createDohResolver({ fetch: (async () => json({}, 500)) as typeof globalThis.fetch });
    await expect(down.lookup('example.com')).rejects.toThrow(/HTTP 500/);
  });
});
