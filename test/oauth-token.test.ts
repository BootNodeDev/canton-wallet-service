import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { createOAuthTokenProvider } from '../src/oauthToken.ts'

const config = {
  tokenUrl: 'https://auth.example/oauth/token',
  clientId: 'validator-devnet-m2m',
  clientSecret: 'client-secret',
  scope: 'daml_ledger_api',
  refreshSkewMs: 60_000,
}

describe('createOAuthTokenProvider', () => {
  it('caches the OAuth access token until the refresh window', async () => {
    // Scenario: wallet-service should not boot with an eight-hour static token.
    // It requests an OAuth token from the hosted validator's provider, reuses it
    // while valid, and asks for a new one before the previous credential expires.
    const requests: Array<{ url: string; body: string }> = []
    const tokens = ['token-1', 'token-2']
    let currentTime = 1_000_000
    const provider = createOAuthTokenProvider(config, {
      now: () => currentTime,
      fetch: async (url, init) => {
        // The auth request must use client_credentials form encoding because
        // that is the machine-to-machine token contract.
        requests.push({ url: String(url), body: String(init?.body) })
        return new Response(
          JSON.stringify({
            access_token: tokens.shift(),
            token_type: 'Bearer',
            expires_in: 120,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    // First call fetches a token and sends every OAuth field the provider requires.
    assert.equal(await provider.getToken(), 'token-1')
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, 'https://auth.example/oauth/token')
    assert.equal(
      requests[0]?.body,
      'grant_type=client_credentials&client_id=validator-devnet-m2m&client_secret=client-secret&scope=daml_ledger_api',
    )

    // Still before the refresh window, the provider must reuse the cached token.
    currentTime += 30_000
    assert.equal(await provider.getToken(), 'token-1')
    assert.equal(requests.length, 1)

    // Inside the refresh window, the provider asks for a replacement.
    currentTime += 31_000
    assert.equal(await provider.getToken(), 'token-2')
    assert.equal(requests.length, 2)
  })

  it('reports the HTTP failure body when the token request is rejected', async () => {
    // Scenario: wrong client credentials must surface as an auth failure, not as
    // an opaque Canton error on the first ledger call.
    const provider = createOAuthTokenProvider(config, {
      fetch: async () => new Response('{"error":"invalid_client"}', { status: 401 }),
    })

    await assert.rejects(provider.getToken(), /OAuth token request failed with HTTP 401/)
  })

  it('rejects a response without an access_token', async () => {
    const provider = createOAuthTokenProvider(config, {
      fetch: async () => new Response(JSON.stringify({ expires_in: 120 }), { status: 200 }),
    })

    await assert.rejects(provider.getToken(), /did not include access_token/)
  })

  it('rejects a response without a positive expires_in', async () => {
    // Scenario: without a lifetime the provider cannot know when to refresh, so a
    // token that would silently expire mid-session is refused up front.
    const provider = createOAuthTokenProvider(config, {
      fetch: async () =>
        new Response(JSON.stringify({ access_token: 'jwt', expires_in: 0 }), { status: 200 }),
    })

    await assert.rejects(provider.getToken(), /did not include a positive expires_in/)
  })
})
