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
const ADDRESS = '0x405005C7c4422390F4B334F64Cf20E0b767131d0'

// ECDSA over a fixed seed and message is deterministic, so this is an exact
// value rather than a shape. If it ever changes, the derivation changed.
const HELLO_SIGNATURE =
  '0x05c005143100eff1f58be46b0a7fb7fe1a47f20d29d7c14e913dc9ae798e00ab' +
  '6e769cf61784923262ba5bda8f0f5140d661a9b3f14df4d17837dc06dea555ac1b'

/** @type {Cli} */
let cli

beforeEach(async () => {
  cli = new Cli()
  await cli.run(['wallet', 'import', '--name', 'main', '--seed-stdin'], {
    unlocked: true,
    stdin: SEED + '\n'
  })
  await cli.run(['wallet', 'unlock', '--name', 'main'], { unlocked: true })
})

afterEach(async () => {
  await cli.run(['wallet', 'lock', '--all'], { unlocked: true })
  cli.cleanup()
})

describe('message signing', () => {
  it('produces the signature this seed always produces', async () => {
    const result = await cli.json(
      ['message', 'sign', '--network', 'ethereum', '--message', 'hello'], { unlocked: true }
    )

    expect(result).toEqual({
      network: 'ethereum',
      index: 0,
      address: ADDRESS,
      message: 'hello',
      signature: HELLO_SIGNATURE
    })
  })

  it('signs with the account at the index it was given', async () => {
    const zero = await cli.json(
      ['message', 'sign', '--network', 'ethereum', '--message', 'hello'], { unlocked: true }
    )
    const one = await cli.json(
      ['message', 'sign', '--network', 'ethereum', '--message', 'hello', '--index', '1'],
      { unlocked: true }
    )

    expect(one.index).toBe(1)
    expect(one.signature).not.toBe(zero.signature)
    expect(one.address).not.toBe(zero.address)
  })

  it('refuses to sign while locked', async () => {
    await cli.run(['wallet', 'lock', '--all'], { unlocked: true })

    const result = await cli.run(['message', 'sign', '--network', 'ethereum', '--message', 'hi'])

    expect(result.code).toBe(1)
    expect(result.output).toContain("Wallet 'main' is not unlocked.")
  })
})
