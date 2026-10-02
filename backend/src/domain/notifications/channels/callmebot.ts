// CallMeBot WhatsApp relay — fire-and-forget side-channel for notifications.
//
// Activation (user does this once, outside Athena):
//   1. Add the number +34 644 51 95 23 to their phone contacts.
//   2. Send "I allow callmebot to send me messages" from WhatsApp to that number.
//   3. CallMeBot replies with a 7-10 digit apikey — paste it in Réglages.
//
// At emit time we POST (phone, text, apikey) to the public endpoint. Errors
// are logged and swallowed: a failed WhatsApp send must never break the main
// SSE/toast fan-out or the DB insert that already succeeded upstream.

export type CallMeBotPrefs = {
  enabled: boolean;
  phone: string;
  apiKey: string;
  maxPerMinute: number;
};

const ENDPOINT = 'https://api.callmebot.com/whatsapp.php';
const WINDOW_MS = 60_000;

type FetchLike = typeof globalThis.fetch;
let fetchImpl: FetchLike = (...args) => globalThis.fetch(...args);

// Test seam — fake-fetch pattern mirrors services/enable-banking/client.ts
// so unit tests never hit the real CallMeBot endpoint. Returns the previous
// impl so tests can restore it.
export function __setCallMeBotFetchForTests(impl: FetchLike): FetchLike {
  const prev = fetchImpl;
  fetchImpl = impl;
  return prev;
}

// Per-phone successful-send timestamps inside the current rolling window.
// In-memory only — a restart resets the window, which is acceptable
// (restarts are rare and a few extra WhatsApp messages after one are
// harmless). Keyed by phone so two users with different numbers are
// rate-limited independently.
const sendTimestampsByPhone = new Map<string, number[]>();

export function __resetCallMeBotRateLimitForTests(): void {
  sendTimestampsByPhone.clear();
}

function isConfigured(p: CallMeBotPrefs): boolean {
  return p.enabled && p.phone.trim().length > 0 && p.apiKey.trim().length > 0;
}

export async function sendCallMeBot(
  prefs: CallMeBotPrefs,
  title: string,
  body: string,
  log?: { warn: (o: unknown, msg?: string) => void },
  opts: { skipRateLimit?: boolean } = {},
): Promise<void> {
  if (!isConfigured(prefs)) return;
  const phone = prefs.phone.trim();
  if (!opts.skipRateLimit && prefs.maxPerMinute > 0) {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const kept = (sendTimestampsByPhone.get(phone) ?? []).filter((t) => t > cutoff);
    sendTimestampsByPhone.set(phone, kept);
    if (kept.length >= prefs.maxPerMinute) {
      log?.warn({ maxPerMinute: prefs.maxPerMinute }, 'callmebot_rate_limited');
      return;
    }
  }
  const text = [title, body].filter(Boolean).join('\n');
  const url = `${ENDPOINT}?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(prefs.apiKey.trim())}`;
  try {
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res.ok) {
      log?.warn({ status: res.status }, 'callmebot_send_failed');
      return;
    }
    const bucket = sendTimestampsByPhone.get(phone) ?? [];
    bucket.push(Date.now());
    sendTimestampsByPhone.set(phone, bucket);
  } catch (err) {
    log?.warn({ err: String(err) }, 'callmebot_send_errored');
  }
}
