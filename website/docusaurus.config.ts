import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Athena Accounting',
  tagline: 'Self-hosted personal accounting. Your bank data never leaves your network.',
  favicon: 'img/favicon.svg',

  url: 'https://gekkotron.github.io',
  baseUrl: '/Athena-Accounting/',

  organizationName: 'Gekkotron',
  projectName: 'Athena-Accounting',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl: ({ docPath }) =>
            `https://github.com/Gekkotron/Athena-Accounting/edit/main/docs/${docPath}`,
          exclude: [
            '**/_*.{js,jsx,ts,tsx,md,mdx}',
            '**/_*/**',
            '**/*.test.{js,jsx,ts,tsx}',
            '**/__tests__/**',
            'superpowers/**',
            'standalone-app-distribution.md',
          ],
        },
        blog: {
          showReadingTime: true,
          blogTitle: 'Athena Accounting blog',
          blogDescription: 'Release notes and news',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo.svg',
    // Dark-first, to mirror the app (frontend/src/index.css: color-scheme: dark).
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Athena Accounting',
      logo: {
        alt: 'Athena Accounting logo',
        src: 'img/logo.svg',
      },
      items: [
        { to: '/docs/users/getting-started', label: 'Docs', position: 'left' },
        { to: '/blog', label: 'Blog', position: 'left' },
        { type: 'localeDropdown', position: 'right' },
        {
          href: 'https://github.com/Gekkotron/Athena-Accounting',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting started', to: '/docs/users/getting-started' },
            { label: 'Importing', to: '/docs/users/importing' },
            { label: 'API reference', to: '/docs/reference/api-endpoints' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'Issues', href: 'https://github.com/Gekkotron/Athena-Accounting/issues' },
            { label: 'Sponsor', href: 'https://github.com/sponsors/Gekkotron' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/Gekkotron/Athena-Accounting' },
            { label: 'Blog', to: '/blog' },
          ],
        },
      ],
      copyright: `Athena Accounting. Built by Gekkotron. MIT licensed.`,
    },
    prism: {
      // Light — subtle; Dark — Nord/Oceanic-style tones that read well on the
      // ink-900 code-block background.
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
