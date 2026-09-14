/**
 * The Network settings section: one form over the same document the host half
 * reads, saved through this plugin's own routes. The host validates before it
 * stores, so an invalid document comes back as an error here instead of
 * becoming the policy.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { documentFromForm, emptyRule, formFromDocument } from '../../lib/form.js'
import { ROUTE_SETTINGS } from '../../lib/wire.js'

type Rule = ReturnType<typeof emptyRule>
type Form = ReturnType<typeof formFromDocument>

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
  marginBottom: 6,
}

const hint: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
  marginTop: 6,
}

const card: React.CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-3)',
  padding: 16,
  marginBottom: 16,
}

const textarea: React.CSSProperties = {
  width: '100%',
  minHeight: 64,
  resize: 'vertical',
  borderRadius: 10,
  border: '0.5px solid var(--dsw-alias-border-l4)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  padding: '8px 10px',
  boxSizing: 'border-box',
}

const select: React.CSSProperties = {
  borderRadius: 10,
  border: '0.5px solid var(--dsw-alias-border-l4)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  padding: '6px 8px',
}

const checkboxRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--dsw-alias-label-secondary)',
}

/**
 * Whether this shell runs on Windows, which only decides which example path
 * the certificate field shows. The Host is the one that resolves paths.
 */
function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false
  const hinted = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof hinted === 'string' && hinted !== '') return hinted === 'Windows'
  return navigator.userAgent.includes('Windows')
}

/** Read the stored document. */
async function loadSettings(): Promise<{ ok: boolean; document?: unknown; path?: string; error?: string }> {
  try {
    const response = await fetch(ROUTE_SETTINGS, { headers: { accept: 'application/json' } })
    return await response.json() as { ok: boolean; document?: unknown; path?: string; error?: string }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Validate, store, and apply one document. */
async function saveSettings(document: unknown): Promise<{ ok: boolean; applied?: string; error?: string }> {
  try {
    const response = await fetch(ROUTE_SETTINGS, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    })
    return await response.json() as { ok: boolean; applied?: string; error?: string }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function NetPolicySection({ t }: { t: (key: string) => string }): React.ReactElement {
  const [form, setForm] = useState<Form | null>(null)
  const [path, setPath] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadSettings().then((result) => {
      if (!live) return
      if (result.path !== undefined) setPath(result.path)
      if (result.ok) setForm(formFromDocument(result.document))
      else {
        setForm(formFromDocument({}))
        setError(`${t('loadFailed')}${result.error ?? ''}`)
      }
    })
    return () => { live = false }
  }, [t])

  const patch = useCallback((update: Partial<Form>) => {
    setForm(current => current === null ? current : { ...current, ...update })
  }, [])

  const patchRule = useCallback((index: number, update: Partial<Rule>) => {
    setForm(current => current === null ? current : {
      ...current,
      rules: current.rules.map((rule, at) => at === index ? { ...rule, ...update } : rule),
    })
  }, [])

  const save = useCallback(async () => {
    if (form === null || busy) return
    setBusy(true)
    setError(null)
    const result = await saveSettings(documentFromForm(form))
    setBusy(false)
    if (result.ok) {
      setApplied(result.applied ?? '')
      return
    }
    setApplied(null)
    setError(result.error ?? 'unknown error')
  }, [busy, form])

  if (form === null) {
    return <div style={{ padding: 16, color: 'var(--dsw-alias-label-tertiary)' }}>{t('loading')}</div>
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 6px', color: 'var(--dsw-alias-label-primary)' }}>
        {t('title')}
      </h2>
      <p style={{ ...hint, marginTop: 0, marginBottom: 16 }}>{t('description')}</p>

      <div style={card}>
        <label style={label} htmlFor="net-policy-proxy">{t('proxyLabel')}</label>
        <Input
          id="net-policy-proxy"
          value={form.proxy}
          placeholder={t('proxyPlaceholder')}
          onChange={(event: { target: { value: string } }) => { patch({ proxy: event.target.value }) }}
        />
        <p style={hint}>{t('proxyHint')}</p>

        <div style={{ height: 16 }} />
        <label style={label} htmlFor="net-policy-noproxy">{t('noProxyLabel')}</label>
        <Input
          id="net-policy-noproxy"
          value={form.noProxy}
          placeholder={t('noProxyPlaceholder')}
          onChange={(event: { target: { value: string } }) => { patch({ noProxy: event.target.value }) }}
        />
        <p style={hint}>{t('noProxyHint')}</p>
      </div>

      <div style={card}>
        <label style={label} htmlFor="net-policy-ca">{t('caLabel')}</label>
        <textarea
          id="net-policy-ca"
          style={textarea}
          value={form.caFiles}
          placeholder={t(isWindows() ? 'caPlaceholderWindows' : 'caPlaceholder')}
          onChange={(event) => { patch({ caFiles: event.target.value }) }}
        />
        <p style={hint}>{t('caHint')}</p>

        <div style={{ height: 16 }} />
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={form.insecure}
            onChange={(event) => { patch({ insecure: event.target.checked }) }}
          />
          <span>{t('insecureLabel')}</span>
        </label>
        <p style={{ ...hint, color: form.insecure ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-tertiary)' }}>
          {t('insecureHint')}
        </p>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 4 }}>{t('rulesTitle')}</div>
        <p style={{ ...hint, marginTop: 0, marginBottom: 12 }}>{t('rulesHint')}</p>
        {form.rules.map((rule, index) => (
          <div
            key={index}
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
              padding: '10px 0', borderTop: index === 0 ? 'none' : '0.5px solid var(--dsw-alias-border-l4)',
            }}
          >
            <div style={{ flex: '1 1 200px', minWidth: 160 }}>
              <Input
                value={rule.host}
                placeholder={t('ruleHostPlaceholder')}
                onChange={(event: { target: { value: string } }) => { patchRule(index, { host: event.target.value }) }}
              />
            </div>
            <select
              style={select}
              value={rule.proxyMode}
              onChange={(event) => { patchRule(index, { proxyMode: event.target.value as Rule['proxyMode'] }) }}
            >
              <option value="inherit">{t('ruleProxyInherit')}</option>
              <option value="direct">{t('ruleProxyDirect')}</option>
              <option value="custom">{t('ruleProxyCustom')}</option>
            </select>
            {rule.proxyMode === 'custom' && (
              <div style={{ flex: '1 1 180px', minWidth: 140 }}>
                <Input
                  value={rule.proxy}
                  placeholder={t('ruleProxyPlaceholder')}
                  onChange={(event: { target: { value: string } }) => { patchRule(index, { proxy: event.target.value }) }}
                />
              </div>
            )}
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={rule.insecure}
                onChange={(event) => { patchRule(index, { insecure: event.target.checked }) }}
              />
              <span>{t('ruleInsecure')}</span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm(current => current === null ? current : {
                  ...current, rules: current.rules.filter((_row, at) => at !== index),
                })
              }}
            >
              {t('ruleRemove')}
            </Button>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setForm(current => current === null ? current : { ...current, rules: [...current.rules, emptyRule()] })
            }}
          >
            {t('ruleAdd')}
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button variant="primary" disabled={busy} onClick={() => { void save() }}>
          {busy ? t('saving') : t('save')}
        </Button>
        {applied !== null && (
          <span style={{ fontSize: 12, color: 'var(--dsw-alias-state-business-primary)' }}>
            {t('appliedPrefix')}{applied}
          </span>
        )}
        {error !== null && (
          <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-error)' }}>{error}</span>
        )}
      </div>
      {path !== '' && <p style={hint}>{t('storedAt')}{path}</p>}
    </div>
  )
}
