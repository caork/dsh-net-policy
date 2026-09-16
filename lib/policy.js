/**
 * Pure policy resolution for dsh-net-policy: validate one configuration
 * document and answer, for a URL, which proxy it takes and whether its
 * certificate is verified. No transport, no filesystem, no process state, so
 * the same answer can be asserted in tests and reused by the installer.
 * @module dsh-net-policy/policy
 */

const NAME = 'dsh-net-policy'

/** Hosts never sent through a proxy: the Host's own web server and local servers. */
const LOOPBACK_HOSTS = new Set(['localhost', '::1', '0.0.0.0', '::ffff:0.0.0.0'])

/**
 * Whether a hostname is loopback, including the whole 127.0.0.0/8 range that
 * no bypass-list entry can spell.
 * @param {string} hostname - lowercased hostname without brackets.
 * @returns {boolean} true when the address never leaves this machine.
 */
export function isLoopbackHost(hostname) {
  if (LOOPBACK_HOSTS.has(hostname)) return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)) return true
  return /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)
}

/**
 * Match one host pattern against a hostname. An entry names a host and matches
 * it together with every subdomain under it, so `example.com` also matches
 * `api.example.com`; a leading `.` or `*.` means the same thing, and `*`
 * matches everything.
 * @param {string} pattern - the configured entry.
 * @param {string} hostname - the request hostname.
 * @returns {boolean} true when the entry covers this hostname.
 */
export function hostMatches(pattern, hostname) {
  const entry = pattern.trim().toLowerCase().replace(/^\*\./u, '.')
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (entry === '' ) return false
  if (entry === '*') return true
  const bare = entry.startsWith('.') ? entry.slice(1) : entry
  if (host === bare) return true
  return host.endsWith(`.${bare}`)
}

/** Read one string list, rejecting anything else. @returns {string[]} */
function stringList(value, field) {
  if (value === undefined || value === null) return []
  const list = Array.isArray(value) ? value : [value]
  for (const entry of list) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new TypeError(`${NAME}: ${field} must be a non-empty string or an array of them`)
    }
  }
  return list.map(entry => entry.trim())
}

/** Read one optional positive-integer millisecond value. @returns {number | undefined} */
function milliseconds(value, field) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new TypeError(`${NAME}: ${field} must be a positive whole number of milliseconds`)
  }
  return value
}

/**
 * Read the optional timeout block. Anything left unset keeps undici's own
 * default, so a document that does not mention timeouts changes none of them.
 * @returns {{ connect?: number, headers?: number, body?: number }}
 */
function timeouts(value) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${NAME}: timeouts must be a JSON object`)
  const source = /** @type {Record<string, unknown>} */ (value)
  const connect = milliseconds(source.connect, 'timeouts.connect')
  const headers = milliseconds(source.headers, 'timeouts.headers')
  const body = milliseconds(source.body, 'timeouts.body')
  return {
    ...connect === undefined ? {} : { connect },
    ...headers === undefined ? {} : { headers },
    ...body === undefined ? {} : { body },
  }
}

/** Read one optional boolean, rejecting anything else. @returns {boolean} */
function boolean(value, field) {
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') throw new TypeError(`${NAME}: ${field} must be a boolean`)
  return value
}

/**
 * Read one proxy URL. `null` and `false` disable a proxy inherited from the
 * document root, which is how a rule sends one host direct.
 * @returns {string | undefined | null} the URL, `null` for an explicit direct route.
 */
function proxyUrl(value, field) {
  if (value === undefined) return undefined
  if (value === null || value === false || value === '') return null
  if (typeof value !== 'string') throw new TypeError(`${NAME}: ${field} must be a proxy URL string or null`)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError(`${NAME}: ${field} is not a valid URL: ${value}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`${NAME}: ${field} must be an http: or https: proxy URL (SOCKS is not supported): ${value}`)
  }
  return parsed.href
}

/**
 * Validate one configuration document and fill in its defaults.
 * @param {unknown} raw - the document from the settings file or plugin config.
 * @returns {{ caFiles: string[], insecure: boolean, proxy: string | null, noProxy: string[], debug: boolean,
 *   timeouts: { connect?: number, headers?: number, body?: number },
 *   rules: { hosts: string[], proxy: string | undefined | null, insecure: boolean | undefined, caFiles: string[] }[] }}
 *   the normalized policy.
 * @throws {TypeError} when a field has the wrong shape, naming the field.
 */
