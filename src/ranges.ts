import { snapshot as bundled } from './generated/ip-ranges.js';
import { RangeSet, extractCidrs } from './ip.js';
import { crawlers } from './registry.js';
import type { Crawler, RangeSnapshot } from './types.js';

/**
 * The IP ranges bundled with this release, fetched from the operators'
 * official lists when the package was published. Check `generatedAt` to see
 * how fresh it is, or use `fetchRanges()` for live data.
 */
export const bundledRanges: RangeSnapshot = bundled;

/** Every official IP range URL referenced by the registry. */
export function rangeSources(list: readonly Crawler[] = crawlers): string[] {
  return [...new Set(list.flatMap((c) => c.verification.ipRanges))].sort();
}

const cache = new WeakMap<RangeSnapshot, Map<string, RangeSet | null>>();

/**
 * The combined IP ranges for one crawler in a snapshot, or `null` when the
 * snapshot holds no data for any of the crawler's sources.
 */
export function rangesFor(crawler: Crawler, snapshot: RangeSnapshot = bundledRanges): RangeSet | null {
  let perCrawler = cache.get(snapshot);
  if (!perCrawler) {
    perCrawler = new Map();
    cache.set(snapshot, perCrawler);
  }
  if (perCrawler.has(crawler.id)) return perCrawler.get(crawler.id) ?? null;

  const prefixes: string[] = [];
  let found = false;
  for (const url of crawler.verification.ipRanges) {
    const source = snapshot.sources[url];
    if (source && source.prefixes.length > 0) {
      found = true;
      prefixes.push(...source.prefixes);
    }
  }
  const set = found ? new RangeSet(prefixes) : null;
  perCrawler.set(crawler.id, set);
  return set;
}

export interface FetchRangesOptions {
  /** `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** URLs to fetch. Defaults to every source in the registry. */
  sources?: readonly string[];
  /** Per-request timeout in milliseconds. Default 15 000. */
  timeoutMs?: number;
  /**
   * A previous snapshot. Sources that fail to download keep their previous
   * data, so one operator's outage never empties the snapshot.
   */
  previous?: RangeSnapshot;
}

export interface FetchRangesResult {
  snapshot: RangeSnapshot;
  /** Sources that could not be refreshed, with the reason. */
  errors: { url: string; error: string }[];
}

/**
 * Downloads the operators' official IP range lists. Works anywhere `fetch`
 * is available (Node 18+, Deno, Bun, Cloudflare Workers, Vercel Edge).
 *
 * @example
 * const { snapshot } = await fetchRanges({ previous: bundledRanges });
 * const verifier = createVerifier({ ranges: snapshot });
 */
export async function fetchRanges(options: FetchRangesOptions = {}): Promise<FetchRangesResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new TypeError('fetchRanges: no fetch implementation available; pass one with { fetch }.');
  }
  const urls = options.sources ?? rangeSources();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const now = new Date().toISOString();
  const sources: Record<string, RangeSnapshot['sources'][string]> = {};
  const errors: FetchRangesResult['errors'] = [];

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await doFetch(url, {
          headers: { accept: 'application/json' },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: unknown = JSON.parse(await res.text());
        const prefixes = extractCidrs(json);
        if (prefixes.length === 0) throw new Error('no IP prefixes found in response');
        const creationTime =
          json && typeof json === 'object' && 'creationTime' in json && typeof json.creationTime === 'string'
            ? json.creationTime
            : undefined;
        sources[url] = creationTime ? { fetchedAt: now, creationTime, prefixes } : { fetchedAt: now, prefixes };
      } catch (error) {
        errors.push({ url, error: error instanceof Error ? error.message : String(error) });
        const kept = options.previous?.sources[url];
        if (kept) sources[url] = kept;
      }
    }),
  );

  const ordered: Record<string, RangeSnapshot['sources'][string]> = {};
  for (const url of Object.keys(sources).sort()) ordered[url] = sources[url]!;
  errors.sort((a, b) => a.url.localeCompare(b.url));
  return { snapshot: { generatedAt: now, sources: ordered }, errors };
}
