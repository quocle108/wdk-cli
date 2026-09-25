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

import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { Cli } from './helpers.js'

const catalog = createRequire(import.meta.url)('../../wdk.config.json')
const MOONPAY_MODULE = catalog.providers.moonpay.module
const BITFINEX_MODULE = catalog.providers.bitfinex.module

/** @type {Cli} */
let cli

beforeEach(() => { cli = new Cli() })
afterEach(() => cli.cleanup())

describe('token registry', () => {
  it('lists the packaged tokens for a network', async () => {
    const { tokens } = await cli.json(['token', 'list', '--network', 'ethereum'])

    expect(Object.keys(tokens).sort()).toEqual(['eth', 'usdt', 'xaut'])
  })

  it('shows a token with its slugs', async () => {
    const info = await cli.json(['token', 'info', '--network', 'ethereum', '--token', 'usdt'])

    expect(info).toMatchObject({ symbol: 'USDT', decimals: 6, isNative: false })
  })

  it('reports a token the registry does not carry', async () => {
    const result = await cli.run(['token', 'info', '--network', 'ethereum', '--token', 'nope'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Token 'nope' not found on 'ethereum'.")
  })

  it('reports a network that does not exist', async () => {
    const result = await cli.run(['token', 'list', '--network', 'atlantis'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Network 'atlantis' is not supported.")
  })

  it('adds a custom token and reads it back', async () => {
    await cli.json(['token', 'add', JSON.stringify({
      network: 'ethereum', token: 'dai', symbol: 'DAI', decimals: 18, isNative: false,
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
    })])

    const info = await cli.json(['token', 'info', '--network', 'ethereum', '--token', 'dai'])

    expect(info).toMatchObject({ symbol: 'DAI', decimals: 18 })
  })

  it('warns when a custom token shadows a packaged one', async () => {
    const result = await cli.run(['token', 'add', JSON.stringify({
      network: 'ethereum', token: 'usdt', symbol: 'USDT', decimals: 6, isNative: false,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    })])

    expect(result.output).toContain('overrides it')
  })

  it('refuses to delete a packaged token', async () => {
    const result = await cli.run(['token', 'delete', '--network', 'ethereum', '--token', 'usdt'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('built-in token')
  })

  it('reverts to the packaged token when the override is deleted', async () => {
    await cli.json(['token', 'add', JSON.stringify({
      network: 'ethereum', token: 'usdt', symbol: 'FAKE', decimals: 2, isNative: false,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    })])

    await cli.run(['token', 'delete', '--network', 'ethereum', '--token', 'usdt'])
    const info = await cli.json(['token', 'info', '--network', 'ethereum', '--token', 'usdt'])

    expect(info.symbol).toBe('USDT')
  })
})
describe('token enable and disable', () => {
  it('marks a disabled token in the listing', async () => {
    await cli.run(['token', 'disable', '--network', 'ethereum', '--token', 'usdt'])

    const { disabled } = await cli.json(['token', 'list', '--network', 'ethereum'])

    expect(disabled).toContain('ethereum/usdt')
  })

  it('brings a disabled token back', async () => {
    await cli.run(['token', 'disable', '--network', 'ethereum', '--token', 'usdt'])

    await cli.run(['token', 'enable', '--network', 'ethereum', '--token', 'usdt'])
    const { disabled } = await cli.json(['token', 'list', '--network', 'ethereum'])

    expect(disabled).not.toContain('ethereum/usdt')
  })
})
