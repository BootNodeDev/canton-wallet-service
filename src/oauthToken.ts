export interface OAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope: string
  audience?: string
  refreshSkewMs: number
}

export interface CantonTokenProvider {
  getToken: () => Promise<string>
}

type OAuthTokenProviderDeps = {
  fetch?: typeof fetch
  now?: () => number
}

type OAuthTokenResponse = {
  access_token?: string
  expires_in?: number
}

// What readTokenResponse has proved is present, so callers need no non-null assertions.
type ValidatedToken = { accessToken: string; expiresInMs: number }

// Converts the client credentials into the exact form body required by the OAuth provider.
const tokenRequestBody = (config: OAuthConfig): URLSearchParams => {
  const body = new URLSearchParams()
  body.set('grant_type', 'client_credentials')
  body.set('client_id', config.clientId)
  body.set('client_secret', config.clientSecret)
  body.set('scope', config.scope)
  // Omitted unless configured: providers that gate on `aud` need it, and the ones
  // that do not reject an empty value.
  if (config.audience !== undefined) {
    body.set('audience', config.audience)
  }
  return body
}

// Parses the OAuth response and rejects malformed credentials before the SDK sees them.
// The provider's own body stays in the log: this runs inside the credential boundary,
// and its caller returns errors to the dApp.
const readTokenResponse = async (response: Response): Promise<ValidatedToken> => {
  const text = await response.text()
  if (!response.ok) {
    console.error('[wallet-service] OAuth token request rejected', response.status, text)
    throw new Error(`OAuth token request failed with HTTP ${response.status}`)
  }
  let parsed: OAuthTokenResponse
  try {
    parsed = JSON.parse(text) as OAuthTokenResponse
  } catch {
    // A token URL pointed at a discovery document or an HTML error page lands here.
    console.error('[wallet-service] OAuth token response was not JSON', text.slice(0, 200))
    throw new Error('OAuth token response was not JSON')
  }
  if (typeof parsed.access_token !== 'string' || parsed.access_token.trim() === '') {
    throw new Error('OAuth token response did not include access_token')
  }
  if (typeof parsed.expires_in !== 'number' || parsed.expires_in <= 0) {
    throw new Error('OAuth token response did not include a positive expires_in')
  }
  return { accessToken: parsed.access_token, expiresInMs: parsed.expires_in * 1000 }
}

// Fetches and caches OAuth access tokens so wallet-service never depends on a pasted JWT.
export const createOAuthTokenProvider = (
  config: OAuthConfig,
  deps: OAuthTokenProviderDeps = {},
): CantonTokenProvider => {
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? (() => Date.now())
  // Bound once: every input is fixed at construction, so the body is byte-identical on
  // every refresh. It also keeps the returned provider — a process-lifetime object —
  // from holding `config`, and with it clientSecret, reachable for the whole run.
  const { tokenUrl, refreshSkewMs } = config
  const requestBody = tokenRequestBody(config).toString()
  let cached: { token: string; refreshAt: number } | undefined
  let inFlight: Promise<string> | undefined

  const fetchToken = async (): Promise<string> => {
    const requestedAt = now()
    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: requestBody,
    })
    const { accessToken, expiresInMs } = await readTokenResponse(response)
    // Never skew past half the lifetime: a token shorter than the skew would otherwise
    // refresh on every call, and each new JWT rebuilds the SDKs that captured the old one.
    const skew = Math.min(refreshSkewMs, expiresInMs / 2)
    cached = { token: accessToken, refreshAt: requestedAt + expiresInMs - skew }
    return accessToken
  }

  return {
    getToken: async () => {
      if (cached !== undefined && now() < cached.refreshAt) {
        return cached.token
      }
      // A burst arriving on an expired token must make one request, not one per caller.
      inFlight ??= fetchToken().finally(() => {
        inFlight = undefined
      })
      return await inFlight
    },
  }
}
