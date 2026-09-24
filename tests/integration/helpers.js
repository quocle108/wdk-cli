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

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(CLI_ROOT, 'bin', 'wdk.mjs')

/**
 * @typedef {Object} CliResult
 * @property {number} code - The process exit code.
 * @property {string} stdout - Everything written to stdout, ANSI stripped.
 * @property {string} stderr - Everything written to stderr, ANSI stripped.
 * @property {string} output - stdout and stderr joined, for matching a message
 *   without caring which stream carried it.
 */

/** Matches the ANSI colour codes chalk writes when stdout is a TTY. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/**
 * An isolated CLI installation: its own config directory, torn down by
 * {@link Cli#cleanup}. A directory with no wallets means no passphrase prompt,
 * so every registry and config command runs unattended.
 */
export class Cli {
  /** The config directory this instance runs against. */
  configHome
  /** The passphrase every wallet in this instance is created with. */
  passphrase

  constructor () {
    this.configHome = mkdtempSync(join(tmpdir(), 'wdk-it-'))
    // Generated per instance and thrown away with the directory: these wallets
    // exist only for the length of one test file.
    this.passphrase = `pw-${randomBytes(12).toString('hex')}`
  }

  /**
   * Runs one `wdk` command to completion.
   *
   * @param {string[]} args - Arguments after the binary name.
   * @param {Object} [options] - Run options.
   * @param {string} [options.stdin] - Text to write to stdin, for the
   *   `--*-stdin` flags.
   * @param {boolean} [options.unlocked] - Pass the instance passphrase through
   *   `WDK_PASSPHRASE`, the documented way to run wallet commands unattended.
   * @returns {Promise<CliResult>} What the command printed and exited with.
   */
  run (args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, ...args], {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: this.configHome,
          ...(options.unlocked ? { WDK_PASSPHRASE: this.passphrase } : { WDK_PASSPHRASE: undefined }),
          NO_COLOR: '1',
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += d })
      child.stderr.on('data', (d) => { stderr += d })
      child.on('error', reject)
      child.on('close', (code) => {
        const clean = (s) => s.replace(ANSI, '')
        resolve({
          code: code ?? 0,
          stdout: clean(stdout),
          stderr: clean(stderr),
          output: clean(stdout + stderr)
        })
      })

      if (options.stdin !== undefined) child.stdin.write(options.stdin)
      child.stdin.end()
    })
  }

  /**
   * Runs a command with `--json` and parses the object it prints.
   *
   * @param {string[]} args - Arguments after the binary name.
   * @param {Object} [options] - Run options, as {@link Cli#run} takes them.
   * @returns {Promise<Record<string, unknown>>} The parsed payload.
   * @throws {Error} When the command printed something other than one JSON object.
   */
  async json (args, options = {}) {
    const result = await this.run([...args, '--json'], options)
    const line = result.stdout.trim().split('\n').filter(Boolean).pop()
    if (line === undefined) throw new Error(`no JSON on stdout: ${result.output}`)
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`stdout was not JSON: ${result.output}`)
    }
  }

  /**
   * Reads the persisted user config.
   *
   * @returns {Record<string, unknown>} The parsed config file, or `{}` before
   *   the CLI has written one.
   */
  readConfig () {
    try {
      return JSON.parse(readFileSync(this.configPath(), 'utf8'))
    } catch {
      return {}
    }
  }

  /**
   * Replaces the persisted user config, for states the CLI refuses to create —
   * a second provider of a single-instance kind, say.
   *
   * @param {Record<string, unknown>} config - The config to write.
   * @returns {void}
   */
  writeConfig (config) {
    mkdirSync(dirname(this.configPath()), { recursive: true })
    writeFileSync(this.configPath(), JSON.stringify(config, null, 2))
  }

  /**
   * Returns the path of the persisted user config.
   *
   * @returns {string} Absolute path to `config.json`.
   */
  configPath () {
    return join(this.configHome, 'wdk-cli', 'config.json')
  }

  /**
   * Removes the config directory.
   *
   * @returns {void}
   */
  cleanup () {
    rmSync(this.configHome, { recursive: true, force: true })
  }
}
