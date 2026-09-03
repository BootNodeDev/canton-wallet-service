<!-- starter-kit: v2026.09 -->

# Agent Configuration — canton-wallet-service

Canonical agent configuration for this repository. For what the service is and how to run it, see [`README.md`](./README.md).

## Scope

A consumer-dApp-agnostic Express JSON-RPC bridge between a CIP-0103 wallet and a Canton participant. It holds the Canton bearer token boundary, prepares and executes transactions, proxies participant reads, exposes CIP-56 token-standard reads/transfers and Amulet (Canton Coin) preapproval management and DevNet faucet tap, and handles wallet-internal party onboarding.

## Stack & Conventions

| Category | Technology | Notes |
|----------|-----------|-------|
| Language | TypeScript, ESM, `NodeNext` | Type-stripped at test time, `tsc`-emitted for `dist/` |
| Runtime | Node >= 24.15 (`.nvmrc`) | `--experimental-strip-types` needs it |
| HTTP | Express 5 | One process, no framework beyond it |
| Canton | `@canton-network/wallet-sdk`, pinned exact | See the override note under Working Rules |
| Package manager | pnpm 11 | Never npm or yarn |
| Lint & format | Biome (`biome.json`) | `pnpm run lint` before committing |
| Dead code | knip (`knip.json`) | `pnpm knip` |
| Tests | `node:test` | `pnpm test` |
| Secrets | gitleaks, pinned in `.gitleaks-version` | Hooks and CI run the same binary |
| Naming | camelCase values, PascalCase types, kebab-case or camelCase files | Enforced by Biome's `useFilenamingConvention` |

## Code Style

- TypeScript, ESM, `NodeNext` resolution: relative imports keep their `.ts` extension and `tsc` rewrites it on emit.
- No semicolons, single quotes, 100-column lines, 2-space indent, trailing commas. Biome (`biome.json`) is the authority.
- Comments explain *why*, one sentence, and only where the code cannot carry the fact.

## Working Rules

- Keep this service agnostic to the *consumer dApp*. Canton-standard logic is in scope: CIP-56 token-standard reads/transfers and Amulet (Canton Coin) preapproval — including the Splice/Amulet template ids those require. What stays out is consumer-dApp-specific routes, template ids, or command logic.
- Keep the public dApp-facing API in the wallet. This service exposes only the HTTP bridge the wallet needs.
- Keep wallet-internal party onboarding under `/admin/party/*`, not on the `/rpc` dApp surface.
- Keep `ledgerApi` as a participant-native pass-through. Do not silently translate request bodies or wrap participant responses.
- `ledgerApi` refuses a `resource` that resolves off the configured JSON API origin, and that guard is load-bearing rather than defensive tidiness: `resource` is the dApp's parameter, `new URL` discards the base for an absolute or protocol-relative value, and the outbound request carries the Canton bearer token. Without it, a caller names any host and receives the token.
- Keep token handling inside this service boundary. Do not expose the Canton bearer token to the dApp or wallet UI.
- Canton credentials are a branch, not a choice of one: a static `CANTON_BACKEND_TOKEN` for LocalNet, or `EXTERNAL_OAUTH_*` client credentials for a hosted validator. Everything downstream reads `createTokenProvider`, never a config field, because an OAuth token rotates and an SDK captures its bearer at construction.
- Configuration is environment-only, read in `src/config.ts`. Never read a consumer's config file.
- `@canton-network/wallet-sdk` is pinned exact, but it asks for `^1.x` on every `@canton-network/core-*` package, so a reinstall floats them. Amulet preapproval broke that way. Every core package is pinned in the `overrides` block in `pnpm-workspace.yaml`. Bump them deliberately, then re-run the local loop.
- `@canton-network/core-splice-client` is a direct dependency because `core-amulet-service` 1.8.0 hid the `ScanProxyClient` it holds. `rpc.ts` builds its own for the `AmuletRules` and `OpenMiningRound` reads. Do not reach into the SDK's private fields for it.
- Use **pnpm** only (never npm or yarn).

## Architecture

See [`architecture.md`](architecture.md) for project structure, data flow, and key abstractions.

## Distribution

Consumed as a git dependency pinned to a tag; not on npm. `prepare` builds `dist/` and installs the git hooks, `files` ships only `dist/` and `.env.example`, and `bin` exposes `canton-wallet-service`. Tag a release whenever the wire surface changes, so consumers move deliberately.

