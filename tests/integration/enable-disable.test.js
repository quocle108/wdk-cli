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

// Disabling one entry in the registry is felt in the others: a module hides the
// networks it backs, a network hides its tokens, a provider stops serving the
// command that consumes it. Each case here crosses at least two registries, so
// no single-service unit test covers it.

import { createRequire } from 'node:module'
import { Cli } from './helpers.js'

const catalog = createRequire(import.meta.url)('../../wdk.config.json')

const SEED = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const EVM_MODULE = '@tetherto/wdk-wallet-evm'
const INDEXER_MODULE = '@tetherto/wdk-indexer-http'
const PRICING_MODULE = '@tetherto/wdk-pricing-bitfinex-http'

/** The networks the EVM wallet module backs, all of which it takes down with it. */
const EVM_NETWORKS = Object.entries(catalog.networks)
  .filter(([, entry]) => entry.module === EVM_MODULE)
  .map(([name]) => name)
const TOTAL_NETWORKS = Object.keys(catalog.networks).length
const PROVIDER_COUNT = Object.keys(catalog.providers).length

/** Every provider the catalog ships, with the module behind it. */
const PROVIDERS = Object.entries(catalog.providers).map(([name, entry]) => ({
  name,
  kind: entry.kind,
  module: entry.module
}))

/** @type {Cli} */
let cli

beforeEach(() => {
  cli = new Cli()
})

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

/**
 * Disables a module and returns what the command reported.
 *
 * @param {string} name - The module package name.
 * @returns {Promise<Record<string, unknown>>} The command's JSON payload.
 */
function disableModule (name) {
  return cli.json(['module', 'disable', '--name', name], { unlocked: true })
}

