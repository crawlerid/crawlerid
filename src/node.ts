import { Resolver } from 'node:dns/promises';
import type { DnsResolver } from './types.js';

export interface NodeResolverOptions {
  /** Per-query timeout in milliseconds. Default 2 500. */
  timeoutMs?: number;
  /** Attempts per query. Default 2. */
  tries?: number;
  /** DNS servers to use instead of the system configuration, e.g. `['1.1.1.1']`. */
  servers?: string[];
  /**
   * A hostname that must always resolve, used to tell "this IP has no PTR
   * record" apart from "DNS is not working here". Some sandboxes and
   * containers answer every query with "not found"; without this check a
   * genuine crawler would be reported as `failed`. Checked at most once a
   * minute. Default `'example.com'`; pass `false` to disable.
   */
  canary?: string | false;
}

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && NOT_FOUND.has(String(error.code));
}

/**
 * A `DnsResolver` backed by `node:dns`, with timeouts. Works in Node.js, Bun
 * and Deno (with Node compatibility).
 *
 * @example
 * import { createVerifier } from 'crawlerid';
 * import { nodeResolver } from 'crawlerid/node';
 * const verifier = createVerifier({ resolver: nodeResolver() });
 */
export function nodeResolver(options: NodeResolverOptions = {}): DnsResolver {
  const resolver = new Resolver({ timeout: options.timeoutMs ?? 2_500, tries: options.tries ?? 2 });
  if (options.servers) resolver.setServers(options.servers);
  const canary = options.canary ?? 'example.com';
  let health: { ok: boolean; at: number } | undefined;

  const dnsWorks = async (): Promise<boolean> => {
    if (canary === false) return true;
    if (health && Date.now() - health.at < 60_000) return health.ok;
    let ok: boolean;
    try {
      ok = (await resolver.resolve4(canary)).length > 0;
    } catch {
      ok = false;
    }
    health = { ok, at: Date.now() };
    return ok;
  };

  const settle = async (query: Promise<string[]>): Promise<string[]> => {
    try {
      return await query;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      if (!(await dnsWorks())) {
        throw new Error(`DNS is not resolving (canary "${String(canary)}" failed); refusing to treat "not found" as an answer`);
      }
      return [];
    }
  };

  return {
    reverse: (ip) => settle(resolver.reverse(ip)),
    async lookup(hostname) {
      const [v4, v6] = await Promise.allSettled([settle(resolver.resolve4(hostname)), settle(resolver.resolve6(hostname))]);
      if (v4.status === 'rejected' && v6.status === 'rejected') throw v4.reason;
      return [...(v4.status === 'fulfilled' ? v4.value : []), ...(v6.status === 'fulfilled' ? v6.value : [])];
    },
  };
}

export type { DnsResolver } from './types.js';
