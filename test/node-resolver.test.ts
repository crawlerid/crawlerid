import { beforeEach, describe, expect, it, vi } from 'vitest';

const notFound = (): Error => Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' });
const state = { canaryWorks: true };

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    setServers(): void {}
    async reverse(): Promise<string[]> {
      throw notFound();
    }
    async resolve4(host: string): Promise<string[]> {
      if (host === 'example.com' && state.canaryWorks) return ['93.184.215.14'];
      throw notFound();
    }
    async resolve6(): Promise<string[]> {
      throw notFound();
    }
  },
}));

const { nodeResolver } = await import('../src/node.js');

describe('nodeResolver', () => {
  beforeEach(() => {
    state.canaryWorks = true;
  });

  it('turns "not found" into an empty answer when DNS works', async () => {
    const dns = nodeResolver();
    expect(await dns.reverse('192.0.2.1')).toEqual([]);
    expect(await dns.lookup('nothing.example')).toEqual([]);
  });

  it('refuses to report "not found" when DNS itself is broken', async () => {
    state.canaryWorks = false;
    const dns = nodeResolver();
    await expect(dns.reverse('192.0.2.1')).rejects.toThrow(/DNS is not resolving/);
  });

  it('can skip the canary check', async () => {
    state.canaryWorks = false;
    expect(await nodeResolver({ canary: false }).reverse('192.0.2.1')).toEqual([]);
  });
});
