# Canton Wallet Service

Express JSON-RPC bridge between a CIP-0103 wallet and a Canton participant.

It is intentionally app-agnostic: app-specific Daml commands come from the
consumer, the wallet owns signing and approval UI, and this service only handles
Canton connectivity, participant reads, prepared transaction execution, and
wallet-internal party onboarding.

## Install

Not published to npm yet. Consume it from git, pinned to a tag. No `dist/` is
committed, so the binary comes from the package's own `prepare` build — and pnpm
blocks a dependency's build scripts by default, so it has to be allowed through
before the install produces anything runnable:

```bash
pnpm add -D "git+ssh://git@github.com/BootNodeDev/canton-wallet-service.git#v0.1.3"
pnpm approve-builds          # allow this package's `prepare`, then re-install
pnpm exec canton-wallet-service
```

pnpm matches a git dependency by its resolved tarball id, so the allowance is
keyed to a commit sha and moving the tag means re-approving.

Configuration is environment-only (see `.env.example`), so a consumer supplies
it however it already supplies env to its own processes.

## Run

Requires Node 24 (see `.nvmrc`) and a reachable Canton participant.

```bash
pnpm install
cp .env.example .env   # then fill CANTON_BACKEND_TOKEN
pnpm run dev           # or: pnpm run build && pnpm start
curl -fsS http://localhost:3010/health
```

The image builds from this repository root and needs no wider build context:

```bash
docker build -t canton-wallet-service .
```

`docker-compose.yml` builds that image and reads an `.env` beside it, which is
how the service is deployed on a host of its own:

```bash
cp .env.example .env   # then fill in the credentials for that network
docker compose up --build -d
```

## Token

Real Canton calls require a bearer token the participant's ledger API accepts.
This service never mints one from a signing recipe; it takes credentials one of
two ways, and refuses to start with neither.

**Static token.** `CANTON_BACKEND_TOKEN` is a token minted wherever the
participant's signing recipe lives — on Splice LocalNet, a dev JWT with subject
`ledger-api-user`. This is the LocalNet path and needs nothing else.

**OAuth client credentials.** A hosted validator issues short-lived tokens, so
setting any `EXTERNAL_OAUTH_*` variable switches the service to fetching one
itself by client-credentials grant, caching it, and refreshing a minute before
it expires. `CANTON_BACKEND_TOKEN` is then neither read nor needed.

| Variable                       | Purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| `EXTERNAL_OAUTH_TOKEN_URL`     | The provider's token endpoint.                 |
| `EXTERNAL_OAUTH_CLIENT_ID`     | Machine-to-machine client id.                  |
| `EXTERNAL_OAUTH_CLIENT_SECRET` | Its secret. Never comes from a preset.         |
| `EXTERNAL_OAUTH_SCOPE`         | Usually `daml_ledger_api`.                     |
| `EXTERNAL_OAUTH_AUDIENCE`      | Optional. Sent only when set, for providers that gate on `aud`. |
| `EXTERNAL_PRESET`              | Optional. Supplies defaults for a known validator. |

On the OAuth path no localhost default is allowed to stand in for an endpoint:
`CANTON_JSON_API_URL` and the three `SPLICE_*` URLs must name the hosted
validator, whether from the environment or from `EXTERNAL_PRESET`. Missing,
malformed, or loopback values fail at startup naming the variable rather than at
the first Canton call — a service that boots green and refuses every Canton call
is the worse outcome.

A preset (`src/presets/`) is checked-in source, so it carries endpoints and
public OAuth fields only, never the secret. It fills what it knows and no more:
`fivenorth` has no published scan host, so `SPLICE_SCAN_API_URL` still has to be
supplied alongside it.

## API Boundary

The public dApp surface is CIP-0103. The wallet exposes that provider to dApps;
this service exposes only the HTTP JSON-RPC bridge the wallet needs at:

```text
POST /rpc
```

- [CIP-0103 Provider API](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md#provider-api)
- [CIP-0103 Synchronous dApp API](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md#synchronous-dapp-api)
- [Vendored OpenRPC dApp API](api-specs/openrpc-dapp-api.json)

Service-specific methods:

| Method               | Caller                          | Purpose                                                                                                          |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `prepareTransaction` | the wallet                      | Calls Canton interactive submission prepare and returns the prepared transaction payload/hash for local signing. |
| `executePrepared`    | the wallet                      | Submits the wallet's signature over a prepared transaction to Canton.                                            |
| `ledgerApi`          | the wallet on behalf of the dApp | Proxies app-user JSON API reads/writes and injects the Canton bearer token. `resource` must resolve to the configured JSON API origin; anything off it is refused with `-32602`, since the injected token would otherwise travel with it. |

### CIP-56 token methods

These add Canton token-standard reads and transfers plus Amulet (Canton Coin) preapproval. They are token-standard / Amulet logic, not consumer-dApp logic.

| Method | Purpose |
| --- | --- |
| `cip56.listHoldingSummary` | Per-instrument token balance summaries for a party (Amulet summaries via scan proxy; other tokens via holding UTXOs). |
| `cip56.listHoldings` | Raw token holding UTXOs for a party. |
| `cip56.listPendingTransfers` | Pending incoming CIP-56 transfer instructions for a party. |
| `cip56.createTransfer` | Prepares a token transfer for the caller to sign and execute. |
| `cip56.acceptTransfer` | Prepares acceptance of a pending incoming transfer. |
| `amulet.preapproval.status` | Reads the Amulet transfer-preapproval (auto-accept) status for a receiver. |
| `amulet.preapproval.create` | Prepares enabling Amulet auto-accept. |
| `amulet.preapproval.cancel` | Prepares disabling Amulet auto-accept. |
| `amulet.preapproval.acceptProposal` | Accepts a `TransferPreapprovalProposal` for the receiver. |
| `amulet.tap` | Prepares the fixed 100 AMT Splice DevNet faucet tap for a receiver (DevNet only). |

The write methods (`create*`, `acceptTransfer`, `amulet.preapproval.create/cancel/acceptProposal`, `amulet.tap`) return prepared transactions; the wallet signs locally and submits via `executePrepared`.

`prepareExecute`, `prepareExecuteAndWait`, and `signMessage` stay in the
wallet because they require the user's key and approval UI.

For `ledgerApi` semantics, read the upstream spec instead of duplicating it:

- [CIP-0103 `ledgerApi`](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md#ledgerapi)
- [CIP-0103 JSON Ledger API rationale](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md#interoperability-with-the-json-ledger-api)
- [`LedgerApiRequest` schema](api-specs/openrpc-dapp-api.json)

## Admin Endpoints

External party onboarding is wallet/provider operational logic, not generic
dApp API. See
[CIP-0103 topology-related capabilities](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md#topology-related-capabilities).

The wallet uses these wallet-internal endpoints:

| Endpoint                     | Purpose                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /admin/party/prepare`  | Prepares the external party topology transaction and returns `{ onboardingId, partyId, multiHash }`. |
| `POST /admin/party/complete` | Submits the signed topology transaction, grants user rights, and returns the created party.          |

These endpoints stay outside `/rpc` so the dApp API remains a projection of
the CIP/OpenRPC surface.
