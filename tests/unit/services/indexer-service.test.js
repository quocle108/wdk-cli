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
  isIndexerEnabled,
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
      key === 'overrides' ? { providers: { indexer: { enabled: false } } } : undefined
    )
    const fetchMock = jest.spyOn(globalThis, 'fetch')

    await expect(getTokenTransfers('ethereum', 'usdt', ADDRESS)).rejects.toThrow(
      "Protocol 'indexer' is disabled."
    )

    expect(getMock).toHaveBeenCalledWith('overrides')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the indexer as disabled before any wallet work', () => {
    jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'overrides' ? { providers: { indexer: { enabled: false } } } : undefined
    )

    expect(isIndexerEnabled()).toBe(false)
  })

  it('reports the indexer as enabled by default', () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined)

    expect(isIndexerEnabled()).toBe(true)
  })

  it('reports a missing base URL against the provider config key', async () => {
    jest.spyOn(configService, 'get').mockImplementation((key) =>
      key === 'providers.indexer.config' ? { baseUrl: '' } : undefined
    )

    await expect(getTokenTransfers('ethereum', 'usdt', ADDRESS)).rejects.toThrow(
      expect.objectContaining({
        message: 'Indexer base URL not configured.',
        code: 'MISSING_CONFIG',
        suggestion: 'Set it with: wdk config set --key providers.indexer.config.baseUrl --value <url>'
      })
    )
  })
})
