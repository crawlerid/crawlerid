# crawlerid

[![npm](https://img.shields.io/npm/v/crawlerid)](https://www.npmjs.com/package/crawlerid)
[![CI](https://github.com/crawlerid/crawlerid/actions/workflows/ci.yml/badge.svg)](https://github.com/crawlerid/crawlerid/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/crawlerid)](LICENSE)

**Is that really GPTBot?** crawlerid identifies web crawlers and AI agents from their `User-Agent`, then checks the claim against each operator's official IP lists and DNS records.

Anyone can send `User-Agent: Googlebot` or `ClaudeBot`, and scrapers routinely do it to slip past rules written for the real crawlers. Every operator publishes a different way to check: a JSON list here, a reverse DNS suffix there, sometimes both, each on its own docs page. crawlerid keeps all of it in one registry where every entry links to its official source, and gives you one function to call.

- **47 crawlers from 12 operators**: Google, Microsoft, Apple, OpenAI, Anthropic, Perplexity, Mistral, Common Crawl, Amazon, Meta, DuckDuckGo and Yandex.
- **Real verification**: official IP lists (bundled and refreshed weekly) plus forward-confirmed reverse DNS, the method Google and Bing document.
- **Zero dependencies, edge-ready**: Node.js, Bun, Deno, Cloudflare Workers and Vercel Edge. The core never imports Node built-ins.
- **Fast on the hot path**: human visitors are ruled out with a single scan of the header, with no I/O. `verifySync()` checks IP lists without touching the network.
- **robots.txt by category**: block AI training while staying in AI search, using each operator's exact documented tokens.
- **CLI log audit**: find spoofed crawlers in your existing access logs in one command.

```sh
npm install crawlerid
```

## Quick start

```ts
import { createVerifier } from 'crawlerid';
import { nodeResolver } from 'crawlerid/node';

const verifier = createVerifier({ resolver: nodeResolver() }); // create once, reuse

const result = await verifier.verify({
  userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
  ip: '203.0.113.7',
});

result.status;          // 'failed': the IP is not in OpenAI's published GPTBot list
result.reason;          // 'ip-not-in-published-ranges'
result.crawler?.name;   // 'GPTBot'
result.crawler?.category; // 'ai-training'
```

Only need to know what a header *claims*?

```ts
import { identify } from 'crawlerid';

identify('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)');
// → { id: 'bingbot', name: 'Bingbot', operator: 'Microsoft', category: 'search', … }
```

## What the verdicts mean

| `status` | Meaning | Typical action |
| --- | --- | --- |
| `verified` | The IP is in the operator's published list, or forward-confirmed reverse DNS matched. | Trust the identity. |
| `failed` | Claims to be a known crawler, but the operator's data says the IP isn't theirs. | Almost always spoofed: block, rate-limit, or treat as an ordinary visitor. |
| `unverifiable` | A known crawler, but no check could be completed (see `reason`). | Don't grant special treatment based on the header alone. |
| `unknown` | Not a known crawler's User-Agent. | Ordinary traffic. |

`reason` tells you why a request was not verified:
`ip-not-in-published-ranges`, `no-ptr-record`, `ptr-hostname-mismatch`, `forward-dns-mismatch` (all `failed`), and
`no-official-method`, `no-range-data`, `dns-resolver-required`, `dns-error`, `invalid-ip` (all `unverifiable`).

crawlerid fails safe: a DNS outage or timeout produces `unverifiable`, never `failed`. The Node resolver also checks that DNS is actually working before it trusts a "not found" answer.

## Recipes

> **Use a client IP you can trust.** Take it from the socket, or from a header your own platform sets (`cf-connecting-ip` on Cloudflare, `x-real-ip` on Vercel). Never trust a raw `X-Forwarded-For` that the client could have written.

### Express

```js
import express from 'express';
import { createVerifier } from 'crawlerid';
import { nodeResolver } from 'crawlerid/node';

const verifier = createVerifier({ resolver: nodeResolver() });
const app = express();
app.set('trust proxy', 'loopback'); // only if you run behind your own reverse proxy

app.use(async (req, res, next) => {
  const result = await verifier.verify({ userAgent: req.get('user-agent'), ip: req.ip });
  if (result.status === 'failed') return res.status(403).send('Forbidden');
  res.locals.crawler = result;
  next();
});
```

### Next.js (`proxy.ts`, or `middleware.ts` before Next.js 16)

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifySync } from 'crawlerid';

export function proxy(request: NextRequest) {
  const { status } = verifySync({
    userAgent: request.headers.get('user-agent'),
    ip: request.headers.get('x-real-ip'), // set by Vercel
  });
  if (status === 'failed') return new NextResponse('Forbidden', { status: 403 });
  return NextResponse.next();
}
```

### Cloudflare Workers (and other edge runtimes)

There's no `node:dns` here, so reverse DNS goes over DNS-over-HTTPS:

```ts
import { createDohResolver, createVerifier } from 'crawlerid';

const verifier = createVerifier({ resolver: createDohResolver() });

export default {
  async fetch(request: Request): Promise<Response> {
    const result = await verifier.verify({
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('cf-connecting-ip'),
    });
    if (result.status === 'failed') return new Response('Forbidden', { status: 403 });
    return fetch(request);
  },
};
```

### Keep IP ranges fresh at runtime

The package ships with a snapshot of every official list, and each release refreshes it. Long-running services can also pull the live lists themselves:

```ts
import { bundledRanges, createVerifier, fetchRanges } from 'crawlerid';

let ranges = bundledRanges;
const verifier = createVerifier({ ranges });

async function refresh() {
  const { snapshot, errors } = await fetchRanges({ previous: ranges }); // failed sources keep old data
  ranges = snapshot;
  verifier.setRanges(snapshot);
  for (const e of errors) console.warn(`crawlerid: ${e.url}: ${e.error}`);
}
await refresh();
setInterval(refresh, 24 * 60 * 60 * 1000).unref();
```

### robots.txt by category

```ts
import { robotsTxt } from 'crawlerid';

robotsTxt({
  categories: { 'ai-training': 'disallow' },
  crawlers: { 'Applebot-Extended': 'allow' }, // per-crawler overrides win
  sitemaps: ['https://example.com/sitemap.xml'],
});
```

```
# Generated by crawlerid 0.1.0 - https://github.com/crawlerid/crawlerid

# ai-training: Google, OpenAI, Anthropic, Mistral AI, Common Crawl, Amazon, Meta
User-agent: Google-Extended
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: MistralAI-Training
User-agent: CCBot
User-agent: Amazonbot
User-agent: meta-externalagent
Disallow: /

Sitemap: https://example.com/sitemap.xml
```

Only blocked crawlers get a group. A crawler named in its own group stops reading your `User-agent: *` rules, so "allow" is expressed by leaving it out. Append the output to your existing robots.txt. Typos in names throw an error instead of being silently ignored.

Remember that robots.txt is a request, not an enforcement mechanism. Several user-triggered agents (`ai-assistant`, `ai-agent`) say they may ignore it. Pair it with `verify()` if you need enforcement.

## CLI

```sh
npx crawlerid logs /var/log/nginx/access.log --live --dns
```

Example output:

```
48211 of 48211 lines parsed; 9120 requests claim to be a known crawler.

crawler             operator   category     requests  verified  FAILED  unverifiable
------------------  ---------  -----------  --------  --------  ------  ------------
Googlebot           Google     search       5310      5310      0       0
GPTBot              OpenAI     ai-training  1874      1702      172     0
Meta-ExternalAgent  Meta       ai-training  1201      0         0       1201
ClaudeBot           Anthropic  ai-training  735       735       0       0

Top IPs that failed verification (likely spoofed User-Agents):
  203.0.113.7                              172 requests
```

| Command | What it does |
| --- | --- |
| `crawlerid identify "<ua>"` | Which crawler does this header claim to be? |
| `crawlerid verify --ua "<ua>" --ip <ip>` | Is it really that crawler? Exits 1 on `failed`. |
| `crawlerid logs <file\|->` | Audit a combined-format access log (Nginx, Apache, Caddy). |
| `crawlerid robots --disallow ai-training` | Print robots.txt groups. |
| `crawlerid list [--category ai-search]` | List known crawlers. |

Add `--live` to download fresh IP lists, `--dns` for reverse DNS checks, and `--json` for machine-readable output.

## API

| Export | Description |
| --- | --- |
| `identify(userAgent)` | The `Crawler` a User-Agent claims to be, or `null`. Whole-token, case-insensitive matching. |
| `createVerifier(options?)` | A `Verifier` with `verify()`, `verifySync()` and `setRanges()`. Caches reverse DNS results (10 000 entries, 6 h) and de-duplicates concurrent lookups. |
| `verify(input, options?)` / `verifySync(input, options?)` | One-off versions of the above. |
| `fetchRanges(options?)` | Downloads the official IP lists via `fetch`. Sources that fail keep their `previous` data. |
| `bundledRanges` | The snapshot shipped with this release. Check `generatedAt` to see its age. |
| `createDohResolver(options?)` | DNS-over-HTTPS resolver for edge runtimes (Cloudflare or Google JSON API). |
| `nodeResolver(options?)` from `crawlerid/node` | `node:dns`-backed resolver with timeouts and a broken-DNS safeguard. |
| `robotsTxt(options)` | robots.txt groups by category or crawler. |
| `crawlers`, `getCrawler(idOrToken)`, `crawlersInCategory(category)` | The registry. |
| `parseLogLine(line)` | `{ ip, userAgent }` from a combined-format log line. |
| `RangeSet`, `parseIp`, `parseCidr`, `extractCidrs` | The dependency-free IPv4/IPv6 utilities used internally. |

Everything is fully typed.

### Not using JavaScript?

The registry and IP snapshot are plain JSON with a [JSON Schema](data/crawlers.schema.json), so any language can use them:

- `https://cdn.jsdelivr.net/npm/crawlerid/data/crawlers.json`
- `https://cdn.jsdelivr.net/npm/crawlerid/data/ip-ranges.json`

## Supported crawlers

<!-- crawlers:start -->

47 crawlers from 12 operators. Each name links to the official source.

| Crawler | Token | Operator | Category | Obeys robots.txt | Verified with |
| --- | --- | --- | --- | --- | --- |
| [Googlebot](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Googlebot` | Google | search | yes | IP list + reverse DNS |
| [Googlebot Image](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Googlebot-Image` | Google | search | yes | IP list + reverse DNS |
| [Googlebot Video](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Googlebot-Video` | Google | search | yes | IP list + reverse DNS |
| [Googlebot News](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Googlebot-News` | Google | search | yes | robots.txt token only |
| [Google StoreBot](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Storebot-Google` | Google | search | yes | IP list + reverse DNS |
| [Google-InspectionTool](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Google-InspectionTool` | Google | search | yes | IP list + reverse DNS |
| [GoogleOther](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `GoogleOther` | Google | other | yes | IP list + reverse DNS |
| [GoogleOther-Image](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `GoogleOther-Image` | Google | other | yes | IP list + reverse DNS |
| [GoogleOther-Video](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `GoogleOther-Video` | Google | other | yes | IP list + reverse DNS |
| [Google-CloudVertexBot](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Google-CloudVertexBot` | Google | other | yes | IP list + reverse DNS |
| [Google-Extended](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | `Google-Extended` | Google | ai-training | yes | robots.txt token only |
| [AdsBot](https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers) | `AdsBot-Google` | Google | ads | yes | IP list + reverse DNS |
| [Mediapartners-Google](https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers) | `Mediapartners-Google` | Google | ads | yes | IP list + reverse DNS |
| [APIs-Google](https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers) | `APIs-Google` | Google | other | yes | IP list + reverse DNS |
| [Google-Safety](https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers) | `Google-Safety` | Google | other | no | IP list + reverse DNS |
| [Feedfetcher](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) | `FeedFetcher-Google` | Google | fetcher | no | IP list + reverse DNS |
| [Google Read Aloud](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) | `Google-Read-Aloud` | Google | fetcher | no | IP list + reverse DNS |
| [Google Site Verifier](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) | `Google-Site-Verification` | Google | fetcher | no | IP list + reverse DNS |
| [Gemini Notebook](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) | `Google-GeminiNotebook` | Google | ai-assistant | no | IP list + reverse DNS |
| [Google-Agent](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) | `Google-Agent` | Google | ai-agent | no | IP list + reverse DNS |
| [Bingbot](https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26) | `bingbot` | Microsoft | search | yes | IP list + reverse DNS |
| [Applebot](https://support.apple.com/en-us/119829) | `Applebot` | Apple | search | yes | IP list + reverse DNS |
| [Applebot-Extended](https://support.apple.com/en-us/119829) | `Applebot-Extended` | Apple | ai-training | yes | robots.txt token only |
| [GPTBot](https://developers.openai.com/api/docs/bots) | `GPTBot` | OpenAI | ai-training | yes | IP list |
| [OAI-SearchBot](https://developers.openai.com/api/docs/bots) | `OAI-SearchBot` | OpenAI | ai-search | yes | IP list |
| [ChatGPT-User](https://developers.openai.com/api/docs/bots) | `ChatGPT-User` | OpenAI | ai-assistant | no | IP list |
| [OAI-AdsBot](https://developers.openai.com/api/docs/bots) | `OAI-AdsBot` | OpenAI | ads | ? | IP list |
| [ClaudeBot](https://support.claude.com/en/articles/8896518-what-is-claude-bot) | `ClaudeBot` | Anthropic | ai-training | yes | IP list |
| [Claude-SearchBot](https://support.claude.com/en/articles/8896518-what-is-claude-bot) | `Claude-SearchBot` | Anthropic | ai-search | yes | IP list |
| [Claude-User](https://support.claude.com/en/articles/8896518-what-is-claude-bot) | `Claude-User` | Anthropic | ai-assistant | yes | IP list |
| [PerplexityBot](https://docs.perplexity.ai/guides/bots) | `PerplexityBot` | Perplexity | ai-search | yes | IP list |
| [Perplexity-User](https://docs.perplexity.ai/guides/bots) | `Perplexity-User` | Perplexity | ai-assistant | no | IP list |
| [MistralAI-User](https://docs.mistral.ai/robots) | `MistralAI-User` | Mistral AI | ai-assistant | ? | IP list |
| [MistralAI-Index](https://docs.mistral.ai/robots) | `MistralAI-Index` | Mistral AI | ai-search | ? | IP list |
| [MistralAI-Training](https://docs.mistral.ai/robots) | `MistralAI-Training` | Mistral AI | ai-training | yes | none published |
| [CCBot](https://commoncrawl.org/ccbot) | `CCBot` | Common Crawl | ai-training | yes | IP list + reverse DNS |
| [Amazonbot](https://developer.amazon.com/amazonbot) | `Amazonbot` | Amazon | ai-training | yes | none published |
| [Amzn-SearchBot](https://developer.amazon.com/amazonbot) | `Amzn-SearchBot` | Amazon | ai-search | yes | none published |
| [Amzn-User](https://developer.amazon.com/amazonbot) | `Amzn-User` | Amazon | ai-assistant | no | none published |
| [Meta-ExternalAgent](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) | `meta-externalagent` | Meta | ai-training | yes | none published |
| [Meta-ExternalFetcher](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) | `meta-externalfetcher` | Meta | ai-assistant | no | none published |
| [Meta-WebIndexer](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) | `meta-webindexer` | Meta | ai-search | yes | none published |
| [Meta-ExternalAds](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) | `meta-externalads` | Meta | ads | yes | none published |
| [FacebookExternalHit](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) | `facebookexternalhit` | Meta | preview | no | none published |
| [DuckDuckBot](https://duckduckgo.com/duckduckgo-help-pages/results/duckduckbot) | `DuckDuckBot` | DuckDuckGo | search | yes | none published |
| [DuckAssistBot](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot) | `DuckAssistBot` | DuckDuckGo | ai-assistant | yes | none published |
| [YandexBot](https://yandex.com/support/webmaster/robot-workings/check-yandex-robots.html) | `YandexBot` | Yandex | search | yes | reverse DNS |

<!-- crawlers:end -->

"none published" means the operator offers no machine-readable list or DNS suffix yet, so requests can only be identified, not verified. Those are good places to contribute (see below).

## How the data stays correct

1. Every registry entry links to the operator's own documentation (`docs`). Third-party bot lists are never used as a source.
2. A [weekly workflow](.github/workflows/refresh-ip-ranges.yml) downloads every official IP list and opens a pull request when a prefix changes. Merged changes go out as patch releases.
3. Releases are blocked if the snapshot is empty, incomplete or older than 45 days. Packages are published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

## Contributing

Crawlers change constantly, and the registry is only as good as its upkeep. Help is very welcome, especially in these areas:

- **New crawlers and corrections**: open an [issue](https://github.com/crawlerid/crawlerid/issues/new/choose) or edit [`data/crawlers.json`](data/crawlers.json).
- **Verification for operators that publish lists only as web pages** (Amazon, DuckDuckGo) or **only via their network registration** (Meta's AS32934).
- **Web Bot Auth** ([HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421)): cryptographic verification for agents that sign their requests.
- **Framework adapters and ports**: Fastify, Hono, Astro, Nuxt, plus Python and Go readers for the JSON data.

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started. It takes about five minutes to set up.

## Related projects

- [isbot](https://github.com/omrilotan/isbot) separates bots from humans using User-Agent heuristics. crawlerid answers a different question: is a self-declared crawler genuine? They work well together.
- [ai.robots.txt](https://github.com/ai-robots-txt/ai.robots.txt) is a community list of AI crawlers for blocking.

## License

[MIT](LICENSE)
