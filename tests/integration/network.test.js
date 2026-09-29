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
import { Cli } from './helpers.js'

const catalog = createRequire(import.meta.url)('../../wdk.config.json')
const MOONPAY_MODULE = catalog.providers.moonpay.module
const TESTNET_COUNT = Object.values(catalog.networks).filter((n) => n.testnet).length

const SEED = 'cook voyage document eight skate token alien guide drink uncle term abuse'
/** The address this seed derives on any EVM network at index 0. */
const ETHEREUM_0 = '0x405005C7c4422390F4B334F64Cf20E0b767131d0'
const EVM_MODULE = '@tetherto/wdk-wallet-evm'
const DAI = '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'

/** A custom EVM network with its native asset declared inline. */
const SPEC = JSON.stringify({
  network: 'optimism',
  module: EVM_MODULE,
  displayName: 'Optimism',
  config: { provider: 'https://mainnet.optimism.io', chainId: 10 },
  tokens: [{ token: 'eth', symbol: 'ETH', decimals: 18, isNative: true }]
})

/** @type {Cli} */
let cli

beforeEach(() => { cli = new Cli() })
afterEach(async () => {
  await cli.run(['wallet', 'lock', '--all'], { unlocked: true })
  cli.cleanup()
})

/**
 * Imports the fixed test seed and unlocks it.
 *
 * @returns {Promise<void>}
 */
async function importAndUnlock () {
  await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
    unlocked: true,
    stdin: SEED + '\n'
  })
  await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })
}

describe('network registry', () => {
  it('lists the packaged networks', async () => {
    const { networks } = await cli.json(['network', 'list'])

    expect(networks.length).toBe(22)
  })

  it('separates testnets behind a flag', async () => {
    const { networks } = await cli.json(['network', 'list', '--testnet'])

    expect(networks).toHaveLength(TESTNET_COUNT)
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

describe('a network the user creates', () => {
  it('derives on the real module, not a registry stub', async () => {
    await cli.json(['network', 'create', SPEC], { unlocked: true })
    await importAndUnlock()

    const derived = await cli.json(['get', 'address', '--network', 'optimism'], { unlocked: true })

    // Same module and BIP-44 path as the packaged EVM networks, so the same
    // seed must produce the same address. A registry entry alone could not.
    expect(derived.address).toBe(ETHEREUM_0)
    expect(derived.index).toBe(0)
  })

  it('registers the tokens declared in its spec', async () => {
    await cli.json(['network', 'create', SPEC], { unlocked: true })

    const { tokens } = await cli.json(['token', 'list', '--network', 'optimism'])

    expect(Object.keys(tokens)).toEqual(['eth'])
    expect(tokens.eth.symbol).toBe('ETH')
    expect(tokens.eth.isNative).toBe(true)
  })

  it('accepts a token added after the fact', async () => {
    await cli.json(['network', 'create', SPEC], { unlocked: true })

    await cli.json(['token', 'add', JSON.stringify({
      network: 'optimism', token: 'dai', symbol: 'DAI', decimals: 18, isNative: false, address: DAI
    })], { unlocked: true })

    const { tokens } = await cli.json(['token', 'list', '--network', 'optimism'])
    expect(Object.keys(tokens)).toEqual(['eth', 'dai'])
    expect(tokens.dai.address).toBe(DAI)
  })

  it('follows its module into and out of a disable', async () => {
    await cli.json(['network', 'create', SPEC], { unlocked: true })

    await cli.json(['module', 'disable', '--name', EVM_MODULE], { unlocked: true })
    const hidden = await cli.json(['network', 'list'])
    expect(hidden.networks.find((n) => n.name === 'optimism')).toBeUndefined()

    await cli.json(['module', 'enable', '--name', EVM_MODULE], { unlocked: true })
    const back = await cli.json(['network', 'list'])
    expect(back.networks.find((n) => n.name === 'optimism').enabled).toBe(true)
  })

  // The spec is validated in full before anything is written, so this covers
  // fail-fast validation. The rollback in the catch block — a token that passes
  // validation but fails on save — is a separate path and is NOT covered here.
  it('writes nothing when a token in the spec is rejected', async () => {
    const bad = JSON.stringify({
      network: 'optimism',
      module: EVM_MODULE,
      tokens: [
        { token: 'eth', symbol: 'ETH', decimals: 18, isNative: true },
        { token: 'bad', symbol: 'BAD', decimals: 6, isNative: false }
      ]
    })

    const result = await cli.run(['network', 'create', bad], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Non-native tokens require an "address".')

    const { networks } = await cli.json(['network', 'list'])
    expect(networks.find((n) => n.name === 'optimism')).toBeUndefined()
  })

  it('takes its custom tokens with it when deleted', async () => {
    await cli.json(['network', 'create', SPEC], { unlocked: true })
    await cli.json(['token', 'add', JSON.stringify({
      network: 'optimism', token: 'dai', symbol: 'DAI', decimals: 18, isNative: false, address: DAI
    })], { unlocked: true })

    await cli.json(['network', 'delete', '--name', 'optimism'], { unlocked: true })
    await cli.json(['network', 'create', SPEC], { unlocked: true })

    // Recreated under the same name: only the spec's own token may come back.
    const { tokens } = await cli.json(['token', 'list', '--network', 'optimism'])
    expect(Object.keys(tokens)).toEqual(['eth'])
  })
})
