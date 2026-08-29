import type { WalletServiceConfig } from './config.ts'
import { type CantonTokenProvider, createOAuthTokenProvider } from './oauthToken.ts'

// LocalNet: a pasted JWT wrapped as a provider so consumers stay uniform with refreshing tokens.
export const createStaticTokenProvider = (token: string): CantonTokenProvider => ({
  getToken: async () => token,
})

// The single seam every consumer uses. Total, because config's credentials are a union:
// there is no "configured but credential-less" state for a caller to re-check.
export const createTokenProvider = (
  config: WalletServiceConfig,
  deps: { fetch?: typeof fetch } = {},
): CantonTokenProvider =>
  config.canton.tokenSource === 'static'
    ? createStaticTokenProvider(config.canton.backendToken)
    : createOAuthTokenProvider(config.canton.oauth, deps)
