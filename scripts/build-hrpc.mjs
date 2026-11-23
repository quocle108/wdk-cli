#!/usr/bin/env node
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
 * Generates the wallet daemon's HRPC contract into src/daemon/rpc/spec/:
 * `hyperschema/` is the append-only message registry, `hrpc/` the typed RPC
 * over bare-rpc. Both are committed; run this only when the contract grows.
 *
 *   node scripts/build-hrpc.mjs
 *
 * Append-only: never rename, reorder or remove a field or a command, and never
 * make an optional field required.
 *
 * Optional fields are encoded by truthiness: `0`, `false` and `''` are not sent
 * and decode as `0`, `false` and `null`. A field whose zero value means
 * something (`ttl: 0` is an unlimited session) is therefore required, and every
 * free-form `json` value travels boxed as `{ v: value }` (see rpc/wire.js). Add new ones at the end, and bump
 * `PROTOCOL_VERSION` in src/daemon/rpc/protocol-version.js when a client must
 * not talk to an older daemon.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import HRPCBuilder from 'hrpc'
import Hyperschema from 'hyperschema'

const SCHEMA_DIR = fileURLToPath(new URL('../src/daemon/rpc/spec/hyperschema', import.meta.url))
const HRPC_DIR = fileURLToPath(new URL('../src/daemon/rpc/spec/hrpc', import.meta.url))

const schema = Hyperschema.from(SCHEMA_DIR)
const ns = schema.namespace('wdk-daemon')

const t = (name) => `@wdk-daemon/${name}`

// ── shared structs ──────────────────────────────────────────────────

ns.register({
  name: 'error',
  fields: [
    { name: 'message', type: 'string', required: true },
    { name: 'code', type: 'string' },
    { name: 'suggestion', type: 'string' }
  ]
})

ns.register({
  name: 'wallet-status',
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'ttlMs', type: 'uint', required: true },
    { name: 'ttlRemaining', type: 'uint', required: true }
  ]
})

ns.register({
  name: 'skipped-protocol',
  fields: [
    { name: 'protocol', type: 'string', required: true },
    { name: 'reason', type: 'string', required: true }
  ]
})

ns.register({
  name: 'method-arg',
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'value', type: 'string', required: true }
  ]
})

ns.register({
  name: 'quote-token',
  fields: [
    { name: 'address', type: 'string' },
    { name: 'decimals', type: 'uint', required: true },
    { name: 'symbol', type: 'string', required: true },
    { name: 'isNative', type: 'bool', required: true }
  ]
})

ns.register({
  name: 'quote-request',
  fields: [
    { name: 'fromToken', type: t('quote-token'), required: true },
    { name: 'toToken', type: t('quote-token'), required: true },
    { name: 'toChain', type: 'json' },
    { name: 'amountIn', type: 'string' },
    { name: 'amountOut', type: 'string' },
    { name: 'recipient', type: 'string' },
    { name: 'fromSymbol', type: 'string', required: true },
    { name: 'toSymbol', type: 'string', required: true },
    { name: 'toNetwork', type: 'string' }
  ]
})

// ── requests ────────────────────────────────────────────────────────

ns.register({ name: 'empty', fields: [] })

ns.register({
  name: 'handshake-request',
  fields: [{ name: 'protocolVersion', type: 'uint', required: true }]
})

ns.register({
  name: 'unlock-wallet-request',
  fields: [
    { name: 'wallet', type: 'string' },
    { name: 'passphrase', type: 'string', required: true },
    { name: 'ttl', type: 'uint', required: true }
  ]
})

ns.register({
  name: 'lock-wallet-request',
  fields: [{ name: 'wallet', type: 'string' }]
})

ns.register({
  name: 'account-request',
  fields: [
    { name: 'wallet', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'index', type: 'uint' },
    { name: 'token', type: 'string' },
    { name: 'to', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'method', type: 'string' },
    { name: 'args', type: t('method-arg'), array: true },
    { name: 'message', type: 'string' },
    { name: 'signature', type: 'string' },
    { name: 'hash', type: 'string' },
    { name: 'finality', type: 'string' },
    { name: 'timeout', type: 'uint' },
    { name: 'protocol', type: 'string' },
    { name: 'request', type: t('quote-request') }
  ]
})

// ── responses ───────────────────────────────────────────────────────
// Every response carries an optional `error`; the other fields are set only
// when it is absent.

