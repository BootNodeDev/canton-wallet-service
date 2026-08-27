# Agent Configuration — canton-wallet-service

Canonical agent configuration for this repository. For what the service is and how to run it, see [`README.md`](./README.md).

## Scope

A consumer-dApp-agnostic Express JSON-RPC bridge between a CIP-0103 wallet and a Canton participant. It holds the Canton bearer token boundary, prepares and executes transactions, proxies participant reads, exposes CIP-56 token-standard reads/transfers and Amulet (Canton Coin) preapproval management and DevNet faucet tap, and handles wallet-internal party onboarding.

## Working Rules

- Keep this service agnostic to the *consumer dApp*. Canton-standard logic is in scope: CIP-56 token-standard reads/transfers and Amulet (Canton Coin) preapproval — including the Splice/Amulet template ids those require. What stays out is consumer-dApp-specific routes, template ids, or command logic.
- Keep the public dApp-facing API in the wallet. This service exposes only the HTTP bridge the wallet needs.
- Keep wallet-internal party onboarding under `/admin/party/*`, not on the `/rpc` dApp surface.
- Keep `ledgerApi` as a participant-native pass-through. Do not silently translate request bodies or wrap participant responses.
- Keep token handling inside this service boundary. Do not expose `CANTON_BACKEND_TOKEN` to the dApp or wallet UI.
- Configuration is environment-only, read in `src/config.ts`. Never read a consumer's config file.
- `@canton-network/wallet-sdk` is pinned exact and `@canton-network/core-acs-reader` held at `1.12.0` through `pnpm.overrides`, because the SDK floats that transitive dependency. Bump either deliberately, then re-run the local loop.

## Code Style

- TypeScript, ESM, `NodeNext` resolution: relative imports keep their `.ts` extension and `tsc` rewrites it on emit.
- No semicolons, single quotes, 100-column lines. Biome (`biome.json`) is the authority.
- Comments explain *why*, one sentence, and only where the code cannot carry the fact.

## Distribution

Consumed as a git dependency pinned to a tag; not on npm. `prepare` builds `dist/`, `files` ships only that, and `bin` exposes `canton-wallet-service`. Tag a release whenever the wire surface changes, so consumers move deliberately.

## Testing

- Run tests with `pnpm test`.
- Use `node:test` with `--experimental-strip-types`, matching `package.json`.
- Cover RPC method shape, pending approvals, CIP-56 token reads/transfers, Amulet preapproval, party onboarding, and HTTP status behavior.

## Validation Checklist

- `pnpm run lint`
- `pnpm test`
- `pnpm run build`
