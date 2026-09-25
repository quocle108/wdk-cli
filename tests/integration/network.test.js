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

describe('network registry', () => {
  it('lists the packaged networks', async () => {
    const { networks } = await cli.json(['network', 'list'])

    expect(networks.length).toBe(22)
  })

  it('separates testnets behind a flag', async () => {
    const { networks } = await cli.json(['network', 'list', '--testnet'])

    expect(networks.every((n) => n.testnet)).toBe(true)
  })

  it('refuses a network name that already exists', async () => {
    const result = await cli.run(['network', 'create', JSON.stringify({
      network: 'ethereum', module: '@tetherto/wdk-wallet-evm', chainId: 'eip155:1', displayName: 'X'
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Network 'ethereum' already exists.")
  })

  it('refuses a module that is not a wallet module', async () => {
    const result = await cli.run(['network', 'create', JSON.stringify({
      network: 'mychain', module: MOONPAY_MODULE, chainId: 'eip155:99', displayName: 'Mine'
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Network spec "module" must be one of')
  })

  it('refuses to delete a packaged network', async () => {
    const result = await cli.run(['network', 'delete', '--name', 'ethereum'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("'ethereum' is a built-in network and cannot be deleted.")
  })
})
describe('network info, enable and disable', () => {
  it('shows a packaged network', async () => {
    const info = await cli.json(['network', 'info', '--network', 'ethereum'])

    expect(info).toMatchObject({
      name: 'ethereum',
      displayName: 'Ethereum',
      module: '@tetherto/wdk-wallet-evm'
    })
  })

  it('reports a network that is not registered', async () => {
    const result = await cli.run(['network', 'info', '--network', 'atlantis'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Network 'atlantis' is not supported.")
  })

  it('drops a disabled network from the listing', async () => {
    await cli.run(['network', 'disable', '--name', 'polygon'])

    const { networks } = await cli.json(['network', 'list'])

    expect(networks.find((n) => n.name === 'polygon').enabled).toBe(false)
  })

  it('brings a disabled network back', async () => {
    await cli.run(['network', 'disable', '--name', 'polygon'])

    await cli.run(['network', 'enable', '--name', 'polygon'])
    const { networks } = await cli.json(['network', 'list'])

    expect(networks.find((n) => n.name === 'polygon').enabled).toBe(true)
  })

  it('refuses to disable a network twice', async () => {
    await cli.run(['network', 'disable', '--name', 'polygon'])

    const again = await cli.run(['network', 'disable', '--name', 'polygon'])

    expect(again.code).toBe(1)
  })
})
