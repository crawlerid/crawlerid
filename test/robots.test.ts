import { describe, expect, it } from 'vitest';
import { robotsTxt } from '../src/robots.js';

const agents = (text: string): string[] =>
  text.split('\n').filter((l) => l.startsWith('User-agent: ')).map((l) => l.slice('User-agent: '.length));

describe('robotsTxt', () => {
  it('blocks a whole category with its documented tokens', () => {
    const text = robotsTxt({ categories: { 'ai-training': 'disallow' } });
    expect(agents(text)).toEqual(
      expect.arrayContaining(['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent']),
    );
    expect(agents(text)).not.toContain('Googlebot');
    expect(agents(text)).not.toContain('OAI-SearchBot');
    expect(text).toContain('Disallow: /\n');
  });

  it('lets per-crawler overrides win over categories', () => {
    const text = robotsTxt({
      categories: { 'ai-training': 'disallow' },
      crawlers: { 'Applebot-Extended': 'allow', perplexitybot: 'disallow' },
    });
    expect(agents(text)).not.toContain('Applebot-Extended');
    expect(agents(text)).toContain('PerplexityBot');
  });

  it('writes one group per category, so allowed crawlers keep following the * group', () => {
    const text = robotsTxt({ categories: { 'ai-training': 'disallow', 'ai-search': 'disallow' }, comments: false });
    const groups = text.trim().split('\n\n');
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group.split('\n').at(-1)).toBe('Disallow: /');
  });

  it('flags groups that contain user-triggered agents which may ignore robots.txt', () => {
    expect(robotsTxt({ categories: { 'ai-assistant': 'disallow' } })).toContain('may ignore robots.txt');
    expect(robotsTxt({ categories: { 'ai-training': 'disallow' } })).not.toContain('may ignore robots.txt');
  });

  it('supports custom paths, sitemaps and no comments', () => {
    const text = robotsTxt({
      crawlers: { gptbot: 'disallow' },
      paths: ['/private/', '/drafts/'],
      sitemaps: ['https://example.com/sitemap.xml'],
      comments: false,
    });
    expect(text).toBe(
      'User-agent: GPTBot\nDisallow: /private/\nDisallow: /drafts/\n\nSitemap: https://example.com/sitemap.xml\n',
    );
  });

  it('skips crawlers that have no robots.txt token', () => {
    expect(agents(robotsTxt({ crawlers: { 'google-safety': 'disallow' } }))).toEqual([]);
  });

  it('throws on typos instead of silently ignoring them', () => {
    expect(() => robotsTxt({ crawlers: { GTPBot: 'disallow' } })).toThrow(/unknown crawler/);
    expect(() => robotsTxt({ categories: { 'ai-trainin': 'disallow' } as never })).toThrow(/unknown category/);
  });
});
