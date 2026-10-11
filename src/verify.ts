import { formatIp, parseIp, sameIp, type ParsedIp } from './ip.js';
import { bundledRanges, rangesFor } from './ranges.js';
import { identify } from './registry.js';
import type {
  Crawler,
  DnsResolver,
  RangeSnapshot,
  VerificationReason,
  VerificationResult,
} from './types.js';

export interface VerifyInput {
  /** The request's `User-Agent` header. */
  userAgent: string | null | undefined;
  /**
   * The client IP as seen by your server. Take it from your platform's
   * trusted source (the socket, `cf-connecting-ip`, `x-real-ip` set by your
   * own proxy…), never from a header the client controls.
   */
  ip: string | null | undefined;
}

export interface VerifierOptions {
  /** IP range data. Defaults to the snapshot bundled with this release. */
  ranges?: RangeSnapshot;
  /**
   * Enables reverse DNS verification (needed for crawlers such as Yandex, and
   * a fallback for others). Use `nodeResolver()` from `crawlerid/node` or
   * `createDohResolver()`.
   */
  resolver?: DnsResolver;
  /** Max reverse DNS results kept in memory. Default 10 000. Set 0 to disable. */
  cacheSize?: number;
  /** How long reverse DNS results stay cached, in ms. Default 6 hours. */
  cacheTtlMs?: number;
}

export interface Verifier {
  /** Full verification, using IP ranges and (if a resolver is set) reverse DNS. */
  verify(input: VerifyInput): Promise<VerificationResult>;
  /**
   * Synchronous verification using IP ranges only. Crawlers that can only be
   * checked with DNS come back `unverifiable` with `dns-resolver-required`.
   */
  verifySync(input: VerifyInput): VerificationResult;
  /** Replaces the IP range data, e.g. after `fetchRanges()`. */
  setRanges(ranges: RangeSnapshot): void;
}

const result = (
  status: VerificationResult['status'],
  crawler: Crawler | null,
  extra: { method?: 'ip-range' | 'reverse-dns'; reason?: VerificationReason; hostname?: string } = {},
): VerificationResult => ({ status, crawler, ...extra });

type Step =
  | { done: VerificationResult }
  | { dns: { crawler: Crawler; ip: ParsedIp; rangeChecked: boolean } };

/** Everything that does not need DNS. */
function precheck(input: VerifyInput, ranges: RangeSnapshot): Step {
  const crawler = identify(input.userAgent);
  if (!crawler) return { done: result('unknown', null) };

  const ip = input.ip ? parseIp(input.ip) : null;
  if (!ip) return { done: result('unverifiable', crawler, { reason: 'invalid-ip' }) };

  const { ipRanges, reverseDns } = crawler.verification;
  if (ipRanges.length === 0 && reverseDns.length === 0) {
    return { done: result('unverifiable', crawler, { reason: 'no-official-method' }) };
  }

  const set = ipRanges.length > 0 ? rangesFor(crawler, ranges) : null;
  if (set?.has(ip)) return { done: result('verified', crawler, { method: 'ip-range' }) };

  if (reverseDns.length === 0) {
    return set
      ? { done: result('failed', crawler, { reason: 'ip-not-in-published-ranges' }) }
      : { done: result('unverifiable', crawler, { reason: 'no-range-data' }) };
  }
  return { dns: { crawler, ip, rangeChecked: set !== null } };
}

