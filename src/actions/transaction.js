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

import { daemonClient } from '../daemon/client.js'
import { validateNetwork } from '../config/networks.js'
import { WdkCliError, ErrorCode } from '../errors/index.js'

/** The finality targets a transaction wait can block on. */
export const FINALITY_TARGETS = /** @type {const} */ (['confirmed', 'final'])

/**
 * @typedef {Object} GetTransactionInput
 * @property {string} network - The blockchain network name (e.g. "ethereum", "bitcoin").
 * @property {string} hash - The transaction hash.
 * @property {'confirmed' | 'final'} [finality] - When set, block until the
 *   transaction reaches this finality target (or is dropped / the wait times out).
 * @property {number} [timeout] - Wait time budget in milliseconds (requires finality).
 * @property {number} index - The BIP-44 account index.
 * @property {string} [wallet] - The wallet name (defaults to the active wallet).
 */

/**
 * @typedef {Object} GetTransactionResult
 * @property {string} network - The blockchain network name.
 * @property {string} hash - The transaction hash.
 * @property {number} index - The BIP-44 account index.
 * @property {unknown} transaction - The normalized receipt (`hash`, `finality`,
 *   `success?`, `block?`, `fee?`, plus module-specific fields; BigInt values
 *   serialized as strings).
 */

/**
 * Fetches a transaction's normalized receipt, optionally blocking until it
 * reaches a finality target.
 *
 * @param {GetTransactionInput} input - The lookup parameters.
 * @returns {Promise<GetTransactionResult>} The normalized receipt.
 * @throws {WdkCliError} When the hash is empty, the finality target is
 *   invalid, a timeout is given without a finality target, the network is
 *   not supported, or the wallet is not unlocked.
 */
export async function getTransaction (input) {
  const wallet = await daemonClient.requireUnlocked(input.wallet)
  validateNetwork(input.network)
  if (typeof input.hash !== 'string' || input.hash === '') {
    throw new WdkCliError('Transaction hash must be a non-empty string.', ErrorCode.INVALID_ARGUMENT)
  }
  if (input.finality !== undefined && !FINALITY_TARGETS.includes(input.finality)) {
    throw new WdkCliError(
      `Invalid finality target '${input.finality}'.`,
      ErrorCode.INVALID_ARGUMENT,
      `Use one of: ${FINALITY_TARGETS.join(', ')}.`
    )
  }
  if (input.timeout !== undefined && input.finality === undefined) {
    throw new WdkCliError(
      'A timeout requires a finality target.',
      ErrorCode.INVALID_ARGUMENT,
      'Set finality to confirmed or final, or drop the timeout.'
    )
  }

  const transaction = await daemonClient.getTransaction(
    input.network,
    input.hash,
    { finality: input.finality, timeout: input.timeout, index: input.index },
    wallet
  )
  return {
    network: input.network,
    hash: input.hash,
    index: input.index,
    transaction
  }
}
