import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../src/config.ts'

const CANTON_VARS = [
  'CANTON_BACKEND_TOKEN',
  'CANTON_AUTH_AUDIENCE',
  'CANTON_AUTH_SECRET',
  'CANTON_JSON_API_URL',
  'SPLICE_VALIDATOR_URL',
  'SPLICE_SCAN_API_URL',
  'SPLICE_REGISTRY_API_URL',
  'EXTERNAL_PRESET',
  'EXTERNAL_OAUTH_TOKEN_URL',
  'EXTERNAL_OAUTH_CLIENT_ID',
  'EXTERNAL_OAUTH_CLIENT_SECRET',
  'EXTERNAL_OAUTH_SCOPE',
] as const

// The endpoints a hosted validator must state, since no localhost default may stand in.
const hostedEndpoints = (): void => {
  process.env.CANTON_JSON_API_URL = 'https://ledger.example'
  process.env.SPLICE_VALIDATOR_URL = 'https://wallet.example/api/validator'
  process.env.SPLICE_SCAN_API_URL = 'https://scan.example/api/scan'
  process.env.SPLICE_REGISTRY_API_URL = 'https://wallet.example/api/validator/v0/scan-proxy'
}

const oauthCredentials = (): void => {
  process.env.EXTERNAL_OAUTH_TOKEN_URL = 'https://auth.example/oauth/token'
  process.env.EXTERNAL_OAUTH_CLIENT_ID = 'client-id'
  process.env.EXTERNAL_OAUTH_CLIENT_SECRET = 'client-secret'
  process.env.EXTERNAL_OAUTH_SCOPE = 'daml_ledger_api'
}

const snapshot = (): Record<string, string | undefined> =>
  Object.fromEntries(CANTON_VARS.map((name) => [name, process.env[name]]))

const restore = (saved: Record<string, string | undefined>): void => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
}

