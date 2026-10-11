import { describe, expect, it } from 'vitest';
import { crawlers, crawlersInCategory, getCrawler, identify } from '../src/registry.js';

// Real User-Agent strings, as published by the operators.
const SAMPLES: [string, string][] = [
  ['gptbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)'],
  ['oai-searchbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot'],
  ['chatgpt-user', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'],
  ['claudebot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  ['claude-user', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)'],
  ['claude-searchbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)'],
  ['perplexitybot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
  ['perplexity-user', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)'],
  ['mistralai-user', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)'],
  [
    'googlebot',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ],
  ['googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['googlebot-image', 'Googlebot-Image/1.0'],
  ['googlebot-video', 'Googlebot-Video/1.0'],
  ['storebot-google', 'Mozilla/5.0 (X11; Linux x86_64; Storebot-Google/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36'],
  ['googleother', 'GoogleOther'],
  ['googleother-image', 'GoogleOther-Image/1.0'],
  [
    'adsbot-google',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)',
  ],
  ['adsbot-google', 'AdsBot-Google (+http://www.google.com/adsbot.html)'],
  ['mediapartners-google', 'Mediapartners-Google'],
  ['apis-google', 'APIs-Google (+https://developers.google.com/webmasters/APIs-Google.html)'],
  [
    'google-agent',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)',
  ],
  ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  [
    'applebot',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  ],
  ['ccbot', 'CCBot/2.0 (https://commoncrawl.org/faq/)'],
  [
    'amazonbot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
  ],
  ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['meta-externalagent', 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
  ['duckduckbot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
  ['duckassistbot', 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)'],
  ['yandexbot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
];

const NOT_CRAWLERS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  'curl/8.9.1',
  'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
  'MyGoogleBotClone/1.0',
  'NotGPTBot/1.0',
  'googlebotx',
  'Google-Extended', // robots.txt-only token, never a real User-Agent
  '',
];

describe('identify', () => {
  it.each(SAMPLES)('recognises %s', (id, ua) => {
    expect(identify(ua)?.id).toBe(id);
  });

  it.each(NOT_CRAWLERS)('does not flag %j', (ua) => {
    expect(identify(ua)).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(identify('mozilla/5.0 (compatible; GOOGLEBOT/2.1)')?.id).toBe('googlebot');
  });

  it('tolerates missing input', () => {
    expect(identify(undefined)).toBeNull();
    expect(identify(null)).toBeNull();
  });

  it('recognises every registered User-Agent token', () => {
    for (const crawler of crawlers) {
      for (const token of crawler.userAgents) {
        expect(identify(`Mozilla/5.0 (compatible; ${token}/1.0)`)?.id, token).toBe(crawler.id);
      }
    }
  });
});

describe('getCrawler', () => {
  it('finds crawlers by id, User-Agent token or robots token', () => {
    expect(getCrawler('gptbot')?.name).toBe('GPTBot');
    expect(getCrawler('GPTBot')?.id).toBe('gptbot');
    expect(getCrawler('google-extended')?.id).toBe('google-extended');
    expect(getCrawler('Google-Extended')?.category).toBe('ai-training');
    expect(getCrawler('AdsBot-Google-Mobile')?.id).toBe('adsbot-google');
    expect(getCrawler('nope')).toBeUndefined();
  });

  it('groups crawlers by category', () => {
    const ids = crawlersInCategory('ai-training').map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['gptbot', 'claudebot', 'ccbot', 'google-extended', 'applebot-extended']));
    expect(ids).not.toContain('googlebot');
  });
});
