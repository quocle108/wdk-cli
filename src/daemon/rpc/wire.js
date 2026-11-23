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
 * Converts between the daemon's request/response objects (src/daemon/protocol.js)
 * and the messages of its HRPC contract (scripts/build-hrpc.mjs).
 *
 * The contract encodes optional fields by truthiness and decodes an absent
 * string as `null`, so: absent values are dropped on the way in and `null`s
 * become missing keys on the way out, and free-form `json` values travel boxed
 * as `{ v: value }` so that `false`, `0`, `''` and `null` survive.
 */

/** @typedef {import('../protocol.js').DaemonRequest} DaemonRequest */
/** @typedef {import('../protocol.js').DaemonResponse} DaemonResponse */
/** @typedef {import('../protocol.js').DaemonAction} DaemonAction */
/** @typedef {import('../protocol.js').QuoteRequest} QuoteRequest */

/**
 * @typedef {Object} ActionContract
 * @property {string} method - The HRPC method name.
 * @property {string[]} fields - The response data fields, in order.
 * @property {string[]} [json] - The response fields that carry free-form values.
 * @property {boolean} [empty] - True when the request carries no fields.
 */

const QUOTE = { fields: ['protocol', 'from', 'inputAmount', 'outputAmount', 'fees', 'skipped'], json: ['fees'] }
const EXECUTE = { fields: ['protocol', 'from', 'result', 'skipped'], json: ['result'] }

/**
 * Every daemon action with its contract.
 *
 * @type {Array<[DaemonAction, ActionContract]>}
 */
export const ACTION_CONTRACTS = [
  ['unlock_wallet', { method: 'unlockWallet', fields: ['message', 'wallet'] }],
  ['lock_wallet', { method: 'lockWallet', fields: ['message', 'wallet'] }],
  ['get_address', { method: 'getAddress', fields: ['address'] }],
  ['call_method', { method: 'callMethod', fields: ['result', 'address'], json: ['result'] }],
  ['get_balance', { method: 'getBalance', fields: ['balance', 'symbol', 'decimals', 'address'] }],
  ['estimate_fee', { method: 'estimateFee', fields: ['fee', 'feeFormatted', 'from'] }],
  ['send', { method: 'send', fields: ['txHash', 'network', 'from', 'to', 'amount', 'fee'] }],
  ['sign_message', { method: 'signMessage', fields: ['address', 'signature'] }],
  ['verify_message', { method: 'verifyMessage', fields: ['valid', 'address'] }],
  ['get_transaction', { method: 'getTransaction', fields: ['transaction'], json: ['transaction'] }],
  ['quote_swap', { method: 'quoteSwap', ...QUOTE }],
  ['quote_bridge', { method: 'quoteBridge', ...QUOTE }],
  ['execute_swap', { method: 'executeSwap', ...EXECUTE }],
  ['execute_bridge', { method: 'executeBridge', ...EXECUTE }],
  ['list_wallets', { method: 'listWallets', fields: ['wallets'], empty: true }],
  ['status', { method: 'status', fields: ['unlocked', 'wallets', 'pid'], empty: true }],
  ['lock', { method: 'lock', fields: ['message'], empty: true }]
]

const CONTRACTS = new Map(ACTION_CONTRACTS)

/**
 * Returns the contract of a daemon action.
 *
 * @param {DaemonAction} action - The daemon action.
 * @returns {ActionContract} Its contract.
 * @throws {Error} If the action is not part of the contract.
 */
export function getActionContract (action) {
  const contract = CONTRACTS.get(action)
  if (!contract) throw new Error(`Unknown action: ${action}`)
  return contract
}

/**
 * Boxes a free-form value for a `json` field.
 *
 * @param {unknown} value - The value, or undefined when there is none.
 * @returns {{ v: unknown } | undefined} The boxed value.
 */
function box (value) {
  return value === undefined ? undefined : { v: value }
}

/**
 * Copies an object without its `null` and `undefined` values.
 *
 * @param {Record<string, unknown>} object - The object.
 * @returns {Record<string, unknown>} The copy.
 */
function present (object) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(object)) {
    if (value !== null && value !== undefined) out[key] = value
  }
  return out
}

/**
 * Rebuilds a quote token from its wire message.
 *
 * @param {Record<string, any>} wire - The decoded token.
 * @returns {import('../protocol.js').QuoteToken} The token.
 */
function quoteToken (wire) {
  return {
    ...(wire.address ? { address: wire.address } : {}),
    decimals: wire.decimals,
    symbol: wire.symbol,
    isNative: wire.isNative
  }
}

/**
 * Builds the wire message for a request (client side).
 *
 * @param {DaemonRequest} req - The request.
 * @returns {Record<string, unknown>} The wire message.
 */
export function toWireRequest (req) {
  const { action: _action, args, request, ...fields } = req
  return {
    ...present(fields),
    ...(args ? { args: Object.entries(args).map(([name, value]) => ({ name, value: String(value) })) } : {}),
    ...(request ? { request: { ...present(request), toChain: box(request.toChain) } } : {})
  }
}

/**
 * Rebuilds a request from its wire message (daemon side).
 *
 * @param {DaemonAction} action - The action the message was sent for.
 * @param {Record<string, any> | null} wire - The decoded wire message.
 * @returns {DaemonRequest} The request.
 */
export function fromWireRequest (action, wire) {
  const { args, request, ...fields } = wire ?? {}
  /** @type {DaemonRequest} */
  const req = { action, ...present(fields) }
  if (Array.isArray(args) && args.length > 0) {
    req.args = Object.fromEntries(args.map(({ name, value }) => [name, value]))
  }
  if (request) {
    const { fromToken, toToken, fromSymbol, toSymbol, toChain, amountIn, amountOut, recipient, toNetwork } = request
    req.request = {
      fromToken: quoteToken(fromToken),
      toToken: quoteToken(toToken),
      fromSymbol,
      toSymbol,
      ...present({ amountIn, amountOut, recipient, toNetwork }),
      ...(toChain ? { toChain: toChain.v } : {})
    }
  }
  return req
}

/**
 * Builds the wire message for a response (daemon side).
 *
 * @param {DaemonAction} action - The action the response answers.
 * @param {DaemonResponse} resp - The response.
 * @returns {Record<string, unknown>} The wire message.
 */
export function toWireResponse (action, resp) {
  if (!resp.ok) {
    return { error: present({ message: resp.error ?? 'Internal error', code: resp.code, suggestion: resp.suggestion }) }
  }
  const { fields, json = [] } = getActionContract(action)
  const data = typeof resp.data === 'object' && resp.data !== null ? resp.data : {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const field of fields) {
    out[field] = json.includes(field) ? box(data[field]) : data[field]
  }
  return out
}

/**
 * Rebuilds a response from its wire message (client side).
 *
 * @param {DaemonAction} action - The action the response answers.
 * @param {Record<string, any>} wire - The decoded wire message.
 * @returns {DaemonResponse} The response.
 */
export function fromWireResponse (action, wire) {
  if (wire.error) {
    const { message, code, suggestion } = wire.error
    return { ok: false, error: message, ...present({ code, suggestion }) }
  }
  const { fields, json = [] } = getActionContract(action)
  /** @type {Record<string, unknown>} */
  const data = {}
  for (const field of fields) {
    const value = wire[field]
    if (json.includes(field)) {
      if (value) data[field] = value.v
    } else if (value !== null && value !== undefined) {
      data[field] = value
    }
  }
  return { ok: true, data }
}
