---
title: Interactive demo
sidebar_position: 1
---

# Interactive demo

A version of Athena Accounting runs directly in your browser. No account, no install, no server: everything you do is saved only in `localStorage` (on your machine, in your browser, walled off from the rest of the web).

- The default dataset covers the last six months of a fictional profile (two accounts, ~180 transactions, budgets, categories, rules).
- Sample-data labels — category, envelope and account names — are in French because the fictional profile is based in France. The UI itself follows whatever language you pick from the switcher, top-right of the sidebar.
- Every feature that needs a real server — PDF/CSV statement imports, MCP tokens — shows a "not available in the demo" panel. The rest (sort, categorisation, budgets, dashboard, Sankey, insights) is fully usable.
- The **Reset the demo** button at the top of the screen restores the original dataset if you want to start over.

![Athena dashboard with the demo dataset](/img/users/en/demo-dashboard.png)

<p style={{ textAlign: 'center', margin: '2rem 0' }}>
  <a
    href="/Athena-Accounting/demo/"
    className="button button--primary button--lg"
  >
    Open the demo →
  </a>
</p>

## Want to install it?

- [Home server (Docker)](./getting-started) — for multi-user use on a NAS, a mini-PC or a dedicated machine.
- [Desktop app (macOS/Windows/Linux)](./desktop-install) — for single-user use, no prerequisites, in one double-click.

## Demo limits

- No backend: endpoints that lean on Node code (PDF parsing, photo OCR, MCP tokens) show a "not available" modal. That's on purpose — installing Athena locally unlocks these features.
- Storage is the browser's: clearing site data also wipes the demo. Use it as a preview, not as a production tool.
- The demo database schema is versioned; if it evolves, the demo updates itself (which drops any changes you had made).
