# Architecture Overview

The shape of the service, for onboarding and for agents building context. What it is
and how to run it lives in [`README.md`](./README.md); the working rules live in
[`CLAUDE.md`](./CLAUDE.md).

## Tech Stack

| Category | Technology | Notes |
|----------|-----------|-------|
| Runtime | Node >= 24.15 (`.nvmrc` pins 24.19.0) | Tests run on `--experimental-strip-types`, so no build step to test |
| Language | TypeScript, ESM, `NodeNext` | Relative imports keep `.ts`; `tsc` rewrites them on emit |
| HTTP | Express 5 + `cors` | One process, no router files, no middleware stack beyond CORS and a 1 MB JSON body |
| Canton | `@canton-network/wallet-sdk` 1.3.1 (exact) | `@canton-network/core-acs-reader` held at 1.12.0 by a `pnpm-workspace.yaml` override |
| Config | `dotenv` | Environment only, parsed once at startup |
| Testing | `node:test` | 90+ tests, no runner dependency |
| Lint & format | Biome | Also the formatter; no ESLint or Prettier |
| Dead code | knip | |
| Secrets | gitleaks, pinned by `.gitleaks-version` | |
| Packaging | pnpm, git dependency | `prepare` builds `dist/`, `bin` exposes `canton-wallet-service` |

## Project Structure

```text
src/
  server.ts          Express app and process entry point (the `bin`). Routes only.
  config.ts          Environment -> WalletServiceConfig. The only reader of process.env.
  rpc.ts             The JSON-RPC surface: dispatch, SDK caches, CIP-56 and Amulet logic.
  party.ts           /admin/party/* onboarding: prepare -> sign -> complete.
  tokenProvider.ts   The credential seam. One function every consumer calls.
  oauthToken.ts      Client-credentials grant, cached and refreshed ahead of expiry.
  canton-token.ts    Local HS256 JWT minting for a LocalNet participant. No src importer.
  types.ts           Wire types for the CIP-0103 dApp API and JSON-RPC envelopes.
  presets/           Checked-in endpoint + public OAuth defaults per known network.
test/                node:test suites, one per src module plus a smoke test of the app.
api-specs/           Vendored OpenRPC document for the dApp API.
scripts/             install-gitleaks.sh, the pinned-binary fetcher shared by hooks and CI.
```

## Key Abstractions

### The token seam

`createTokenProvider(config)` returns a `CantonTokenProvider` (`{ getToken(): Promise<string> }`)
regardless of which credential path is configured. Nothing downstream reads a config field to
decide: the static path wraps a pasted JWT, the OAuth path fetches, caches, and refreshes one
minute before expiry (`TOKEN_REFRESH_SKEW_MS`).

`config.canton` is a discriminated union, not a bag of optionals, so a credential travels with
the mode that needs it and no caller re-checks that the field its branch requires is present.

### SDK-per-token cache

The wallet SDK is constructed with `auth: { method: 'static' }`, meaning it captures its bearer
at construction. A rotated OAuth token therefore needs a new instance. `sdkPerToken` in
[`rpc.ts`](src/rpc.ts) memoizes one SDK per token value and clears the slot on a failed build
only when it still holds the attempt that failed, so a rotation racing a slow rejection cannot
discard the instance it just built. Two caches exist: the plain ledger SDK (`getSdk`) and the
CIP-56/Amulet-configured one (`getTokenSdk`).

### Scan proxy client

`amulet.preapproval.*` needs two Splice Scan contracts, `AmuletRules` and the active
`OpenMiningRound`. `core-amulet-service` 1.8.0 stopped exposing the client that reads them, so
`rpc.ts` builds its own `ScanProxyClient` against `SPLICE_VALIDATOR_URL`. One instance is enough:
it asks its token provider on every request, so a rotated token needs no rebuild.

Note that `ScanProxyClient` caches both contracts in process-lifetime statics with no expiry. A
network that rotates `AmuletRules` under a long-running container needs a restart.

### Pending store

Party onboarding spans two requests, and the object the second one needs cannot be handed to the
client, so `createPendingStore` (defined in `rpc.ts`, used by `party.ts`) holds it under an
opaque `onboardingId` with a TTL and a max size, 5 minutes and 32 entries. An abandoned flow
expires rather than accumulating. Prepared transactions need no such store: the payload goes out
to the wallet and comes back to `executePrepared`.

