---
title: Bank sync
sidebar_position: 4
---

# Bank sync (Enable Banking)

Bank sync pulls transactions straight from your bank so you don't have
to download statements. It is **optional** — [file import](./importing.md)
(OFX/CSV/PDF) remains the baseline that always works — and it is built so
that **you** own every credential involved: Athena ships no API key and
runs no cloud service.

## How it works

Under European PSD2 rules, banks only expose their account APIs to
licensed providers. Athena therefore connects through
[Enable Banking](https://enablebanking.com), a licensed European AISP
whose free *restricted production* mode lets you access **your own bank
accounts** with your own application credentials. Enable Banking is a
pass-through: it does not retain your banking data — transactions
transit their API and land in your Athena database, on your machine.
Athena's LAN-only, no-cloud stance is unchanged.

Access is strictly **read-only** (account information only, no payment
initiation), and the consent you grant your bank expires after 90–180
days — reconnecting takes one mobile confirmation.

## Set up

1. Create a free account at [enablebanking.com](https://enablebanking.com).
2. In their Control Panel, **link your own bank accounts** (this is what
   the restricted mode allows — accounts you have not linked are never
   returned by the API).
3. Create an **application**. When asked for a redirect URL, use your
   Athena address followed by `/bank-sync/callback` — the exact value is
   shown in *Réglages → Synchronisation bancaire*. Download the RS256
   private key the Control Panel generates for the application.
4. In Athena, open *Réglages → Synchronisation bancaire* and paste the
   **application ID** and the **private key** (the full PEM file,
   including the `BEGIN`/`END` lines). Athena validates the pair against
   Enable Banking before saving; the key is encrypted at rest and never
   shown, returned, or logged again.

Never commit the private key to a repository or share it — anyone
holding it can read the accounts you linked.

## Connect a bank

Pick your bank in the list and click **Connecter**. You are redirected
to your bank's own consent page, confirm there (for most French banks
this is one mobile-app validation — CIC/Crédit Mutuel's *Confirmation
Mobile*, for example), and land back in Athena. Then map each bank
account to an Athena account — accounts marked *Ignorer* are not
synced. You can change the mapping at any time from Réglages.

## Syncing

Once connected, Athena syncs automatically **once a night** (disable
with `BANK_SYNC_AUTO=0`, see the
[configuration reference](../reference/configuration.md)), and every
connection card has a **Synchroniser** button for an immediate pull.

Synced transactions go through the exact same pipeline as file imports:
deduplication (so a sync overlapping a statement you already imported
creates no doubles), categorization rules, transfer detection, and
recurring-series detection. Each sync batch appears in *Données →
Imports* as a `bank-sync` entry.

## Consent lifecycle

PSD2 consents expire after 90–180 days depending on the bank. Each
connection card shows where you stand:

- **« Connecté jusqu'au \<date\> »** — all good, syncs run unattended.
- **« Reconnexion requise avant le \<date\> »** — the consent ends within two
  weeks; click **Reconnecter** when convenient.
- **Reconnexion requise** — the consent has expired or the bank revoked
  it; syncing is paused for this connection until you reconnect (one
  mobile confirmation, same flow as the first connection).

## Privacy

- Your transactions transit Enable Banking's API but are not stored
  there; they live only in your Athena database.
- Your application private key is encrypted at rest with a key derived
  from your server's `SESSION_SECRET`; no endpoint ever returns it.
- Revoking access is always possible: disconnect in Athena, revoke the
  consent at your bank, or delete the application at enablebanking.com.

## An honest caveat

Enable Banking's restricted production mode is a free evaluation tier,
not a contractual product — its terms could change someday (a
predecessor service, GoCardless Bank Account Data, closed its free tier
in 2025). That is exactly why file import stays Athena's first-class
path and bank sync is an optional layer on top.

## Troubleshooting

- **"Enable Banking a refusé ces identifiants" when saving** — the
  application ID and private key don't match, the key file is truncated,
  or the application was deactivated. Re-download the key from the
  Control Panel and paste the whole PEM.
- **"Clé privée invalide"** — the pasted text isn't a PEM private key.
  Paste the full file including `-----BEGIN PRIVATE KEY-----`.
- **The bank isn't in the list** — the list shows French banks by
  default; check the bank exists in Enable Banking's
  [coverage](https://enablebanking.com/coverage/).
- **The redirect never reaches Athena** (the whitelisted URL doesn't
  match the address you browse Athena at, or the Control Panel refused
  your LAN URL) — the authorization code is still in the final page's
  address bar. Copy that full URL and paste it into *Réglages →
  Synchronisation bancaire → "Finaliser manuellement"*; Athena extracts
  the code and creates the connection. Remember the redirect URL only
  needs to be reachable by **your browser**, never by Enable Banking —
  a LAN address like `http://192.168.1.20:8080/bank-sync/callback` is
  the normal case.
- **The callback page shows an error** — the authorization code is
  single-use and short-lived; restart the connection from Réglages.
- **A connection is stuck on "Reconnexion requise"** — that is the
  expected state after consent expiry; click **Reconnecter** and approve
  on your phone.

## See also

- [Importing](./importing.md) — file-based imports, deduplication, the
  PDF wizard.
- [Configuration reference](../reference/configuration.md) —
  `BANK_SYNC_AUTO` and every other environment variable.
- [Security and privacy](./security-and-privacy.md) — Athena's overall
  security model.