function matchesSuffix(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

/** Forward-confirmed reverse DNS, as recommended by Google, Bing, Apple and others. */
async function reverseDnsCheck(crawler: Crawler, ip: ParsedIp, resolver: DnsResolver): Promise<VerificationResult> {
  const address = formatIp(ip);
  let hostnames: string[];
  try {
    hostnames = await resolver.reverse(address);
  } catch {
    return result('unverifiable', crawler, { reason: 'dns-error' });
  }
  if (hostnames.length === 0) return result('failed', crawler, { reason: 'no-ptr-record' });

  const normalised = hostnames.map((h) => h.toLowerCase().replace(/\.$/, ''));
  const hostname = normalised.find((h) => matchesSuffix(h, crawler.verification.reverseDns));
  if (!hostname) {
    return result('failed', crawler, { reason: 'ptr-hostname-mismatch', hostname: normalised[0] as string });
  }

  let addresses: string[];
  try {
    addresses = await resolver.lookup(hostname);
  } catch {
    return result('unverifiable', crawler, { reason: 'dns-error', hostname });
  }
  if (!addresses.some((a) => sameIp(a, address))) {
    return result('failed', crawler, { reason: 'forward-dns-mismatch', hostname });
  }
  return result('verified', crawler, { method: 'reverse-dns', hostname });
}

/**
 * Creates a verifier with its own reverse DNS cache. Create one per process
 * and reuse it.
 *
 * @example
 * import { createVerifier } from 'crawlerid';
 * import { nodeResolver } from 'crawlerid/node';
 *
 * const verifier = createVerifier({ resolver: nodeResolver() });
 * const { status, crawler } = await verifier.verify({ userAgent, ip });
 * if (status === 'failed') return new Response('Forbidden', { status: 403 });
 */
export function createVerifier(options: VerifierOptions = {}): Verifier {
  let ranges = options.ranges ?? bundledRanges;
  const resolver = options.resolver;
  const cacheSize = options.cacheSize ?? 10_000;
  const ttl = options.cacheTtlMs ?? 6 * 60 * 60 * 1000;
  const cache = new Map<string, { value: VerificationResult; expires: number }>();
  const inFlight = new Map<string, Promise<VerificationResult>>();

  const remember = (key: string, value: VerificationResult): void => {
    // DNS errors are transient; do not pin them in the cache.
    if (cacheSize <= 0 || value.reason === 'dns-error') return;
    cache.delete(key);
    cache.set(key, { value, expires: Date.now() + ttl });
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  };

  return {
    verifySync(input) {
      const step = precheck(input, ranges);
      if ('done' in step) return step.done;
      const { crawler, rangeChecked } = step.dns;
      // An IP outside an authoritative published list is a failure even without DNS.
      return rangeChecked
        ? result('failed', crawler, { reason: 'ip-not-in-published-ranges' })
        : result('unverifiable', crawler, { reason: 'dns-resolver-required' });
    },

    async verify(input) {
      const step = precheck(input, ranges);
      if ('done' in step) return step.done;
      const { crawler, ip, rangeChecked } = step.dns;
      if (!resolver) {
        return rangeChecked
          ? result('failed', crawler, { reason: 'ip-not-in-published-ranges' })
          : result('unverifiable', crawler, { reason: 'dns-resolver-required' });
      }

      const key = `${crawler.id}|${ip.version}|${ip.value}`;
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;
      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = reverseDnsCheck(crawler, ip, resolver).then((value) => {
        remember(key, value);
        return value;
      });
      inFlight.set(key, promise);
      try {
        return await promise;
      } finally {
        inFlight.delete(key);
      }
    },

    setRanges(next) {
      ranges = next;
    },
  };
}

let defaultVerifier: Verifier | undefined;

/**
 * Verifies a request against the bundled IP ranges (and reverse DNS when a
 * `resolver` is given). For repeated use, prefer `createVerifier()`, which
 * caches DNS results.
 */
export function verify(input: VerifyInput, options?: VerifierOptions): Promise<VerificationResult> {
  if (!options) return (defaultVerifier ??= createVerifier()).verify(input);
  return createVerifier(options).verify(input);
}

/** Synchronous, IP-range-only variant of `verify()`. Never touches the network. */
export function verifySync(input: VerifyInput, options?: Pick<VerifierOptions, 'ranges'>): VerificationResult {
  if (!options) return (defaultVerifier ??= createVerifier()).verifySync(input);
  return createVerifier(options).verifySync(input);
}
