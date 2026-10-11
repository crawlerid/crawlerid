/**
 * Dependency-free IPv4/IPv6 parsing and CIDR matching. Addresses are handled
 * as bigints so both families share one code path.
 */

export interface ParsedIp {
  readonly version: 4 | 6;
  readonly value: bigint;
}

const V4_PART = /^(?:0|[1-9]\d{0,2})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

function parseV4(input: string): bigint | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!V4_PART.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseV6(input: string): bigint | null {
  let text = input;
  // An embedded IPv4 tail (e.g. ::ffff:192.0.2.1) is rewritten as two hex groups.
  const lastColon = text.lastIndexOf(':');
  if (lastColon !== -1 && text.includes('.', lastColon)) {
    const v4 = parseV4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 ? groups < 1 : head.length !== 8) return null;

  const all = [...head, ...Array<string>(groups).fill('0'), ...tail];
  let value = 0n;
  for (const group of all) {
    if (!HEX_GROUP.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

const V4_MAPPED_PREFIX = 0xffffn << 32n;

/**
 * Parses an IPv4 or IPv6 address. Accepts bracketed IPv6 (`[::1]`) and zone
 * ids (`fe80::1%eth0`). IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`, as
 * reported by Node's `req.socket.remoteAddress`) are normalised to IPv4.
 * Returns `null` for anything that is not a valid address.
 */
export function parseIp(input: string): ParsedIp | null {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (text === '') return null;

  if (!text.includes(':')) {
    const v4 = parseV4(text);
    return v4 === null ? null : { version: 4, value: v4 };
  }
  const v6 = parseV6(text);
  if (v6 === null) return null;
  if (v6 >> 32n === V4_MAPPED_PREFIX >> 32n) {
    return { version: 4, value: v6 & 0xffffffffn };
  }
  return { version: 6, value: v6 };
}

export interface CidrRange {
  readonly version: 4 | 6;
  readonly start: bigint;
  readonly end: bigint;
}

/**
 * Parses `"192.0.2.0/24"`, `"2001:db8::/32"` or a bare address (treated as a
 * single-host range). Host bits below the prefix are ignored. Returns `null`
 * when the input is invalid.
 */
export function parseCidr(input: string): CidrRange | null {
  if (typeof input !== 'string') return null;
  const [address, prefixText, extra] = input.trim().split('/');
  if (extra !== undefined || address === undefined) return null;
  // A prefix written in IPv6 notation stays IPv6, even for IPv4-mapped space.
  const ip = address.includes(':') ? v6Only(address) : parseIp(address);
  if (!ip) return null;
  const bits = ip.version === 4 ? 32 : 128;
  let prefix = bits;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > bits) return null;
  }
  const hostBits = BigInt(bits - prefix);
  const mask = (1n << hostBits) - 1n;
  const start = ip.value & ~mask;
  return { version: ip.version, start, end: start | mask };
}

function v6Only(address: string): ParsedIp | null {
  const ip = parseIp(address);
  if (!ip) return null;
  if (ip.version === 6) return ip;
  // parseIp normalised an IPv4-mapped address; restore the IPv6 value.
  return { version: 6, value: V4_MAPPED_PREFIX | ip.value };
}

/** Formats a parsed address back to a canonical string (IPv6 is not compressed). */
export function formatIp(ip: ParsedIp): string {
  if (ip.version === 4) {
    return [24n, 16n, 8n, 0n].map((s) => ((ip.value >> s) & 0xffn).toString()).join('.');
  }
  const groups: string[] = [];
  for (let s = 112n; s >= 0n; s -= 16n) groups.push(((ip.value >> s) & 0xffffn).toString(16));
  return groups.join(':');
}

/** Returns true when two address strings denote the same IP. */
export function sameIp(a: string, b: string): boolean {
  const x = parseIp(a);
  const y = parseIp(b);
  return x !== null && y !== null && x.version === y.version && x.value === y.value;
}

/**
 * An immutable set of CIDR ranges with O(log n) membership checks.
 * Overlapping and adjacent ranges are merged on construction.
 */
export class RangeSet {
  readonly #v4: bigint[][];
  readonly #v6: bigint[][];
  readonly size: number;

  constructor(cidrs: Iterable<string>) {
    const v4: CidrRange[] = [];
    const v6: CidrRange[] = [];
    let size = 0;
    for (const cidr of cidrs) {
      const range = parseCidr(cidr);
      if (!range) continue;
      (range.version === 4 ? v4 : v6).push(range);
      size++;
    }
    this.#v4 = merge(v4);
    this.#v6 = merge(v6);
    this.size = size;
  }

  /** Whether the address (string or parsed) falls inside any range. */
  has(ip: string | ParsedIp): boolean {
    const parsed = typeof ip === 'string' ? parseIp(ip) : ip;
    if (!parsed) return false;
    const ranges = parsed.version === 4 ? this.#v4 : this.#v6;
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [start, end] = ranges[mid] as [bigint, bigint];
      if (parsed.value < start) hi = mid - 1;
      else if (parsed.value > end) lo = mid + 1;
      else return true;
    }
    return false;
  }
}

function merge(ranges: CidrRange[]): bigint[][] {
  ranges.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: bigint[][] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start <= (last[1] as bigint) + 1n) {
      if (r.end > (last[1] as bigint)) last[1] = r.end;
    } else {
      out.push([r.start, r.end]);
    }
  }
  return out;
}

const CIDR_TOKEN = /^[0-9a-f:.]+(?:\/\d{1,3})?$/i;

/**
 * Collects every CIDR prefix or IP address found anywhere in a parsed JSON
 * document. Operators use slightly different shapes (`prefixes[].ipv4Prefix`,
 * plain arrays, nested objects), so this walks the whole tree instead of
 * assuming one schema. Results are de-duplicated and sorted.
 */
export function extractCidrs(json: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      const text = node.trim();
      if ((text.includes('.') || text.includes(':')) && CIDR_TOKEN.test(text) && parseCidr(text)) {
        found.add(text);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) visit(item);
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) visit(value);
    }
  };
  visit(json);
  return [...found].sort();
}
