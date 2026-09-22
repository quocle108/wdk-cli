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
import { createHmac } from 'node:crypto'

const getConfig = jest.fn()
const loadProtocolClass = jest.fn()
const getInstalledVersion = jest.fn()

// Mocked, not spied on: the real service reads the developer's own config file.
jest.unstable_mockModule('../../../src/services/config-service.js', () => ({
  configService: { get: getConfig, set: jest.fn(), delete: jest.fn() }
}))

const protocolService = await import('../../../src/services/protocol-service.js')
jest.unstable_mockModule('../../../src/services/protocol-service.js', () => ({
  ...protocolService,
  loadProtocolClass
}))

const moduleService = await import('../../../src/services/module-service.js')
jest.unstable_mockModule('../../../src/services/module-service.js', () => ({
  ...moduleService,
  getInstalledVersion
}))

const { getFiatProviders, resolveRampProvider, hasRampAdapter } =
  await import('../../../src/services/ramp/index.js')

const require = createRequire(import.meta.url)
const catalog = require('../../../wdk.config.json')

const MOONPAY_MODULE = catalog.providers.moonpay.module

/** How the stub module was constructed, captured for assertions. */
let captured

beforeEach(() => {
  getConfig.mockReset()
  loadProtocolClass.mockReset()
  getInstalledVersion.mockReset()
  getConfig.mockReturnValue(undefined)
  getInstalledVersion.mockImplementation((m) => (m === MOONPAY_MODULE ? '1.0.0' : null))
  captured = undefined
})

/** Mocks config reads so only the listed keys answer. */
function withConfig (values) {
  getConfig.mockImplementation((key) => (Object.hasOwn(values, key) ? values[key] : undefined))
}

/** Makes the module loader return a class that records its construction. */
function withModule (methods = {}) {
  loadProtocolClass.mockResolvedValue(class {
    constructor (account, config) {
      captured = { account, config }
      Object.assign(this, methods)
    }
  })
}

/** A module answering both listings with nothing. */
const EMPTY_LISTINGS = {
  getSupportedCryptoAssets: async () => [],
  getSupportedFiatCurrencies: async () => []
}

describe('getFiatProviders', () => {
  it('lists the providers whose module is installed', () => {
    expect(getFiatProviders()).toEqual(['moonpay'])
  })

  it('drops a disabled provider', () => {
    withConfig({ overrides: { providers: { moonpay: { enabled: false } } } })

    expect(getFiatProviders()).toEqual([])
  })
})

describe('hasRampAdapter', () => {
  it('ships an adapter for moonpay', () => {
    expect(hasRampAdapter('moonpay')).toBe(true)
  })

  it.each([['velora'], ['nope']])('ships none for %s', (name) => {
    expect(hasRampAdapter(name)).toBe(false)
  })
})

describe('resolveRampProvider', () => {
  it('picks the only usable provider when none is named', () => {
    expect(resolveRampProvider().name).toBe('moonpay')
  })

  it('returns the named provider', () => {
    expect(resolveRampProvider('moonpay').name).toBe('moonpay')
  })

  it('refuses a provider of another kind', () => {
    expect(() => resolveRampProvider('velora')).toThrow(
      expect.objectContaining({
        message: "Provider 'velora' is not a fiat on/off-ramp.",
        code: 'INVALID_ARGUMENT'
      })
    )
  })

  it('reports when none is usable', () => {
    getInstalledVersion.mockReturnValue(null)

    expect(() => resolveRampProvider()).toThrow(
      expect.objectContaining({
        message: 'No fiat provider is available.',
        code: 'MISSING_CONFIG'
      })
    )
  })
})

describe('token resolution', () => {
  it('resolves the packaged slug and both sides decimals', async () => {
    withModule({
      getSupportedCryptoAssets: async () => [{ code: 'usdt_trx', decimals: 6 }],
      getSupportedFiatCurrencies: async () => [{ code: 'usd', decimals: 2 }]
    })

    const resolved = await resolveRampProvider('moonpay').resolveAssets('tron', 'usdt', 'usd')

    expect(resolved).toEqual({ cryptoCode: 'usdt_trx', cryptoDecimals: 6, fiatDecimals: 2 })
  })

  it('matches a fiat code whose case differs from the request', async () => {
    withModule({
      getSupportedCryptoAssets: async () => [{ code: 'usdt_trx', decimals: 6 }],
      getSupportedFiatCurrencies: async () => [{ code: 'USD', decimals: 2 }]
    })

    const resolved = await resolveRampProvider('moonpay').resolveAssets('tron', 'usdt', 'usd')

    expect(resolved.fiatDecimals).toBe(2)
  })

  it('refuses a token with no mapping, naming what the provider does carry', async () => {
    withModule(EMPTY_LISTINGS)

    await expect(
      resolveRampProvider('moonpay').resolveAssets('avalanche', 'usdt', 'usd')
    ).rejects.toThrow(
      expect.objectContaining({
        message: "Token 'usdt' on 'avalanche' has no moonpay mapping.",
        code: 'TOKEN_NOT_SUPPORTED'
      })
    )
  })

  it('refuses a token that is not registered', async () => {
    withModule(EMPTY_LISTINGS)

    await expect(
      resolveRampProvider('moonpay').resolveAssets('ethereum', 'nope', 'usd')
    ).rejects.toThrow("Unknown token 'nope' on 'ethereum'.")
  })

  it('applies a user slug override', async () => {
    withConfig({
      overrides: { tokens: { 'ethereum/eth': { metadata: { slugs: { moonpay: 'eth_override' } } } } }
    })
    withModule({
      getSupportedCryptoAssets: async () => [{ code: 'eth_override', decimals: 18 }],
      getSupportedFiatCurrencies: async () => [{ code: 'usd', decimals: 2 }]
    })

    const resolved = await resolveRampProvider('moonpay').resolveAssets('ethereum', 'eth', 'usd')

    expect(resolved.cryptoCode).toBe('eth_override')
  })

  it('refuses an asset the provider does not list', async () => {
    withModule({
      getSupportedCryptoAssets: async () => [{ code: 'something_else', decimals: 6 }],
      getSupportedFiatCurrencies: async () => [{ code: 'usd', decimals: 2 }]
    })

    await expect(
      resolveRampProvider('moonpay').resolveAssets('tron', 'usdt', 'usd')
    ).rejects.toThrow("Asset 'usdt_trx' is not supported by moonpay.")
  })
})