export function normalizeConfig(raw) {
  if (raw === undefined || raw === null) raw = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`${NAME}: configuration must be a JSON object`)
  }
  const source = /** @type {Record<string, unknown>} */ (raw)
  const rawRules = source.rules === undefined ? [] : source.rules
  if (!Array.isArray(rawRules)) throw new TypeError(`${NAME}: rules must be an array`)
  const rules = rawRules.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError(`${NAME}: rules[${String(index)}] must be an object`)
    }
    const rule = /** @type {Record<string, unknown>} */ (entry)
    const hosts = stringList(rule.host ?? rule.hosts, `rules[${String(index)}].host`)
    if (hosts.length === 0) throw new TypeError(`${NAME}: rules[${String(index)}].host is required`)
    return {
      hosts,
      proxy: proxyUrl(rule.proxy, `rules[${String(index)}].proxy`),
      insecure: rule.insecure === undefined ? undefined : boolean(rule.insecure, `rules[${String(index)}].insecure`),
      caFiles: stringList(rule.caFiles ?? rule.caFile, `rules[${String(index)}].caFiles`),
    }
  })
  return {
    caFiles: stringList(source.caFiles ?? source.caFile, 'caFiles'),
    insecure: boolean(source.insecure, 'insecure'),
    proxy: proxyUrl(source.proxy, 'proxy') ?? null,
    noProxy: stringList(source.noProxy, 'noProxy'),
    debug: boolean(source.debug, 'debug'),
    timeouts: timeouts(source.timeouts),
    rules,
  }
}

/** Every PEM path the policy asks this process to trust. @returns {string[]} */
export function trustedCaFiles(policy) {
  return [...policy.caFiles, ...policy.rules.flatMap(rule => rule.caFiles)]
}

/**
 * Decide one URL's route. The first matching rule wins; the document root
 * supplies whatever that rule leaves unset. Loopback is always direct.
 * @param {ReturnType<typeof normalizeConfig>} policy - the normalized policy.
 * @param {string | URL} target - the request URL or origin.
 * @returns {{ proxy: string | null, insecure: boolean }} the route for this URL.
 */
export function routeFor(policy, target) {
  const url = typeof target === 'string' ? new URL(target) : target
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  const rule = policy.rules.find(entry => entry.hosts.some(pattern => hostMatches(pattern, hostname)))
  const insecure = rule?.insecure ?? policy.insecure
  if (isLoopbackHost(hostname)) return { proxy: null, insecure }
  if (rule?.proxy !== undefined) return { proxy: rule.proxy, insecure }
  if (policy.noProxy.some(pattern => hostMatches(pattern, hostname))) return { proxy: null, insecure }
  return { proxy: policy.proxy, insecure }
}

/**
 * One line naming what the policy will do, for the Host log.
 * @param {ReturnType<typeof normalizeConfig>} policy - the normalized policy.
 * @returns {string} the diagnostic, which never contains proxy credentials.
 */
export function describePolicy(policy) {
  const redact = (url) => {
    if (url === null) return 'direct'
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    return parsed.href
  }
  const parts = [`proxy ${redact(policy.proxy)}`]
  if (policy.noProxy.length > 0) parts.push(`bypass ${policy.noProxy.join(',')}`)
  const caCount = trustedCaFiles(policy).length
  if (caCount > 0) parts.push(`${String(caCount)} extra CA file(s)`)
  if (policy.insecure) parts.push('certificate verification DISABLED for every host')
  const limits = Object.entries(policy.timeouts).map(([name, value]) => `${name} ${String(value)}ms`)
  if (limits.length > 0) parts.push(`timeouts ${limits.join(', ')}`)
  if (policy.debug) parts.push('per-origin routing logged')
  for (const rule of policy.rules) {
    const detail = [
      rule.proxy === undefined ? undefined : `proxy ${redact(rule.proxy)}`,
      rule.insecure === undefined ? undefined : `insecure ${String(rule.insecure)}`,
    ].filter(entry => entry !== undefined).join(' ')
    if (detail !== '') parts.push(`${rule.hosts.join('|')} => ${detail}`)
  }
  return parts.join('; ')
}
