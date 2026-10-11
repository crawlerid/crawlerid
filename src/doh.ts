import { parseIp } from './ip.js';
import type { DnsResolver } from './types.js';

export interface DohResolverOptions {
  /**
   * A DNS-over-HTTPS endpoint that speaks the JSON API
   * (`application/dns-json`). Default: Cloudflare (`https://cloudflare-dns.com/dns-query`).
   * Google's `https://dns.google/resolve` also works.
   */
  endpoint?: string;
  /** `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Per-query timeout in milliseconds. Default 3 000. */
  timeoutMs?: number;
}

const TYPE = { A: 1, PTR: 12, AAAA: 28 } as const;

/** The `in-addr.arpa` / `ip6.arpa` name for a PTR lookup. */
export function ptrName(ip: string): string {
  const parsed = parseIp(ip);
  if (!parsed) throw new TypeError(`Invalid IP address: ${ip}`);
  if (parsed.version === 4) {
    return [0n, 8n, 16n, 24n].map((s) => ((parsed.value >> s) & 0xffn).toString()).join('.') + '.in-addr.arpa';
  }
  const nibbles: string[] = [];
  for (let s = 0n; s < 128n; s += 4n) nibbles.push(((parsed.value >> s) & 0xfn).toString(16));
  return `${nibbles.join('.')}.ip6.arpa`;
}

interface DohAnswer {
  type: number;
  data: string;
}

/**
 * A `DnsResolver` that uses DNS-over-HTTPS, so reverse DNS verification works
 * on edge runtimes without `node:dns` (Cloudflare Workers, Vercel Edge, Deno
 * Deploy, browsers).
 */
export function createDohResolver(options: DohResolverOptions = {}): DnsResolver {
  const endpoint = options.endpoint ?? 'https://cloudflare-dns.com/dns-query';
  const timeoutMs = options.timeoutMs ?? 3_000;

  async function query(name: string, type: number): Promise<string[]> {
    const doFetch = options.fetch ?? globalThis.fetch;
    const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}&type=${type}`;
    const res = await doFetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`DoH query failed: HTTP ${res.status}`);
    const body = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
    if (body.Status === 3) return []; // NXDOMAIN
    if (body.Status !== 0) throw new Error(`DoH query failed: DNS status ${String(body.Status)}`);
    return (body.Answer ?? []).filter((a) => a.type === type).map((a) => a.data.replace(/\.$/, ''));
  }

  return {
    reverse: (ip) => query(ptrName(ip), TYPE.PTR),
    async lookup(hostname) {
      const [a, aaaa] = await Promise.allSettled([query(hostname, TYPE.A), query(hostname, TYPE.AAAA)]);
      if (a.status === 'rejected' && aaaa.status === 'rejected') throw a.reason;
      return [...(a.status === 'fulfilled' ? a.value : []), ...(aaaa.status === 'fulfilled' ? aaaa.value : [])];
    },
  };
}
