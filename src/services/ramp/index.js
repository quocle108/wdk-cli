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

import { getProtocols, getProtocol, findProtocol } from '../protocol-service.js'
import { getInstalledVersion } from '../module-service.js'
import { MoonPayRampProvider } from './moonpay.js'
import { WdkCliError, ErrorCode } from '../../errors/index.js'

/** @typedef {import('./types.js').RampProvider} RampProvider */

/** The registry kind an on/off-ramp provider declares. */
export const FIAT = 'fiat'

/**
 * The adapter for each ramp provider the CLI ships. A provider is usable only
 * if it appears here, which is why `provider add` refuses `kind: "fiat"`.
 *
 * @type {Record<string, () => RampProvider>}
 */
const ADAPTERS = {
  moonpay: () => new MoonPayRampProvider()
}

/**
 * Returns whether the CLI ships an adapter for a provider name.
 *
 * @param {string} name - The provider short name.
 * @returns {boolean} True when the provider can be driven.
 */
function hasRampAdapter (name) {
  return Object.hasOwn(ADAPTERS, name)
}

/**
 * Returns the fiat providers the CLI can drive: enabled, declaring
 * `kind: "fiat"`, shipping an adapter, and with their module installed.
 *
 * @returns {string[]} Provider short names, in packaged order.
 */
function getFiatProviders () {
  return Object.entries(getProtocols())
    .filter(([name, entry]) =>
      entry.kind === FIAT && hasRampAdapter(name) && getInstalledVersion(entry.module) !== null
    )
    .map(([name]) => name)
}

/**
 * Picks the fiat provider to use: the requested one, or the only usable one
 * when none is named.
 *
 * @param {string} [requested] - The provider short name from `--provider`.
 * @returns {RampProvider} The provider's adapter.
 * @throws {WdkCliError} INVALID_ARGUMENT when the named provider is not a fiat on/off-ramp.
 * @throws {WdkCliError} UNSUPPORTED_MODULE when the named provider's module is not installed.
 * @throws {WdkCliError} MISSING_CONFIG when no fiat provider is usable.
 * @throws {WdkCliError} INVALID_ARGUMENT when several are usable and none was named.
 */
export function resolveRampProvider (requested) {
  if (requested) {
    const entry = getProtocol(requested)
    if (entry.kind !== FIAT || !hasRampAdapter(requested)) {
      throw new WdkCliError(
        `Provider '${requested}' is not a fiat on/off-ramp.`,
        ErrorCode.INVALID_ARGUMENT,
        `Fiat providers: ${Object.keys(ADAPTERS).join(', ')}`
      )
    }
    if (getInstalledVersion(entry.module) === null) {
      throw new WdkCliError(
        `Provider '${requested}' is not installed.`,
        ErrorCode.UNSUPPORTED_MODULE,
        `Install it with: wdk module add --name ${entry.module}`
      )
    }
    return ADAPTERS[requested]()
  }

  const usable = getFiatProviders()
  if (usable.length === 0) {
    // findProtocol, not getProtocol: the shipped providers may all be disabled,
    // and building this message must not throw on that.
    const shipped = Object.keys(ADAPTERS)
      .map((name) => `${name} (${findProtocol(name)?.module ?? 'not registered'})`)
      .join(', ')
    throw new WdkCliError(
      'No fiat provider is available.',
      ErrorCode.MISSING_CONFIG,
      `Install or enable one of: ${shipped}`
    )
  }
  if (usable.length > 1) {
    throw new WdkCliError(
      `Several fiat providers are available: ${usable.join(', ')}.`,
      ErrorCode.INVALID_ARGUMENT,
      `Choose one with: --provider ${usable[0]}`
    )
  }
  return ADAPTERS[usable[0]]()
}
