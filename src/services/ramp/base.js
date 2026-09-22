// Copyright 2026 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { getProtocol, loadProtocolClass, resolveProtocolConfig } from '../protocol-service.js'
import { getTokenSlug, getTokenByName, getTokensSupportedBy } from '../token-service.js'
import { WdkCliError, ErrorCode } from '../../errors/index.js'

/** @typedef {import('./types.js').Direction} Direction */
/** @typedef {import('./types.js').FiatProtocol} FiatProtocol */
/** @typedef {import('./types.js').QuoteResult} QuoteResult */
/** @typedef {import('./types.js').RampInput} RampInput */
/** @typedef {import('./types.js').ResolvedAssets} ResolvedAssets */
/** @typedef {import('./types.js').UrlResult} UrlResult */
/** @typedef {import('./types.js').RampProvider} RampProvider */
/** @typedef {import('./types.js').SupportedAsset} SupportedAsset */
/**
 * A fiat protocol's default-exported class, constructed with no account and a
 * provider-shaped config.
 *
 * @typedef {new (account: undefined, config: Record<string, unknown>) => FiatProtocol} FiatProtocolConstructor
 */

/**
 * The behaviour every ramp provider shares: constructing its module, resolving
 * a token through `metadata.slugs`, and driving the SDK's quote and URL calls.
 *
 * @implements {RampProvider}
 */
export class BaseRampProvider {
  /**
   * @param {string} name - The provider short name, as the registry lists it.
   */
  constructor (name) {
    /** @type {string} */
    this.name = name
    /** @type {FiatProtocol | undefined} */
    this._protocol = undefined
  }

  /**
   * Shapes the config the module is constructed with, passing the registry's
   * merged config through untouched by default.
   *
   * @protected
   * @param {Record<string, unknown>} config - The provider's merged registry config.
   * @returns {Record<string, unknown>} The config to construct the module with.
   */
  _moduleConfig (config) {
    return config
  }

  /**
   * Returns the module instance, constructing it on first use.
   *
   * @protected
   * @param {string} network - The network name, for per-network config.
   * @returns {Promise<FiatProtocol>} The constructed protocol.
   * @throws {WdkCliError} UNSUPPORTED_MODULE when the module is not registered.
   * @throws {WdkCliError} UNSUPPORTED_MODULE when the module is not installed.
   */
  async _getProtocol (network) {
    if (!this._protocol) {
      const ProtocolClass = /** @type {FiatProtocolConstructor} */ (
        /** @type {unknown} */ (await loadProtocolClass(getProtocol(this.name).module))
      )
      this._protocol = new ProtocolClass(
        undefined,
        this._moduleConfig(resolveProtocolConfig(this.name, network))
      )
    }
    return this._protocol
  }

  /**
   * Returns the provider's merged config for a network.
   *
   * @protected
   * @param {string} network - The network name.
   * @returns {Record<string, unknown>} The merged config.
   */
  _config (network) {
    return resolveProtocolConfig(this.name, network)
  }

  /**
   * Returns the provider's identifier for a token, with any extra fields its
   * API takes alongside it. An unmapped token is an error, never a guess.
   *
   * @protected
   * @param {string} network - The network name.
   * @param {string} token - The CLI token name.
   * @returns {{ code: string, extras: Record<string, unknown> }} The identifier and its call extras.
   * @throws {WdkCliError} TOKEN_NOT_SUPPORTED when the token is not registered.
   * @throws {WdkCliError} TOKEN_NOT_SUPPORTED when the token has no mapping for this provider.
   */
  _slug (network, token) {
    const lower = token.toLowerCase()
    const mapping = getTokenSlug(network, lower, this.name)

    if (mapping === undefined) {
      if (!getTokenByName(network, lower)) {
        throw new WdkCliError(
          `Unknown token '${token}' on '${network}'.`,
          ErrorCode.TOKEN_NOT_SUPPORTED,
          `See registered tokens with: wdk token list --network ${network}`
        )
      }
      const supported = getTokensSupportedBy(network, this.name)
      const add = `Add one with: wdk config set --key overrides.tokens."${network}/${lower}".metadata.slugs.${this.name} --value '<code>'`
      throw new WdkCliError(
        `Token '${lower}' on '${network}' has no ${this.name} mapping.`,
        ErrorCode.TOKEN_NOT_SUPPORTED,
        supported.length > 0
          ? `${add}\nTokens ${this.name} already supports on ${network}: ${supported.join(', ')}`
          : add
      )
    }

    if (typeof mapping === 'string') return { code: mapping, extras: {} }
    const { slug, ...extras } = mapping
    return { code: slug, extras }
  }

