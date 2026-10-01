# Sift demo proxy

A Cloudflare Worker that lets the extension run with no API keys entered (issue #39).
It holds the Nebius and Tavily keys, forwards only the calls the extension makes
(`src/policy.ts`), and caps use per install, per IP and overall per UTC day (a Durable Object).
It does not log request bodies.

## Deploy

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put NEBIUS_API_KEY
npx wrangler secret put TAVILY_API_KEY
npm run deploy        # prints https://sift-demo-proxy.<account>.workers.dev
```

Tune the caps without a code change by adding vars to `wrangler.toml`, for example
`NEBIUS_GLOBAL = "2000"` or `TAVILY_PER_INSTALL = "25"` (defaults: `DEFAULT_LIMITS` in `src/policy.ts`).

## Build the extension against it

```bash
VITE_DEMO_PROXY_URL=https://sift-demo-proxy.<account>.workers.dev npm run build
```

Without `VITE_DEMO_PROXY_URL` the extension has no demo mode and needs keys, as before.

## After the judging window

Rotate or delete both keys (`wrangler secret delete`, or the providers' dashboards) and
`wrangler delete`. The extension then falls back to asking for keys.
