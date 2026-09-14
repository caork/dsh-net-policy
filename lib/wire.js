/**
 * Shared wire contract between the host half (HTTP routes) and the browser
 * half (the settings section). Constants and types only, so both builds can
 * import it without pulling a runtime.
 * @module dsh-net-policy/wire
 */

/** Absolute pathname prefix every route of this plugin lives under. */
export const ROUTE_PREFIX = '/plugin/dsh-net-policy'

/** GET and PUT the plugin's own settings document. */
export const ROUTE_SETTINGS = `${ROUTE_PREFIX}/settings`

/** Largest accepted request body: these documents are a few short strings. */
export const BODY_LIMIT = 64 * 1024
