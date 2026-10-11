/**
 * What a crawler is for. Categories drive `robotsTxt()` policies and let you
 * treat, say, AI-training crawlers differently from search engines.
 */
export type Category =
  /** Classic search-engine crawlers (Googlebot, Bingbot, Applebot…). */
  | 'search'
  /** Crawlers that collect content to train AI models (GPTBot, ClaudeBot, CCBot…). */
  | 'ai-training'
  /** Crawlers that index content for AI search/answer products (OAI-SearchBot, PerplexityBot…). */
  | 'ai-search'
  /** Fetches made live when a user asks an AI assistant something (ChatGPT-User, Claude-User…). */
  | 'ai-assistant'
  /** Agentic browsing performed on behalf of a user (Google-Agent…). */
  | 'ai-agent'
  /** Ad-quality and landing-page checkers (AdsBot-Google, OAI-AdsBot…). */
  | 'ads'
  /** Link-preview fetchers for social and messaging apps. */
  | 'preview'
  /** Other user-triggered fetchers (feed readers, site verification…). */
  | 'fetcher'
  /** Anything else. */
  | 'other';

export const CATEGORIES: readonly Category[] = [
  'search',
  'ai-training',
  'ai-search',
  'ai-assistant',
  'ai-agent',
  'ads',
  'preview',
  'fetcher',
  'other',
];

/** A known crawler, as described by its operator's official documentation. */
export interface Crawler {
  /** Stable, lowercase identifier, e.g. `"gptbot"`. */
  readonly id: string;
  /** Display name, e.g. `"GPTBot"`. */
  readonly name: string;
  /** Company or project that runs the crawler. */
  readonly operator: string;
  readonly category: Category;
  /**
   * Tokens that identify the crawler in a `User-Agent` header (matched
   * case-insensitively as whole tokens). Empty for robots.txt-only control
   * tokens such as `Google-Extended`.
   */
  readonly userAgents: readonly string[];
  /** Tokens the crawler obeys in robots.txt `User-agent:` lines. */
  readonly robotsTokens: readonly string[];
  /** Whether the operator says it follows robots.txt. `null` when undocumented. */
  readonly respectsRobotsTxt: boolean | null;
  /** The operator's official documentation page (the source for this entry). */
  readonly docs: string;
  readonly verification: {
    /** Official URLs of machine-readable IP range lists. */
    readonly ipRanges: readonly string[];
    /** Hostname suffixes for forward-confirmed reverse DNS verification. */
    readonly reverseDns: readonly string[];
  };
  readonly notes?: string;
}

/** Outcome of verifying that a request really comes from the crawler it claims to be. */
export type VerificationStatus =
  /** The IP belongs to the claimed crawler, per the operator's published data. */
  | 'verified'
  /** The request claims to be a known crawler but failed the operator's check. Most likely spoofed. */
  | 'failed'
  /** The request claims to be a known crawler, but no check could be completed (see `reason`). */
  | 'unverifiable'
  /** The User-Agent does not match any known crawler. */
  | 'unknown';

export type VerificationReason =
  | 'ip-not-in-published-ranges'
  | 'no-ptr-record'
  | 'ptr-hostname-mismatch'
  | 'forward-dns-mismatch'
  | 'no-official-method'
  | 'no-range-data'
  | 'dns-resolver-required'
  | 'dns-error'
  | 'invalid-ip';

export interface VerificationResult {
  readonly status: VerificationStatus;
  /** The crawler the User-Agent claims to be, if any. */
  readonly crawler: Crawler | null;
  /** How the verdict was reached when `status` is `'verified'`. */
  readonly method?: 'ip-range' | 'reverse-dns';
  /** Why the request was not verified. */
  readonly reason?: VerificationReason;
  /** The reverse DNS hostname used, for `reverse-dns` checks. */
  readonly hostname?: string;
}

/**
 * Minimal DNS interface used for reverse DNS verification. Use
 * `nodeResolver()` from `crawlerid/node`, `createDohResolver()` on edge
 * runtimes, or supply your own.
 */
export interface DnsResolver {
  /** PTR lookup. Resolve to `[]` when the IP has no PTR record. */
  reverse(ip: string): Promise<string[]>;
  /** A and AAAA lookup. Resolve to `[]` when the name does not exist. */
  lookup(hostname: string): Promise<string[]>;
}

/** IP ranges for each official source URL, as stored in `data/ip-ranges.json`. */
export interface RangeSnapshot {
  /** ISO timestamp of when the snapshot was generated, or `null` if never. */
  readonly generatedAt: string | null;
  readonly sources: Readonly<
    Record<
      string,
      {
        /** ISO timestamp of the last successful fetch. */
        readonly fetchedAt: string;
        /** The `creationTime` the operator put in the file, when present. */
        readonly creationTime?: string;
        /** CIDR prefixes (single IPs are stored as /32 or /128). */
        readonly prefixes: readonly string[];
      }
    >
  >;
}
