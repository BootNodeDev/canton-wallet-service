import type { WalletServiceConfig } from './config.ts'
import { type CantonTokenProvider, createOAuthTokenProvider } from './oauthToken.ts'

// LocalNet: a pasted JWT wrapped as a provider so consumers stay uniform with refreshing tokens.
export const createStaticTokenProvider = (token: string): CantonTokenProvider => ({
  getToken: async () => token,
})

// Single seam every consumer uses; the token source already chose the strategy in config.
export const createTokenProvider = (
  config: WalletServiceConfig,
  deps: { fetch?: typeof fetch } = {},
): CantonTokenProvider | undefined => {
  const { tokenSource } = config.canton
  if (tokenSource === 'static') {
    if (config.canton.backendToken === undefined) {
      throw new Error('static token source requires CANTON_BACKEND_TOKEN')
    }
    return createStaticTokenProvider(config.canton.backendToken)
  }
  if (tokenSource === 'oauth') {
    if (config.canton.oauth === undefined) {
      throw new Error('oauth token source requires EXTERNAL_OAUTH_* configuration')
    }
    return createOAuthTokenProvider(config.canton.oauth, { fetch: deps.fetch ?? fetch })
  }
  return undefined
}
