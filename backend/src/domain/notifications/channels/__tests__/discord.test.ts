import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetDiscordRateLimitForTests,
  __setDiscordFetchForTests,
  sendDiscord,
} from '../discord.js';

const URL_OK = 'https://discord.com/api/webhooks/123/abc-DEF_9';
const okResponse = () => new Response(null, { status: 204 });
const prefs = (over: Partial<{ enabled: boolean; webhookUrl: string; maxPerMinute: number }> = {}) => ({
  enabled: true,
  webhookUrl: URL_OK,
  maxPerMinute: 0,
  ...over,
});

beforeEach(() => {
  __resetDiscordRateLimitForTests();
});

afterEach(() => {
  __setDiscordFetchForTests(((..._args) => Promise.resolve(okResponse())) as typeof fetch);
});

describe('sendDiscord', () => {
  it('POSTs a JSON body with bold title, body and empty allowed_mentions', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setDiscordFetchForTests(fetchSpy as unknown as typeof fetch);

    await sendDiscord(prefs({ webhookUrl: `  ${URL_OK}  ` }), 'Big transaction', 'EUR 249.99 at Amazon');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(URL_OK);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      content: '**Big transaction**\nEUR 249.99 at Amazon',
      allowed_mentions: { parse: [] },
    });
  });

  it('omits the newline when the body is empty', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setDiscordFetchForTests(fetchSpy as unknown as typeof fetch);

    await sendDiscord(prefs(), 'Title only', '');

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse(String(init?.body)).content).toBe('**Title only**');
  });

  it('skips the fetch when the channel is disabled or unconfigured', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setDiscordFetchForTests(fetchSpy as unknown as typeof fetch);

    await sendDiscord(prefs({ enabled: false }), 't', 'b');
    await sendDiscord(prefs({ webhookUrl: '' }), 't', 'b');
    await sendDiscord(prefs({ webhookUrl: '   ' }), 't', 'b');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('swallows fetch errors and logs them when a logger is provided', async () => {
    __setDiscordFetchForTests((() => Promise.reject(new Error('boom'))) as unknown as typeof fetch);
    const warn = vi.fn();

    await expect(sendDiscord(prefs(), 't', 'b', { warn })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ err: 'Error: boom' }, 'discord_send_errored');
  });

  it('logs a warning (but does not throw) when the response is non-2xx', async () => {
    __setDiscordFetchForTests((() => Promise.resolve(new Response('nope', { status: 404 }))) as unknown as typeof fetch);
    const warn = vi.fn();

    await sendDiscord(prefs(), 't', 'b', { warn });
    expect(warn).toHaveBeenCalledWith({ status: 404 }, 'discord_send_failed');
  });

  it('rate-limits sends past maxPerMinute inside the 1-minute window', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setDiscordFetchForTests(fetchSpy as unknown as typeof fetch);
    const warn = vi.fn();
    const p = prefs({ maxPerMinute: 2 });

    await sendDiscord(p, 't1', 'b1');
    await sendDiscord(p, 't2', 'b2');
    await sendDiscord(p, 't3', 'b3', { warn });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith({ maxPerMinute: 2 }, 'discord_rate_limited');
  });

  it('does not record a failed send against the rate-limit window', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());
    __setDiscordFetchForTests(fetchSpy as unknown as typeof fetch);
    const p = prefs({ maxPerMinute: 2 });

    await sendDiscord(p, 't1', 'b1');
    await sendDiscord(p, 't2', 'b2');
    await sendDiscord(p, 't3', 'b3');

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('skipRateLimit bypasses the window gate', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setDiscordFetchForTests(fetchSpy as unknown as typeof fetch);
    const p = prefs({ maxPerMinute: 1 });

    await sendDiscord(p, 't1', 'b1');
    await sendDiscord(p, 't2', 'b2', undefined, { skipRateLimit: true });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('truncates content to the 2000-char Discord limit', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setDiscordFetchForTests(fetchSpy as unknown as typeof fetch);

    await sendDiscord(prefs(), 't', 'x'.repeat(5000));

    const [, init] = fetchSpy.mock.calls[0]!;
    const { content } = JSON.parse(String(init?.body)) as { content: string };
    expect(content).toHaveLength(2000);
    expect(content.endsWith('…')).toBe(true);
  });
});
