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

import { BaseRampProvider, postToEndpoint, assertEnvironment } from './base.js'
import { isTestnet } from '../../config/networks.js'
import { WdkCliError, ErrorCode } from '../../errors/index.js'

/** The environment value that means MoonPay's test environment. */
const TESTNET_ENVIRONMENT = 'sandbox'

/**
 * MoonPay on/off ramp. Its `signUrl` config names a signing server rather than
 * holding a value, and its `environment` has to agree with the network.
 */
export class MoonPayRampProvider extends BaseRampProvider {
  constructor () {
    super('moonpay')
  }

  /**
   * Turns the stored `signUrl` into the callback the module expects, dropping
   * it when unset.
   *
   * @protected
   * @param {Record<string, unknown>} config - The merged registry config.
   * @returns {Record<string, unknown>} The module config.
   */
  _moduleConfig (config) {
    const { signUrl, ...rest } = config
    if (typeof signUrl !== 'string' || !signUrl) return rest
    return { ...rest, signUrl: (url) => postToEndpoint(signUrl, url) }
  }

  /**
   * Refuses a production environment on a testnet, and a sandbox one on a
   * mainnet.
   *
   * @param {string} network - The network name.
   * @returns {Promise<void>}
   * @throws {WdkCliError} MISSING_CONFIG when the environment is not configured.
   * @throws {WdkCliError} INVALID_CONFIG when it is neither `production` nor `sandbox`.
   * @throws {WdkCliError} ENVIRONMENT_MISMATCH when it disagrees with the network.
   */
  async validateEnvironment (network) {
    const environment = this._config(network).environment
    if (typeof environment !== 'string' || !environment) {
      throw new WdkCliError(
        'MoonPay environment is not configured.',
        ErrorCode.MISSING_CONFIG,
        'Set it with: wdk config set --key providers.moonpay.config.environment --value sandbox'
      )
    }
    if (environment !== 'production' && environment !== TESTNET_ENVIRONMENT) {
      throw new WdkCliError(
        `Invalid MoonPay environment '${environment}'. Must be 'production' or 'sandbox'.`,
        ErrorCode.INVALID_CONFIG
      )
    }
    assertEnvironment(this.name, network, environment, TESTNET_ENVIRONMENT, isTestnet(network))
  }
}
