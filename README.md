# 73inc Infinity Project

A Solana meme coin scanner and guarded, wallet-signed trading console for 73inc.
Static site (no build step) deployed on Netlify, backed by six Netlify Functions.

## Architecture

- `index.html` — minimal shell, loads `css/styles.css` and `js/main.js` as an ES module.
- `css/styles.css` — all styling.
- `js/` — the app, split into small modules:
  - `state.js` — shared in-memory + localStorage-backed state.
  - `api.js` — thin wrappers around the Netlify function endpoints.
  - `ui.js` — toasts, formatters, and the shared token card builder.
  - `wallet.js` — Phantom connect/disconnect and client-side signed swaps. The server never holds private keys.
  - `autotrade.js` — the auto-flag signal engine (see below).
  - `scanner.js`, `trending.js`, `watchlist.js`, `portfolio.js` — one module per tab.
  - `main.js` — entry point, tab switching, wallet UI wiring.
- `netlify/functions/` — six serverless functions:
  - `dexscreener-scan.mjs` — live Solana-only token discovery + RugCheck scoring (Scanner and Trending tabs).
  - `wallet-portfolio.mjs` — live SOL + SPL holdings via RPC and Jupiter/DexScreener pricing (Portfolio tab).
  - `jupiter-swap.mjs` — builds an unsigned swap transaction for Phantom to sign (manual Buy/Sell).
  - `trade-intent.mjs` — server-side guardrail validation before any trade.
  - `automation-execute.mjs` — optional private live-execution adapter (see below).
  - `photon-route.mjs` — optional Photon routing helper.

## Auto-flag trading model

The Auto-Trader tab never executes real trades silently. It continuously scores live
tokens against your score/liquidity/volume thresholds and:

- In **Paper mode**, it opens and closes simulated positions locally so you can test settings risk-free.
- In **Live mode**, it only ever surfaces a BUY or SELL signal with a **Confirm** button. Every real
  trade requires your explicit click, which then opens Phantom for your signature — exactly like a manual trade.

Nothing is ever executed unattended with real funds.

## Private live execution adapter (optional, advanced)

Live unattended execution via `automation-execute.mjs` is disabled unless both of these Netlify
environment variables exist:

- `AUTOTRADE_EXECUTION_URL`
- `AUTOTRADE_EXECUTION_TOKEN`

Optional variables: `AUTOTRADE_PROVIDER`, `PHOTON_ROUTE_URL`, `PHOTON_API_KEY`.

Never commit a wallet private key or seed phrase to this repository. Phantom remains an
interactive, user-approved signing path and is not used for silent background signing.

## Deploying

This is a static site with no build step. Netlify publishes the repository root (`.`) directly
and serves `netlify/functions` as serverless functions, as configured in `netlify.toml`. Pushing
to `main` triggers an automatic Netlify deploy.
