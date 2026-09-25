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

describe('provider list and info', () => {
  it('lists every packaged provider, pricing first', async () => {
    const { providers, count } = await cli.json(['provider', 'list'])

    expect(count).toBe(8)
    expect(providers.map((p) => p.name)).toEqual([
      'wdk-indexer', 'bitfinex', 'moonpay', 'transak', 'velora', 'usdt0', 'rhinofi', 'symbiosis'
    ])
  })

  it('reports the indexer with the client package backing it', async () => {
    const info = await cli.json(['provider', 'info', '--name', 'wdk-indexer'])

    expect(info).toMatchObject({
      name: 'wdk-indexer',
      kind: 'indexer',
      module: '@tetherto/wdk-indexer-http',
      source: 'built-in'
    })
  })

  it('reports an unknown provider by name', async () => {
    const result = await cli.run(['provider', 'info', '--name', 'nope'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Unknown provider 'nope'.")
  })
})

describe('provider add', () => {
  it('refuses a kind the registry does not define', async () => {
    const result = await cli.run(['provider', 'add', JSON.stringify({
      name: 'x', kind: 'lending', module: MOONPAY_MODULE
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Provider spec "kind" must be one of')
  })

  it('refuses an indexer, which ships with the CLI', async () => {
    const result = await cli.run(['provider', 'add', JSON.stringify({
      name: 'myidx', kind: 'indexer', module: MOONPAY_MODULE
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Indexer providers cannot be added.')
  })

  it('refuses a second price feed while the packaged one is enabled', async () => {
    const result = await cli.run(['provider', 'add', JSON.stringify({
      name: 'cg', kind: 'pricing', module: BITFINEX_MODULE
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain('A price feed is already enabled: bitfinex.')
  })

  it('accepts a price feed once the packaged one is disabled', async () => {
    await cli.run(['provider', 'disable', '--name', 'bitfinex'])

    const added = await cli.json(['provider', 'add', JSON.stringify({
      name: 'cg', kind: 'pricing', module: BITFINEX_MODULE
    })])

    expect(added).toMatchObject({ name: 'cg', kind: 'pricing', added: true })
  })

  it('refuses a module that is not registered', async () => {
    const result = await cli.run(['provider', 'add', JSON.stringify({
      name: 'x', kind: 'swap', module: '@nobody/not-installed'
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Module '@nobody/not-installed' is not registered.")
  })

  it('refuses a name that is already taken', async () => {
    const result = await cli.run(['provider', 'add', JSON.stringify({
      name: 'moonpay', kind: 'fiat', module: MOONPAY_MODULE
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain("'moonpay' is a built-in provider.")
  })

  it('refuses a spec that is not an object', async () => {
    const result = await cli.run(['provider', 'add', '"just a string"'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Cannot read <data>')
  })

  it('refuses malformed JSON', async () => {
    const result = await cli.run(['provider', 'add', '{not json'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Invalid JSON in <data>')
  })

  it('persists endpointKeys so the module is handed a callback', async () => {
    await cli.json(['provider', 'add', JSON.stringify({
      name: 'banxa',
      kind: 'fiat',
      module: MOONPAY_MODULE,
      endpointKeys: ['widgetUrl'],
      config: { apiKey: 'dummy-key', widgetUrl: 'https://dummy-signer.test/sign' }
    })])

    expect(cli.readConfig().customProviders.banxa.endpointKeys).toEqual(['widgetUrl'])
  })

  it('refuses endpointKeys that are not strings', async () => {
    const result = await cli.run(['provider', 'add', JSON.stringify({
      name: 'banxa', kind: 'fiat', module: MOONPAY_MODULE, endpointKeys: [1]
    })])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Provider spec "endpointKeys" must be an array of non-empty strings.')
  })
})

describe('provider enable, disable and delete', () => {
  it('refuses to delete a packaged provider', async () => {
    const result = await cli.run(['provider', 'delete', '--name', 'bitfinex'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("'bitfinex' is a built-in provider and cannot be deleted.")
  })

  it('reports a delete for a provider that was never added', async () => {
    const result = await cli.run(['provider', 'delete', '--name', 'ghost'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Provider 'ghost' is not a custom provider.")
  })

  it('marks a disabled provider in the listing', async () => {
    await cli.run(['provider', 'disable', '--name', 'moonpay'])

    const { providers } = await cli.json(['provider', 'list'])

    expect(providers.find((p) => p.name === 'moonpay').enabled).toBe(false)
  })

  it('refuses to enable a second indexer', async () => {
    const config = cli.readConfig()
    config.customProviders = { myidx: { kind: 'indexer', config: {} } }
    config.overrides = { providers: { myidx: { enabled: false } } }
    cli.writeConfig(config)

    const result = await cli.run(['provider', 'enable', '--name', 'myidx'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('An indexer is already enabled: wdk-indexer.')
  })

  it('always allows disabling, so a feed can be swapped', async () => {
    const result = await cli.run(['provider', 'disable', '--name', 'wdk-indexer'])

    expect(result.code).toBe(0)
  })

  it('refuses to disable something already disabled', async () => {
    await cli.run(['provider', 'disable', '--name', 'moonpay'])

    const again = await cli.run(['provider', 'disable', '--name', 'moonpay'])

    expect(again.code).toBe(1)
    expect(again.output).toContain("'moonpay' is already disabled.")
  })
})

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

describe('module registry', () => {
  it('reports every catalog module as installed and ok', async () => {
    const { modules } = await cli.json(['module', 'list'])

    expect(modules.every((m) => m.status === 'ok')).toBe(true)
  })

  it('treats a git-pinned module as satisfied rather than mismatched', async () => {
    const { modules } = await cli.json(['module', 'list'])
    const indexer = modules.find((m) => m.module === '@tetherto/wdk-indexer-http')

    expect(indexer.pinned).toContain('github:')
    expect(indexer.status).toBe('ok')
  })
})

describe('config', () => {
  it('reports where the config file lives', async () => {
    const result = await cli.run(['config', 'path'])

    expect(result.stdout.trim()).toBe(cli.configPath())
  })

  it('round-trips a value through set and get', async () => {
    await cli.run(['config', 'set', '--key', 'defaults.defaultIndex', '--value', '3'])

    const result = await cli.run(['config', 'get', '--key', 'defaults.defaultIndex'])

    expect(result.stdout.trim()).toBe('3')
  })

  it('reports a key that was never set, and still exits 0', async () => {
    const result = await cli.run(['config', 'get', '--key', 'nope.missing'])

    expect(result.output).toContain("Key 'nope.missing' is not set.")
    expect(result.code).toBe(0)
  })

  it('writes the value where the file can be read back', async () => {
    await cli.run(['config', 'set', '--key', 'providers.bitfinex.config.apiKey', '--value', 'k'])

    expect(cli.readConfig().providers.bitfinex.config.apiKey).toBe('k')
  })

  it('clears everything on reset', async () => {
    await cli.run(['config', 'set', '--key', 'defaults.defaultIndex', '--value', '3'])

    await cli.run(['config', 'reset', '--all'])
    const result = await cli.run(['config', 'get', '--key', 'defaults.defaultIndex'])

    expect(result.output).toContain("Key 'defaults.defaultIndex' is not set.")
  })

  it('keeps the config owner-only after a write', async () => {
    await cli.run(['config', 'set', '--key', 'defaults.defaultIndex', '--value', '1'])

    expect(statSync(cli.configPath()).mode & 0o077).toBe(0)
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

describe('module enable and disable', () => {
  it('reports a disabled module and hides its providers', async () => {
    await cli.run(['module', 'disable', '--name', '@tetherto/wdk-protocol-fiat-moonpay'])

    const { modules } = await cli.json(['module', 'list'])
    const { providers } = await cli.json(['provider', 'list'])

    expect(modules.find((m) => m.module === '@tetherto/wdk-protocol-fiat-moonpay').status)
      .toBe('disabled')
    expect(providers.find((p) => p.name === 'moonpay')).toBeUndefined()
  })

  it('brings a disabled module back', async () => {
    await cli.run(['module', 'disable', '--name', '@tetherto/wdk-protocol-fiat-moonpay'])

    await cli.run(['module', 'enable', '--name', '@tetherto/wdk-protocol-fiat-moonpay'])
    const { modules } = await cli.json(['module', 'list'])

    expect(modules.find((m) => m.module === '@tetherto/wdk-protocol-fiat-moonpay').status).toBe('ok')
  })
})
