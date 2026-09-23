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

import { configService } from './config-service.js'
import { WdkCliError, ErrorCode } from '../errors/index.js'
import { walletsFile } from '../config/wdk-config.js'
import { getAllTokens, getTokenByName, tokenSlugValue, getTokensSupportedBy } from './token-service.js'
import { getOwn } from './override-service.js'
import { resolveProtocolConfig, getProtocols, getAllProtocols } from './protocol-service.js'

/**
 * The system key the indexer's token codes are registered under in
 * `metadata.slugs`. Independent of the provider's name: the code is the token
 * segment of the indexer URL, not a vendor's vocabulary.
 */
const INDEXER_SLUG_KEY = 'indexer'

/** The kind an indexer provider declares in the registry. */
const INDEXER_KIND = 'indexer'

/**
 * Returns the name of the enabled indexer provider.
 *
 * @returns {string} The provider short name.
 * @throws {WdkCliError} MISSING_CONFIG when no indexer provider is enabled.
 * @throws {WdkCliError} INVALID_ARGUMENT when several are enabled at once.
 */
function indexerProvider () {
  const usable = Object.entries(getProtocols())
    .filter(([, entry]) => entry.kind === INDEXER_KIND)
    .map(([name]) => name)
  if (usable.length === 0) {
    const known = Object.entries(getAllProtocols())
      .filter(([, entry]) => entry.kind === INDEXER_KIND)
      .map(([name]) => name)
    throw new WdkCliError(
      'No indexer is available.',
      ErrorCode.MISSING_CONFIG,
      known.length > 0
        ? `Enable one with: wdk provider enable --name ${known[0]}`
        : 'See the registered providers with: wdk provider list'
    )
  }
  if (usable.length > 1) {
    throw new WdkCliError(
      `Several indexers are enabled: ${usable.join(', ')}.`,
      ErrorCode.INVALID_ARGUMENT,
      `Leave one enabled with: wdk provider disable --name ${usable[1]}`
    )
  }
  return usable[0]
}

/**
 * Checks that exactly one indexer provider is enabled, so a caller can fail
 * before doing expensive work such as unlocking a wallet or deriving an address.
 *
 * @returns {void}
 * @throws {WdkCliError} MISSING_CONFIG when no indexer provider is enabled.
 * @throws {WdkCliError} INVALID_ARGUMENT when several are enabled at once.
 */
export function assertIndexerAvailable () {
  indexerProvider()
}

/**
 * @typedef {Object} IndexerEndpoint
 * @property {string} baseUrl - The indexer API's base URL, without a trailing slash.
 * @property {string | undefined} apiKey - The key sent as `x-api-key`, or undefined
 *   when the base URL is a proxy that supplies its own.
 */

/**
 * Returns the indexer's base URL and API key from its registry entry, merged
 * with the user's `providers.wdk-indexer.config` deltas.
 *
 * @returns {IndexerEndpoint} The endpoint settings.
 * @throws {WdkCliError} MISSING_CONFIG when no indexer provider is enabled.
 * @throws {WdkCliError} INVALID_ARGUMENT when several are enabled at once.
 * @throws {WdkCliError} MISSING_CONFIG when the base URL is unset.
 */
function endpoint () {
  const config = resolveProtocolConfig(indexerProvider())
  const baseUrl = /** @type {string | undefined} */ (config.baseUrl)
  if (!baseUrl) {
    throw new WdkCliError(
      'Indexer base URL not configured.',
      ErrorCode.MISSING_CONFIG,
      'Set it with: wdk config set --key providers.wdk-indexer.config.baseUrl --value <url>'
    )
  }
  return { baseUrl, apiKey: /** @type {string | undefined} */ (config.apiKey) }
}

/**
 * @typedef {Object} TokenTransfer
 * @property {string} blockchain - The blockchain identifier.
 * @property {number} blockNumber - The block number of the transfer.
 * @property {string} transactionHash - The transaction hash.
 * @property {number} transferIndex - The index of the transfer within the transaction.
 * @property {string} token - The token symbol.
 * @property {string} amount - The transfer amount as a string.
 * @property {number} timestamp - The Unix timestamp of the transfer.
 * @property {number} transactionIndex - The transaction index within the block.
 * @property {number} logIndex - The log index within the transaction.
 * @property {string} from - The sender address.
 * @property {string} to - The recipient address.
 * @property {string} [label] - An optional human-readable label.
 */

/**
 * @typedef {Object} TokenTransferOptions
 * @property {number} [limit] - Maximum number of transfers to return.
 * @property {number} [fromTs] - Start timestamp filter (Unix seconds).
 * @property {number} [toTs] - End timestamp filter (Unix seconds).
 */

/**
 * @typedef {Object} BatchTransferRequestItem
 * @property {string} blockchain - The blockchain identifier.
 * @property {string} token - The token symbol to query.
 * @property {string} address - The wallet address to query.
 * @property {number} [limit] - Maximum number of transfers to return.
 * @property {number} [fromTs] - Start timestamp filter (Unix seconds).
 * @property {number} [toTs] - End timestamp filter (Unix seconds).
 */

/**
 * @typedef {{ transfers: TokenTransfer[] } | { error: string, message: string, status: number }} BatchTransferResultItem
 */

/** @type {Record<string, string>} */
const BUILTIN_INDEXER_SLUGS = {}
for (const [name, entry] of Object.entries(walletsFile.networks)) {
  if (entry.indexerSlug) BUILTIN_INDEXER_SLUGS[name] = entry.indexerSlug
}

/**
 * The universe of indexer token codes known to any registered token.
 * Derived from each token's indexer slug across the whole token registry.
 *
 * @type {readonly string[]}
 */
