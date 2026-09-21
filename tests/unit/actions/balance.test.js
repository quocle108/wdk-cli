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

const requireUnlocked = jest.fn()
const daemonGetBalance = jest.fn()
const convertToUsd = jest.fn()

jest.unstable_mockModule('../../../src/daemon/client.js', () => ({
  daemonClient: { requireUnlocked, getBalance: daemonGetBalance }
}))

jest.unstable_mockModule('../../../src/services/price-service.js', () => ({ convertToUsd }))

const { getBalance, getAllBalances } = await import('../../../src/actions/balance.js')

const DUMMY_ADDRESS = '0x1111111111111111111111111111111111111111'
const DUMMY_BALANCE = { balance: '1000000000000000000', symbol: 'ETH', decimals: 18, address: DUMMY_ADDRESS }

beforeEach(() => {
  requireUnlocked.mockReset()
  daemonGetBalance.mockReset()
  convertToUsd.mockReset()
  requireUnlocked.mockResolvedValue('main')
})

describe('getBalance', () => {
  it('returns the balance with the account it belongs to', async () => {
    daemonGetBalance.mockResolvedValue(DUMMY_BALANCE)
    convertToUsd.mockResolvedValue(2000)

    const result = await getBalance({ network: 'ethereum', index: 0 })

    expect(result).toEqual({
      network: 'ethereum',
      index: 0,
      balance: '1000000000000000000',
      symbol: 'ETH',
      decimals: 18,
      formatted: '1 ETH',
      usd: 2000,
      address: DUMMY_ADDRESS
    })
    expect(daemonGetBalance).toHaveBeenCalledWith('ethereum', 0, undefined, 'main')
  })

  it('skips the price lookup for an empty balance', async () => {
    daemonGetBalance.mockResolvedValue({ ...DUMMY_BALANCE, balance: '0' })

    const result = await getBalance({ network: 'ethereum', index: 0 })

    expect(result).toEqual({
      network: 'ethereum',
      index: 0,
      balance: '0',
      symbol: 'ETH',
      decimals: 18,
      formatted: '0 ETH',
      usd: 0,
      address: DUMMY_ADDRESS
    })
    expect(convertToUsd).not.toHaveBeenCalled()
  })
})

describe('getAllBalances', () => {
  it('takes each address from the balance response instead of a separate lookup', async () => {
    daemonGetBalance.mockImplementation(async (network) =>
      network === 'ethereum' ? DUMMY_BALANCE : Promise.reject(new Error('dummy provider down'))
    )
    convertToUsd.mockResolvedValue(2000)

    const result = await getAllBalances({ index: 0 })

    expect(result).toEqual({
      index: 0,
      type: 'mainnet',
      balances: [{
        network: 'ethereum',
        address: DUMMY_ADDRESS,
        balance: '1000000000000000000',
        symbol: 'ETH',
        decimals: 18,
        formatted: '1 ETH',
        usd: 2000
      }],
      totalUsd: 2000
    })
    expect(daemonGetBalance).toHaveBeenCalledWith('ethereum', 0, undefined, 'main')
  })
})
