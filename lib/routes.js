/**
 * Route handlers for the settings document: pure functions over a path and a
 * body, so the browser half's contract can be asserted without a web server.
 * @module dsh-net-policy/routes
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeConfig } from './policy.js'

/**
 * Store one document, replacing the file in a single step so a reader never
 * sees a half-written policy.
 *
 * Windows is the reason for the fallback: `rename` over an existing file is
 * atomic on POSIX, but on Windows a virus scanner or an editor holding the
 * target open answers EPERM/EBUSY. Overwriting in place is not atomic, and it
 * is still better than refusing the user's save.
 * @param {string} settingsPath - the file to replace.
 * @param {string} text - the document to store.
 */
function storeDocument(settingsPath, text) {
  const directory = dirname(settingsPath)
  mkdirSync(directory, { recursive: true })
  const temporary = join(directory, `.net-policy.${String(process.pid)}.tmp`)
  writeFileSync(temporary, text, 'utf8')
  try {
    renameSync(temporary, settingsPath)
  } catch (cause) {
    try {
      writeFileSync(settingsPath, text, 'utf8')
    } catch {
      throw cause
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}

/**
 * Read the stored document for the settings section.
 * @param {string} settingsPath - the resolved settings file.
 * @returns {{ status: number, body: unknown }} the route outcome.
 */
export function handleReadSettings(settingsPath) {
  if (!existsSync(settingsPath)) {
    return { status: 200, body: { ok: true, path: settingsPath, exists: false, document: {} } }
  }
  try {
    // The byte-order mark a Windows editor leaves behind would otherwise make
    // JSON.parse reject a file the user just edited by hand.
    const raw = readFileSync(settingsPath, 'utf8')
    const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw
    const document = text.trim() === '' ? {} : JSON.parse(text)
    return { status: 200, body: { ok: true, path: settingsPath, exists: true, document } }
  } catch (cause) {
    return { status: 200, body: { ok: false, path: settingsPath, exists: true, error: cause instanceof Error ? cause.message : String(cause) } }
  }
}

/**
 * Validate, store, and apply one document. A document the plugin cannot use is
 * rejected before the file is touched, so a bad edit never becomes the policy
 * this process keeps.
 * @param {string} settingsPath - the resolved settings file.
 * @param {unknown} body - the parsed request body, the document itself.
 * @param {{ assertUsable: (policy: unknown) => void, apply: () => { ok: boolean, detail: string } }} deps
 *   validation and the reapply hook.
 * @returns {{ status: number, body: unknown }} the route outcome.
 */
export function handleWriteSettings(settingsPath, body, deps) {
  let policy
  try {
    policy = normalizeConfig(body)
    deps.assertUsable(policy)
  } catch (cause) {
    return { status: 400, body: { ok: false, error: cause instanceof Error ? cause.message : String(cause) } }
  }
  try {
    storeDocument(settingsPath, `${JSON.stringify(body, null, 2)}\n`)
  } catch (cause) {
    return { status: 500, body: { ok: false, error: `cannot write ${settingsPath}: ${cause instanceof Error ? cause.message : String(cause)}` } }
  }
  const applied = deps.apply()
  if (!applied.ok) return { status: 500, body: { ok: false, error: applied.detail } }
  return { status: 200, body: { ok: true, path: settingsPath, applied: applied.detail } }
}
