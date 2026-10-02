import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCallMeBotRateLimitForTests,
  __setCallMeBotFetchForTests,
  sendCallMeBot,
} from '../callmebot.js';

const okResponse = () => new Response('OK', { status: 200 });

beforeEach(() => {
  __resetCallMeBotRateLimitForTests();
});

afterEach(() => {
  __setCallMeBotFetchForTests(((..._args) => Promise.resolve(okResponse())) as typeof fetch);
});

describe('sendCallMeBot', () => {
  it('posts title + body to the CallMeBot endpoint with url-encoded fields', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setCallMeBotFetchForTests(fetchSpy as unknown as typeof fetch);

    await sendCallMeBot(
      { enabled: true, phone: '+33 612 34 56 78', apiKey: 'abc 123', maxPerMinute: 0 },
      'Big transaction',
      'EUR 249.99 at Amazon',
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.callmebot.com/whatsapp.php'
        + '?phone=%2B33%20612%2034%2056%2078'
        + '&text=Big%20transaction%0AEUR%20249.99%20at%20Amazon'
        + '&apikey=abc%20123',
    );
  });

  it('skips the fetch when the channel is disabled or unconfigured', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setCallMeBotFetchForTests(fetchSpy as unknown as typeof fetch);

    await sendCallMeBot({ enabled: false, phone: '+33612345678', apiKey: 'k', maxPerMinute: 0 }, 't', 'b');
    await sendCallMeBot({ enabled: true, phone: '', apiKey: 'k', maxPerMinute: 0 }, 't', 'b');
    await sendCallMeBot({ enabled: true, phone: '+33612345678', apiKey: '', maxPerMinute: 0 }, 't', 'b');
    await sendCallMeBot({ enabled: true, phone: '   ', apiKey: 'k', maxPerMinute: 0 }, 't', 'b');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('swallows fetch errors and logs them when a logger is provided', async () => {
    __setCallMeBotFetchForTests((() => Promise.reject(new Error('boom'))) as unknown as typeof fetch);
    const warn = vi.fn();

    await expect(
      sendCallMeBot({ enabled: true, phone: '+33612', apiKey: 'k', maxPerMinute: 0 }, 't', 'b', { warn }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ err: 'Error: boom' }, 'callmebot_send_errored');
  });

  it('logs a warning (but does not throw) when the response is non-2xx', async () => {
    __setCallMeBotFetchForTests((() => Promise.resolve(new Response('nope', { status: 403 }))) as unknown as typeof fetch);
    const warn = vi.fn();

    await sendCallMeBot({ enabled: true, phone: '+33612', apiKey: 'k', maxPerMinute: 0 }, 't', 'b', { warn });
    expect(warn).toHaveBeenCalledWith({ status: 403 }, 'callmebot_send_failed');
  });

  it('rate-limits sends past maxPerMinute inside the 1-minute window', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setCallMeBotFetchForTests(fetchSpy as unknown as typeof fetch);
    const warn = vi.fn();
    const prefs = { enabled: true, phone: '+33612', apiKey: 'k', maxPerMinute: 2 };

    await sendCallMeBot(prefs, 't1', 'b1');
    await sendCallMeBot(prefs, 't2', 'b2');
    await sendCallMeBot(prefs, 't3', 'b3', { warn });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith({ maxPerMinute: 2 }, 'callmebot_rate_limited');
  });

  it('does not record a failed send against the rate-limit window', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());
    __setCallMeBotFetchForTests(fetchSpy as unknown as typeof fetch);
    const prefs = { enabled: true, phone: '+33612', apiKey: 'k', maxPerMinute: 2 };

    await sendCallMeBot(prefs, 't1', 'b1');
    await sendCallMeBot(prefs, 't2', 'b2');
    await sendCallMeBot(prefs, 't3', 'b3');

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('skipRateLimit bypasses the window gate', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    __setCallMeBotFetchForTests(fetchSpy as unknown as typeof fetch);
    const prefs = { enabled: true, phone: '+33612', apiKey: 'k', maxPerMinute: 1 };

    await sendCallMeBot(prefs, 't1', 'b1');
    await sendCallMeBot(prefs, 't2', 'b2', undefined, { skipRateLimit: true });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
