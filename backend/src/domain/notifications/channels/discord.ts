// Discord channel-webhook relay — fire-and-forget side-channel for notifications.
//
// Activation (user does this once, outside Athena):
//   1. In Discord: Server settings → Integrations → Webhooks → New Webhook.
//   2. Pick the target channel, then "Copy Webhook URL".
//   3. Paste the URL in Réglages.
//
// The webhook URL is a bearer secret for that channel: anyone holding it can
// post there. At emit time we POST a JSON message to it. Errors are logged
// and swallowed: a failed Discord send must never break the main SSE/toast
// fan-out or the DB insert that already succeeded upstream.

export type DiscordPrefs = {
  enabled: boolean;
  webhookUrl: string;
  maxPerMinute: number;
};

const WINDOW_MS = 60_000;
const MAX_CONTENT = 2000;

type FetchLike = typeof globalThis.fetch;
let fetchImpl: FetchLike = (...args) => globalThis.fetch(...args);

// Test seam — same fake-fetch pattern as callmebot.ts so unit tests never hit
// Discord. Returns the previous impl so tests can restore it.
export function __setDiscordFetchForTests(impl: FetchLike): FetchLike {
  const prev = fetchImpl;
  fetchImpl = impl;
  return prev;
}

// Per-webhook successful-send timestamps inside the current rolling window.
// In-memory only — a restart resets the window, which is acceptable.
// Keyed by webhook URL so distinct channels are rate-limited independently.
const sendTimestampsByUrl = new Map<string, number[]>();

export function __resetDiscordRateLimitForTests(): void {
  sendTimestampsByUrl.clear();
}

function isConfigured(p: DiscordPrefs): boolean {
  return p.enabled && p.webhookUrl.trim().length > 0;
}

export async function sendDiscord(
  prefs: DiscordPrefs,
  title: string,
  body: string,
  log?: { warn: (o: unknown, msg?: string) => void },
  opts: { skipRateLimit?: boolean } = {},
): Promise<void> {
  if (!isConfigured(prefs)) return;
  const url = prefs.webhookUrl.trim();
  if (!opts.skipRateLimit && prefs.maxPerMinute > 0) {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const kept = (sendTimestampsByUrl.get(url) ?? []).filter((t) => t > cutoff);
    sendTimestampsByUrl.set(url, kept);
    if (kept.length >= prefs.maxPerMinute) {
      log?.warn({ maxPerMinute: prefs.maxPerMinute }, 'discord_rate_limited');
      return;
    }
  }
  let content = `**${title}**${body ? `\n${body}` : ''}`;
  if (content.length > MAX_CONTENT) content = `${content.slice(0, MAX_CONTENT - 1)}…`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Empty allowed_mentions.parse: merchant names containing @everyone
      // must not ping the channel.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      log?.warn({ status: res.status }, 'discord_send_failed');
      return;
    }
    const bucket = sendTimestampsByUrl.get(url) ?? [];
    bucket.push(Date.now());
    sendTimestampsByUrl.set(url, bucket);
  } catch (err) {
    log?.warn({ err: String(err) }, 'discord_send_errored');
  }
}
