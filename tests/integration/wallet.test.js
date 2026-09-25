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
const ETHEREUM_0 = '0x405005C7c4422390F4B334F64Cf20E0b767131d0'
/** Mainnet networks in the packaged registry. */
const MAINNET_COUNT = 15

/** @type {Cli} */
let cli

beforeEach(async () => {
  cli = new Cli()
})

afterEach(async () => {
  await cli.run(['wallet', 'lock', '--all'], { unlocked: true })
  cli.cleanup()
})

/**
 * Imports the fixed test seed under a name and unlocks it.
 *
 * @param {string} [name] - The wallet name.
 * @returns {Promise<void>}
 */
async function importAndUnlock (name = 'main') {
  await cli.run(['wallet', 'import', '--name', name, '--seed-stdin'], {
    unlocked: true,
    stdin: SEED + '\n'
  })
  await cli.run(['wallet', 'unlock', '--name', name], { unlocked: true })
}

describe('wallet lifecycle', () => {
  it('creates a wallet and returns a seed phrase of the requested length', async () => {
    const created = await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })

    expect(created.wallet).toBe('w1')
    expect(created.seedPhrase.split(' ')).toHaveLength(12)
  })

  it('creates a 24-word wallet when asked', async () => {
    const created = await cli.json(
      ['wallet', 'create', '--name', 'w1', '--words', '24'], { unlocked: true }
    )

    expect(created.seedPhrase.split(' ')).toHaveLength(24)
  })

  it('makes the first wallet the default', async () => {
    await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })

    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets).toEqual([{ name: 'w1', default: true, unlocked: false }])
  })

  it('refuses a second wallet with the same name', async () => {
    await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })

    const again = await cli.run(['wallet', 'create', '--name', 'w1'], { unlocked: true })

    expect(again.code).toBe(1)
    expect(again.output).toContain("Wallet 'w1' already exists.")
  })

  it('refuses a word count that is not 12 or 24', async () => {
    const result = await cli.run(
      ['wallet', 'create', '--name', 'w1', '--words', '18'], { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain('--words must be 12 or 24')
  })

  it('cannot prompt for a passphrase when stdin is piped', async () => {
    const result = await cli.run(['wallet', 'create', '--name', 'w1'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Cannot prompt for a passphrase when stdin is piped.')
  })

  it('renames a wallet, keeping it usable', async () => {
    await importAndUnlock('old')

    await cli.run(['wallet', 'rename', '--name', 'old', '--new-name', 'new'], { unlocked: true })
    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets.map((w) => w.name)).toEqual(['new'])
  })

  it('deletes a wallet', async () => {
    await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })

    await cli.run(['wallet', 'delete', '--name', 'w1'], { unlocked: true })
    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets).toEqual([])
  })

  it('reports a wallet that does not exist', async () => {
    const result = await cli.run(['wallet', 'unlock', '--name', 'ghost'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("Wallet 'ghost' not found.")
  })
})

describe('import, unlock and lock', () => {
  it('imports a known seed and reports it unlocked, with the session ttl', async () => {
    await importAndUnlock()

    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets).toHaveLength(1)
    expect(wallets[0]).toMatchObject({ name: 'main', default: true, unlocked: true, ttlMs: 300_000 })
  })

  it('refuses a seed that is not valid BIP-39', async () => {
    const result = await cli.run(['wallet', 'import', '--name', 'bad', '--seed-stdin'], {
      unlocked: true,
      stdin: 'not a real seed phrase at all here friend\n'
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Invalid seed phrase. Must be 12 or 24 valid BIP-39 words.')
  })

  it('refuses the wrong passphrase on unlock', async () => {
    await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
      unlocked: true,
      stdin: SEED + '\n'
    })

    const result = await cli.run(['wallet', 'unlock', '--name', 'main'], { passphrase: 'wrong-one' })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Incorrect passphrase.')
  })

  it('requires a target for lock', async () => {
    const result = await cli.run(['wallet', 'lock'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Provide --name <name> or --all.')
  })

  it('locks a wallet by name', async () => {
    await importAndUnlock()

    await cli.run(['wallet', 'lock', '--name', 'main'], { unlocked: true })
    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets[0].unlocked).toBe(false)
  })
})

