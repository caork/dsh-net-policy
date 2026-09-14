/**
 * Translation between the settings document and the flat shape the browser
 * form edits. Pure and dependency-free, so the round trip is asserted in the
 * host's own tests rather than only in a browser.
 * @module dsh-net-policy/form
 */

/**
 * @typedef {'inherit' | 'direct' | 'custom'} ProxyMode
 *   How one rule answers the proxy question: take the root's answer, force a
 *   direct connection, or name a proxy of its own.
 * @typedef {{ host: string, proxyMode: ProxyMode, proxy: string, insecure: boolean, caFiles: string }} RuleForm
 *   One rule row as the browser form edits it.
 */

/** Split a comma, whitespace, or newline separated list into entries. */
function splitList(text) {
  return text.split(/[\s,]+/u).map(entry => entry.trim()).filter(entry => entry !== '')
}

/** Split a newline separated list, keeping spaces inside each line (paths). */
function splitLines(text) {
  return text.split(/\r?\n/u).map(entry => entry.trim()).filter(entry => entry !== '')
}

/**
 * Project one stored document into form fields.
 * @param {unknown} document - the stored settings document.
 * @returns {{ proxy: string, noProxy: string, caFiles: string, insecure: boolean, rules: RuleForm[] }}
 *   the form state.
 */
export function formFromDocument(document) {
  const source = typeof document === 'object' && document !== null && !Array.isArray(document)
    ? /** @type {Record<string, unknown>} */ (document)
    : {}
  const list = (value) => {
    if (typeof value === 'string') return [value]
    return Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : []
  }
  const rawRules = Array.isArray(source.rules) ? source.rules : []
  return {
    proxy: typeof source.proxy === 'string' ? source.proxy : '',
    noProxy: list(source.noProxy).join(', '),
    caFiles: [...list(source.caFiles), ...list(source.caFile)].join('\n'),
    insecure: source.insecure === true,
    rules: rawRules
      .filter(entry => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
      .map((entry) => {
        const rule = /** @type {Record<string, unknown>} */ (entry)
        const hosts = [...list(rule.host), ...list(rule.hosts)]
        const hasProxy = 'proxy' in rule
        const custom = typeof rule.proxy === 'string' && rule.proxy !== ''
        return /** @type {RuleForm} */ ({
          host: hosts.join(', '),
          proxyMode: custom ? 'custom' : hasProxy ? 'direct' : 'inherit',
          proxy: custom ? /** @type {string} */ (rule.proxy) : '',
          insecure: rule.insecure === true,
          caFiles: [...list(rule.caFiles), ...list(rule.caFile)].join('\n'),
        })
      }),
  }
}

/**
 * Build the document one form state describes, leaving out everything the user
 * did not set so the stored file stays readable by hand.
 * @param {ReturnType<typeof formFromDocument>} form - the form state.
 * @returns {Record<string, unknown>} the document to store.
 */
export function documentFromForm(form) {
  const document = {}
  const proxy = form.proxy.trim()
  if (proxy !== '') document.proxy = proxy
  const noProxy = splitList(form.noProxy)
  if (noProxy.length > 0) document.noProxy = noProxy
  const caFiles = splitLines(form.caFiles)
  if (caFiles.length > 0) document.caFiles = caFiles
  if (form.insecure) document.insecure = true
  const rules = form.rules
    .map((rule) => {
      const hosts = splitList(rule.host)
      if (hosts.length === 0) return undefined
      const entry = { host: hosts.length === 1 ? hosts[0] : hosts }
      if (rule.proxyMode === 'direct') entry.proxy = null
      if (rule.proxyMode === 'custom' && rule.proxy.trim() !== '') entry.proxy = rule.proxy.trim()
      if (rule.insecure) entry.insecure = true
      const ruleCaFiles = splitLines(rule.caFiles ?? '')
      if (ruleCaFiles.length > 0) entry.caFiles = ruleCaFiles
      return entry
    })
    .filter(entry => entry !== undefined)
  if (rules.length > 0) document.rules = rules
  return document
}

/**
 * One blank rule row for the form's add button.
 * @returns {RuleForm} the blank row.
 */
export function emptyRule() {
  return { host: '', proxyMode: 'inherit', proxy: '', insecure: false, caFiles: '' }
}