## Testing

- Run tests with `pnpm test`.
- Use `node:test` with `--experimental-strip-types`, matching `package.json`.
- Cover RPC method shape, pending approvals, CIP-56 token reads/transfers, Amulet preapproval, party onboarding, and HTTP status behavior.
- **What not to test:** SDK internals, third-party library behavior, trivial pass-throughs.

## Local Gates

Installed by `prepare` through husky, so they run on every commit and push:

| Hook | Runs |
|------|------|
| `pre-commit` | `lint-staged` formatter pass, then the read-only gates (`pnpm test`), then `gitleaks git --staged` |
| `commit-msg` | `commitlint` over the message |
| `pre-push` | `pnpm typecheck`, then `gitleaks` over the outgoing commit range |

`scripts/install-gitleaks.sh` fetches the version pinned in `.gitleaks-version` into `bin/`, checksum-verified, so local and CI apply identical rules. `.gitleaksignore` holds accepted findings by fingerprint; a new secret produces a new fingerprint and still fails.

## Commit Standards

Use [Conventional Commits](https://www.conventionalcommits.org/), enforced by `commitlint.config.js`:

**Format:** `type(scope): subject`

- **Scope** is optional: `feat: add login` and `feat(auth): add login` are both valid
- **Subject** uses imperative mood, lowercase after the colon, no trailing period
- **Body** (optional): separated by a blank line, explains *what* and *why*

**Prefixes:**

| Prefix | Purpose |
|--------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, dependencies, config |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `style` | Formatting, whitespace, semicolons |
| `ci` | CI/CD pipeline changes |
| `perf` | Performance improvement |
| `build` | Build system or external dependencies |
| `hotfix` | Urgent production fix |
| `revert` | Reverts a previous commit |
| `wip` | Work in progress (avoid on main) |
| `release` | Release-related changes |

## PR Workflow

- Every PR must reference an issue (`Closes #`)

  > No related issue? Use `No related issue.` as the first line of the Summary section.

- Mirror the issue's acceptance criteria in the PR
- Self-review your diff before requesting peer review
- Keep PRs small and focused -- one issue, one PR
- PR titles use the same conventional commit format (`feat: add user dashboard`)
- The `create-pr` skill at `.claude/skills/create-pr/` reads [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) and fills every section automatically
- CI runs the same gates as the hooks (`.github/workflows/pr.yml`), plus knip and the build

## Label Conventions

GitHub form dropdowns (like the Priority field in issue templates) only work through the web UI. When issues are created via `gh` CLI or REST API, dropdown values become unstructured body text -- not queryable, not consistent. **Labels are the API-reliable mechanism for structured metadata.**

**Priority** (bugs, features, and epics):

| Label | Description |
|-------|-------------|
| `priority: critical` | Blocking work, system down, or security issue |
| `priority: high` | Must be addressed in current sprint |
| `priority: medium` | Should be addressed soon |
| `priority: low` | Nice to have, can wait |

Labels are queryable: `gh issue list --label "priority: high"`.

The `create-issue` skill at `.claude/skills/create-issue/` applies these labels automatically when creating issues via CLI. Bug, feature, and epic templates include a Priority dropdown for web UI users, but labels are the source of truth for programmatic workflows.

## Guardrails

- Do not commit secrets, API keys, or credentials. `.env` is ignored and `.env.example` carries names only
- Do not modify CI/CD pipelines without team review
- Do not skip tests or linting to make a build pass
- When in doubt, ask -- don't assume

## Change Strategy

- Prefer small, focused diffs over broad refactors
- Preserve the wire surface unless the task explicitly changes it; a change to it means a new tag
- Avoid introducing new patterns when a project pattern already exists
- Update docs only when behavior or workflow changes

## Validation Checklist

- `pnpm run lint`
- `pnpm test`
- `pnpm run typecheck`
- `pnpm knip`
- `pnpm run build`

## References

- [CIP-0103 (wallet provider / dApp API)](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md)
- [Vendored OpenRPC dApp API](api-specs/openrpc-dapp-api.json)
- [Canton wallet SDK](https://github.com/canton-network/wallet/tree/main/sdk/wallet-sdk)
- [Splice (Amulet / Canton Coin)](https://docs.dev.sync.global/)
- [Biome](https://biomejs.dev/) · [knip](https://knip.dev/) · [gitleaks](https://github.com/gitleaks/gitleaks)
