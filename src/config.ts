import type { OAuthConfig } from './oauthToken.ts'
import { FIVENORTH_PRESET, type NetworkPreset } from './presets/fivenorth.ts'

export interface CantonEndpoints {
  jsonApiUrl: string
  ledgerApiUrl: string
  adminApiUrl: string
}

// A union, not a bag of optionals: the credential a source needs travels with it, so
// nothing downstream re-checks that the field its mode requires is actually present.
export type CantonCredentials =
  | { tokenSource: 'static'; backendToken: string }
  | { tokenSource: 'oauth'; oauth: OAuthConfig }

export interface SpliceEndpoints {
  validatorUrl: string
  scanApiUrl: string
  registryApiUrl: string
}

export interface WalletServiceConfig {
  port: number
  corsOrigins: string[]
  network: string
  provider: {
    id: string
    version: string
    url?: string
  }
  canton: CantonEndpoints & CantonCredentials
  splice: SpliceEndpoints
}

export const TOKEN_REFRESH_SKEW_MS = 60_000

// A Map, not an object literal: a plain lookup would resolve 'toString' to
// Object.prototype's and pass the allowlist below.
const PRESETS = new Map<string, NetworkPreset>([['fivenorth', FIVENORTH_PRESET]])

// Splice LocalNet endpoints as published on the host, used only by the static token path.
const LOCALNET = {
  jsonApiUrl: 'http://localhost:3013',
  ledgerApiUrl: 'grpc://localhost:3014',
  adminApiUrl: 'grpc://localhost:3015',
  validatorUrl: 'http://localhost:2000/api/validator',
  scanApiUrl: 'http://scan.localhost:4000/api/scan',
  registryApiUrl: 'http://localhost:2000/api/validator/v0/scan-proxy',
} as const

// Setting any EXTERNAL_OAUTH_* variable selects the OAuth path, so a half-filled config
// fails naming what is missing instead of silently falling back to the static token.
// Matched by prefix rather than a list, so a misspelled name still lands on the OAuth
// branch and gets an error about the variable it meant.
const OAUTH_PREFIX = 'EXTERNAL_OAUTH_'

const presetHint = (preset: NetworkPreset | undefined): string =>
  preset === undefined ? ' (or set EXTERNAL_PRESET to a preset that supplies it)' : ''

