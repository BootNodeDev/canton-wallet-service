import type { OAuthConfig } from '../oauthToken.ts'

// The only place the FiveNorth vendor lives: delete this file + its one entry in
// config.ts's PRESETS to remove it.
export interface NetworkPreset {
  canton: { jsonApiUrl: string; ledgerApiUrl?: string; adminApiUrl?: string }
  splice: { validatorUrl: string; registryApiUrl: string; scanApiUrl?: string }
  oauth: Pick<OAuthConfig, 'tokenUrl' | 'clientId' | 'scope'>
}

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
  },
  oauth: {
    tokenUrl: 'https://auth.sandbox.fivenorth.io/application/o/token/',
    clientId: 'validator-devnet-m2m',
    scope: 'daml_ledger_api',
  },
}
