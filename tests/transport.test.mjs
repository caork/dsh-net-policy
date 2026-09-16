/**
 * Drive the installed policy through the process's real built-in fetch: a
 * self-signed HTTPS origin, and a CONNECT proxy that records what it was asked
 * to tunnel. An assertion here is what catches undici or Node changing where
 * the global dispatcher lives.
 */
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { connect } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-net-policy-'))
const { apply, buildTransport, captureBaseline } = await import('../lib/index.js')
const { normalizeConfig } = await import('../lib/policy.js')

const fixture = (file) => fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url))
const CERT_PATH = fixture('server-cert.pem')

let origin
let proxyUrl
let connectRequests = []
let closeAll = async () => {}

before(async () => {
  const tlsServer = createTlsServer(
    { key: readFileSync(fixture('server-key.pem')), cert: readFileSync(CERT_PATH) },
    (_request, response) => { response.writeHead(200); response.end('served') },
  )
  await new Promise(resolve => tlsServer.listen(0, '127.0.0.1', resolve))
  const originPort = tlsServer.address().port

  // A CONNECT proxy that tunnels every request to the one origin above, so the
  // client's hostname never needs to resolve.
  const proxy = createHttpServer((_request, response) => { response.writeHead(405); response.end() })
  proxy.on('connect', (request, socket) => {
    connectRequests.push(request.url)
    const upstream = connect(originPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => { socket.destroy() })
    socket.on('error', () => { upstream.destroy() })
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))

  origin = `https://localhost:${String(originPort)}`
  proxyUrl = `http://127.0.0.1:${String(proxy.address().port)}`
  closeAll = async () => {
    await new Promise(resolve => proxy.close(resolve))
    await new Promise(resolve => tlsServer.close(resolve))
  }
})

after(async () => { await closeAll() })

/** Mount the plugin with one inline config, run the body, then unmount it. */
async function withPolicy(config, body) {
  const disposers = []
  const ctx = { effect: (factory) => { disposers.push(factory()) }, inject: () => {} }
  apply(ctx, config)
  try {
    await body()
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
  }
}

/** Fetch and answer with the status, or the network error code. */
async function get(url) {
  try {
    const response = await fetch(url)
    return { status: response.status, body: await response.text() }
  } catch (error) {
    return { error: error.cause?.code ?? error.cause?.message ?? error.message }
  }
}

test('an unknown self-signed origin is refused before the policy is installed', async () => {
  assert.deepEqual(await get(origin), { error: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
})

test('a caFiles entry makes the origin trusted, and unmounting takes the trust back', async () => {
  await withPolicy({ caFiles: [CERT_PATH] }, async () => {
    assert.deepEqual(await get(origin), { status: 200, body: 'served' })
  })
  assert.deepEqual(await get(origin), { error: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
})

test('a DER certificate is trusted too, which is what the Windows store exports', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-net-policy-der-'))
  const derPath = join(home, 'root-ca.cer')
  const pem = readFileSync(CERT_PATH, 'utf8')
  const body = pem.replace(/-----[A-Z ]+-----/gu, '').replace(/\s/gu, '')
  writeFileSync(derPath, Buffer.from(body, 'base64'))
  try {
    await withPolicy({ caFiles: [derPath] }, async () => {
      assert.deepEqual(await get(origin), { status: 200, body: 'served' })
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a file that is neither PEM nor DER leaves the previous policy in place', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-net-policy-bad-'))
  const badPath = join(home, 'not-a-cert.pem')
  writeFileSync(badPath, 'this is not a certificate\n')
  try {
    await withPolicy({ caFiles: [badPath] }, async () => {
      assert.deepEqual(await get(origin), { error: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an insecure rule skips verification for its host only', async () => {
  await withPolicy({ rules: [{ host: 'localhost', insecure: true }] }, async () => {
    assert.deepEqual(await get(origin), { status: 200, body: 'served' })
    assert.deepEqual(await get(`https://127.0.0.1${new URL(origin).port === '' ? '' : `:${new URL(origin).port}`}`), {
      error: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    })
  })
})

test('a proxy rule sends the request through the proxy', async () => {
  connectRequests = []
  const port = new URL(origin).port
  await withPolicy({
    caFiles: [CERT_PATH],
    rules: [{ host: 'dsh-test.local', proxy: proxyUrl }],
  }, async () => {
    assert.deepEqual(await get(`https://dsh-test.local:${port}/`), { status: 200, body: 'served' })
  })
  assert.deepEqual(connectRequests, [`dsh-test.local:${port}`])
})

test('a bypass entry keeps the request off the proxy', async () => {
  connectRequests = []
  const port = new URL(origin).port
  await withPolicy({
    caFiles: [CERT_PATH],
    proxy: proxyUrl,
    noProxy: ['dsh-bypass.invalid'],
  }, async () => {
    const result = await get(`https://dsh-bypass.invalid:${port}/`)
    assert.equal(result.status, undefined, 'a bypassed name has no DNS answer, so the request must fail')
  })
  assert.deepEqual(connectRequests, [])
})

test('an edit to the settings file reaches the next request without a restart', async () => {
  const settingsPath = join(process.env.DSH_HOME, 'net-policy.json')
  writeFileSync(settingsPath, JSON.stringify({ rules: [] }))
  const disposers = []
  const ctx = { effect: (factory) => { disposers.push(factory()) }, inject: () => {} }
  apply(ctx, {})
  try {
    assert.deepEqual(await get(origin), { error: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
    writeFileSync(settingsPath, JSON.stringify({ rules: [{ host: 'localhost', insecure: true }] }))
    const deadline = Date.now() + 15_000
    let result = await get(origin)
    while (result.status !== 200 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500))
      result = await get(origin)
    }
    assert.deepEqual(result, { status: 200, body: 'served' })
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    rmSync(settingsPath, { force: true })
  }
})

test('loopback is never proxied even when the root names a proxy', async () => {
  connectRequests = []
  await withPolicy({ caFiles: [CERT_PATH], proxy: proxyUrl }, async () => {
    assert.deepEqual(await get(origin), { status: 200, body: 'served' })
  })
  assert.deepEqual(connectRequests, [])
})

test('debug logging names the route each origin was given', async () => {
  const lines = []
  const log = { info: (message) => { lines.push(message) }, warn: () => {}, error: () => {} }
  const transport = buildTransport(
    normalizeConfig({ debug: true, rules: [{ host: 'localhost', insecure: true }] }),
    captureBaseline(),
    log,
  )
  try {
    const response = await fetch(origin, { dispatcher: transport.dispatcher })
    assert.equal(response.status, 200)
    await response.text()
  } finally {
    await transport.release()
  }
  assert.ok(
    lines.some(line => line === `route ${origin} => direct, verification off`),
    lines.join(' | '),
  )
})

test('a headers timeout from the document is the one the request gets', async () => {
  // A server that accepts the connection and then says nothing: without the
  // configured limit this request would wait out undici's 300 s default.
  const sockets = []
  const silent = createHttpServer(() => {})
  silent.on('connection', (socket) => { sockets.push(socket) })
  await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve))
  const port = silent.address().port
  const transport = buildTransport(normalizeConfig({ timeouts: { headers: 300 } }), captureBaseline())
  try {
    const failure = await fetch(`http://127.0.0.1:${String(port)}/`, { dispatcher: transport.dispatcher })
      .then(() => undefined)
      .catch(error => error.cause?.code ?? error.message)
    assert.equal(failure, 'UND_ERR_HEADERS_TIMEOUT')
  } finally {
    await transport.release()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => silent.close(resolve))
  }
})