### Data access

Everything outbound goes through the wallet SDK or `fetch`, and every path is injectable:
`createRpc` takes `sdkFactory`, `fetch`, `tokenProvider`, `scanProxy`, `now` and `sleep` as
optional dependencies, which is how the suite covers Canton behavior with no participant running.

## Routes

| Route | Module | Description |
|-------|--------|-------------|
| `GET /health` | `server.ts` | Liveness plus the configured network name |
| `GET /` and `GET /wallet-service/info` | `rpc.serviceInfo()` | Provider identity and connectivity |
| `POST /rpc` | `rpc.handle()` | The JSON-RPC surface (see below) |
| `POST /admin/party/prepare` | `party.prepare()` | Returns `{ onboardingId, partyId, multiHash }` |
| `POST /admin/party/complete` | `party.complete()` | Submits the signed topology transaction |

The `/rpc` methods split three ways: CIP-0103 provider methods (`status`, `connect`,
`listAccounts`, ...), service-specific ones (`prepareTransaction`, `executePrepared`,
`ledgerApi`), and the token-standard set (`cip56.*`, `amulet.*`). `prepareExecute`,
`prepareExecuteAndWait` and `signMessage` are refused here by design: they need the user's key
and approval UI, which live in the wallet. The full method table is in the
[README](./README.md#api-boundary).

## Data Flow

```text
dApp  ->  wallet (CIP-0103 provider, holds the key)
            |
            v  HTTP JSON-RPC
        wallet-service  --(bearer token injected here)-->  Canton participant / Splice
```

The bearer token never leaves this process: the wallet posts an unauthenticated request, the
service attaches the credential, and responses come back stripped of it. A write is always two
round trips, since only the wallet can sign: the service prepares, the wallet signs locally, and
`executePrepared` submits the signature.

`ledgerApi` is a participant-native pass-through and refuses any `resource` that resolves off
the configured JSON API origin. That guard is load-bearing: `resource` is the dApp's parameter,
`new URL` discards the base for an absolute or protocol-relative value, and the outbound request
carries the token, so without it a caller could name any host and receive it.

## Environment Variables

Read once in [`config.ts`](src/config.ts); see [`.env.example`](.env.example) for defaults.

| Variable | Purpose |
|----------|---------|
| `WALLET_SERVICE_PORT` | Listen port (default 3010) |
| `WALLET_SERVICE_CORS_ORIGINS` | Comma-separated allowed origins, or `*` |
| `NETWORK`, `WALLET_PROVIDER_*` | Identity reported by `serviceInfo()` |
| `CANTON_JSON_API_URL`, `CANTON_LEDGER_API_URL`, `CANTON_ADMIN_API_URL` | Participant endpoints |
| `SPLICE_VALIDATOR_URL`, `SPLICE_SCAN_API_URL`, `SPLICE_REGISTRY_API_URL` | Splice endpoints for CIP-56 and Amulet |
| `CANTON_BACKEND_TOKEN` | Static credential path (LocalNet) |
| `EXTERNAL_OAUTH_*` | Client-credentials path; setting any of them selects it |
| `EXTERNAL_PRESET` | Endpoint and public OAuth defaults for a known validator |

On the OAuth path every endpoint must name the hosted validator: a missing, malformed, or
loopback URL fails at startup naming the variable, because a service that boots green and
refuses every Canton call is the worse outcome.

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm run dev` | `tsx watch src/server.ts` |
| `pnpm run build` | `tsc -p .` into `dist/` |
| `pnpm start` | `node dist/server.js` |
| `pnpm test` | `node:test` over `test/**/*.test.ts` |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run lint` / `lint:fix` | Biome check, with or without `--write` |
| `pnpm knip` | Unused files, exports and dependencies |
| `pnpm run prepare` | Builds `dist/` and installs the husky hooks |

## Distribution

Not on npm. Consumers install a git dependency pinned to a tag, and pnpm blocks a dependency's
build scripts by default, so the install needs `pnpm approve-builds` before `prepare` produces a
runnable binary. `files` ships `dist/` and `.env.example` only. Tag a release whenever the wire
surface changes.
