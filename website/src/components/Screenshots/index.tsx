import { useState } from 'react';
import Heading from '@theme/Heading';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

type Shot = {
  key: string;
  label: string;
  caption: string;
  // The SVG placeholder that ships in the repo. When a real PNG lands in
  // static/img/screenshots/, drop the .svg extension in that folder and
  // change this entry to `.png` — Docusaurus copies both extensions.
  file: string;
};

const SHOTS: Shot[] = [
  { key: 'dashboard',    label: 'Dashboard',    caption: 'Balance chart, category donut, and a monthly Sankey — all local.', file: 'dashboard.svg' },
  { key: 'transactions', label: 'Transactions', caption: 'Bulk-editable ledger with rule-driven auto-categorisation.',       file: 'transactions.svg' },
  { key: 'envelopes',    label: 'Envelopes',    caption: 'YNAB-style budgeting with per-goal fill and pool auto-assign.',     file: 'envelopes.svg' },
  { key: 'insights',     label: 'Insights',     caption: 'Anomaly detection surfaces where spending is drifting.',           file: 'insights.svg' },
];

export default function Screenshots(): React.JSX.Element {
  const [active, setActive] = useState<Shot>(SHOTS[0]!);
  const src = useBaseUrl(`/img/screenshots/${active.file}`);
  return (
    <section className={styles.section}>
      <div className="container">
        <Heading as="h2" className={styles.heading}>See it in action</Heading>
        <div className={styles.tabs} role="tablist">
          {SHOTS.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={active.key === s.key}
              className={active.key === s.key ? styles.tabActive : styles.tab}
              onClick={() => setActive(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <figure className={styles.figure}>
          <img src={src} alt={`${active.label} screenshot`} className={styles.shot} />
          <figcaption className={styles.caption}>{active.caption}</figcaption>
        </figure>
      </div>
    </section>
  );
}
