import Translate from '@docusaurus/Translate';
import styles from './index.module.css';

type LedgerStep = {
  n: string;
  title: React.ReactNode;
  body: React.ReactNode;
};

type Props = {
  divider: React.ReactNode;
};

export function LedgerStrip({ divider }: Props) {
  const steps: LedgerStep[] = [
    {
      n: '01',
      title: <Translate id="home.step1.title">Import</Translate>,
      body: (
        <Translate id="home.step1.body">
          Bank statements go in. OFX, QFX, CSV and PDF — with an interactive template wizard for new PDF banks.
        </Translate>
      ),
    },
    {
      n: '02',
      title: <Translate id="home.step2.title">Categorise</Translate>,
      body: (
        <Translate id="home.step2.body">
          Rules and the Tri queue turn raw memo strings into structured signal, with internal-transfer detection.
        </Translate>
      ),
    },
    {
      n: '03',
      title: <Translate id="home.step3.title">Budget</Translate>,
      body: (
        <Translate id="home.step3.body">
          Plafonds cap each category. Enveloppes roll the leftover forward. Both live on the same page.
        </Translate>
      ),
    },
    {
      n: '04',
      title: <Translate id="home.step4.title">Forecast</Translate>,
      body: (
        <Translate id="home.step4.body">
          Recurring bills feed a six-month projection of your balance. Only confirmed series count — by design.
        </Translate>
      ),
    },
  ];
  return (
    <section className={styles.ledger} aria-labelledby="ledger-heading">
      {divider}
      <div className={styles.ledgerHeader}>
        <p className={styles.eyebrow}>
          <Translate id="home.ledger.eyebrow">The workflow</Translate>
        </p>
        <h2 id="ledger-heading" className={styles.sectionHeading}>
          <Translate id="home.ledger.title">
            In four moves.
          </Translate>
        </h2>
      </div>
      <ol className={styles.ledgerList}>
        {steps.map((s, i) => (
          <li key={s.n} className={styles.ledgerStep} style={{ ['--i' as string]: i }}>
            <div className={styles.ledgerN}>{s.n}</div>
            <div className={styles.ledgerBody}>
              <h3 className={styles.ledgerTitle}>{s.title}</h3>
              <p className={styles.ledgerText}>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