ns.register({
  name: 'handshake-response',
  fields: [
    { name: 'protocolVersion', type: 'uint', required: true },
    { name: 'daemonVersion', type: 'string', required: true }
  ]
})

ns.register({
  name: 'wallet-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'message', type: 'string' },
    { name: 'wallet', type: 'string' }
  ]
})

ns.register({
  name: 'address-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'address', type: 'string' }
  ]
})

ns.register({
  name: 'balance-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'balance', type: 'string' },
    { name: 'symbol', type: 'string' },
    { name: 'decimals', type: 'uint' },
    { name: 'address', type: 'string' }
  ]
})

ns.register({
  name: 'fee-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'fee', type: 'string' },
    { name: 'feeFormatted', type: 'string' },
    { name: 'from', type: 'string' }
  ]
})

ns.register({
  name: 'send-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'txHash', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'from', type: 'string' },
    { name: 'to', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'fee', type: 'string' }
  ]
})

ns.register({
  name: 'call-method-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'result', type: 'json' },
    { name: 'address', type: 'string' }
  ]
})

ns.register({
  name: 'sign-message-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'address', type: 'string' },
    { name: 'signature', type: 'string' }
  ]
})

ns.register({
  name: 'verify-message-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'valid', type: 'bool' },
    { name: 'address', type: 'string' }
  ]
})

ns.register({
  name: 'transaction-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'transaction', type: 'json' }
  ]
})

ns.register({
  name: 'quote-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'protocol', type: 'string' },
    { name: 'from', type: 'string' },
    { name: 'inputAmount', type: 'string' },
    { name: 'outputAmount', type: 'string' },
    { name: 'fees', type: 'json' },
    { name: 'skipped', type: t('skipped-protocol'), array: true }
  ]
})

ns.register({
  name: 'execute-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'protocol', type: 'string' },
    { name: 'from', type: 'string' },
    { name: 'result', type: 'json' },
    { name: 'skipped', type: t('skipped-protocol'), array: true }
  ]
})

ns.register({
  name: 'wallets-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'wallets', type: t('wallet-status'), array: true }
  ]
})

ns.register({
  name: 'status-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'unlocked', type: 'bool' },
    { name: 'wallets', type: t('wallet-status'), array: true },
    { name: 'pid', type: 'uint' }
  ]
})

ns.register({
  name: 'message-response',
  fields: [
    { name: 'error', type: t('error') },
    { name: 'message', type: 'string' }
  ]
})

Hyperschema.toDisk(schema)

// ── commands ────────────────────────────────────────────────────────
// Registration order assigns command ids: append-only, never reorder.

const builder = HRPCBuilder.from(SCHEMA_DIR, HRPC_DIR)
const rpc = builder.namespace('wdk-daemon')

const command = (name, request, response) =>
  rpc.register({
    name,
    request: { name: t(request), stream: false },
    response: { name: t(response), stream: false }
  })

command('handshake', 'handshake-request', 'handshake-response')
command('unlock-wallet', 'unlock-wallet-request', 'wallet-response')
command('lock-wallet', 'lock-wallet-request', 'wallet-response')
command('get-address', 'account-request', 'address-response')
command('call-method', 'account-request', 'call-method-response')
command('get-balance', 'account-request', 'balance-response')
command('estimate-fee', 'account-request', 'fee-response')
command('send', 'account-request', 'send-response')
command('sign-message', 'account-request', 'sign-message-response')
command('verify-message', 'account-request', 'verify-message-response')
command('get-transaction', 'account-request', 'transaction-response')
command('quote-swap', 'account-request', 'quote-response')
command('quote-bridge', 'account-request', 'quote-response')
command('execute-swap', 'account-request', 'execute-response')
command('execute-bridge', 'account-request', 'execute-response')
command('list-wallets', 'empty', 'wallets-response')
command('status', 'empty', 'status-response')
command('lock', 'empty', 'message-response')

HRPCBuilder.toDisk(builder)

// The generated code is not written for `tsc --checkJs`; the hand-written
// modules in src/daemon/rpc/ carry the types.
for (const file of [`${SCHEMA_DIR}/index.js`, `${HRPC_DIR}/index.js`, `${HRPC_DIR}/messages.js`]) {
  writeFileSync(file, '// @ts-nocheck\n' + readFileSync(file, 'utf8'))
}

console.log(`hrpc contract generated → ${HRPC_DIR}`)
