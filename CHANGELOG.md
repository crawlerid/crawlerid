# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.0

First release.

- `identify()`: recognises 47 crawlers and AI agents from 12 operators, each sourced from official documentation.
- `verify()`, `verifySync()` and `createVerifier()`: verification against official IP lists, plus forward-confirmed reverse DNS with caching and de-duplication of concurrent lookups.
- `fetchRanges()`: live download of every official IP list; `bundledRanges` provides the snapshot shipped with each release.
- `createDohResolver()` for edge runtimes and `nodeResolver()` (from `crawlerid/node`), with a safeguard against environments where DNS is broken.
- `robotsTxt()`: robots.txt groups by category or crawler.
- CLI: `identify`, `verify`, `logs`, `robots`, `list`.
