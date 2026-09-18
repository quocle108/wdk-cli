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

import { jest } from '@jest/globals'
import { createRequire } from 'node:module'

import {
  getProtocols,
  getProtocolsByKind,
  getProtocol,
  resolveProtocolConfig,
  servesRequest
} from '../../../src/services/protocol-service.js'
import { configService } from '../../../src/services/config-service.js'

const require = createRequire(import.meta.url)
const catalog = require('../../../wdk.config.json')

describe('getProtocols', () => {
  it('returns the providers declared in wdk.config.json, each with a declared kind', () => {
    const protocols = getProtocols()

    expect(protocols).toEqual(catalog.providers)
    expect(protocols.velora.kind).toBe('swap')
    expect(protocols.usdt0.kind).toBe('bridge')
    expect(protocols.rhinofi.kind).toBe('swidge')
    expect(protocols.symbiosis.kind).toBe('swidge')
  })
})

describe('getProtocolsByKind', () => {
  it('returns swap and swidge protocols for a swap request', () => {
    expect(Object.keys(getProtocolsByKind('swap'))).toEqual(['velora', 'rhinofi', 'symbiosis'])
  })

  it('returns bridge and swidge protocols for a bridge request', () => {
    expect(Object.keys(getProtocolsByKind('bridge'))).toEqual(['usdt0', 'rhinofi', 'symbiosis'])
  })
})

describe('getProtocol', () => {
  it('returns a catalog protocol entry', () => {
    expect(getProtocol('velora')).toEqual(catalog.providers.velora)
  })

  it('rejects an unknown protocol with the available list', () => {
    expect(() => getProtocol('nope')).toThrow("Unknown protocol 'nope'.")
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects the inherited object property %s as a protocol name', (name) => {
      expect(() => getProtocol(name)).toThrow(`Unknown protocol '${name}'.`)
    }
  )
})

describe('resolveProtocolConfig', () => {
  it('returns the protocol general config when there is no per-network override', () => {
    expect(resolveProtocolConfig('velora', 'ethereum')).toEqual(catalog.providers.velora.config)
  })

  it('merges the per-network protocol override over the general config', () => {
    expect(resolveProtocolConfig('symbiosis', 'ethereum')).toEqual({ partnerId: 'wdk', chain: 1 })
  })
})

describe('servesRequest', () => {
  it('lets a swidge protocol serve both swap and bridge requests', () => {
    expect(servesRequest('swidge', 'swap')).toBe(true)
    expect(servesRequest('swidge', 'bridge')).toBe(true)
  })

  it('lets a swap protocol serve only swap requests', () => {
    expect(servesRequest('swap', 'swap')).toBe(true)
    expect(servesRequest('swap', 'bridge')).toBe(false)
  })

  it('lets a bridge protocol serve only bridge requests', () => {
    expect(servesRequest('bridge', 'bridge')).toBe(true)
    expect(servesRequest('bridge', 'swap')).toBe(false)
  })
})

describe('protocol overrides', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const withOverrides = (overrides) => {
    jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'overrides' ? overrides : undefined
    )
  }

  it('drops protocols whose module is disabled', () => {
    withOverrides({ modules: { [catalog.providers.velora.module]: { enabled: false } } })

    expect(getProtocols().velora).toBeUndefined()
    expect(getProtocols().usdt0).toEqual(catalog.providers.usdt0)
    expect(Object.keys(getProtocolsByKind('swap'))).toEqual(['rhinofi', 'symbiosis'])
    expect(() => getProtocol('velora')).toThrow("Protocol 'velora' is disabled.")
  })
})
