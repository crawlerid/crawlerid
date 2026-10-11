# Contributing to crawlerid

Thanks for helping! Most contributions are small data updates, and those are just as valuable as code: the registry is only useful if it stays accurate.

## Setup

You need Node.js 22 or newer.

```sh
git clone https://github.com/crawlerid/crawlerid.git
cd crawlerid
npm install
npm test
```

| Script | What it does |
| --- | --- |
| `npm test` | Validates the data, regenerates `src/generated/`, runs the tests |
| `npm run typecheck` | TypeScript checks |
| `npm run build` | Compiles to `dist/` |
| `npm run docs` | Regenerates the crawler table in `README.md` from the registry |
| `npm run data:update` | Downloads every official IP list into `data/ip-ranges.json` (needs network access) |
| `node dist/cli.js …` | Runs your local build of the CLI |

## Adding a crawler

1. **Find the operator's own documentation** for the crawler. This is the only acceptable source, because third-party lists are often wrong or out of date. If the operator documents nothing, open an issue instead so it can be discussed.
2. **Add an entry to [`data/crawlers.json`](data/crawlers.json).** Your editor will autocomplete fields from the JSON Schema.

   ```json
   {
     "id": "examplebot",
     "name": "ExampleBot",
     "operator": "Example Inc.",
     "category": "ai-search",
     "userAgents": ["ExampleBot"],
     "robotsTokens": ["ExampleBot"],
     "respectsRobotsTxt": true,
     "docs": "https://example.com/docs/examplebot",
     "verification": {
       "ipRanges": ["https://example.com/examplebot.json"],
       "reverseDns": []
     }
   }
   ```

3. Run `npm test` (validation explains anything it rejects) and `npm run docs`.
4. Open a pull request.

### Field guide

- **`id`**: lowercase kebab-case, usually the token lowercased. Never rename an existing id, because users depend on it.
- **`userAgents`**: the token exactly as it appears in the `User-Agent` header (`ClaudeBot` in `…compatible; ClaudeBot/1.0…`). Tokens are matched case-insensitively as whole tokens, so `Googlebot` does not match `Googlebot-Image`. Leave it empty for robots.txt-only control tokens such as `Google-Extended`.
- **`robotsTokens`**: the name(s) to use in robots.txt `User-agent:` lines, as documented. Leave it empty if the operator says the crawler ignores robots.txt.
- **`category`**: what the crawler is *for*:
  - `search`: classic search indexing
  - `ai-training`: collecting training data
  - `ai-search`: indexing for an AI search or answer product
  - `ai-assistant`: live fetches when a user asks an assistant
  - `ai-agent`: agentic browsing on a user's behalf
  - `ads`, `preview`, `fetcher`, `other`

  If one crawler does several of these, pick the most restrictive one the operator states (training beats search).
- **`respectsRobotsTxt`**: `true` or `false` only when the operator says so; otherwise `null`.
- **`verification.ipRanges`**: official, **machine-readable** IP list URLs only. HTML pages aren't supported yet, so mention them in `notes`.
- **`verification.reverseDns`**: documented hostname suffixes, lowercase, without a leading dot (`googlebot.com`).
- **`notes`**: short and factual. Use it for caveats a user needs.

## Code changes

- Keep the core (`src/`, except `node.ts` and `cli.ts`) free of Node built-ins, so it keeps running on edge runtimes.
- No runtime dependencies. Dev dependencies are fine.
- Add tests next to what you change. Security-relevant logic (anything that can turn a spoofed request into `verified`) needs a test for the negative case.
- Add a line to `CHANGELOG.md` under **Unreleased** for anything a user would notice.

## Good first issues

Issues labelled [`good first issue`](https://github.com/crawlerid/crawlerid/labels/good%20first%20issue) are scoped to an afternoon and come with pointers. Comment on one to claim it.

## Releases (maintainers)

1. Move the **Unreleased** changelog entries under a new version heading.
2. Run `npm version <patch|minor|major>`, then `git push --follow-tags`.
3. The release workflow tests the code, checks that the IP snapshot is fresh, publishes to npm with provenance, and creates the GitHub release.

Data-only changes, including the weekly IP range pull requests, ship as patch releases.

## Becoming a maintainer

Anyone who has landed a few good pull requests and keeps showing up in reviews will be invited to join as a maintainer. Reviewing pull requests and triaging issues counts as much as writing code. Organisations that depend on crawlerid are especially welcome to put forward a maintainer.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
