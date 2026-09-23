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

import BigNumber from 'bignumber.js'
import {
  getNativeToken,
  getTokenByAddress,
  tokenSlugValue
} from './token-service.js'
import { resolvePricingProvider } from './pricing/index.js'
import { WdkCliError, ErrorCode } from '../errors/index.js'

/** @typedef {import('./token-service.js').TokenEntry} TokenEntry */

/** The quote currency every price is expressed in. */
const QUOTE = 'USD'

/**
 * Returns the symbol a price feed knows a token by: its registered slug, or the
 * token's own symbol when the feed uses the same name. The registry records
 * only the disagreements — `usdt` is `UST` to Bitfinex, while `BTC` and `ETH`
 * need no entry.
 *
 * @param {TokenEntry} token - The token entry.
 * @param {string} feed - The provider short name, which is its `metadata.slugs` key.
 * @returns {string} The feed's symbol for the token.
 */
function feedSymbol (token, feed) {
  return tokenSlugValue(token, feed) ?? token.symbol
}

/**
 * Asks the price feed for a token's USD price.
 *
 * @param {TokenEntry} token - The token entry.
 * @param {string} label - The token symbol, for error messages.
 * @param {string} network - The network name, for error messages.
 * @returns {Promise<number>} The USD price.
 * @throws {WdkCliError} TOKEN_NOT_SUPPORTED when the feed does not carry the token.
 */
async function priceOf (token, label, network) {
  const { name, provider } = await resolvePricingProvider()
  const price = await provider.getLastPrice(feedSymbol(token, name), QUOTE)
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new WdkCliError(
      `No USD price available for ${label} on ${network}.`,
      ErrorCode.TOKEN_NOT_SUPPORTED
    )
  }
  return price
}

/**
 * Returns the current USD price of the native token for a network.
 *
 * @param {string} network - The network name.
 * @returns {Promise<number>} The USD price.
 */
export async function getNativeUsdPrice (network) {
  const native = getNativeToken(network)
  if (!native) {
    throw new WdkCliError(
      `No native token registered for ${network}.`,
      ErrorCode.NETWORK_NOT_SUPPORTED
    )
  }
  return priceOf(native, native.symbol, network)
}

/**
 * Returns the current USD price of an ERC-20 / SPL token.
 *
 * @param {string} network - The network name.
 * @param {string} tokenAddress - The token contract address.
 * @returns {Promise<number>} The USD price.
 */
export async function getTokenUsdPrice (network, tokenAddress) {
  const tokenInfo = getTokenByAddress(network, tokenAddress)
  if (!tokenInfo) {
    throw new WdkCliError(`Unknown token ${tokenAddress} on ${network}.`, ErrorCode.INVALID_TOKEN)
  }
  return priceOf(tokenInfo, tokenInfo.symbol, network)
}

/**
 * Converts a native or token amount (in base units) to a USD value, rounded
 * to 2 decimal places (USD's standard display precision).
 *
 * @param {string} network - The network name.
 * @param {bigint} amount - The amount in base units (e.g. wei, satoshis).
 * @param {string} [tokenAddress] - The token contract address; omit for native token.
 * @returns {Promise<number>} The equivalent USD value, rounded to 2 decimal places.
 */
export async function convertToUsd (network, amount, tokenAddress) {
  if (tokenAddress) {
    const tokenInfo = getTokenByAddress(network, tokenAddress)
    if (!tokenInfo) {
      throw new WdkCliError(`Unknown token ${tokenAddress} on ${network}.`, ErrorCode.INVALID_TOKEN)
    }
    const price = await getTokenUsdPrice(network, tokenAddress)
    const value = new BigNumber(amount.toString()).shiftedBy(-tokenInfo.decimals)
    return Math.round(value.multipliedBy(price).toNumber() * 100) / 100
  }
  const native = getNativeToken(network)
  if (!native) {
    throw new WdkCliError(
      `No native token registered for ${network}.`,
      ErrorCode.NETWORK_NOT_SUPPORTED
    )
  }
  const price = await getNativeUsdPrice(network)
  const value = new BigNumber(amount.toString()).shiftedBy(-native.decimals)
  return Math.round(value.multipliedBy(price).toNumber() * 100) / 100
}
