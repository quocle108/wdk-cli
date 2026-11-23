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

import '../services/install-node-host.js'
import { createServer } from 'node:net'
import { readFile, writeFile, unlink, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getDaemonSocketPath, getDaemonPidPath, getDaemonProtocolPath, getWalletPath } from '../config/paths.js'
import { APP_VERSION, DAEMON_MAX_REQUEST_BYTES } from '../config/constants.js'
import { WalletDaemonCore } from './core/wallet-daemon-core.js'
import { serve } from './rpc/serve.js'
import { PROTOCOL_VERSION } from './rpc/protocol-version.js'

/** @typedef {import('node:net').Server} Server */
/** @typedef {import('node:net').Socket} Socket */

/**
 * Long-lived wallet daemon. Holds unlocked WDK instances in memory and serves
 * CLI/MCP requests over a local IPC endpoint (Unix domain socket on
 * macOS/Linux, named pipe on Windows).
 */
export class WalletDaemon {
  /** @type {WalletDaemonCore} */
  #core = new WalletDaemonCore({
    walletStore: { readSeedFile: (name) => readFile(getWalletPath(name), 'utf8') },
    pid: process.pid,
    requestShutdown: () => { this.shutdown() }
  })

  /** @type {Server | null} */
  #server = null

  /**
   * Starts the daemon: creates the IPC endpoint (Unix domain socket on
   * macOS/Linux, named pipe on Windows), writes the protocol and PID files, and begins
   * accepting connections. Access is restricted to the current user on all
   * runtimes: on Node the socket is created under umask 0o077, so it is
   * owner-only from the instant it exists; Bare has no umask, so there it is
   * chmod'ed to 0o700 right after listen; Windows uses the default per-user ACL.
   *
   * @returns {Promise<void>}
   */
  async start () {
    const socketPath = getDaemonSocketPath()
    const isWin = process.platform === 'win32'

    if (!isWin) {
      await mkdir(dirname(socketPath), { recursive: true })
      try {
        await unlink(socketPath)
      } catch {
        /* socket may not exist */
      }
    }

    // Written before listening, so a client that finds this daemon running
    // always finds the protocol it speaks.
    const protocolPath = getDaemonProtocolPath()
    await writeFile(protocolPath, String(PROTOCOL_VERSION), 'utf8')
    if (!isWin) {
      await chmod(protocolPath, 0o600)
    }

    this.#server = createServer((socket) => this.#handleConnection(socket))

    const hasUmask = !isWin && typeof process.umask === 'function'
    const oldUmask = hasUmask ? process.umask(0o077) : 0
    await new Promise((resolve, reject) => {
      const onError = reject
      this.#server.once('error', onError)
      this.#server.listen(socketPath, () => {
        this.#server.removeListener('error', onError)
        if (hasUmask) process.umask(oldUmask)
        resolve()
      })
    })
    if (!isWin && !hasUmask) {
      await chmod(socketPath, 0o700)
    }

    const pidPath = getDaemonPidPath()
    await writeFile(pidPath, String(process.pid), 'utf8')
    if (!isWin) {
      await chmod(pidPath, 0o600) // owner-only; prevents other users from reading/killing the daemon
    }
  }

  /**
   * Serves the HRPC contract on a new connection. A connection that sends more
   * than `DAEMON_MAX_REQUEST_BYTES` is dropped: the CLI and the MCP server send
   * one handshake and one request per connection, far below the limit.
   *
   * @param {Socket} socket - The connected socket.
   * @returns {void}
   */
  #handleConnection (socket) {
    let received = 0
    socket.on('data', (chunk) => {
      received += chunk.length
      if (received > DAEMON_MAX_REQUEST_BYTES) socket.destroy()
    })
    serve(this.#core, socket, { daemonVersion: APP_VERSION })
  }

  /**
   * Gracefully shuts down the daemon and exits the process. Split from
   * {@link WalletDaemon#close} so a caller that owns the process — a test, or
   * an embedder — can release the daemon's resources without terminating.
   *
   * @returns {Promise<void>}
   */
  async shutdown () {
    await this.close()
    process.exit(0)
  }

  /**
   * Releases everything the daemon holds: disposes each unlocked wallet, stops
   * accepting connections, and removes the socket and PID files. Leaves the
   * process running.
   *
   * @returns {Promise<void>}
   */
  async close () {
    this.#core.dispose()

    if (this.#server) {
      this.#server.close()
      this.#server = null
    }

    // Only unlink socket on Unix; on Windows the pipe vanishes with the process
    if (process.platform !== 'win32') {
      try {
        await unlink(getDaemonSocketPath())
      } catch {
        /* */
      }
    }
    try {
      await unlink(getDaemonPidPath())
    } catch {
      /* */
    }
    try {
      await unlink(getDaemonProtocolPath())
    } catch {
      /* */
    }
  }
}

/**
 * Creates and starts the wallet daemon, registering OS signal handlers for graceful shutdown.
 *
 * @returns {Promise<void>}
 */
export async function startDaemon () {
  const daemon = new WalletDaemon()
  await daemon.start()

  const handleSignal = () => {
    daemon.shutdown().catch(() => {})
  }
  process.on('SIGTERM', handleSignal)
  process.on('SIGINT', handleSignal)
  // On Windows, SIGTERM is not supported; listen for SIGHUP as a fallback
  if (process.platform === 'win32') {
    process.on('SIGHUP', handleSignal)
  }
}
