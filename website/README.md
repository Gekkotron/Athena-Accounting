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

FR translations live in `website/i18n/fr/docusaurus-plugin-content-docs/current/`. Missing pages fall back to English. Currently only the `users/` track is translated.
