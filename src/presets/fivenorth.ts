import type { CantonEndpoints, SpliceEndpoints } from '../config.ts'
import type { OAuthConfig } from '../oauthToken.ts'

// Field names come from the config they fill, so renaming an endpoint there fails to
// compile here rather than leaving every preset silently stale.
export interface NetworkPreset {
  canton: Pick<CantonEndpoints, 'jsonApiUrl'> & Partial<CantonEndpoints>
  splice: Pick<SpliceEndpoints, 'validatorUrl' | 'registryApiUrl'> & Partial<SpliceEndpoints>
  oauth: Pick<OAuthConfig, 'tokenUrl' | 'clientId' | 'scope'>
}

// The only place the FiveNorth vendor lives: delete this file + its one entry in
// config.ts's PRESETS to remove it.
export const FIVENORTH_PRESET: NetworkPreset = {
  canton: {
    jsonApiUrl: 'https://ledger-api.validator.devnet.sandbox.fivenorth.io',
    ledgerApiUrl: 'https://ledger-api.validator.devnet.sandbox.fivenorth.io',
    adminApiUrl: '',
  },
  splice: {
    validatorUrl: 'https://wallet.validator.devnet.sandbox.fivenorth.io/api/validator',
    registryApiUrl:
      'https://wallet.validator.devnet.sandbox.fivenorth.io/api/validator/v0/scan-proxy',
    // No published scan host, so SPLICE_SCAN_API_URL still has to be supplied alongside.
  },
  oauth: {
    tokenUrl: 'https://auth.sandbox.fivenorth.io/application/o/token/',
    clientId: 'validator-devnet-m2m',
    scope: 'daml_ledger_api',
  },
}
