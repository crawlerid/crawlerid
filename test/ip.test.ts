import { describe, expect, it } from 'vitest';
import { RangeSet, extractCidrs, parseCidr, parseIp } from '../src/ip.js';
import { formatIp, sameIp } from '../src/ip.js';

describe('parseIp', () => {
  it('parses IPv4', () => {
    expect(parseIp('66.249.66.1')).toEqual({ version: 4, value: 0x42f94201n });
    expect(parseIp('0.0.0.0')?.value).toBe(0n);
    expect(parseIp('255.255.255.255')?.value).toBe(0xffffffffn);
  });

  it('rejects malformed IPv4', () => {
    for (const bad of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.-4', '1..3.4', '', ' ', 'abc']) {
      expect(parseIp(bad), bad).toBeNull();
    }
  });

  it('parses IPv6 in all common notations', () => {
    expect(parseIp('::')?.value).toBe(0n);
    expect(parseIp('::1')?.value).toBe(1n);
    expect(parseIp('2001:db8::1')?.value).toBe(0x20010db8000000000000000000000001n);
    expect(parseIp('2001:0db8:0000:0000:0000:0000:0000:0001')?.value).toBe(0x20010db8000000000000000000000001n);
    expect(parseIp('[2001:db8::1]')?.version).toBe(6);
    expect(parseIp('fe80::1%eth0')?.version).toBe(6);
    expect(parseIp('2001:db8::')?.value).toBe(0x20010db8n << 96n);
  });

  it('normalises IPv4-mapped IPv6 to IPv4', () => {
    expect(parseIp('::ffff:66.249.66.1')).toEqual(parseIp('66.249.66.1'));
    expect(parseIp('::FFFF:42f9:4201')).toEqual(parseIp('66.249.66.1'));
  });

  it('rejects malformed IPv6', () => {
    for (const bad of ['1::2::3', '2001:db8:::1', '12345::', 'g::1', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '::ffff:1.2.3']) {
      expect(parseIp(bad), bad).toBeNull();
    }
  });

  it('formats and compares addresses', () => {
    expect(formatIp(parseIp('::ffff:1.2.3.4')!)).toBe('1.2.3.4');
    expect(formatIp(parseIp('2001:db8::1')!)).toBe('2001:db8:0:0:0:0:0:1');
    expect(sameIp('2001:db8::1', '2001:DB8:0::1')).toBe(true);
    expect(sameIp('1.2.3.4', '::ffff:1.2.3.4')).toBe(true);
    expect(sameIp('1.2.3.4', '1.2.3.5')).toBe(false);
    expect(sameIp('1.2.3.4', 'nope')).toBe(false);
  });
});

describe('parseCidr', () => {
  it('parses prefixes and bare addresses', () => {
    expect(parseCidr('192.0.2.0/24')).toEqual({ version: 4, start: 0xc0000200n, end: 0xc00002ffn });
    expect(parseCidr('192.0.2.7')).toEqual({ version: 4, start: 0xc0000207n, end: 0xc0000207n });
    expect(parseCidr('0.0.0.0/0')).toEqual({ version: 4, start: 0n, end: 0xffffffffn });
    expect(parseCidr('2001:db8::/32')?.end).toBe((0x20010db8n << 96n) | ((1n << 96n) - 1n));
  });

  it('ignores host bits below the prefix', () => {
    expect(parseCidr('192.0.2.77/24')).toEqual(parseCidr('192.0.2.0/24'));
  });

  it('keeps IPv6 notation as IPv6', () => {
    expect(parseCidr('::ffff:0:0/96')?.version).toBe(6);
  });

  it('rejects invalid input', () => {
    for (const bad of ['192.0.2.0/33', '2001:db8::/129', '192.0.2.0/', '192.0.2.0/24/1', '10.0.0.0/-1', 'x/8']) {
      expect(parseCidr(bad), bad).toBeNull();
    }
  });
});

describe('RangeSet', () => {
  const set = new RangeSet(['66.249.64.0/27', '66.249.64.32/27', '20.171.206.0/24', '2001:4860:4801:10::/64', 'junk']);

  it('matches addresses inside ranges', () => {
    expect(set.has('66.249.64.0')).toBe(true);
    expect(set.has('66.249.64.63')).toBe(true); // second, adjacent range (merged)
    expect(set.has('20.171.206.255')).toBe(true);
    expect(set.has('2001:4860:4801:10::abcd')).toBe(true);
    expect(set.has('::ffff:20.171.206.9')).toBe(true);
  });

  it('rejects addresses outside ranges and garbage', () => {
    expect(set.has('66.249.64.64')).toBe(false);
    expect(set.has('20.171.207.0')).toBe(false);
    expect(set.has('2001:4860:4801:11::1')).toBe(false);
    expect(set.has('not an ip')).toBe(false);
  });

  it('counts only valid prefixes', () => {
    expect(set.size).toBe(4);
  });

  it('handles an empty set', () => {
    expect(new RangeSet([]).has('1.1.1.1')).toBe(false);
  });
});

describe('extractCidrs', () => {
  it('reads the prefixes[].ipv4Prefix/ipv6Prefix format used by Google, OpenAI and others', () => {
    const json = {
      creationTime: '2026-10-09T14:46:27.000000',
      prefixes: [{ ipv6Prefix: '2001:4860:4801:10::/64' }, { ipv4Prefix: '192.178.4.0/27' }, { ipv4Prefix: '34.162.230.222/32' }],
    };
    expect(extractCidrs(json)).toEqual(['192.178.4.0/27', '2001:4860:4801:10::/64', '34.162.230.222/32']);
  });

  it('reads plain arrays, nested objects and bare IPs, and de-duplicates', () => {
    expect(extractCidrs({ a: ['1.2.3.0/24', '1.2.3.0/24'], b: { c: '5.6.7.8' } })).toEqual(['1.2.3.0/24', '5.6.7.8']);
  });

  it('ignores timestamps, versions and other strings', () => {
    expect(extractCidrs({ creationTime: '2026-08-18T23:56:36Z', v: '1.2', name: 'bot', n: 12 })).toEqual([]);
  });
});
