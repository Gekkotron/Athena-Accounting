import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Translate, { translate } from '@docusaurus/Translate';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import styles from './index.module.css';
import { LedgerStrip } from './LedgerStrip';

function HeroPreamble() {
  return (
    <p className={styles.preamble} aria-hidden="false">
      <span>
        <Translate id="home.preamble.open" description="Hero preamble word 1">
          open source
        </Translate>
      </span>
      <span className={styles.preambleDot} aria-hidden="true">
        ·
      </span>
      <span>
        <Translate id="home.preamble.selfhosted" description="Hero preamble word 2">
          self-hosted
        </Translate>
      </span>
      <span className={styles.preambleDot} aria-hidden="true">
        ·
      </span>
      <span>
        <Translate id="home.preamble.single" description="Hero preamble word 3">
          single user
        </Translate>
      </span>
    </p>
  );
}

function HeroHeadline() {
  return (
    <Heading as="h1" className={styles.headline}>
      <span className={styles.headlineLine1}>
        <Translate id="home.headline.line1" description="Hero headline first line">
          A ledger for one,
        </Translate>
      </span>
      <span className={styles.headlineLine2}>
        <Translate id="home.headline.line2" description="Hero headline second line, styled emphatic">
          running on your machine.
        </Translate>
      </span>
    </Heading>
  );
}

function HeroSubhead() {
  return (
    <p className={styles.subhead}>
      <Translate id="home.subhead" description="Hero subhead paragraph">
        Import OFX, QFX, CSV, and PDF statements. Categorise once, forever. Runs on your LAN — your bank data never leaves your network.
      </Translate>
    </p>
  );
}

function HeroCtas() {
  const demoUrl = 'pathname://' + useBaseUrl('/demo/');
  return (
    <div className={styles.ctas}>
      <Link
        href={demoUrl}
        className={clsx('button button--primary button--lg', styles.ctaPrimary)}>
        <span>
          <Translate id="home.cta.demo" description="Primary CTA — try the demo">
            Try the live demo
          </Translate>
        </span>
        <span className={styles.ctaArrow} aria-hidden="true">
          →
        </span>
      </Link>
      <Link
        to="/docs/users/getting-started"
        className={clsx('button button--lg', styles.ctaGhost)}>
        <Translate id="home.cta.docs" description="Secondary CTA — read docs">
          Read the docs
        </Translate>
      </Link>
      <Link
        href="https://github.com/Gekkotron/Athena-Accounting"
        className={styles.ctaTextLink}>
        <Translate id="home.cta.source" description="Tertiary CTA — view source">
          View the source
        </Translate>
        <span aria-hidden="true"> ↗</span>
      </Link>
    </div>
  );
}

function TrustChips() {
  const items = [
    { key: 'local', label: <Translate id="home.chip.local">Local-only</Translate> },
    { key: 'mit', label: <Translate id="home.chip.mit">MIT-licensed</Translate> },
    { key: 'telemetry', label: <Translate id="home.chip.telemetry">Zero telemetry</Translate> },
    { key: 'onecmd', label: <Translate id="home.chip.onecmd">One command up</Translate> },
  ];
  return (
    <ul className={styles.chips} aria-label="Project values">
      {items.map((item) => (
        <li key={item.key} className={styles.chip}>
          <span className={styles.chipMark} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function ProductShot() {
  const src = useBaseUrl('/img/users/en/demo-dashboard.png');
  return (
    <section className={styles.productSection} aria-labelledby="product-heading">
      <h2 id="product-heading" className={styles.visuallyHidden}>
        <Translate id="home.product.headingSr">Product screenshot</Translate>
      </h2>
      <div className={styles.productFrame}>
        <div className={styles.productChrome} aria-hidden="true">
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.chromePath}>athena.local · Dashboard</span>
        </div>
        <img
          src={src}
          className={styles.productImage}
          loading="lazy"
          alt={translate({
            id: 'home.product.alt',
            message:
              'Athena Accounting dashboard: balance curve, category donut, Sankey flow, monthly insights.',
          })}
        />
      </div>
      <p className={styles.productCaption}>
        <Translate id="home.product.caption">
          Dashboard — a real month, showing the balance curve, category donut, and monthly Sankey.
        </Translate>
      </p>
    </section>
  );
}

function SectionDivider() {
  return (
    <div className={styles.divider} aria-hidden="true">
      <span className={styles.dividerLine} />
      <span className={styles.dividerDot} />
      <span className={styles.dividerLine} />
    </div>
  );
}

function ClosingCta() {
  const demoUrl = 'pathname://' + useBaseUrl('/demo/');
  return (
    <section className={styles.closing} aria-labelledby="closing-heading">
      <SectionDivider />
      <div className={styles.closingInner}>
        <h2 id="closing-heading" className={styles.closingHeading}>
          <Translate id="home.closing.title">
            Set it up once. Own your ledger forever.
          </Translate>
        </h2>
        <p className={styles.closingBody}>
          <Translate id="home.closing.body">
            Athena runs on a Raspberry Pi, a spare mini-PC, or your laptop. There is no account to create, no plan to upgrade, and no server that can be turned off.
          </Translate>
        </p>
        <div className={styles.closingCtas}>
          <Link
            to="/docs/users/getting-started"
            className={clsx('button button--primary button--lg', styles.ctaPrimary)}>
            <Translate id="home.closing.cta1">Install Athena</Translate>
            <span className={styles.ctaArrow} aria-hidden="true">
              →
            </span>
          </Link>
          <Link href={demoUrl} className={clsx('button button--lg', styles.ctaGhost)}>
            <Translate id="home.closing.cta2">See the demo first</Translate>
          </Link>
        </div>
        <p className={styles.signature}>
          <Translate
            id="home.signature"
            values={{
              author: (
                <a
                  href="https://github.com/Gekkotron"
                  className={styles.signatureLink}>
                  Gekkotron
                </a>
              ),
            }}>
            {'Built by {author} · Runs on your LAN · MIT-licensed · No telemetry, ever.'}
          </Translate>
        </p>
      </div>
    </section>
  );
}

export default function Home(): React.JSX.Element {
  return (
    <Layout
      title={translate({
        id: 'home.meta.title',
        message: 'Athena Accounting — a private, self-hosted ledger',
      })}
      description={translate({
        id: 'home.meta.description',
        message:
          'A self-hosted personal accounting app. OFX, QFX, CSV, PDF imports. Local-only, MIT-licensed, zero telemetry.',
      })}>
      <header className={styles.hero}>
        <div className={styles.heroGrain} aria-hidden="true" />
        <div className={styles.heroWashes} aria-hidden="true" />
        <div className={clsx('container', styles.heroInner)}>
          <HeroPreamble />
          <HeroHeadline />
          <HeroSubhead />
          <HeroCtas />
          <TrustChips />
        </div>
      </header>
      <main>
        <ProductShot />
        <LedgerStrip divider={<SectionDivider />} />
        <SectionDivider />
        <HomepageFeatures />
        <ClosingCta />
      </main>
    </Layout>
  );
}
