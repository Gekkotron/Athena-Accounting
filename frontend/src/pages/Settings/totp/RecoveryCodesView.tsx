import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  codes: string[];
  onDone: () => void;
}

// Renders the 10 recovery codes with copy + download buttons, and a
// checkbox-gated Finish button. Used by both the enrol wizard's step 3 and
// the regenerate modal.
export function RecoveryCodesView({ codes, onDone }: Props) {
  const { t } = useTranslation('settings');
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);

  const copyAll = async () => {
    const text = codes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent — the codes are still visible on screen.
    }
  };

  const download = () => {
    const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'athena-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-400">{t('settings.twoFactor.enroll.step3Description')}</p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm rounded-md bg-ink-900 p-3">
        {codes.map((c) => (
          <li key={c} className="text-ink-100 tracking-wider">{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={() => void copyAll()}>
          {copied
            ? t('settings.twoFactor.enroll.copiedButton')
            : t('settings.twoFactor.enroll.copyButton')}
        </button>
        <button type="button" className="btn-ghost" onClick={download}>
          {t('settings.twoFactor.enroll.downloadButton')}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        {t('settings.twoFactor.enroll.savedCheckboxLabel')}
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={!ack}
          onClick={onDone}
        >
          {t('settings.twoFactor.enroll.finishButton')}
        </button>
      </div>
    </div>
  );
}
