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

/**
 * @typedef {'buy' | 'sell'} Direction
 */

/**
 * @typedef {Object} ResolvedAssets
 * @property {string} cryptoCode - The provider's identifier for the crypto asset.
 * @property {number} cryptoDecimals - The number of decimals for the crypto asset.
 * @property {number} fiatDecimals - The number of decimals for the fiat currency.
 */

/**
 * @typedef {Object} RampInput
 * @property {string} network - The blockchain network name.
 * @property {string} token - The CLI token name.
 * @property {string} walletAddress - The wallet address for receiving (buy) or refunding (sell).
 * @property {string} fiatCurrency - The fiat currency code (e.g. "usd").
 * @property {bigint} [fiatAmount] - The fiat amount in base units.
 * @property {bigint} [cryptoAmount] - The crypto amount in base units.
 * @property {number} fiatDecimals - The number of decimals for the fiat currency.
 * @property {number} cryptoDecimals - The number of decimals for the crypto asset.
 */

/**
 * @typedef {Object} QuoteResult
 * @property {bigint} fiatAmount - The fiat amount in base units.
 * @property {bigint} cryptoAmount - The crypto amount in base units.
 * @property {bigint} fee - The provider fee in fiat base units.
 * @property {string} rate - The fiat-per-crypto rate as a decimal string.
 */

/**
 * @typedef {Object} UrlResult
 * @property {string} url - The hosted widget URL for the buy or sell flow.
 */

/**
 * The part of the SDK's `FiatProtocol` contract the adapters call.
 *
 * @typedef {Object} FiatProtocol
 * @property {(options: Record<string, unknown>) => Promise<QuoteResult>} quoteBuy - Prices a purchase.
 * @property {(options: Record<string, unknown>) => Promise<QuoteResult>} quoteSell - Prices a sale.
 * @property {(options: Record<string, unknown>) => Promise<{ buyUrl: string }>} buy - Builds the hosted buy URL.
 * @property {(options: Record<string, unknown>) => Promise<{ sellUrl: string }>} sell - Builds the hosted sell URL.
 * @property {() => Promise<SupportedAsset[]>} getSupportedCryptoAssets - Lists the crypto assets the provider carries.
 * @property {() => Promise<SupportedAsset[]>} getSupportedFiatCurrencies - Lists the fiat currencies the provider carries.
 */

/**
 * An entry from a provider's supported-asset or supported-currency listing.
 *
 * @typedef {Object} SupportedAsset
 * @property {string} code - The provider's identifier for the asset or currency.
 * @property {number} decimals - The number of decimal places its amounts use.
 * @property {string} [networkCode] - The provider's name for the network the asset lives on,
 *   when it lists the same code on more than one.
 */

/**
 * The CLI-side contract every on-ramp / off-ramp provider must implement. One
 * adapter per provider, holding whatever that provider needs beyond the SDK's
 * `FiatProtocol`: how it is credentialed, how it names tokens and currencies,
 * and whether its environment has to agree with the network.
 *
 * @typedef {Object} RampProvider
 * @property {string} name - The provider short name, as the registry lists it.
 * @property {(network: string) => Promise<void>} validateEnvironment - Throws when the provider's environment does not match the network (e.g. production vs. testnet).
 * @property {(network: string, token: string, fiatCurrency: string) => Promise<ResolvedAssets>} resolveAssets - Resolves the provider's asset code and both sides' decimals.
 * @property {(input: RampInput, direction: Direction) => Promise<QuoteResult | undefined>} quote - Returns a price quote, or undefined when the provider cannot price this pair.
 * @property {(input: RampInput, direction: Direction) => Promise<UrlResult>} buildUrl - Builds the hosted widget URL for the requested direction.
 */

export {}
