import { crawlers as generated } from './generated/registry.js';
import type { Category, Crawler } from './types.js';

/** Every crawler in the registry, in registry order. */
export const crawlers: readonly Crawler[] = generated;

let byUserAgentToken: Map<string, Crawler> | undefined;
let byIdOrToken: Map<string, Crawler> | undefined;

function userAgentIndex(): Map<string, Crawler> {
  if (!byUserAgentToken) {
    byUserAgentToken = new Map();
    for (const crawler of crawlers) {
      for (const token of crawler.userAgents) byUserAgentToken.set(token.toLowerCase(), crawler);
    }
  }
  return byUserAgentToken;
}

// User-Agent tokens are made of these characters; anything else is a boundary.
const UA_TOKEN = /[A-Za-z0-9_-]+/g;

/**
 * Identifies which known crawler a `User-Agent` header claims to be.
 *
 * This only reads the header, which anyone can fake. Use `verify()` to check
 * the claim against the operator's published IP ranges or DNS.
 *
 * Tokens are matched case-insensitively and as whole tokens, so `Googlebot`
 * does not match `Googlebot-Image` and vice versa.
 *
 * @example
 * identify('Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)')?.id
 * // → 'gptbot'
 */
export function identify(userAgent: string | null | undefined): Crawler | null {
  if (!userAgent) return null;
  const index = userAgentIndex();
  for (const match of userAgent.matchAll(UA_TOKEN)) {
    const crawler = index.get(match[0].toLowerCase());
    if (crawler) return crawler;
  }
  return null;
}

/**
 * Looks up a crawler by its id (`"gptbot"`), a User-Agent token, or a
 * robots.txt token (`"Google-Extended"`), case-insensitively.
 */
export function getCrawler(idOrToken: string): Crawler | undefined {
  if (!byIdOrToken) {
    byIdOrToken = new Map();
    for (const crawler of crawlers) {
      for (const key of [...crawler.robotsTokens, ...crawler.userAgents, crawler.id]) {
        byIdOrToken.set(key.toLowerCase(), crawler);
      }
    }
  }
  return byIdOrToken.get(idOrToken.toLowerCase());
}

/** All crawlers in the given category. */
export function crawlersInCategory(category: Category): Crawler[] {
  return crawlers.filter((c) => c.category === category);
}