  /**
   * No environment rule by default.
   *
   * @param {string} _network - The network name.
   * @returns {Promise<void>}
   */
  async validateEnvironment (_network) {}

  /**
   * Picks the listing row the module itself will use for a token. A provider
   * that names assets by a (code, network) pair lists the same code once per
   * network with its own decimals, so the code alone is not enough.
   *
   * @protected
   * @param {SupportedAsset[]} assets - The provider's crypto listing.
   * @param {string} code - The provider's identifier for the token.
   * @param {Record<string, unknown>} extras - The mapping's extra fields, which may carry `network`.
   * @param {string} network - The CLI network name, for error messages.
   * @param {string} token - The CLI token name, for error messages.
   * @returns {SupportedAsset} The matching row.
   * @throws {WdkCliError} TOKEN_NOT_SUPPORTED when the provider does not list the code.
   * @throws {WdkCliError} TOKEN_NOT_SUPPORTED when the code is ambiguous and the mapping names no network.
   */
  _pickAsset (assets, code, extras, network, token) {
    const candidates = assets.filter((a) => a.code === code)
    const fix = `Check it with: wdk token info --network ${network} --token ${token}`

    if (candidates.length === 0) {
      throw new WdkCliError(
        `Asset '${code}' is not supported by ${this.name}.`,
        ErrorCode.TOKEN_NOT_SUPPORTED,
        `The token's ${this.name} slug may be wrong. ${fix}`
      )
    }
    if (candidates.length === 1) return candidates[0]

    const wanted = extras.network
    if (typeof wanted !== 'string' || !wanted) {
      throw new WdkCliError(
        `${this.name} lists '${code}' on ${candidates.length} networks, so the mapping must name one.`,
        ErrorCode.TOKEN_NOT_SUPPORTED,
        `Set it with: wdk config set --key overrides.tokens."${network}/${token}".metadata.slugs.${this.name} ` +
          `--value '{"slug":"${code}","network":"<one of: ${candidates.map((c) => c.networkCode).join(', ')}>"}'`
      )
    }
    const picked = candidates.find((a) => a.networkCode === wanted)
    if (!picked) {
      throw new WdkCliError(
        `${this.name} does not list '${code}' on network '${wanted}'.`,
        ErrorCode.TOKEN_NOT_SUPPORTED,
        `It lists it on: ${candidates.map((c) => c.networkCode).join(', ')}. ${fix}`
      )
    }
    return picked
  }

  /**
   * Resolves the provider's asset code and the decimals of both sides from its
   * own listings. Currency codes are matched case-insensitively.
   *
   * @param {string} network - The network name.
   * @param {string} token - The CLI token name.
   * @param {string} fiatCurrency - The fiat currency code.
   * @returns {Promise<ResolvedAssets>} The resolved codes and decimals.
   * @throws {WdkCliError} TOKEN_NOT_SUPPORTED when the provider does not carry the asset.
   * @throws {WdkCliError} INVALID_ARGUMENT when the provider does not carry the currency.
   */
  async resolveAssets (network, token, fiatCurrency) {
    const protocol = await this._getProtocol(network)
    const { code, extras } = this._slug(network, token)
    const [cryptos, fiats] = await Promise.all([
      protocol.getSupportedCryptoAssets(),
      protocol.getSupportedFiatCurrencies()
    ])

    const crypto = this._pickAsset(cryptos, code, extras, network, token)
    const wanted = fiatCurrency.toLowerCase()
    const fiat = fiats.find((f) => f.code.toLowerCase() === wanted)
    if (!fiat) {
      throw new WdkCliError(
        `Fiat currency '${fiatCurrency}' is not supported by ${this.name}.`,
        ErrorCode.INVALID_ARGUMENT,
        `Currencies ${this.name} supports: ${fiats.map((f) => f.code).sort().join(', ')}`
      )
    }
    return { cryptoCode: code, cryptoDecimals: crypto.decimals, fiatDecimals: fiat.decimals }
  }

