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

import { PricingProvider, PricingClient } from '@tetherto/wdk-pricing-provider'
import { getProtocols, loadProtocolClass, resolveProtocolConfig } from '../protocol-service.js'
import { getInstalledVersion } from '../module-service.js'
import { WdkCliError, ErrorCode } from '../../errors/index.js'

/** @typedef {import('@tetherto/wdk-pricing-provider').PricingProvider} Pricing */

/** The registry kind a USD price feed declares. */
export const PRICING = 'pricing'

/** How long a fetched price stays fresh. Matches the previous hand-rolled cache;
 *  the package would otherwise default to an hour. */
const CACHE_TTL_MS = 5 * 60 * 1000

/** @type {Map<string, Pricing>} */
const instances = new Map()

/**
 * Returns the names of the pricing providers the CLI can use: enabled,
 * declaring `kind: "pricing"`, and with their module installed.
 *
 * @returns {string[]} Provider short names, in packaged order.
 */
function getPricingProviders () {
  return Object.entries(getProtocols())
    .filter(([, entry]) => entry.kind === PRICING && getInstalledVersion(entry.module) !== null)
    .map(([name]) => name)
}

/**
 * Returns the pricing provider to use, constructing it on first use. Pricing
 * providers cannot be added, so the usable one is whichever of the packaged
 * feeds is enabled.
 *
 * @returns {Promise<{ name: string, provider: Pricing }>} The provider and the name
 *   it is registered under, which is also its `metadata.slugs` key.
 * @throws {WdkCliError} MISSING_CONFIG when no pricing provider is available.
 * @throws {WdkCliError} INVALID_ARGUMENT when several are enabled at once.
 * @throws {WdkCliError} UNSUPPORTED_MODULE when the module exports no pricing client.
 */
export async function resolvePricingProvider () {
  const usable = getPricingProviders()
  if (usable.length === 0) {
    throw new WdkCliError(
      'No price feed is available.',
      ErrorCode.MISSING_CONFIG,
      'Enable one with: wdk provider enable --name <name>'
    )
  }
  if (usable.length > 1) {
    throw new WdkCliError(
      `Several price feeds are enabled: ${usable.join(', ')}.`,
      ErrorCode.INVALID_ARGUMENT,
      `Leave one enabled with: wdk provider disable --name ${usable[1]}`
    )
  }

  const name = usable[0]
  const cached = instances.get(name)
  if (cached) return { name, provider: cached }

  const module = getProtocols()[name].module
  const ClientClass = clientClass(await loadProtocolClass(module), name)
  const provider = /** @type {Pricing} */ (new PricingProvider({
    client: new ClientClass(resolveProtocolConfig(name)),
    priceCacheDurationMs: CACHE_TTL_MS
  }))
  instances.set(name, provider)
  return { name, provider }
}

/**
 * Returns the client class from a loaded pricing module. Protocol modules
 * default-export their class, so `loadProtocolClass` hands those back directly;
 * the pricing clients use a named export, so it hands back the namespace and
 * the class is the export extending {@link PricingClient}.
 *
 * @param {unknown} mod - What the loader returned.
 * @param {string} name - The provider short name, for the error message.
 * @returns {new (config: Record<string, unknown>) => PricingClient} The client class.
 * @throws {WdkCliError} UNSUPPORTED_MODULE when no pricing client can be identified.
 */
function clientClass (mod, name) {
  /** @param {unknown} v */
  const cast = (v) => /** @type {new (config: Record<string, unknown>) => PricingClient} */ (v)
  /** @param {unknown} v */
  const extendsBase = (v) => typeof v === 'function' && v.prototype instanceof PricingClient

  if (extendsBase(mod)) return cast(mod)

  const clients = Object.values(/** @type {Record<string, unknown>} */ (mod)).filter(extendsBase)
  if (clients.length === 1) return cast(clients[0])

  throw new WdkCliError(
    `Provider '${name}' does not export a pricing client.`,
    ErrorCode.UNSUPPORTED_MODULE,
    clients.length > 1
      ? 'Its module exports several; a pricing module must export exactly one.'
      : 'A pricing module must export a class extending PricingClient.'
  )
}
