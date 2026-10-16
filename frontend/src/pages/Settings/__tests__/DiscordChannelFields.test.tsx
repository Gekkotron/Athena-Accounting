import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscordChannelFields } from '../DiscordChannelFields';
import { DEFAULTS, type NotificationPrefs } from '../../../lib/settings';
import { pinLocale } from '../../../test/i18n';

pinLocale('settings');

const VALID = 'https://discord.com/api/webhooks/123456/abc-DEF_9';

function prefs(enabled: boolean): NotificationPrefs {
  const n = DEFAULTS.notifications;
  return {
    ...n,
    channels: { ...n.channels, discord: { enabled, webhookUrl: '', maxPerMinute: 0 } },
  };
}

describe('DiscordChannelFields', () => {
  it('toggling the checkbox patches enabled', async () => {
    const onPatch = vi.fn();
    render(<DiscordChannelFields prefs={prefs(false)} onPatch={onPatch} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onPatch).toHaveBeenCalledWith({ channels: { discord: { enabled: true } } });
  });

  it('saves a valid URL with maxPerMinute', async () => {
    const onPatch = vi.fn();
    render(<DiscordChannelFields prefs={prefs(true)} onPatch={onPatch} />);
    const save = screen.getByRole('button', { name: /enregistrer/i });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/discord\.com\/api\/webhooks/), VALID);
    await userEvent.clear(screen.getByPlaceholderText('0'));
    await userEvent.type(screen.getByPlaceholderText('0'), '4');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onPatch).toHaveBeenCalledWith({
      channels: { discord: { webhookUrl: VALID, maxPerMinute: 4 } },
    });
  });

  it('shows an error and disables Save for an invalid URL', async () => {
    const onPatch = vi.fn();
    render(<DiscordChannelFields prefs={prefs(true)} onPatch={onPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/discord\.com\/api\/webhooks/), 'https://example.com/hook');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled();
  });
});
