import clsx from 'clsx';
import Heading from '@theme/Heading';
import Translate from '@docusaurus/Translate';
import styles from './styles.module.css';

type Feature = {
  key: string;
  span: 'wide' | 'narrow';
  monogram: string;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  body: React.ReactNode;
  detail?: React.ReactNode;
};

const features: Feature[] = [
  {
    key: 'imports',
    span: 'wide',
    monogram: 'I',
    eyebrow: <Translate id="feat.imports.eyebrow">Imports</Translate>,
    title: <Translate id="feat.imports.title">Every format your bank still sends</Translate>,
    body: (
      <Translate id="feat.imports.body">
        OFX and QFX drop in silently. CSV maps auto-detect their separator and header row. PDF statements go through an interactive template wizard once — every later statement in that layout imports on its own.
      </Translate>
    ),
    detail: (
      <span className={styles.detailChips}>
        <span>OFX</span>
        <span>QFX</span>
        <span>CSV</span>
        <span>PDF</span>
        <span>Photo · OCR</span>
      </span>
    ),
  },
  {
    key: 'rules',
    span: 'narrow',
    monogram: 'R',
    eyebrow: <Translate id="feat.rules.eyebrow">Rules & Tri</Translate>,
    title: <Translate id="feat.rules.title">Categorise once, forever</Translate>,
    body: (
      <Translate id="feat.rules.body">
        Accent- and case-insensitive matching, a bulk Tri queue for the long tail, and internal-transfer detection that links both legs.
      </Translate>
    ),
  },
  {
    key: 'dashboard',
    span: 'narrow',
    monogram: 'D',
    eyebrow: <Translate id="feat.dashboard.eyebrow">Dashboards</Translate>,
    title: <Translate id="feat.dashboard.title">Charts that actually read</Translate>,
    body: (
      <Translate id="feat.dashboard.body">
        Balance curve, category donut, monthly Sankey, and an insights panel that surfaces where the money is drifting — with tabular numerals.
      </Translate>
    ),
  },
  {
    key: 'budgets',
    span: 'narrow',
    monogram: 'B',
    eyebrow: <Translate id="feat.budgets.eyebrow">Budgets</Translate>,
    title: <Translate id="feat.budgets.title">Plafonds and enveloppes</Translate>,
    body: (
      <Translate id="feat.budgets.body">
        Two models on the same page. Plafonds cap each category month-by-month. Enveloppes roll the leftover forward, sinking-fund style.
      </Translate>
    ),
  },
  {
    key: 'recurrent',
    span: 'narrow',
    monogram: 'F',
    eyebrow: <Translate id="feat.recurrent.eyebrow">Récurrent</Translate>,
    title: <Translate id="feat.recurrent.title">A six-month look ahead</Translate>,
    body: (
      <Translate id="feat.recurrent.body">
        Recurring bills are detected, confirmed by you, then projected six months out — only confirmed series count, so a bad guess never poisons the curve.
      </Translate>
    ),
  },
  {
    key: 'local',
    span: 'wide',
    monogram: 'L',
    eyebrow: <Translate id="feat.local.eyebrow">Local-only</Translate>,
    title: <Translate id="feat.local.title">Runs on your machine, and only your machine</Translate>,
    body: (
      <Translate id="feat.local.body">
        Docker Compose or a native desktop build. No hosted service. No sign-up. No telemetry. No third party ever sees your data. An optional local MCP server lets an LLM you already run act on your ledger — six tools, stdio, no network.
      </Translate>
    ),
    detail: (
      <span className={styles.detailChips}>
        <span>Docker Compose</span>
        <span>Desktop (PGlite)</span>
        <span>MCP · 6 tools</span>
        <span>MIT</span>
      </span>
    ),
  },
];

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <article
      className={clsx(
        styles.card,
        feature.span === 'wide' ? styles.cardWide : styles.cardNarrow,
      )}>
      <div className={styles.cardHead}>
        <div className={styles.monogram} aria-hidden="true">
          {feature.monogram}
        </div>
        <p className={styles.eyebrow}>{feature.eyebrow}</p>
      </div>
      <Heading as="h3" className={styles.title}>
        {feature.title}
      </Heading>
      <p className={styles.body}>{feature.body}</p>
      {feature.detail ? <div className={styles.detail}>{feature.detail}</div> : null}
    </article>
  );
}

export default function HomepageFeatures(): React.JSX.Element {
  return (
    <section className={styles.section} aria-labelledby="features-heading">
      <div className={styles.header}>
        <p className={styles.sectionEyebrow}>
          <Translate id="feat.section.eyebrow">The bill of materials</Translate>
        </p>
        <h2 id="features-heading" className={styles.sectionHeading}>
          <Translate id="feat.section.title">Everything Athena is, on one page.</Translate>
        </h2>
      </div>
      <div className={styles.grid}>
        {features.map((f) => (
          <FeatureCard key={f.key} feature={f} />
        ))}
      </div>
    </section>
  );
}