describe('config loader', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = snapshot()
    for (const name of CANTON_VARS) {
      delete process.env[name]
    }
  })

  afterEach(() => {
    restore(saved)
  })

  it('fails clearly when real mode starts without CANTON_BACKEND_TOKEN', () => {
    // Scenario: real wallet-service mode must not mint a bearer token from the
    // local auth recipe. The operator should generate a token explicitly and
    // paste it into CANTON_BACKEND_TOKEN so every runtime token is visible.
    assert.throws(
      () => loadConfig(),
      /CANTON_BACKEND_TOKEN is required\. Provide a bearer token the participant accepts\./,
    )
  })

  it('does not use the local signing recipe to mint a wallet-service token', () => {
    // Scenario: the local signing recipe is only for scripts.
    // The runtime service must still fail until CANTON_BACKEND_TOKEN is set.
    process.env.CANTON_AUTH_AUDIENCE = 'https://canton.network.global'
    process.env.CANTON_AUTH_SECRET = 'unsafe'

    assert.throws(
      () => loadConfig(),
      /CANTON_BACKEND_TOKEN is required\. Provide a bearer token the participant accepts\./,
    )
  })

  it('tokenSource is "static" when CANTON_BACKEND_TOKEN is set', () => {
    // Scenario: the explicit backend token is the only accepted LocalNet
    // credential source, and it is passed through unchanged to SDK calls.
    process.env.CANTON_BACKEND_TOKEN = 'explicit.jwt.value'
    process.env.CANTON_AUTH_AUDIENCE = 'https://canton.network.global'
    process.env.CANTON_AUTH_SECRET = 'unsafe'
    const config = loadConfig()
    assert.equal(config.canton.tokenSource, 'static')
    assert.equal(config.canton.backendToken, 'explicit.jwt.value')
    assert.equal(config.canton.oauth, undefined)
  })

  it('defaults Splice service URLs for token and Amulet SDK helpers', () => {
    // Scenario: wallet-service owns SDK helper configuration so the wallet can
    // keep a single wallet-service URL. LocalNet defaults should match the
    // Splice services a LocalNet bundle exposes.
    process.env.CANTON_BACKEND_TOKEN = 'explicit.jwt.value'

    const config = loadConfig()

    assert.deepEqual(config.splice, {
      validatorUrl: 'http://localhost:2000/api/validator',
      scanApiUrl: 'http://scan.localhost:4000/api/scan',
      registryApiUrl: 'http://localhost:2000/api/validator/v0/scan-proxy',
    })
  })

  it('allows Splice service URLs to be overridden by environment', () => {
    // Scenario: non-default LocalNet layouts can move Splice endpoints without
    // changing the wallet runtime config. wallet-service reads these values once
    // at startup and passes them to the SDK namespaces.
    process.env.CANTON_BACKEND_TOKEN = 'explicit.jwt.value'
    process.env.SPLICE_VALIDATOR_URL = 'http://validator.example/api/validator'
    process.env.SPLICE_SCAN_API_URL = 'http://scan.example/api/scan'
    process.env.SPLICE_REGISTRY_API_URL = 'http://registry.example/api/registry'

    const config = loadConfig()

    assert.deepEqual(config.splice, {
      validatorUrl: 'http://validator.example/api/validator',
      scanApiUrl: 'http://scan.example/api/scan',
      registryApiUrl: 'http://registry.example/api/registry',
    })
  })

  it('switches to the OAuth path when the EXTERNAL_OAUTH_* variables are set', () => {
    // Scenario: a hosted validator issues short-lived tokens, so wallet-service
    // takes client credentials instead of a pasted JWT. CANTON_BACKEND_TOKEN is
    // not needed and not read on this path.
    hostedEndpoints()
    oauthCredentials()

    const config = loadConfig()

    assert.equal(config.canton.tokenSource, 'oauth')
    assert.equal(config.canton.backendToken, undefined)
    assert.deepEqual(config.canton.oauth, {
      tokenUrl: 'https://auth.example/oauth/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'daml_ledger_api',
      refreshSkewMs: 60_000,
    })
    assert.equal(config.network, 'canton:external')
  })

  it('fails naming the missing variable when OAuth config is half-filled', () => {
    // Scenario: one EXTERNAL_OAUTH_* variable selects the OAuth path, so a typo in
    // another must stop startup by name rather than fall back to the static token.
    hostedEndpoints()
    oauthCredentials()
    delete process.env.EXTERNAL_OAUTH_CLIENT_SECRET

    assert.throws(() => loadConfig(), /EXTERNAL_OAUTH_CLIENT_SECRET is required/)
  })

  it('rejects a malformed OAuth token URL by name', () => {
    hostedEndpoints()
    oauthCredentials()
    process.env.EXTERNAL_OAUTH_TOKEN_URL = 'auth.example/oauth/token'

    assert.throws(() => loadConfig(), /EXTERNAL_OAUTH_TOKEN_URL must be an absolute URL/)
  })

  it('refuses to let a localhost default stand in for a hosted endpoint', () => {
    // Scenario: silently defaulting a hosted deployment's Splice URLs to LocalNet
    // produces a service that starts and then fails every call.
    oauthCredentials()

    assert.throws(() => loadConfig(), /CANTON_JSON_API_URL is required/)
  })

  it('fills hosted endpoints and OAuth defaults from a named preset', () => {
    // Scenario: EXTERNAL_PRESET selects a known validator so only the secret has
    // to be supplied. The secret itself is never presettable.
    process.env.EXTERNAL_PRESET = 'fivenorth'
    process.env.EXTERNAL_OAUTH_CLIENT_SECRET = 'client-secret'
    process.env.SPLICE_SCAN_API_URL = 'https://scan.example/api/scan'

    const config = loadConfig()

    assert.equal(config.canton.tokenSource, 'oauth')
    assert.equal(config.canton.oauth?.clientId, 'validator-devnet-m2m')
    assert.equal(
      config.canton.jsonApiUrl,
      'https://ledger-api.validator.devnet.sandbox.fivenorth.io',
    )
  })

  it('rejects an unknown preset by name', () => {
    process.env.EXTERNAL_PRESET = 'nowhere'

    assert.throws(() => loadConfig(), /EXTERNAL_PRESET must be one of: fivenorth/)
  })
})
