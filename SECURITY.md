# Security policy

crawlerid is often used to make allow/deny decisions, so correctness bugs can be security bugs.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub Security Advisories](https://github.com/crawlerid/crawlerid/security/advisories/new).

You can expect an acknowledgement within 3 working days and a plan within 10. Fixes are released as soon as they are ready, with credit to you unless you prefer otherwise.

## In scope

- Any way to make a spoofed request come back `verified` (IP parsing, CIDR matching, DNS suffix matching, forward confirmation, caching).
- Any way for a genuine crawler to be reported as `failed` because of an infrastructure problem rather than the operator's data.
- Denial of service through crafted input, such as pathological User-Agent strings, IP strings or log lines.
- Incorrect registry data that weakens verification, such as a too-broad DNS suffix or a non-official IP list.

## Supported versions

Only the latest minor release receives fixes. Update regularly: crawler IP ranges change, and releases carry fresh data.
