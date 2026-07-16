import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: React.ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Imports that just work',
    description: (
      <>
        OFX, French CSV, and PDF bank statements. New PDF banks trigger an
        interactive template wizard once; every later statement in that
        format imports automatically.
      </>
    ),
  },
  {
    title: 'Rules and Tri tab',
    description: (
      <>
        Configurable rule engine with accent- and case-insensitive matching,
        a bulk Tri tab for uncategorised transactions, and internal transfer
        detection that links the two legs.
      </>
    ),
  },
  {
    title: 'Dashboards that read',
    description: (
      <>
        Balance chart, category donut, monthly Sankey, monthly averages, and
        an insights panel that surfaces where your money is drifting.
      </>
    ),
  },
  {
    title: 'Local-only, always',
    description: (
      <>
        Self-hosted. No cloud dependencies. Runs on a mini-PC on your LAN.
        Your bank data never leaves your network.
      </>
    ),
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx('col col--3')}>
      <div className={styles.featureCard}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): React.JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