describe('a disabled module and the networks it backs', () => {
  it('takes down every network on that module and leaves the others alone', async () => {
    const before = await cli.json(['network', 'list'])
    expect(before.networks).toHaveLength(TOTAL_NETWORKS)

    await disableModule(EVM_MODULE)

    const { networks } = await cli.json(['network', 'list'])
    const names = networks.map((n) => n.name)
    expect(networks).toHaveLength(TOTAL_NETWORKS - EVM_NETWORKS.length)
    for (const network of EVM_NETWORKS) expect(names).not.toContain(network)
    expect(names).toContain('solana')
  })

  it('hides a module-disabled network but only flags a user-disabled one', async () => {
    await cli.json(['network', 'disable', '--name', 'arbitrum'], { unlocked: true })

    const flagged = await cli.json(['network', 'list'])
    expect(flagged.networks.find((n) => n.name === 'arbitrum').enabled).toBe(false)

    await disableModule(EVM_MODULE)

    const hidden = await cli.json(['network', 'list'])
    expect(hidden.networks.find((n) => n.name === 'arbitrum')).toBeUndefined()
  })

  it('tells every command that touches the network to enable the module', async () => {
    await disableModule(EVM_MODULE)

    for (const args of [
      ['network', 'info', '--network', 'ethereum'],
      ['token', 'list', '--network', 'ethereum'],
      ['method', 'list', '--network', 'ethereum']
    ]) {
      const result = await cli.run(args, { unlocked: true })

      expect(result.code).toBe(1)
      expect(result.output).toContain("Network 'ethereum' is disabled.")
      expect(result.output).toContain(`wdk module enable --name ${EVM_MODULE}`)
    }
  })

  it('refuses to re-enable the network on its own', async () => {
    await disableModule(EVM_MODULE)

    const result = await cli.run(['network', 'enable', '--name', 'ethereum'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("Network 'ethereum' is disabled by its module.")
  })

  it('keeps a network the user disabled off after the module comes back', async () => {
    await cli.json(['network', 'disable', '--name', 'arbitrum'], { unlocked: true })
    await disableModule(EVM_MODULE)
    await cli.json(['module', 'enable', '--name', EVM_MODULE], { unlocked: true })

    const { networks } = await cli.json(['network', 'list'])

    expect(networks).toHaveLength(TOTAL_NETWORKS)
    expect(networks.find((n) => n.name === 'arbitrum').enabled).toBe(false)
    expect(networks.find((n) => n.name === 'ethereum').enabled).toBe(true)
  })
})

describe('a disabled module and the provider it serves', () => {
  // Every kind is meant to behave the same here, so drive the same contract from
  // the catalog: a new provider kind is covered the day it is registered.
  it.each(PROVIDERS)('hides the $kind provider $name when its module goes', async (provider) => {
    const before = await cli.json(['provider', 'list'])
    expect(before.providers).toHaveLength(PROVIDER_COUNT)
    expect(before.providers.find((p) => p.name === provider.name).enabled).toBe(true)

    await disableModule(provider.module)

    const { providers } = await cli.json(['provider', 'list'])
    expect(providers).toHaveLength(PROVIDER_COUNT - 1)
    expect(providers.find((p) => p.name === provider.name)).toBeUndefined()

    const info = await cli.json(['provider', 'info', '--name', provider.name])
    expect(info.enabled).toBe(false)

    const result = await cli.run(['provider', 'enable', '--name', provider.name], { unlocked: true })
    expect(result.code).toBe(1)
    expect(result.output).toContain(`Provider '${provider.name}' is disabled by its module.`)
    expect(result.output).toContain(`wdk module enable --name ${provider.module}`)
  })

  it('leaves a provider of the same kind on a different module alone', async () => {
    await disableModule(catalog.providers.moonpay.module)

    const { providers } = await cli.json(['provider', 'list'])

    expect(providers.find((p) => p.name === 'moonpay')).toBeUndefined()
    expect(providers.find((p) => p.name === 'transak').enabled).toBe(true)
  })

  it('fails the command that consumes the provider', async () => {
    await disableModule(INDEXER_MODULE)

    const result = await cli.run(['get', 'history', '--network', 'ethereum'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain('No indexer is available.')
  })
})

describe('a provider disabled on its own', () => {
  // The contrast with a module disable: this one stays visible and flagged,
  // because the user can undo it directly.
  it.each(PROVIDERS)('keeps the $kind provider $name listed but off', async (provider) => {
    const off = await cli.json(['provider', 'disable', '--name', provider.name], { unlocked: true })
    expect(off.enabled).toBe(false)

    const { providers } = await cli.json(['provider', 'list'])
    expect(providers).toHaveLength(PROVIDER_COUNT)
    expect(providers.find((p) => p.name === provider.name).enabled).toBe(false)

    const on = await cli.json(['provider', 'enable', '--name', provider.name], { unlocked: true })
    expect(on.enabled).toBe(true)
  })

  it('refuses to disable one that is already off', async () => {
    await cli.json(['provider', 'disable', '--name', 'velora'], { unlocked: true })

    const result = await cli.run(['provider', 'disable', '--name', 'velora'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("'velora' is already disabled.")
  })

  it('keeps its own disable through a module cycle', async () => {
    const { module: moduleName } = catalog.providers.velora
    await cli.json(['provider', 'disable', '--name', 'velora'], { unlocked: true })

    await disableModule(moduleName)
    await cli.json(['module', 'enable', '--name', moduleName], { unlocked: true })

    const { providers } = await cli.json(['provider', 'list'])
    expect(providers.find((p) => p.name === 'velora').enabled).toBe(false)
  })
})

describe('a kind with no provider left enabled', () => {
  it('fails buy and sell once every fiat provider is off', async () => {
    await importAndUnlock()
    await cli.json(['provider', 'disable', '--name', 'moonpay'], { unlocked: true })
    await cli.json(['provider', 'disable', '--name', 'transak'], { unlocked: true })
    await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })

    for (const command of ['buy', 'sell']) {
      const result = await cli.run(
        [command, '--network', 'ethereum', '--token', 'usdt', '--fiat-amount', '100'],
        { unlocked: true }
      )

      expect(result.code).toBe(1)
      expect(result.output).toContain('No fiat provider is available.')
    }
  })

  it('fails swap once nothing can swap', async () => {
    await importAndUnlock()
    for (const name of ['velora', 'rhinofi', 'symbiosis']) {
      await cli.json(['provider', 'disable', '--name', name], { unlocked: true })
    }
    await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })

    const result = await cli.run(
      ['swap', '--network', 'ethereum', '--from-token', 'usdt', '--to-token', 'eth', '--amount-in', '1'],
      { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain('No installed protocol can swap.')
  })

  it('fails bridge once nothing can bridge', async () => {
    await importAndUnlock()
    for (const name of ['usdt0', 'rhinofi', 'symbiosis']) {
      await cli.json(['provider', 'disable', '--name', name], { unlocked: true })
    }
    await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })

    const result = await cli.run(
      ['bridge', '--network', 'ethereum', '--token', 'eth', '--to-network', 'arbitrum', '--amount', '1'],
      { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain('No installed protocol can bridge.')
  })
})

describe('kinds that allow only one provider at a time', () => {
  const SECOND_FEED = JSON.stringify({
    name: 'second-feed',
    kind: 'pricing',
    module: catalog.providers.bitfinex.module,
    config: {}
  })

  it('refuses a second price feed while one is enabled', async () => {
    const result = await cli.run(['provider', 'add', SECOND_FEED], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain('A price feed is already enabled: bitfinex.')
  })

  it('accepts the second once the first is off, then guards the way back', async () => {
    await cli.json(['provider', 'disable', '--name', 'bitfinex'], { unlocked: true })

    const added = await cli.json(['provider', 'add', SECOND_FEED], { unlocked: true })
    expect(added.name).toBe('second-feed')

    const result = await cli.run(['provider', 'enable', '--name', 'bitfinex'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain('A price feed is already enabled: second-feed.')
  })

  it('lets a multi-instance kind run two providers at once', async () => {
    const { providers } = await cli.json(['provider', 'list'])

    const fiat = providers.filter((p) => p.kind === 'fiat')
    const swidge = providers.filter((p) => p.kind === 'swidge')
    expect(fiat.every((p) => p.enabled)).toBe(true)
    expect(swidge.every((p) => p.enabled)).toBe(true)
    expect(fiat).toHaveLength(2)
    expect(swidge).toHaveLength(2)
  })
})

describe('naming a provider explicitly', () => {
  it('refuses a provider the user disabled', async () => {
    await importAndUnlock()
    await cli.json(['provider', 'disable', '--name', 'transak'], { unlocked: true })
    await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })

    const result = await cli.run(
      ['buy', '--network', 'ethereum', '--token', 'usdt', '--fiat-amount', '100',
        '--provider', 'transak'],
      { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain("Protocol 'transak' is disabled.")
  })

  it('lists what is available when the name is unknown', async () => {
    await importAndUnlock()

    const result = await cli.run(
      ['buy', '--network', 'ethereum', '--token', 'usdt', '--fiat-amount', '100',
        '--provider', 'nosuch'],
      { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain("Unknown protocol 'nosuch'.")
    expect(result.output).toContain('moonpay')
  })
})

describe('a provider the user added', () => {
  const CUSTOM = JSON.stringify({
    name: 'myramp',
    kind: 'fiat',
    module: catalog.providers.moonpay.module,
    config: {}
  })

  it('can be disabled and then deleted, unlike a built-in', async () => {
    const added = await cli.json(['provider', 'add', CUSTOM], { unlocked: true })
    expect(added.name).toBe('myramp')

    const off = await cli.json(['provider', 'disable', '--name', 'myramp'], { unlocked: true })
    expect(off.enabled).toBe(false)

    const deleted = await cli.json(['provider', 'delete', '--name', 'myramp'], { unlocked: true })
    expect(deleted.deleted).toBe(true)

    const { providers } = await cli.json(['provider', 'list'])
    expect(providers.find((p) => p.name === 'myramp')).toBeUndefined()
  })

  it('takes its disable override with it when deleted', async () => {
    await cli.json(['provider', 'add', CUSTOM], { unlocked: true })
    await cli.json(['provider', 'disable', '--name', 'myramp'], { unlocked: true })
    await cli.json(['provider', 'delete', '--name', 'myramp'], { unlocked: true })

    const result = await cli.run(['provider', 'enable', '--name', 'myramp'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("'myramp' is not a provider.")
  })
})

describe('an override left behind by something that no longer exists', () => {
  it('is cleared on the next enable, once', async () => {
    cli.writeConfig({ overrides: { providers: { ghost: { enabled: false } } } })

    const cleared = await cli.json(['provider', 'enable', '--name', 'ghost'], { unlocked: true })
    expect(cleared.stale).toBe(true)

    const again = await cli.run(['provider', 'enable', '--name', 'ghost'], { unlocked: true })
    expect(again.code).toBe(1)
    expect(again.output).toContain("'ghost' is not a provider.")
  })
})

describe('provider config across a module cycle', () => {
  it('keeps the general config and the per-network override', async () => {
    const indexerKey = 'providers.wdk-indexer.config.apiKey'
    const veloraKey = 'providers.velora.networks.ethereum.slippage'
    await cli.json(['config', 'set', '--key', indexerKey, '--value', 'secret-abc'], { unlocked: true })
    await cli.json(['config', 'set', '--key', veloraKey, '--value', '50'], { unlocked: true })

    await disableModule(INDEXER_MODULE)
    await cli.json(['module', 'enable', '--name', INDEXER_MODULE], { unlocked: true })

    expect((await cli.json(['config', 'get', '--key', indexerKey])).value).toBe('secret-abc')
    expect((await cli.json(['config', 'get', '--key', veloraKey])).value).toBe(50)
  })
})

describe('a disabled module and an open wallet session', () => {
  it('locks the open wallets when the module backs a network', async () => {
    await importAndUnlock()

    const disabled = await disableModule(EVM_MODULE)

    expect(disabled.walletsLocked).toBe(true)
    const { wallets } = await cli.json(['wallet', 'list'])
    expect(wallets).toHaveLength(1)
    expect(wallets[0].unlocked).toBe(false)
  })

  // applyToggle locks unconditionally, so even a price feed that has nothing to
  // do with key derivation costs the user their session. Blunt, but safe: pinning
  // it here means narrowing it later has to be a deliberate change.
  it('locks them even when the module backs no network', async () => {
    await importAndUnlock()

    const disabled = await disableModule(PRICING_MODULE)

    expect(disabled.walletsLocked).toBe(true)
    const { wallets } = await cli.json(['wallet', 'list'])
    expect(wallets).toHaveLength(1)
    expect(wallets[0].unlocked).toBe(false)
  })
})

describe('a disabled token under a network and module cycle', () => {
  it('stays disabled after its network is switched off and on', async () => {
    await cli.json(['token', 'disable', '--network', 'ethereum', '--token', 'usdt'], { unlocked: true })

    await cli.json(['network', 'disable', '--name', 'ethereum'], { unlocked: true })
    await cli.json(['network', 'enable', '--name', 'ethereum'], { unlocked: true })

    const { disabled } = await cli.json(['token', 'list', '--network', 'ethereum'])
    expect(disabled).toEqual(['ethereum/usdt'])
  })

  it('stays disabled after its module is switched off and on', async () => {
    await cli.json(['token', 'disable', '--network', 'ethereum', '--token', 'usdt'], { unlocked: true })

    await disableModule(EVM_MODULE)
    await cli.json(['module', 'enable', '--name', EVM_MODULE], { unlocked: true })

    const { disabled } = await cli.json(['token', 'list', '--network', 'ethereum'])
    expect(disabled).toEqual(['ethereum/usdt'])
  })
})
