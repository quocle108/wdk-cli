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

describe('module methods', () => {
  it('lists the methods a wallet module declares', async () => {
    const { network, methods } = await cli.json(['method', 'list', '--network', 'spark'])

    expect(network).toBe('spark')
    expect(methods.map((m) => m.name)).toContain('getStaticDepositAddress')
  })

  it('marks each method read or write', async () => {
    const { methods } = await cli.json(['method', 'list', '--network', 'spark'])

    expect(methods.every((m) => m.kind === 'read' || m.kind === 'write')).toBe(true)
  })

  it('returns an empty list for a network that declares none', async () => {
    const result = await cli.json(['method', 'list', '--network', 'bitcoin'])

    expect(result).toEqual({ network: 'bitcoin', methods: [] })
  })
})
