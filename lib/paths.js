/**
 * Path helpers shared by the settings reader and the certificate reader.
 * @module dsh-net-policy/paths
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * Expand a leading `~` to this account's home directory. Both separators are
 * accepted, because a Windows user writes `~\certs\root.pem` as readily as a
 * macOS one writes `~/certs/root.pem`.
 * @param {string} path - a path as the user typed it.
 * @returns {string} the path with `~` resolved; anything else is unchanged.
 */
export function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return resolve(homedir(), path.slice(2))
  return path
}
