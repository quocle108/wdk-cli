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
const BITFINEX_MODULE = catalog.providers.bitfinex.module

/** @type {Cli} */
let cli

const SEED = 'cook voyage document eight skate token alien guide drink uncle term abuse'

beforeEach(() => { cli = new Cli() })
afterEach(async () => {
  await cli.run(['wallet', 'lock', '--all'], { unlocked: true })
  cli.cleanup()
})

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

describe('deleting a provider the user added', () => {
  const CUSTOM = JSON.stringify({
    name: 'myramp', kind: 'fiat', module: MOONPAY_MODULE, config: {}
  })

  it('deletes one that is still enabled, without disabling it first', async () => {
    await cli.json(['provider', 'add', CUSTOM], { unlocked: true })

    const deleted = await cli.json(['provider', 'delete', '--name', 'myramp'], { unlocked: true })

    expect(deleted).toMatchObject({ name: 'myramp', deleted: true })
    const { providers } = await cli.json(['provider', 'list'])
    expect(providers.find((p) => p.name === 'myramp')).toBeUndefined()
  })

  it('leaves the packaged providers of the same kind alone', async () => {
    await cli.json(['provider', 'add', CUSTOM], { unlocked: true })

    await cli.json(['provider', 'delete', '--name', 'myramp'], { unlocked: true })

    const { providers } = await cli.json(['provider', 'list'])
    expect(providers.find((p) => p.name === 'moonpay').enabled).toBe(true)
    expect(providers.find((p) => p.name === 'transak').enabled).toBe(true)
  })

  it('frees the slot on a kind that allows only one', async () => {
    await cli.json(['provider', 'disable', '--name', 'bitfinex'], { unlocked: true })
    await cli.json(['provider', 'add', JSON.stringify({
      name: 'feed2', kind: 'pricing', module: BITFINEX_MODULE, config: {}
    })], { unlocked: true })

    const blocked = await cli.run(['provider', 'enable', '--name', 'bitfinex'], { unlocked: true })
    expect(blocked.code).toBe(1)
    expect(blocked.output).toContain('A price feed is already enabled: feed2.')

    await cli.json(['provider', 'delete', '--name', 'feed2'], { unlocked: true })

    const freed = await cli.run(['provider', 'enable', '--name', 'bitfinex'], { unlocked: true })
    expect(freed.code).toBe(0)
    expect(freed.output).toContain("Provider 'bitfinex' enabled.")
  })

  it('takes its stored config with it, so a later provider starts clean', async () => {
    await cli.json(['provider', 'add', CUSTOM], { unlocked: true })
    await cli.json(
      ['config', 'set', '--key', 'providers.myramp.config.apiKey', '--value', 'SUPER-SECRET'],
      { unlocked: true }
    )

    await cli.json(['provider', 'delete', '--name', 'myramp'], { unlocked: true })

    const orphan = await cli.json(['config', 'get', '--key', 'providers.myramp.config.apiKey'])
    expect(orphan.value).toBeNull()

    // The name is reusable, so a leftover key would be merged into whatever is
    // registered next under it — a different service holding the old secret.
    await cli.json(['provider', 'add', CUSTOM], { unlocked: true })
    const info = await cli.json(['provider', 'info', '--name', 'myramp'])
    expect(info.config).toEqual({})
  })

  it('leaves the config of a packaged provider alone', async () => {
    await cli.json(
      ['config', 'set', '--key', 'providers.wdk-indexer.config.apiKey', '--value', 'keep-me'],
      { unlocked: true }
    )
    await cli.json(['provider', 'add', CUSTOM], { unlocked: true })

    await cli.json(['provider', 'delete', '--name', 'myramp'], { unlocked: true })

    const kept = await cli.json(['config', 'get', '--key', 'providers.wdk-indexer.config.apiKey'])
    expect(kept.value).toBe('keep-me')
  })

  it('releases the name for a later add', async () => {
    await cli.json(['provider', 'add', CUSTOM], { unlocked: true })
    await cli.json(['provider', 'delete', '--name', 'myramp'], { unlocked: true })

    const readded = await cli.json(['provider', 'add', CUSTOM], { unlocked: true })

    expect(readded.name).toBe('myramp')
    const { providers } = await cli.json(['provider', 'list'])
    expect(providers.filter((p) => p.name === 'myramp')).toHaveLength(1)
  })
})

describe('a provider the user added, in use', () => {
  // Registering a provider is only half of it: the resolver has to pick it.
  // Exercising one for real needs its API, so this goes as far as selection,
  // which is the part the CLI owns.
  it('is selected once the packaged providers of its kind are off', async () => {
    await cli.json(['provider', 'add', JSON.stringify({
      name: 'myramp', kind: 'fiat', module: MOONPAY_MODULE, config: {}
    })], { unlocked: true })
    await cli.json(['provider', 'disable', '--name', 'moonpay'], { unlocked: true })
    await cli.json(['provider', 'disable', '--name', 'transak'], { unlocked: true })

    await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
      unlocked: true,
      stdin: SEED + '\n'
    })
    await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })

    const result = await cli.run(
      ['buy', '--network', 'ethereum', '--token', 'usdt', '--fiat-amount', '100'],
      { unlocked: true }
    )

    // Naming myramp's own missing mapping proves it was resolved and asked for
    // its slug — not that the kind had no provider at all.
    expect(result.code).toBe(1)
    expect(result.output).toContain("Token 'usdt' on 'ethereum' has no myramp mapping.")
  })
})
