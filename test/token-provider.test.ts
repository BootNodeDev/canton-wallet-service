import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { createStaticTokenProvider, createTokenProvider } from '../src/tokenProvider.ts'

const cfg = (canton: Record<string, unknown>) =>
  ({
    port: 3010,
    corsOrigins: ['http://localhost:3011'],
    network: 'canton:test',
    provider: { id: 'wallet-service', version: '0.1.0' },
    canton,
    splice: { validatorUrl: '', scanApiUrl: '', registryApiUrl: '' },
  }) as never

describe('createTokenProvider', () => {
  it('returns a static provider for the static token source', async () => {
    const provider = createTokenProvider(cfg({ tokenSource: 'static', backendToken: 'local-jwt' }))
    assert.notEqual(provider, undefined)
    assert.equal(await provider?.getToken(), 'local-jwt')
  })

  it('returns undefined for the none token source', () => {
    assert.equal(createTokenProvider(cfg({ tokenSource: 'none' })), undefined)
  })

  it('returns an OAuth provider for the oauth token source', async () => {
    const provider = createTokenProvider(
      cfg({
        tokenSource: 'oauth',
        oauth: {
          tokenUrl: 'https://auth.example/token',
          clientId: 'cid',
          clientSecret: 'secret',
          scope: 'daml_ledger_api',
          refreshSkewMs: 60_000,
        },
      }),
      {
        fetch: async () =>
          new Response(JSON.stringify({ access_token: 'oauth-jwt', expires_in: 120 }), {
            status: 200,
          }),
      },
    )
    assert.equal(await provider?.getToken(), 'oauth-jwt')
  })

  it('refuses a static source with no token rather than issuing an empty bearer', () => {
    assert.throws(
      () => createTokenProvider(cfg({ tokenSource: 'static' })),
      /requires CANTON_BACKEND_TOKEN/,
    )
  })

  it('refuses an oauth source with no OAuth config', () => {
    assert.throws(
      () => createTokenProvider(cfg({ tokenSource: 'oauth' })),
      /requires EXTERNAL_OAUTH_\* configuration/,
    )
  })

  it('createStaticTokenProvider always returns the given token', async () => {
    assert.equal(await createStaticTokenProvider('t').getToken(), 't')
  })
})