const optional = (name: string): string | undefined => {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

const optionalNumber = (name: string, fallback: number): number => {
  const value = optional(name)
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

const required = (name: string, fallback: string | undefined, hint = ''): string => {
  const value = optional(name) ?? fallback
  if (value === undefined || value === '') {
    throw new Error(`${name} is required${hint}`)
  }
  return value
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

// A hosted endpoint that is not a URL fails here rather than inside an SDK call hours later.
// It must not be a loopback one either: `.env.example` ships LocalNet URLs uncommented, so
// copying it and adding OAuth credentials would otherwise boot a green service whose every
// Canton call is refused. A preset cannot rescue that — an explicit value beats it.
const requiredUrl = (name: string, fallback: string | undefined, hint = ''): string => {
  const value = required(name, fallback, hint)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute URL (got '${value}')`)
  }
  if (LOOPBACK.has(parsed.hostname)) {
    throw new Error(
      `${name} must name the hosted validator, not a loopback address (got '${value}'). The OAuth path cannot reach a LocalNet.`,
    )
  }
  return value
}

const resolvePreset = (): NetworkPreset | undefined => {
  const name = optional('EXTERNAL_PRESET')
  if (name === undefined) {
    return undefined
  }
  const preset = PRESETS.get(name)
  if (preset === undefined) {
    throw new Error(
      `EXTERNAL_PRESET must be one of: ${[...PRESETS.keys()].join(', ')} (got '${name}')`,
    )
  }
  return preset
}

type ResolvedNetwork = Pick<WalletServiceConfig, 'canton' | 'splice'>

// LocalNet: an explicit bearer token, minted by whoever runs the participant, and
// localhost defaults for every endpoint.
const resolveStatic = (): ResolvedNetwork => {
  const token = optional('CANTON_BACKEND_TOKEN')
  if (token === undefined) {
    throw new Error(
      'CANTON_BACKEND_TOKEN is required. Provide a bearer token the participant accepts. Set the EXTERNAL_OAUTH_* variables instead to reach a hosted validator with OAuth client credentials.',
    )
  }
  return {
    canton: {
      jsonApiUrl: optional('CANTON_JSON_API_URL') ?? LOCALNET.jsonApiUrl,
      ledgerApiUrl: optional('CANTON_LEDGER_API_URL') ?? LOCALNET.ledgerApiUrl,
      adminApiUrl: optional('CANTON_ADMIN_API_URL') ?? LOCALNET.adminApiUrl,
      backendToken: token,
      tokenSource: 'static',
    },
    splice: {
      validatorUrl: optional('SPLICE_VALIDATOR_URL') ?? LOCALNET.validatorUrl,
      scanApiUrl: optional('SPLICE_SCAN_API_URL') ?? LOCALNET.scanApiUrl,
      registryApiUrl: optional('SPLICE_REGISTRY_API_URL') ?? LOCALNET.registryApiUrl,
    },
  }
}

// Hosted validator: client-credentials OAuth, and no localhost default is allowed to
// stand in for an endpoint that has to be stated.
const resolveOAuth = (preset: NetworkPreset | undefined): ResolvedNetwork => {
  const hint = presetHint(preset)
  const audience = optional('EXTERNAL_OAUTH_AUDIENCE')
  const oauth: OAuthConfig = {
    tokenUrl: requiredUrl('EXTERNAL_OAUTH_TOKEN_URL', preset?.oauth.tokenUrl, hint),
    clientId: required('EXTERNAL_OAUTH_CLIENT_ID', preset?.oauth.clientId, hint),
    // Never presettable: a preset is checked-in source and a secret is not.
    clientSecret: required('EXTERNAL_OAUTH_CLIENT_SECRET', undefined),
    scope: required('EXTERNAL_OAUTH_SCOPE', preset?.oauth.scope, hint),
    // Absent, not undefined, when unset: the BootNode Auth0 tenant issues an accepted
    // token without an audience, and a provider that gates on `aud` needs one.
    ...(audience === undefined ? {} : { audience }),
    refreshSkewMs: TOKEN_REFRESH_SKEW_MS,
  }
  return {
    canton: {
      jsonApiUrl: requiredUrl('CANTON_JSON_API_URL', preset?.canton.jsonApiUrl, hint),
      ledgerApiUrl: optional('CANTON_LEDGER_API_URL') ?? preset?.canton.ledgerApiUrl ?? '',
      adminApiUrl: optional('CANTON_ADMIN_API_URL') ?? preset?.canton.adminApiUrl ?? '',
      oauth,
      tokenSource: 'oauth',
    },
    splice: {
      validatorUrl: requiredUrl('SPLICE_VALIDATOR_URL', preset?.splice.validatorUrl, hint),
      scanApiUrl: requiredUrl('SPLICE_SCAN_API_URL', preset?.splice.scanApiUrl, hint),
      registryApiUrl: requiredUrl('SPLICE_REGISTRY_API_URL', preset?.splice.registryApiUrl, hint),
    },
  }
}

export const loadConfig = (): WalletServiceConfig => {
  const preset = resolvePreset()
  const wantsOAuth =
    preset !== undefined ||
    Object.keys(process.env).some(
      (name) => name.startsWith(OAUTH_PREFIX) && optional(name) !== undefined,
    )
  const { canton, splice } = wantsOAuth ? resolveOAuth(preset) : resolveStatic()
  const port = optionalNumber('WALLET_SERVICE_PORT', 3010)
  return {
    port,
    corsOrigins: (
      optional('WALLET_SERVICE_CORS_ORIGINS') ??
      optional('WALLET_SERVICE_CORS_ORIGIN') ??
      'http://localhost:3011'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    network: optional('NETWORK') ?? (wantsOAuth ? 'canton:external' : 'canton:local'),
    provider: {
      id: optional('WALLET_PROVIDER_ID') ?? 'wallet-service',
      version: optional('WALLET_PROVIDER_VERSION') ?? '0.1.0',
      url: optional('WALLET_PROVIDER_URL') ?? `http://localhost:${port}`,
    },
    canton,
    splice,
  }
}
