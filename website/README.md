# Athena Accounting website

Docusaurus site published to <https://gekkotron.github.io/Athena-Accounting/>.

## Local development

```bash
cd website
npm install
npm run start
```

Opens http://localhost:3000/Athena-Accounting/.

## Build

```bash
npm run build       # outputs to website/build/
npm run serve       # serves the built site locally
```

## Adding a doc page

Add a `.md` file under `docs/` in the repo root. It appears automatically in the sidebar. Control ordering with the `sidebar_position` frontmatter field.

## French translations

FR translations of Docusaurus theme strings (navbar, footer, common UI) live in `website/i18n/fr/`. All doc content currently falls back to English — per-page translations will be added in a follow-up plan.

Docusaurus's `npm run write-translations -- --locale fr` regenerates the theme JSON from bundled defaults. It may also emit `docusaurus-plugin-content-blog/options.json` and `docusaurus-plugin-content-docs/current.json`; those are intentionally not committed since bundled defaults already cover them. Do not `git add` them by accident.
