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

  it('reports an HTTP failure without putting the provider body in the error', async () => {
    // Scenario: wrong client credentials must surface as an auth failure, not as an
    // opaque Canton error. The provider's body stays in the log, because this error
    // travels out to the dApp as a -32000 and the credential boundary is ours.
    const provider = createOAuthTokenProvider(config, {
      fetch: async () =>
        new Response('{"error":"invalid_client","hint":"secret rotated"}', { status: 401 }),
    })

    await assert.rejects(provider.getToken(), (error: Error) => {
      assert.match(error.message, /OAuth token request failed with HTTP 401/)
      assert.doesNotMatch(error.message, /invalid_client|secret rotated/)
      return true
    })
  })

  it('names a non-JSON response instead of throwing a raw SyntaxError', async () => {
    // Scenario: a token URL pointed at a discovery document or an HTML error page.
    const provider = createOAuthTokenProvider(config, {
      fetch: async () => new Response('<!DOCTYPE html><html></html>', { status: 200 }),
    })

    await assert.rejects(provider.getToken(), /OAuth token response was not JSON/)
  })

  it('never skews refresh past half the token lifetime', async () => {
    // Scenario: a 60s token against a 60s skew would refresh on every single call,
    // and each new JWT tears down and rebuilds every SDK that captured the old one.
    let calls = 0
    let currentTime = 1_000_000
    const provider = createOAuthTokenProvider(config, {
      now: () => currentTime,
      fetch: async () => {
        calls += 1
        return new Response(JSON.stringify({ access_token: `t-${calls}`, expires_in: 60 }), {
          status: 200,
        })
      },
    })

    assert.equal(await provider.getToken(), 't-1')
    // Half of 60s is the furthest the skew may pull the refresh forward.
    currentTime += 29_000
    assert.equal(await provider.getToken(), 't-1')
    assert.equal(calls, 1)

    currentTime += 2_000
    assert.equal(await provider.getToken(), 't-2')
    assert.equal(calls, 2)
  })

  it('makes one token request for a burst of concurrent callers', async () => {
    // Scenario: getSdk, getTokenSdk, ledgerApi and the Scan summary all ask at once
    // when the cache expires; a rate-limited provider 429s the extras.
    let calls = 0
    const provider = createOAuthTokenProvider(config, {
      fetch: async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return new Response(JSON.stringify({ access_token: 'shared', expires_in: 3600 }), {
          status: 200,
        })
      },
    })

    const tokens = await Promise.all(Array.from({ length: 8 }, () => provider.getToken()))

    assert.deepEqual(
      tokens,
      Array.from({ length: 8 }, () => 'shared'),
    )
    assert.equal(calls, 1)
  })

  it('sends an audience only when the config carries one', async () => {
    const bodies: string[] = []
    const capture = {
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body))
        return new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), {
          status: 200,
        })
      },
    }

    await createOAuthTokenProvider(config, capture).getToken()
    assert.doesNotMatch(bodies[0] ?? '', /audience/)

    await createOAuthTokenProvider(
      { ...config, audience: 'https://aud.example' },
      capture,
    ).getToken()
    assert.match(bodies[1] ?? '', /audience=https%3A%2F%2Faud.example/)
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
