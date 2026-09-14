import assert from 'node:assert/strict'
import test from 'node:test'
import { describePolicy, hostMatches, isLoopbackHost, normalizeConfig, routeFor } from '../lib/policy.js'

test('a host entry covers the host and its subdomains', () => {
  assert.equal(hostMatches('example.com', 'example.com'), true)
  assert.equal(hostMatches('example.com', 'api.example.com'), true)
  assert.equal(hostMatches('.example.com', 'api.example.com'), true)
  assert.equal(hostMatches('*.example.com', 'api.example.com'), true)
  assert.equal(hostMatches('example.com', 'notexample.com'), false)
  assert.equal(hostMatches('*', 'anything.invalid'), true)
})

test('the whole 127.0.0.0/8 range is loopback', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true)
  assert.equal(isLoopbackHost('127.9.9.9'), true)
  assert.equal(isLoopbackHost('localhost'), true)
  assert.equal(isLoopbackHost('::1'), true)
  assert.equal(isLoopbackHost('192.168.31.179'), false)
})

test('an empty document is a direct, verifying policy', () => {
  const policy = normalizeConfig({})
  assert.deepEqual(routeFor(policy, 'https://api.example.com/v1'), { proxy: null, insecure: false })
})

test('the first matching rule wins and the root fills in what it leaves unset', () => {
  const policy = normalizeConfig({
    proxy: 'http://127.0.0.1:7890',
    insecure: false,
    rules: [
      { host: 'llm.internal', insecure: true, proxy: null },
      { host: '*.corp.example', proxy: 'http://proxy.corp.example:3128' },
    ],
  })
  assert.deepEqual(routeFor(policy, 'https://llm.internal/v1/chat'), { proxy: null, insecure: true })
  assert.deepEqual(routeFor(policy, 'https://api.corp.example/x'), {
    proxy: 'http://proxy.corp.example:3128/', insecure: false,
  })
  assert.deepEqual(routeFor(policy, 'https://api.openai.com/v1'), {
    proxy: 'http://127.0.0.1:7890/', insecure: false,
  })
})

test('loopback and bypass entries stay direct while keeping their verification answer', () => {
  const policy = normalizeConfig({
    proxy: 'http://127.0.0.1:7890',
    noProxy: ['internal.example'],
    rules: [{ host: 'localhost', insecure: true }],
  })
  assert.deepEqual(routeFor(policy, 'https://localhost:8443/'), { proxy: null, insecure: true })
  assert.deepEqual(routeFor(policy, 'https://127.0.0.1:8443/'), { proxy: null, insecure: false })
  assert.deepEqual(routeFor(policy, 'https://api.internal.example/'), { proxy: null, insecure: false })
})

test('a malformed document names the field it rejected', () => {
  assert.throws(() => normalizeConfig({ proxy: 'socks5://127.0.0.1:1080' }), /http: or https: proxy URL/u)
  assert.throws(() => normalizeConfig({ insecure: 'yes' }), /insecure must be a boolean/u)
  assert.throws(() => normalizeConfig({ rules: [{ proxy: 'http://p:1' }] }), /rules\[0\]\.host is required/u)
  assert.throws(() => normalizeConfig([]), /must be a JSON object/u)
})

test('the diagnostic never prints proxy credentials', () => {
  const policy = normalizeConfig({ proxy: 'http://user:secret@127.0.0.1:7890' })
  const description = describePolicy(policy)
  assert.equal(description.includes('secret'), false)
  assert.equal(description.includes('127.0.0.1:7890'), true)
})