describe('address derivation, which needs no chain', () => {
  it('derives the same address the seed always produces', async () => {
    await importAndUnlock()

    const result = await cli.json(['get', 'address', '--network', 'ethereum'], { unlocked: true })

    expect(result).toEqual({ network: 'ethereum', index: 0, address: ETHEREUM_0 })
  })

  it('derives a different address at another index', async () => {
    await importAndUnlock()

    const zero = await cli.json(['get', 'address', '--network', 'ethereum'], { unlocked: true })
    const one = await cli.json(
      ['get', 'address', '--network', 'ethereum', '--index', '1'], { unlocked: true }
    )

    expect(one.index).toBe(1)
    expect(one.address).not.toBe(zero.address)
  })

  it('derives every mainnet address in one call', async () => {
    await importAndUnlock()

    const result = await cli.json(['get', 'address', '--all'], { unlocked: true })

    expect(result.type).toBe('mainnet')
    expect(result.addresses).toHaveLength(MAINNET_COUNT)
    expect(result.addresses.find((a) => a.network === 'ethereum').address).toBe(ETHEREUM_0)
  })

  it('derives testnet addresses only when asked', async () => {
    await importAndUnlock()

    const result = await cli.json(['get', 'address', '--all', '--testnet'], { unlocked: true })

    expect(result.type).toBe('testnet')
  })

  it('refuses a network that is not registered', async () => {
    await importAndUnlock()

    const result = await cli.run(['get', 'address', '--network', 'atlantis'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("Network 'atlantis' is not supported.")
  })

  it('refuses to derive while locked', async () => {
    await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
      unlocked: true,
      stdin: SEED + '\n'
    })

    const result = await cli.run(['get', 'address', '--network', 'ethereum'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Wallet 'main' is not unlocked.")
  })

  it('refuses a network the user disabled', async () => {
    await importAndUnlock()
    await cli.run(['network', 'disable', '--name', 'ethereum'], { unlocked: true })
    // Disabling a network locks every wallet, so re-unlock: otherwise this
    // passes on "not unlocked" and proves nothing about the network.
    await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })

    const result = await cli.run(['get', 'address', '--network', 'ethereum'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("Network 'ethereum' is disabled.")
  })
})

describe('export, which decrypts the seed', () => {
  it('returns exactly the seed that was imported', async () => {
    await importAndUnlock()

    const exported = await cli.json(['wallet', 'export', '--name', 'main'], { unlocked: true })

    expect(exported.seedPhrase).toBe(SEED)
  })

  it('refuses to export without the passphrase', async () => {
    await importAndUnlock()

    const result = await cli.run(['wallet', 'export', '--name', 'main'])

    expect(result.code).toBe(1)
    expect(result.output).not.toContain('cook voyage')
  })

  it('refuses to export a wallet that does not exist', async () => {
    const result = await cli.run(['wallet', 'export', '--name', 'ghost'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("Wallet 'ghost' not found.")
  })
})

describe('the default wallet', () => {
  it('moves the default to another wallet', async () => {
    await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })
    await cli.json(['wallet', 'create', '--name', 'w2'], { unlocked: true })

    await cli.run(['wallet', 'default', '--name', 'w2'], { unlocked: true })
    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets.find((w) => w.default).name).toBe('w2')
  })

  it('refuses to default to a wallet that does not exist', async () => {
    const result = await cli.run(['wallet', 'default', '--name', 'ghost'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain("Wallet 'ghost' not found.")
  })

  it('leaves the second wallet non-default when created', async () => {
    await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })
    await cli.json(['wallet', 'create', '--name', 'w2'], { unlocked: true })

    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets.filter((w) => w.default).map((w) => w.name)).toEqual(['w1'])
  })
})

describe('change-passphrase, which re-encrypts the seed', () => {
  it('keeps the seed recoverable under the new passphrase', async () => {
    await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
      unlocked: true,
      stdin: SEED + '\n'
    })

    const changed = await cli.run(
      ['wallet', 'change-passphrase', '--name', 'main', '--new-passphrase-stdin'],
      { unlocked: true, stdin: 'second-passphrase\n' }
    )
    expect(changed.code).toBe(0)

    const exported = await cli.run(['wallet', 'export', '--name', 'main', '--json'], {
      passphrase: 'second-passphrase'
    })

    expect(JSON.parse(exported.stdout.trim().split('\n').pop()).seedPhrase).toBe(SEED)
  })

  it('stops the old passphrase from working', async () => {
    await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
      unlocked: true,
      stdin: SEED + '\n'
    })
    await cli.run(
      ['wallet', 'change-passphrase', '--name', 'main', '--new-passphrase-stdin'],
      { unlocked: true, stdin: 'second-passphrase\n' }
    )

    const result = await cli.run(['wallet', 'export', '--name', 'main'], { unlocked: true })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Incorrect passphrase.')
  })
})

describe('more than one wallet', () => {
  it('locks every wallet at once', async () => {
    await importAndUnlock('w1')
    await cli.run(['wallet', 'import', '--name', 'w2', '--seed-stdin'], {
      unlocked: true,
      stdin: SEED + '\n'
    })
    await cli.run(['wallet', 'unlock', '--name', 'w2'], { unlocked: true })

    await cli.run(['wallet', 'lock', '--all'], { unlocked: true })
    const { wallets } = await cli.json(['wallet', 'list'])

    expect(wallets.every((w) => !w.unlocked)).toBe(true)
  })

  it('derives from the wallet named by --wallet, not the default', async () => {
    await importAndUnlock('w1')
    await cli.json(['wallet', 'create', '--name', 'w2'], { unlocked: true })
    await cli.run(['wallet', 'unlock', '--name', 'w2'], { unlocked: true })

    const fromNamed = await cli.json(
      ['get', 'address', '--network', 'ethereum', '--wallet', 'w1'], { unlocked: true }
    )

    expect(fromNamed.address).toBe(ETHEREUM_0)
  })

  it('refuses a rename onto a name already taken', async () => {
    await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })
    await cli.json(['wallet', 'create', '--name', 'w2'], { unlocked: true })

    const result = await cli.run(
      ['wallet', 'rename', '--name', 'w1', '--new-name', 'w2'], { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain("Wallet 'w2' already exists.")
  })

  it('refuses to import onto a name already taken', async () => {
    await cli.json(['wallet', 'create', '--name', 'w1'], { unlocked: true })

    const result = await cli.run(['wallet', 'import', '--name', 'w1', '--seed-stdin'], {
      unlocked: true,
      stdin: SEED + '\n'
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain("Wallet 'w1' already exists.")
  })
})
