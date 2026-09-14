/**
 * dsh-net-policy host half: install one outbound transport policy for this
 * Harness process — extra trusted CAs, per-host certificate verification, and
 * per-host HTTP proxies — and take it back down on unmount.
 *
 * Everything the Harness sends through the global `fetch` (the LLM adapters,
 * web search, HTTP MCP) reaches the global undici dispatcher, so one policy
 * installed here covers them without touching any provider configuration.
 * @module dsh-net-policy
 */

import { X509Certificate } from 'node:crypto'
import { existsSync, readFileSync, unwatchFile, watchFile } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import tls from 'node:tls'
import { Agent, Pool, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { expandHome } from './paths.js'
import { describePolicy, normalizeConfig, routeFor, trustedCaFiles } from './policy.js'
import { handleReadSettings, handleWriteSettings } from './routes.js'
import { BODY_LIMIT, ROUTE_SETTINGS } from './wire.js'

export const name = 'dsh-net-policy'
export const inject = []

/** undici's legacy global-dispatcher slot, the one Node's built-in fetch reads. */
const GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1')

/** How often the settings file is polled for edits. */
const WATCH_INTERVAL_MS = 2_000

/**
 * Resolve the settings document path: the configured value, `$DSH_HOME`, or
 * the default Harness home.
 * @param {string | undefined} configured - the plugin's `settingsFile`.
 * @returns {string} an absolute path, which need not exist.
 */
export function resolveSettingsPath(configured) {
  const home = process.env.DSH_HOME === undefined || process.env.DSH_HOME === ''
    ? resolve(homedir(), '.dsh')
    : resolve(process.env.DSH_HOME)
  if (configured === undefined || configured === '') return resolve(home, 'net-policy.json')
  const expanded = expandHome(configured)
  return isAbsolute(expanded) ? expanded : resolve(home, expanded)
}

/**
 * Diagnostics sink. Always stdout, which the product's Host log captures and a
 * headless composition prints, and additionally the Host logger when the
 * composition provides one — a transport that silently did not install is the
 * one failure a user cannot diagnose from the outside.
 */
function createLogger(ctx) {
  let forward
  try {
    const logger = typeof ctx?.logger === 'function' ? ctx.logger(name) : undefined
    if (logger !== undefined && typeof logger.info === 'function') forward = logger
  } catch {
    // A composition without a logger service still gets the stdout line.
  }
  const emit = (level, message) => {
    process.stdout.write(`${name}: ${level}: ${message}\n`)
    try {
      const sink = forward === undefined ? undefined : forward[level] ?? forward.info
      sink?.call(forward, message)
    } catch {
      // The stdout line above is the one that must not depend on a service.
    }
  }
  return {
    info: (message) => { emit('info', message) },
    warn: (message) => { emit('warn', message) },
    error: (message) => { emit('error', message) },
  }
}

/**
 * Read the effective configuration document: the settings file when it exists,
 * and the plugin's own config otherwise.
 * @param {string} settingsPath - the resolved settings file.
 * @param {unknown} inline - the plugin config from the profile patch layer.
 * @returns {{ document: unknown, source: string }} the document and where it came from.
 */
export function readDocument(settingsPath, inline) {
  if (!existsSync(settingsPath)) return { document: inline ?? {}, source: 'plugin config' }
  const text = stripBom(readFileSync(settingsPath, 'utf8'))
  if (text.trim() === '') return { document: {}, source: settingsPath }
  return { document: JSON.parse(text), source: settingsPath }
}

/**
 * Read every certificate file the policy names, as PEM.
 *
 * A file exported from the Windows certificate store is often DER, which the
 * trust APIs drop SILENTLY — the user would see a save succeed and the
 * connection still fail — so DER is converted here instead. A PEM file is
 * passed through whole, because a bundle may carry several certificates.
 * @param {string[]} paths - the configured certificate paths.
 * @returns {string[]} one PEM document per path.
 * @throws {Error} naming the path that could not be read or parsed.
 */
function readCertificates(paths) {
  return paths.map((path) => {
    const expanded = expandHome(path)
    let bytes
    try {
      bytes = readFileSync(expanded)
    } catch (cause) {
      throw new Error(`cannot read CA file ${expanded}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    const text = stripBom(bytes.toString('utf8'))
    if (text.includes('-----BEGIN CERTIFICATE-----')) return text
    try {
      return new X509Certificate(bytes).toString()
    } catch (cause) {
      throw new Error(`${expanded} is neither a PEM nor a DER certificate: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  })
}

/** Drop the byte-order mark a Windows editor writes ahead of a text file. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

/** The process's current default trust store, on any supported runtime. */
function defaultTrust() {
  if (typeof tls.getCACertificates === 'function') return tls.getCACertificates('default')
  return [...tls.rootCertificates]
}

/**
 * Capture the transport state this plugin must be able to give back. Taken
 * once per mount: a settings reload replaces the active policy, and only the
 * unmount returns the process to what it found.
 * @returns {{ dispatcher: unknown, trust: string[], fetch: typeof globalThis.fetch }} the baseline.
 */
export function captureBaseline() {
  return { dispatcher: getGlobalDispatcher(), trust: defaultTrust(), fetch: globalThis.fetch }
}

/** Whether this plugin currently owns `globalThis.fetch`, which it only does as a fallback. */
let fetchIsWrapped = false

/** Put the process back on the captured baseline transport. */
function restoreBaseline(baseline) {
  if (fetchIsWrapped) {
    globalThis.fetch = baseline.fetch
    fetchIsWrapped = false
  }
  setGlobalDispatcher(baseline.dispatcher)
  if (typeof tls.setDefaultCACertificates === 'function') tls.setDefaultCACertificates(baseline.trust)
}

/**
 * Build the transport one normalized policy asks for, without installing it.
 *
 * Extra CAs join the process-wide default trust store, which also reaches
 * callers that build their own transport. Proxy selection and verification
 * live in the global dispatcher's per-origin factory, so one request's answer
 * cannot drift from another's.
 * @param {ReturnType<typeof normalizeConfig>} policy - the policy to build for.
 * @param {ReturnType<typeof captureBaseline>} baseline - the state it builds on top of.
 * @returns {{ dispatcher: Agent, trust: string[], extraCertificates: string[], release: () => Promise<void> }}
 *   the transport and a disposer for the resources it owns.
 */
export function buildTransport(policy, baseline) {
  const extraCertificates = readCertificates(trustedCaFiles(policy))
  const trust = [...baseline.trust, ...extraCertificates]
  // One dispatcher instance per origin, never shared between two origins: the
  // owning Agent closes each of them exactly once on release.
  const dispatcher = new Agent({
    factory(origin, options) {
      const route = routeFor(policy, typeof origin === 'string' ? origin : origin.origin)
      if (route.proxy !== null) {
        return new ProxyAgent({
          uri: route.proxy,
          ...(route.insecure ? { requestTls: { rejectUnauthorized: false } } : {}),
          ...(extraCertificates.length > 0 && !route.insecure ? { requestTls: { ca: trust } } : {}),
        })
      }
      const connect = { ...(typeof options.connect === 'object' && options.connect !== null ? options.connect : {}) }
      if (route.insecure) connect.rejectUnauthorized = false
      else if (extraCertificates.length > 0) connect.ca = trust
      return new Pool(origin, { ...options, connect })
    },
  })
  const release = async () => {
    await Promise.resolve().then(async () => { await dispatcher.close() }).catch(() => {})
  }
  return { dispatcher, trust, extraCertificates, release }
}

/**
 * Make one built transport this process's transport.
 * @param {ReturnType<typeof buildTransport>} transport - the transport to install.
 * @param {ReturnType<typeof captureBaseline>} baseline - the state a fetch wrapper delegates to.
 * @param {ReturnType<typeof createLogger>} log - diagnostics sink.
 */
function activate(transport, baseline, log) {
  if (transport.extraCertificates.length > 0) {
    if (typeof tls.setDefaultCACertificates === 'function') tls.setDefaultCACertificates(transport.trust)
    else log.warn('this runtime cannot extend the default trust store; extra CAs reach fetch only')
  } else if (typeof tls.setDefaultCACertificates === 'function') {
    tls.setDefaultCACertificates(baseline.trust)
  }
  setGlobalDispatcher(transport.dispatcher)
  // Node's built-in fetch reads undici's legacy global slot. A userland undici
  // that no longer writes it would leave every request on the default
  // transport, so check rather than assume, and wrap fetch when it happened.
  if (globalThis[GLOBAL_DISPATCHER] === transport.dispatcher) {
    if (fetchIsWrapped) {
      globalThis.fetch = baseline.fetch
      fetchIsWrapped = false
    }
    return
  }
  globalThis.fetch = (input, init) => baseline.fetch(input, {
    ...init,
    dispatcher: init?.dispatcher ?? transport.dispatcher,
  })
  fetchIsWrapped = true
  log.warn('undici did not publish the global dispatcher slot; routing through a fetch wrapper instead')
}

/**
 * Plugin apply: install the configured policy, then reinstall it whenever the
 * settings file changes. A document this plugin cannot use leaves the previous
 * policy in place — a typo in a settings file must not cost the user their
 * agent — and says so in the Host log.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {unknown} config - the plugin config from the profile patch layer.
 */
export function apply(ctx, config) {
  const log = createLogger(ctx)
  const inline = typeof config === 'object' && config !== null ? { ...config } : {}
  const settingsPath = resolveSettingsPath(inline.settingsFile)
  delete inline.settingsFile

  const baseline = captureBaseline()
  let active

  const reload = (reason) => {
    let policy
    let source
    let transport
    try {
      const read = readDocument(settingsPath, inline)
      source = read.source
      policy = normalizeConfig(read.document)
      transport = buildTransport(policy, baseline)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      log.error(`kept the previous policy: ${detail}`)
      return { ok: false, detail }
    }
    const previous = active
    active = transport
    activate(transport, baseline, log)
    if (previous !== undefined) void previous.release()
    const detail = describePolicy(policy)
    log.info(`${reason} from ${source}: ${detail}`)
    return { ok: true, detail }
  }

  reload('applied')
  const onChange = (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
    reload('reapplied')
  }
  watchFile(settingsPath, { interval: WATCH_INTERVAL_MS }, onChange)

  ctx.effect(() => async () => {
    unwatchFile(settingsPath, onChange)
    restoreBaseline(baseline)
    const current = active
    active = undefined
    await current?.release()
  }, 'dsh-net-policy: outbound transport policy')

  // The browser half edits the same document through these two routes; a web
  // server is optional, so a headless composition keeps the file as its only
  // interface.
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (webCtx) => {
    const send = (response, outcome) => {
      response.writeHead(outcome.status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(JSON.stringify(outcome.body))
    }
    const readBody = (request) => new Promise((resolveBody, rejectBody) => {
      const chunks = []
      let size = 0
      request.on('data', (chunk) => {
        size += chunk.length
        if (size > BODY_LIMIT) {
          request.destroy()
          rejectBody(new Error('request body too large'))
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        if (chunks.length === 0) {
          resolveBody({})
          return
        }
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (cause) {
          rejectBody(new Error(`invalid JSON body: ${cause instanceof Error ? cause.message : String(cause)}`))
        }
      })
      request.on('error', rejectBody)
    })
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: ROUTE_SETTINGS,
      handler: async (request, response) => {
        try {
          if (request.method === 'PUT' || request.method === 'POST') {
            send(response, handleWriteSettings(settingsPath, await readBody(request), {
              assertUsable: (policy) => { readCertificates(trustedCaFiles(policy)) },
              apply: () => reload('applied'),
            }))
            return
          }
          send(response, handleReadSettings(settingsPath))
        } catch (cause) {
          send(response, { status: 400, body: { ok: false, error: cause instanceof Error ? cause.message : String(cause) } })
        }
      },
    }), 'dsh-net-policy: settings route')
  })
}

export default { name, inject, apply }
