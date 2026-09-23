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

import {
  getIndexerSlug,
  isIndexerSupported,
  assertIndexerAvailable,
  getTokenTransfers
} from '../../../src/services/indexer-service.js'
import { configService } from '../../../src/services/config-service.js'

describe('getIndexerSlug', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the built-in slug from wdk.config.json', () => {
    expect(getIndexerSlug('ethereum')).toBe('ethereum')
  })

  it('returns the custom network slug from config', () => {
    const getMock = jest.spyOn(configService, 'get').mockReturnValue('dummy-slug')

    expect(getIndexerSlug('mychain')).toBe('dummy-slug')
    expect(getMock).toHaveBeenCalledWith('customNetworks.mychain.indexerSlug')
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'has no slug for the inherited object property %s', (name) => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined)

      expect(getIndexerSlug(name)).toBeUndefined()
      expect(isIndexerSupported(name)).toBe(false)
    }
  )
})

describe('indexer endpoint configuration', () => {
  const ADDRESS = '0x28C6c06298d514Db089934071355E5743bf21d60'

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('refuses to call the API when the indexer provider is disabled', async () => {
    const getMock = jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'overrides' ? { providers: { 'wdk-indexer': { enabled: false } } } : undefined
    )
    const fetchMock = jest.spyOn(globalThis, 'fetch')

    await expect(getTokenTransfers('ethereum', 'usdt', ADDRESS)).rejects.toThrow(
      'No indexer is available.'
    )

    expect(getMock).toHaveBeenCalledWith('overrides')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects before any wallet work when no indexer is enabled', () => {
    jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'overrides' ? { providers: { 'wdk-indexer': { enabled: false } } } : undefined
    )

    expect(() => assertIndexerAvailable()).toThrow(
      expect.objectContaining({
        message: 'No indexer is available.',
        code: 'MISSING_CONFIG',
        suggestion: 'Enable one with: wdk provider enable --name wdk-indexer'
      })
    )
  })

  it('refuses to guess when two indexers are enabled', () => {
    jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'customProviders'
        ? { myindexer: { kind: 'indexer', config: { baseUrl: 'https://dummy-indexer.test' } } }
        : undefined
    )

    expect(() => assertIndexerAvailable()).toThrow(
      expect.objectContaining({
        message: 'Several indexers are enabled: wdk-indexer, myindexer.',
        code: 'INVALID_ARGUMENT',
        suggestion: 'Leave one enabled with: wdk provider disable --name myindexer'
      })
    )
  })

  it('accepts the single packaged indexer', () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined)

    expect(assertIndexerAvailable()).toBeUndefined()
  })

  it('calls the packaged base URL from the registry entry', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {Response} */ ({ ok: true, json: async () => ({ transfers: [] }) })
    )

    await getTokenTransfers('ethereum', 'usdt', ADDRESS)

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://wdk-api.tether.io/api/v1/ethereum/usdt/' + ADDRESS + '/token-transfers'
    )
  })

  it('reports an unset base URL against the provider config key', async () => {
    jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'providers.wdk-indexer.config' ? { baseUrl: '' } : undefined
    )

    await expect(getTokenTransfers('ethereum', 'usdt', ADDRESS)).rejects.toThrow(
      expect.objectContaining({
        message: 'Indexer base URL not configured.',
        code: 'MISSING_CONFIG',
        suggestion: 'Set it with: wdk config set --key providers.wdk-indexer.config.baseUrl --value <url>'
      })
    )
  })

  it('uses a configured proxy base URL instead', async () => {
    jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'providers.wdk-indexer.config' ? { baseUrl: 'https://proxy.dummy-host.test' } : undefined
    )
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {Response} */ ({ ok: true, json: async () => ({ transfers: [] }) })
    )

    await getTokenTransfers('ethereum', 'usdt', ADDRESS)

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://proxy.dummy-host.test/api/v1/ethereum/usdt/' + ADDRESS + '/token-transfers'
    )
  })
})
