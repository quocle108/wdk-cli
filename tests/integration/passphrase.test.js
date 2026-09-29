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

// The passphrase gate sits in front of commands that have nothing to do with
// keys: disabling a provider asks for it too. What it accepts is decided by the
// keyring, so these cases cross auth, the keyring and the registry.

import { Cli } from './helpers.js'

const SEED = 'cook voyage document eight skate token alien guide drink uncle term abuse'
const NEW_PASSPHRASE = 'second-passphrase'

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
 * Imports the fixed test seed under the instance passphrase.
 *
 * @returns {Promise<void>}
 */
async function importSeed () {
  await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
    unlocked: true,
    stdin: SEED + '\n'
  })
}

describe('the passphrase gate on a registry change', () => {
  it('does not ask when there is no wallet to protect', async () => {
    const result = await cli.run(['provider', 'disable', '--name', 'velora'])

    expect(result.code).toBe(0)
    expect(result.output).toContain("Provider 'velora' disabled.")
  })

  it('asks as soon as a wallet exists', async () => {
    await importSeed()

    const result = await cli.run(['provider', 'disable', '--name', 'velora'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Cannot prompt for a passphrase when stdin is piped.')
    expect(result.output).toContain('Set WDK_PASSPHRASE, or run from a terminal.')
  })

  it('rejects the wrong one', async () => {
    await importSeed()

    const result = await cli.run(['provider', 'disable', '--name', 'velora'], {
      passphrase: 'not-the-passphrase'
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Incorrect passphrase.')
  })

  it('leaves the provider untouched when the passphrase is refused', async () => {
    await importSeed()

    await cli.run(['provider', 'disable', '--name', 'velora'], { passphrase: 'not-the-passphrase' })

    const { providers } = await cli.json(['provider', 'list'])
    expect(providers.find((p) => p.name === 'velora').enabled).toBe(true)
  })
})

describe('after the wallet passphrase changes', () => {
  it('the registry gate follows the new one', async () => {
    await importSeed()
    await cli.run(
      ['wallet', 'change-passphrase', '--name', 'main', '--new-passphrase-stdin'],
      { unlocked: true, stdin: NEW_PASSPHRASE + '\n' }
    )

    const withOld = await cli.run(['provider', 'disable', '--name', 'velora'], { unlocked: true })
    expect(withOld.code).toBe(1)
    expect(withOld.output).toContain('Incorrect passphrase.')

    const withNew = await cli.run(['provider', 'disable', '--name', 'velora'], {
      passphrase: NEW_PASSPHRASE
    })
    expect(withNew.code).toBe(0)
    expect(withNew.output).toContain("Provider 'velora' disabled.")
  })
})
