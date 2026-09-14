import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { documentFromForm, emptyRule, formFromDocument } from '../lib/form.js'
import { expandHome } from '../lib/paths.js'
import { normalizeConfig, routeFor } from '../lib/policy.js'
import { handleReadSettings, handleWriteSettings } from '../lib/routes.js'

test('a document survives the trip through the form', () => {
  const document = {
    proxy: 'http://127.0.0.1:7890',
    noProxy: ['example.com', '192.168.31.179'],
    caFiles: ['/tmp/a.pem', '/tmp/b.pem'],
    insecure: true,
    rules: [
      { host: 'llm.internal', proxy: null, insecure: true },
      { host: ['a.example', 'b.example'], proxy: 'http://proxy:3128' },
    ],
  }
  assert.deepEqual(documentFromForm(formFromDocument(document)), {
    proxy: 'http://127.0.0.1:7890',
    noProxy: ['example.com', '192.168.31.179'],
    caFiles: ['/tmp/a.pem', '/tmp/b.pem'],
    insecure: true,
    rules: [
      { host: 'llm.internal', proxy: null, insecure: true },
      { host: ['a.example', 'b.example'], proxy: 'http://proxy:3128' },
    ],
  })
})

test('an empty form stores an empty document', () => {
  assert.deepEqual(documentFromForm(formFromDocument({})), {})
  assert.deepEqual(documentFromForm({ ...formFromDocument({}), rules: [emptyRule()] }), {})
})

test('an inherit row stores no proxy key, so the root still decides', () => {
  const form = { ...formFromDocument({}), proxy: 'http://127.0.0.1:7890', rules: [{ ...emptyRule(), host: 'a.example', insecure: true }] }
  const document = documentFromForm(form)
  assert.deepEqual(document.rules, [{ host: 'a.example', insecure: true }])
  assert.equal(routeFor(normalizeConfig(document), 'https://a.example/').proxy, 'http://127.0.0.1:7890/')
})

test('the write route validates before it touches the file', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-net-policy-routes-'))
  const settingsPath = join(home, 'net-policy.json')
  try {
    let applied = 0
    const deps = { assertUsable: () => {}, apply: () => { applied += 1; return { ok: true, detail: 'ok' } } }
    const rejected = handleWriteSettings(settingsPath, { proxy: 'socks5://127.0.0.1:1080' }, deps)
    assert.equal(rejected.status, 400)
    assert.equal(applied, 0)
    assert.deepEqual(handleReadSettings(settingsPath).body.exists, false)

    const accepted = handleWriteSettings(settingsPath, { proxy: 'http://127.0.0.1:7890' }, deps)
    assert.equal(accepted.status, 200)
    assert.equal(applied, 1)
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')), { proxy: 'http://127.0.0.1:7890' })
    assert.deepEqual(handleReadSettings(settingsPath).body.document, { proxy: 'http://127.0.0.1:7890' })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an unusable CA path is refused with the path in the message', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-net-policy-routes-'))
  try {
    const outcome = handleWriteSettings(join(home, 'net-policy.json'), { caFiles: ['/nope/missing.pem'] }, {
      assertUsable: () => { throw new Error('cannot read CA file /nope/missing.pem: ENOENT') },
      apply: () => ({ ok: true, detail: 'ok' }),
    })
    assert.equal(outcome.status, 400)
    assert.match(outcome.body.error, /\/nope\/missing\.pem/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a leading ~ expands on either platform separator', () => {
  const home = homedir()
  assert.equal(expandHome('~'), home)
  assert.equal(expandHome('~/certs/root.pem'), join(home, 'certs', 'root.pem'))
  // The Windows form must be recognised as a home path on any platform, so a
  // settings file written on Windows still resolves when it is read back.
  const windowsForm = expandHome('~\\certs\\root.pem')
  assert.ok(windowsForm.startsWith(home), windowsForm)
  assert.ok(windowsForm.endsWith('root.pem'), windowsForm)
  // Anything that is not a home path is returned untouched, including an
  // absolute Windows path and the `~user` form no shell expands here.
  assert.equal(expandHome('/etc/ssl/root.pem'), '/etc/ssl/root.pem')
  assert.equal(expandHome('C:\\certs\\root.pem'), 'C:\\certs\\root.pem')
  assert.equal(expandHome('~user/certs/root.pem'), '~user/certs/root.pem')
})
