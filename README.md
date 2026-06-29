# 73inc Trading Desk

Solana trading execution console with guarded Phantom wallet connection and server-side route preparation.

## Development

```sh
npm install
npm run dev
```

## Production

Netlify builds the Vite application with `npm run build` and publishes `dist`.

Optional Photon routing requires the following Netlify environment variables:

- `PHOTON_ROUTE_URL`
- `PHOTON_API_KEY`

Without them, the route function returns a non-executable simulation response.
