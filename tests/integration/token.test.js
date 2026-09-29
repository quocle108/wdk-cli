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

import { Cli } from './helpers.js'

const SEED = 'cook voyage document eight skate token alien guide drink uncle term abuse'
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

/** A token the packaged registry does not carry. */
const CUSTOM_TOKEN = JSON.stringify({
  network: 'ethereum', token: 'dai', symbol: 'DAI', decimals: 18, isNative: false, address: DAI
})

/** An entry under a packaged key, to override it. */
const OVERRIDE = JSON.stringify({
  network: 'ethereum', token: 'usdt', symbol: 'USDT2', decimals: 8, isNative: false,
  address: '0x1111111111111111111111111111111111111111'
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

  it('adds a custom token, joining the packaged entries', async () => {
    const added = await cli.json(['token', 'add', CUSTOM_TOKEN])
    expect(added.added).toBe(true)

    const { tokens } = await cli.json(['token', 'list', '--network', 'ethereum'])
    expect(Object.keys(tokens)).toEqual(['eth', 'usdt', 'xaut', 'dai'])

    const info = await cli.json(['token', 'info', '--network', 'ethereum', '--token', 'dai'])
    expect(info).toMatchObject({ symbol: 'DAI', decimals: 18, address: DAI })
  })

  it('deletes a custom token, leaving the packaged entries untouched', async () => {
    await cli.json(['token', 'add', CUSTOM_TOKEN])

    const deleted = await cli.json(['token', 'delete', '--network', 'ethereum', '--token', 'dai'])
    expect(deleted.deleted).toBe(true)

    const { tokens } = await cli.json(['token', 'list', '--network', 'ethereum'])
    expect(Object.keys(tokens)).toEqual(['eth', 'usdt', 'xaut'])
  })

  it('warns when a custom token shadows a packaged one', async () => {
    const result = await cli.run(['token', 'add', JSON.stringify({
      network: 'ethereum', token: 'usdt', symbol: 'USDT', decimals: 6, isNative: false,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    })])

    expect(result.output).toContain('overrides it')
  })

  it('refuses to delete a packaged token, pointing at the override instead', async () => {
    const result = await cli.run(['token', 'delete', '--network', 'ethereum', '--token', 'usdt'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("'usdt' on 'ethereum' is a built-in token and cannot be deleted.")
    expect(result.output).toContain('wdk token add')
  })

  it('replaces the packaged fields under the same key', async () => {
    const added = await cli.json(['token', 'add', OVERRIDE])
    expect(added.overridesBuiltin).toBe(true)

    const info = await cli.json(['token', 'info', '--network', 'ethereum', '--token', 'usdt'])
    expect(info.symbol).toBe('USDT2')
    expect(info.decimals).toBe(8)

    // Still one entry, not two: the override replaces rather than appends.
    const { tokens } = await cli.json(['token', 'list', '--network', 'ethereum'])
    expect(Object.keys(tokens)).toEqual(['eth', 'usdt', 'xaut'])
  })

  it('reverts to the packaged token when the override is deleted', async () => {
    await cli.json(['token', 'add', OVERRIDE])

    const deleted = await cli.json(['token', 'delete', '--network', 'ethereum', '--token', 'usdt'])
    expect(deleted.revertedToBuiltin).toBe(true)

    const info = await cli.json(['token', 'info', '--network', 'ethereum', '--token', 'usdt'])
    expect(info.symbol).toBe('USDT')
    expect(info.decimals).toBe(6)
    expect(info.address).toBe(USDT)
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

describe('a token a command has to resolve', () => {
  // A registry entry that no command can resolve would pass every test above.
  // Pin the provider first: the ambiguity check runs before the token lookup.
  it('resolves a custom token, and reports only the missing provider mapping', async () => {
    await cli.json(['token', 'add', CUSTOM_TOKEN])
    await importAndUnlock()

    const result = await cli.run(
      ['buy', '--network', 'ethereum', '--token', 'dai', '--fiat-amount', '100',
        '--provider', 'moonpay'],
      { unlocked: true }
    )

    // Reached the slug lookup, which only happens once the token resolved.
    expect(result.code).toBe(1)
    expect(result.output).toContain("Token 'dai' on 'ethereum' has no moonpay mapping.")
  })

  it('reports a token that was never registered', async () => {
    await importAndUnlock()

    const result = await cli.run(
      ['buy', '--network', 'ethereum', '--token', 'zzz', '--fiat-amount', '100',
        '--provider', 'moonpay'],
      { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain("Unknown token 'zzz' on 'ethereum'.")
  })

  it('stops resolving a token the user disabled', async () => {
    await importAndUnlock()
    await cli.json(['token', 'disable', '--network', 'ethereum', '--token', 'xaut'], { unlocked: true })
    await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })

    const result = await cli.run(
      ['get', 'balance', '--network', 'ethereum', '--token', 'xaut'], { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain("Token 'xaut' is disabled on 'ethereum'.")
  })
})
