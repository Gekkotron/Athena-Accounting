import { useEffect, useState } from 'react';
import { parseDecimal } from '../../../lib/format';

export function AssignmentInput(props: {
  value: string;
  onCommit: (nextAmount: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.value.replace('.', ','));
  useEffect(() => { setDraft(props.value.replace('.', ',')); }, [props.value]);

  const commit = () => {
    const parsed = parseDecimal(draft);
    if (parsed == null) return;
    const normalized = Number(parsed).toFixed(2);
    if (normalized !== props.value) props.onCommit(normalized);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className="input !py-1 !px-2 text-right w-full"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}
