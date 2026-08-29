import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { CantonCredentials } from '../src/config.ts'
import { createStaticTokenProvider, createTokenProvider } from '../src/tokenProvider.ts'

// Typed as the real union, so a credential shape config can no longer produce also
// stops compiling here rather than living on as a test for an impossible state.
const cfg = (canton: CantonCredentials) =>
  ({
    port: 3010,
    corsOrigins: ['http://localhost:3011'],
    network: 'canton:test',
    provider: { id: 'wallet-service', version: '0.1.0' },
    canton: { jsonApiUrl: '', ledgerApiUrl: '', adminApiUrl: '', ...canton },
    splice: { validatorUrl: '', scanApiUrl: '', registryApiUrl: '' },
  }) as never

describe('createTokenProvider', () => {
  it('returns a static provider for the static token source', async () => {
    const provider = createTokenProvider(cfg({ tokenSource: 'static', backendToken: 'local-jwt' }))
    assert.equal(await provider.getToken(), 'local-jwt')
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
    assert.equal(await provider.getToken(), 'oauth-jwt')
  })

  it('createStaticTokenProvider always returns the given token', async () => {
    assert.equal(await createStaticTokenProvider('t').getToken(), 't')
  })
})