describe('MoonPayRampProvider', () => {
  it('turns the configured signUrl into a callback and drops it when unset', async () => {
    withModule(EMPTY_LISTINGS)
    withConfig({ 'providers.moonpay.config': { apiKey: 'k', signUrl: 'https://sign.example/sign' } })
    await resolveRampProvider('moonpay').resolveAssets('ethereum', 'eth', 'usd').catch(() => {})

    expect(captured.account).toBeUndefined()
    expect(typeof captured.config.signUrl).toBe('function')

    withConfig({ 'providers.moonpay.config': { apiKey: 'k' } })
    await resolveRampProvider('moonpay').resolveAssets('ethereum', 'eth', 'usd').catch(() => {})

    expect(Object.hasOwn(captured.config, 'signUrl')).toBe(false)
  })

  it.each([
    ['sandbox', 'sepolia'],
    ['production', 'ethereum']
  ])('accepts %s on %s', async (environment, network) => {
    withConfig({ 'providers.moonpay.config': { environment } })

    await expect(resolveRampProvider('moonpay').validateEnvironment(network)).resolves.toBeUndefined()
  })

  it.each([
    ['production', 'sepolia', 'testnet'],
    ['sandbox', 'ethereum', 'mainnet']
  ])('refuses %s on %s', async (environment, network, label) => {
    withConfig({ 'providers.moonpay.config': { environment } })

    await expect(resolveRampProvider('moonpay').validateEnvironment(network)).rejects.toThrow(
      `Cannot use moonpay environment '${environment}' with ${label} '${network}'.`
    )
  })

  it('reports an unconfigured environment', async () => {
    await expect(resolveRampProvider('moonpay').validateEnvironment('ethereum')).rejects.toThrow(
      expect.objectContaining({
        message: 'MoonPay environment is not configured.',
        code: 'MISSING_CONFIG'
      })
    )
  })

  it('rejects an environment that is neither production nor sandbox', async () => {
    withConfig({ 'providers.moonpay.config': { environment: 'staging' } })

    await expect(resolveRampProvider('moonpay').validateEnvironment('ethereum')).rejects.toThrow(
      expect.objectContaining({
        message: "Invalid MoonPay environment 'staging'. Must be 'production' or 'sandbox'.",
        code: 'INVALID_CONFIG'
      })
    )
  })
})

describe('endpoint callbacks', () => {
  const SIGN_URL = 'http://localhost:3456/sign'
  const SECRET = 'sk_test_DUMMY'
  const UNSIGNED = 'https://buy-sandbox.moonpay.com?apiKey=pk_test_X&currencyCode=usdt_trx'

  /** Records the request the CLI made to the endpoint. */
  let request

  /** Stands in for `examples/moonpay-sign-server.mjs`, implementing its contract. */
  const signServer = async (url, init) => {
    request = { url, body: JSON.parse(init.body) }
    const target = request.body.urlForSignature
    if (typeof target !== 'string' || !target) {
      return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({}) }
    }
    const signature = createHmac('sha256', SECRET).update(new URL(target).search).digest('base64')
    return { ok: true, json: async () => ({ signedUrl: `${target}&signature=${encodeURIComponent(signature)}` }) }
  }

  /** Constructs MoonPay with a signUrl and hands back the wrapped callback. */
  async function signCallback () {
    withModule(EMPTY_LISTINGS)
    withConfig({ 'providers.moonpay.config': { apiKey: 'pk_test_X', signUrl: SIGN_URL } })
    await resolveRampProvider('moonpay').resolveAssets('ethereum', 'eth', 'usd').catch(() => {})
    return captured.config.signUrl
  }

  beforeEach(() => {
    request = undefined
  })

  it('POSTs the URL under the field a MoonPay sign server expects', async () => {
    globalThis.fetch = signServer
    const sign = await signCallback()

    const signed = await sign(UNSIGNED)

    expect(request.url).toBe(SIGN_URL)
    expect(Object.keys(request.body)).toEqual(['urlForSignature'])
    expect(signed).toBe(
      `${UNSIGNED}&signature=${encodeURIComponent(
        createHmac('sha256', SECRET).update(new URL(UNSIGNED).search).digest('base64')
      )}`
    )
  })

  it('reports an unreachable endpoint rather than failing inside the module', async () => {
    globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED') }
    const sign = await signCallback()

    await expect(sign(UNSIGNED)).rejects.toThrow(
      expect.objectContaining({
        message: `Cannot reach endpoint '${SIGN_URL}': connect ECONNREFUSED`,
        code: 'SIGN_FAILED'
      })
    )
  })

  it('reports a non-OK answer', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) })
    const sign = await signCallback()

    await expect(sign(UNSIGNED)).rejects.toThrow(`Endpoint '${SIGN_URL}' failed: 500 Server Error`)
  })

  it('reports an answer carrying no signed URL', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ nope: 1 }) })
    const sign = await signCallback()

    await expect(sign(UNSIGNED)).rejects.toThrow(`Endpoint '${SIGN_URL}' returned no string answer.`)
  })
})
