# 73inc Infinity Project

Internal Solana intelligence and guarded auto-trading station for 73inc.

## Capabilities

- Multi-window DexScreener discovery and ranking
- RugCheck preflight for every auto-trade candidate
- Pump.fun launch scanner with profile and social weighting
- Phantom connect, disconnect, and wallet-signed execution path
- Photon workspace controls and token deep links
- Agent consensus, paper automation, position exits, and manual overrides
- Optional private live execution adapter

## Development

```sh
pnpm install
pnpm dev
```

Netlify builds with `npm run build` and publishes `dist`.

## Private execution configuration

Live unattended execution is disabled unless both of these Netlify environment variables exist:

- `AUTOTRADE_EXECUTION_URL`
- `AUTOTRADE_EXECUTION_TOKEN`

Optional variables:

- `AUTOTRADE_PROVIDER`
- `PHOTON_ROUTE_URL`
- `PHOTON_API_KEY`

The execution adapter must accept validated buy and exit commands. Never commit a wallet private key or seed phrase to this repository. Phantom remains an interactive, user-approved signing path and is not used for silent background signing.