  /**
   * Builds the options common to every quote and URL call.
   *
   * @protected
   * @param {RampInput} input - The ramp input.
   * @returns {Promise<Record<string, unknown>>} The shared call options.
   */
  async _common (input) {
    const protocol = await this._getProtocol(input.network)
    const { code, extras } = this._slug(input.network, input.token)
    const fiats = await protocol.getSupportedFiatCurrencies()
    const wanted = input.fiatCurrency.toLowerCase()
    const fiatCode = fiats.find((f) => f.code.toLowerCase() === wanted)?.code ?? input.fiatCurrency

    const amount = input.fiatAmount !== undefined
      ? { fiatAmount: input.fiatAmount }
      : { cryptoAmount: input.cryptoAmount }

    return {
      cryptoAsset: code,
      fiatCurrency: fiatCode,
      ...amount,
      ...(Object.keys(extras).length > 0 && { config: extras })
    }
  }

  /**
   * Asks the provider for a quote, treating failure as "no quote available".
   *
   * @param {RampInput} input - The ramp input.
   * @param {Direction} direction - The ramp direction.
   * @returns {Promise<QuoteResult | undefined>} The quote, or undefined.
   */
  async quote (input, direction) {
    const protocol = await this._getProtocol(input.network)
    const options = await this._common(input)
    try {
      return direction === 'buy'
        ? await protocol.quoteBuy(options)
        : await protocol.quoteSell(options)
    } catch {
      return undefined
    }
  }

  /**
   * Builds the hosted widget URL for the requested direction.
   *
   * @param {RampInput} input - The ramp input.
   * @param {Direction} direction - The ramp direction.
   * @returns {Promise<UrlResult>} The widget URL.
   */
  async buildUrl (input, direction) {
    const protocol = await this._getProtocol(input.network)
    const options = await this._common(input)
    if (direction === 'buy') {
      const { buyUrl } = await protocol.buy({ ...options, recipient: input.walletAddress })
      return { url: buyUrl }
    }
    const { sellUrl } = await protocol.sell({ ...options, refundAddress: input.walletAddress })
    return { url: sellUrl }
  }
}

/**
 * POSTs to a configured endpoint and returns the string it answers with, for
 * config keys a module takes as a callback rather than a value.
 *
 * A string payload is sent as `{ urlForSignature }`, an object payload as the
 * body. The answer may be a bare string, or carry `signedUrl`, `url` or
 * `widgetUrl`.
 *
 * @param {string} endpoint - The URL to POST to.
 * @param {unknown} payload - The value the module passed to the callback.
 * @returns {Promise<string>} The endpoint's answer.
 * @throws {WdkCliError} SIGN_FAILED when the endpoint is unreachable.
 * @throws {WdkCliError} SIGN_FAILED when it answers with a non-OK status.
 * @throws {WdkCliError} SIGN_FAILED when it answers with no usable string.
 */
export async function postToEndpoint (endpoint, payload) {
  const body = typeof payload === 'string' ? { urlForSignature: payload } : payload
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new WdkCliError(
      `Cannot reach endpoint '${endpoint}': ${detail}`,
      ErrorCode.SIGN_FAILED,
      'Check the configured URL and that the server is reachable.'
    )
  }
  if (!response.ok) {
    throw new WdkCliError(
      `Endpoint '${endpoint}' failed: ${response.status} ${response.statusText}`,
      ErrorCode.SIGN_FAILED
    )
  }
  const data = await response.json()
  const answer = typeof data === 'string' ? data : data?.signedUrl ?? data?.url ?? data?.widgetUrl
  if (typeof answer !== 'string' || !answer) {
    throw new WdkCliError(
      `Endpoint '${endpoint}' returned no string answer.`,
      ErrorCode.SIGN_FAILED,
      'It must answer with a string, or an object carrying signedUrl, url, or widgetUrl.'
    )
  }
  return answer
}

/**
 * Throws when a provider's configured environment disagrees with the network.
 *
 * @param {string} provider - The provider short name.
 * @param {string} network - The network name.
 * @param {unknown} configured - The configured environment value.
 * @param {string} testnetValue - The environment value meaning testnet.
 * @param {boolean} networkIsTestnet - Whether the network is a testnet.
 * @returns {void}
 * @throws {WdkCliError} ENVIRONMENT_MISMATCH when the two disagree.
 */
export function assertEnvironment (provider, network, configured, testnetValue, networkIsTestnet) {
  if (typeof configured !== 'string' || !configured) return
  if ((configured === testnetValue) === networkIsTestnet) return
  throw new WdkCliError(
    `Cannot use ${provider} environment '${configured}' with ${networkIsTestnet ? 'testnet' : 'mainnet'} '${network}'.`,
    ErrorCode.ENVIRONMENT_MISMATCH,
    `Set it with: wdk config set --key providers.${provider}.config.environment --value <value>`
  )
}
