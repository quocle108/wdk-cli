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

import { getIndexerSlug, isIndexerSupported } from '../../../src/services/indexer-service.js'
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