export const INDEXER_TOKENS = [
  ...new Set(
    Object.values(getAllTokens()).flatMap((tokens) =>
      Object.values(tokens)
        .map((t) => tokenSlugValue(t, INDEXER_SLUG_KEY))
        .filter((c) => typeof c === 'string' && c.length > 0)
    )
  )
]

/**
 * Returns the indexer chain slug for a network, or `undefined` when the network
 * has no `indexerSlug` configured. Absence is the authoritative signal that the
 * indexer is not available for the network — callers should check via
 * `isIndexerSupported` (or this function's return value) before constructing
 * indexer URLs.
 *
 * Built-ins set `indexerSlug` in `wdk.config.json`; custom networks set it via
 * `customNetworks.<name>.indexerSlug`.
 *
 * @param {string} network - The network name.
 * @returns {string | undefined} The chain slug, or undefined if not configured.
 */
export function getIndexerSlug (network) {
  return getOwn(BUILTIN_INDEXER_SLUGS, network) ?? /** @type {string | undefined} */ (
    configService.get(`customNetworks.${network}.indexerSlug`)
  )
}

/**
 * Returns the indexer codes supported for a network, collected from the token
 * registry's indexer slug on each entry.
 *
 * @param {string} network - The network name.
 * @returns {string[]} Array of indexer token codes (e.g. ["usdt", "btc"]).
 */
export function getIndexerTokens (network) {
  const codes = new Set()
  for (const token of getTokensSupportedBy(network, INDEXER_SLUG_KEY)) {
    const code = tokenSlugValue(getTokenByName(network, token), INDEXER_SLUG_KEY)
    if (code) codes.add(code)
  }
  return [...codes]
}

/**
 * Returns whether the indexer API is supported for a network. A network is
 * supported when it has an `indexerSlug` configured (either as a built-in
 * field in `wdk.config.json` or under `customNetworks.<name>.indexerSlug`).
 *
 * @param {string} network - The network name.
 * @returns {boolean} True if the network has an `indexerSlug` configured.
 */
export function isIndexerSupported (network) {
  return getIndexerSlug(network) !== undefined
}

/**
 * Fetches token transfer history for a single address from the indexer API.
 *
 * @param {string} network - The network name.
 * @param {string} token - The token symbol to query.
 * @param {string} address - The wallet address.
 * @param {TokenTransferOptions} [options] - Optional filter parameters.
 * @returns {Promise<TokenTransfer[]>} Array of token transfers.
 * @throws {WdkCliError} NETWORK_NOT_SUPPORTED when the network has no `indexerSlug`.
 * @throws {WdkCliError} INVALID_ARGUMENT when the indexer provider is disabled.
 * @throws {WdkCliError} NETWORK_ERROR when the indexer API rejects the request.
 */
export async function getTokenTransfers (network, token, address, options = {}) {
  if (!isIndexerSupported(network)) {
    throw new WdkCliError(
      `Network '${network}' is not supported by the indexer API.`,
      ErrorCode.NETWORK_NOT_SUPPORTED
    )
  }
  const blockchain = getIndexerSlug(network)
  const { baseUrl, apiKey } = endpoint()

  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.fromTs) params.set('fromTs', String(options.fromTs))
  if (options.toTs) params.set('toTs', String(options.toTs))

  const qs = params.toString() ? `?${params.toString()}` : ''
  const url = `${baseUrl}/api/v1/${blockchain}/${token}/${address}/token-transfers${qs}`

  /** @type {Record<string, string>} */
  const headers = {}
  if (apiKey) headers['x-api-key'] = apiKey

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })

  if (!response.ok) {
    if (response.status === 403) {
      throw new WdkCliError(
        'Indexer API error: 403 Forbidden. Please set your API key or use a proxy API for the indexer provider:\n' +
          '  wdk config set --key providers.wdk-indexer.config.apiKey --value <your-api-key>\n' +
          '  wdk config set --key providers.wdk-indexer.config.baseUrl --value <your-proxy-url>',
        ErrorCode.NETWORK_ERROR
      )
    }
    throw new WdkCliError(
      `Indexer API error: ${response.status} ${response.statusText}`,
      ErrorCode.NETWORK_ERROR
    )
  }

  const data = await response.json()
  return data.transfers ?? []
}

/**
 * Fetches token transfer history for multiple addresses in a single batch request.
 *
 * @param {BatchTransferRequestItem[]} items - The batch request items.
 * @returns {Promise<BatchTransferResultItem[]>} Array of per-item results.
 * @throws {WdkCliError} INVALID_ARGUMENT when the indexer provider is disabled.
 * @throws {WdkCliError} NETWORK_ERROR when the indexer API rejects the request.
 */
export async function getTokenTransfersBatch (items) {
  if (items.length === 0) return []

  const { baseUrl, apiKey } = endpoint()

  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' }
  if (apiKey) headers['x-api-key'] = apiKey

  const response = await fetch(`${baseUrl}/api/v1/batch/token-transfers`, {
    method: 'POST',
    headers,
    body: JSON.stringify(items),
    signal: AbortSignal.timeout(20000)
  })

  if (!response.ok) {
    if (response.status === 403) {
      throw new WdkCliError(
        'Indexer API error: 403 Forbidden. Please set your API key or use a proxy API for the indexer provider:\n' +
          '  wdk config set --key providers.wdk-indexer.config.apiKey --value <your-api-key>\n' +
          '  wdk config set --key providers.wdk-indexer.config.baseUrl --value <your-proxy-url>',
        ErrorCode.NETWORK_ERROR
      )
    }
    throw new WdkCliError(
      `Indexer API error: ${response.status} ${response.statusText}`,
      ErrorCode.NETWORK_ERROR
    )
  }

  return await response.json()
}
