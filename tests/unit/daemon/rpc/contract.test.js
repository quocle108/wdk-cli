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

import { jest } from '@jest/globals'
import { createServer, connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HRPC from '../../../../src/daemon/rpc/spec/hrpc/index.js'
import { serve } from '../../../../src/daemon/rpc/serve.js'
import { getActionContract, toWireRequest, fromWireResponse } from '../../../../src/daemon/rpc/wire.js'

const tempDir = mkdtempSync(join(tmpdir(), 'wdk-contract-test-'))
const SOCKET_PATH = join(tempDir, 'contract.sock')

/** @type {jest.Mock} */
const handleRequest = jest.fn()
const server = createServer((socket) => serve({ handleRequest }, socket, { daemonVersion: '9.9.9' }))

/**
 * Sends a request through the real contract and returns what the daemon core
 * received and what the client got back.
 *
 * @param {Record<string, any>} request - The request the client sends.
 * @param {Record<string, any>} response - The response the daemon core returns.
 * @returns {Promise<{ received: Record<string, any>, returned: Record<string, any> }>} Both ends.
 */
async function roundTrip (request, response) {
  handleRequest.mockResolvedValueOnce(response)
  const socket = connect(SOCKET_PATH)
  const rpc = new HRPC(socket)
  try {
    const { method } = getActionContract(request.action)
    const returned = fromWireResponse(request.action, await rpc[method](toWireRequest(request)))
    return { received: handleRequest.mock.calls.at(-1)[0], returned }
  } finally {
    socket.destroy()
  }
}

beforeAll(async () => {
  await new Promise((resolve) => server.listen(SOCKET_PATH, () => resolve(undefined)))
})

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve(undefined)))
  rmSync(tempDir, { recursive: true, force: true })
})

describe('daemon HRPC contract', () => {
  it('carries an empty passphrase and a ttl of 0, which means no expiry', async () => {
    const { received } = await roundTrip(
      { action: 'unlock_wallet', wallet: 'main', passphrase: '', ttl: 0 },
      { ok: true, data: { message: "Wallet 'main' unlocked", wallet: 'main' } }
    )

    expect(received).toEqual({ action: 'unlock_wallet', wallet: 'main', passphrase: '', ttl: 0 })
  })

  it('carries method arguments and every falsy method result', async () => {
    const request = { action: 'call_method', wallet: 'main', network: 'ethereum', index: 2, method: 'approve', args: { token: '0xT', amount: '0' } }

    for (const result of [false, 0, '', null, { allowance: '5' }]) {
      const { received, returned } = await roundTrip(request, { ok: true, data: { result, address: '0xA' } })

      expect(received).toMatchObject(request)
      expect(returned).toEqual({ ok: true, data: { result, address: '0xA' } })
    }
  })

  it('carries a false verification and zero decimals', async () => {
    const verify = await roundTrip(
      { action: 'verify_message', network: 'ethereum', message: 'hi', signature: '0xS' },
      { ok: true, data: { valid: false, address: '0xA' } }
    )
    const balance = await roundTrip(
      { action: 'get_balance', network: 'ethereum', token: '0xT' },
      { ok: true, data: { balance: '0', symbol: 'TKN', decimals: 0, address: '0xA' } }
    )

    expect(verify.returned).toEqual({ ok: true, data: { valid: false, address: '0xA' } })
    expect(balance.returned).toEqual({ ok: true, data: { balance: '0', symbol: 'TKN', decimals: 0, address: '0xA' } })
  })

  it('leaves out a field the daemon did not set, as before', async () => {
    const { returned } = await roundTrip(
      { action: 'send', network: 'ethereum', to: '0xB', amount: '1' },
      { ok: true, data: { txHash: '0xH', network: 'ethereum', from: '0xA', to: '0xB', amount: '1', fee: undefined } }
    )

    expect(returned).toEqual({ ok: true, data: { txHash: '0xH', network: 'ethereum', from: '0xA', to: '0xB', amount: '1' } })
    expect('fee' in returned.data).toBe(false)
  })

  it('carries a quote request and its result', async () => {
    const quoteRequest = {
      fromToken: { address: '0xT', decimals: 6, symbol: 'USDT', isNative: false },
      toToken: { decimals: 18, symbol: 'ETH', isNative: true },
      toChain: 42161,
      amountIn: '1000000',
      fromSymbol: 'USDT',
      toSymbol: 'ETH',
      toNetwork: 'arbitrum'
    }
    const quote = { protocol: 'velora', from: '0xA', outputAmount: '5', fees: { gas: '1', items: [] }, skipped: [{ protocol: 'rhino', reason: 'no route' }] }

    const { received, returned } = await roundTrip(
      { action: 'quote_bridge', network: 'ethereum', protocol: 'velora', request: quoteRequest },
      { ok: true, data: quote }
    )

    expect(received.request).toEqual(quoteRequest)
    expect(returned).toEqual({ ok: true, data: quote })
  })

  it('carries a transaction receipt and the wallet status list', async () => {
    const receipt = { hash: '0xH', finality: 'confirmed', blockNumber: '12' }
    const status = { unlocked: true, wallets: [{ name: 'main', ttlMs: 0, ttlRemaining: 0 }], pid: 7 }

    const tx = await roundTrip({ action: 'get_transaction', network: 'ethereum', hash: '0xH', finality: 'confirmed', timeout: 1000 }, { ok: true, data: { transaction: receipt } })
    const st = await roundTrip({ action: 'status' }, { ok: true, data: status })

    expect(tx.received).toMatchObject({ hash: '0xH', finality: 'confirmed', timeout: 1000 })
    expect(tx.returned).toEqual({ ok: true, data: { transaction: receipt } })
    expect(st.returned).toEqual({ ok: true, data: status })
  })

  it('carries an error with its code and suggestion, and one without', async () => {
    const coded = await roundTrip(
      { action: 'get_address', network: 'ethereum', wallet: 'main' },
      { ok: false, error: "Wallet 'main' is not unlocked.", code: 'WALLET_NOT_UNLOCKED', suggestion: 'Run: wdk wallet unlock --name main' }
    )
    const plain = await roundTrip({ action: 'lock_wallet', wallet: 'main' }, { ok: false, error: "Wallet 'main' is not unlocked" })

    expect(coded.returned).toEqual({ ok: false, error: "Wallet 'main' is not unlocked.", code: 'WALLET_NOT_UNLOCKED', suggestion: 'Run: wdk wallet unlock --name main' })
    expect(plain.returned).toEqual({ ok: false, error: "Wallet 'main' is not unlocked" })
  })

  it('answers with an internal error when the daemon core throws', async () => {
    handleRequest.mockRejectedValueOnce(new Error('boom'))
    const socket = connect(SOCKET_PATH)
    const rpc = new HRPC(socket)

    const wire = await rpc.status({})
    socket.destroy()

    expect(fromWireResponse('status', wire)).toEqual({ ok: false, error: 'Internal error' })
  })
})
