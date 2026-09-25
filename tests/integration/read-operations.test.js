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

// ECDSA over a fixed seed and message is deterministic, so this is an exact
// value rather than a shape. If it ever changes, the derivation changed.
const HELLO_SIGNATURE =
  '0x05c005143100eff1f58be46b0a7fb7fe1a47f20d29d7c14e913dc9ae798e00ab' +
  '6e769cf61784923262ba5bda8f0f5140d661a9b3f14df4d17837dc06dea555ac1b'

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

describe('address derivation', () => {
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

describe('message verification', () => {
  it('accepts a signature over the message that was signed', async () => {
    await importAndUnlock()

    const result = await cli.json(
      ['message', 'verify', '--network', 'ethereum', '--message', 'hello',
        '--signature', HELLO_SIGNATURE],
      { unlocked: true }
    )

    expect(result).toMatchObject({ address: ETHEREUM_0, valid: true })
  })

  it('rejects the same signature over a different message', async () => {
    await importAndUnlock()

    const result = await cli.json(
      ['message', 'verify', '--network', 'ethereum', '--message', 'tampered',
        '--signature', HELLO_SIGNATURE],
      { unlocked: true }
    )

    expect(result.valid).toBe(false)
  })

  it('reports a signature that is not well formed', async () => {
    await importAndUnlock()

    const result = await cli.run(
      ['message', 'verify', '--network', 'ethereum', '--message', 'hello', '--signature', '0xdead'],
      { unlocked: true }
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain('invalid raw signature length')
  })
})
