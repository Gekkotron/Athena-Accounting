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

export type CallMeBotPrefs = { enabled: boolean; phone: string; apiKey: string };

const ENDPOINT = 'https://api.callmebot.com/whatsapp.php';

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

function isConfigured(p: CallMeBotPrefs): boolean {
  return p.enabled && p.phone.trim().length > 0 && p.apiKey.trim().length > 0;
}

export async function sendCallMeBot(
  prefs: CallMeBotPrefs,
  title: string,
  body: string,
  log?: { warn: (o: unknown, msg?: string) => void },
): Promise<void> {
  if (!isConfigured(prefs)) return;
  const text = [title, body].filter(Boolean).join('\n');
  const url = `${ENDPOINT}?phone=${encodeURIComponent(prefs.phone.trim())}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(prefs.apiKey.trim())}`;
  try {
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res.ok) {
      log?.warn({ status: res.status }, 'callmebot_send_failed');
    }
  } catch (err) {
    log?.warn({ err: String(err) }, 'callmebot_send_errored');
  }
}
