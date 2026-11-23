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

import HRPC from './spec/hrpc/index.js'
import { ACTION_CONTRACTS, fromWireRequest, toWireResponse } from './wire.js'
import { PROTOCOL_VERSION } from './protocol-version.js'

/** @typedef {import('../core/wallet-daemon-core.js').WalletDaemonCore} WalletDaemonCore */

/**
 * A duplex byte stream, such as a socket or a worklet's IPC channel.
 *
 * @typedef {Object} DuplexStream
 * @property {(event: string, listener: (...args: any[]) => void) => unknown} on - Subscribes to a stream event.
 * @property {(chunk: Uint8Array) => unknown} write - Writes bytes to the peer.
 */

/**
 * Serves the daemon's HRPC contract on a duplex stream — a socket on desktop,
 * a worklet's IPC channel on mobile — answering every request from `core`.
 *
 * @param {WalletDaemonCore} core - The daemon core that answers requests.
 * @param {DuplexStream} stream - The connection to serve.
 * @param {{ daemonVersion: string }} info - What the handshake reports about this daemon.
 * @returns {HRPC} The HRPC endpoint bound to the stream.
 */
export function serve (core, stream, { daemonVersion }) {
  const rpc = new HRPC(stream)

  rpc.onHandshake(async () => ({ protocolVersion: PROTOCOL_VERSION, daemonVersion }))

  for (const [action, { method }] of ACTION_CONTRACTS) {
    const handler = `on${method[0].toUpperCase()}${method.slice(1)}`
    rpc[handler](async (wire) => {
      try {
        return toWireResponse(action, await core.handleRequest(fromWireRequest(action, wire)))
      } catch {
        return toWireResponse(action, { ok: false, error: 'Internal error' })
      }
    })
  }

  return rpc
}
