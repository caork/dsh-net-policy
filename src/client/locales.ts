/**
 * Locale dictionaries for the Network settings section. `zh` is the key
 * source; `en` carries the same keys.
 */

export type NetPolicyKey =
  | 'navLabel'
  | 'title'
  | 'description'
  | 'proxyLabel'
  | 'proxyPlaceholder'
  | 'proxyHint'
  | 'noProxyLabel'
  | 'noProxyPlaceholder'
  | 'noProxyHint'
  | 'caLabel'
  | 'caPlaceholder'
  | 'caPlaceholderWindows'
  | 'caHint'
  | 'insecureLabel'
  | 'insecureHint'
  | 'rulesTitle'
  | 'rulesHint'
  | 'ruleHostPlaceholder'
  | 'ruleProxyInherit'
  | 'ruleProxyDirect'
  | 'ruleProxyCustom'
  | 'ruleProxyPlaceholder'
  | 'ruleInsecure'
  | 'ruleRemove'
  | 'ruleAdd'
  | 'save'
  | 'saving'
  | 'loading'
  | 'appliedPrefix'
  | 'storedAt'
  | 'loadFailed'

export const zh: Record<NetPolicyKey, string> = {
  navLabel: '网络',
  title: '出站网络策略',
  description: '模型请求、联网搜索和 HTTP MCP 都走这里的设置。改动保存后立即生效，不必重启。',
  proxyLabel: '默认代理',
  proxyPlaceholder: 'http://127.0.0.1:7890',
  proxyHint: '留空表示直连。只支持 http/https 代理地址，不支持 SOCKS。',
  noProxyLabel: '不走代理的域名',
  noProxyPlaceholder: 'example.com, 192.168.31.179',
  noProxyHint: '逗号分隔。一条记录同时覆盖它的子域名。本机地址始终直连。',
  caLabel: '额外信任的 CA 证书',
  caPlaceholder: '/Users/you/certs/root-ca.pem',
  caPlaceholderWindows: 'C:\\Users\\you\\certs\\root-ca.cer',
  caHint: '每行一个 PEM 文件路径，追加到系统信任之上，不会替换原有信任。',
  insecureLabel: '对所有域名跳过证书校验',
  insecureHint: '危险：链路上的任何人都能读取和篡改流量。优先用下面的按域名规则。',
  rulesTitle: '按域名的规则',
  rulesHint: '自上而下取第一条匹配的规则，未填的项沿用上面的默认值。',
  ruleHostPlaceholder: 'llm.example.com',
  ruleProxyInherit: '跟随默认',
  ruleProxyDirect: '直连',
  ruleProxyCustom: '指定代理',
  ruleProxyPlaceholder: 'http://127.0.0.1:7890',
  ruleInsecure: '跳过证书校验',
  ruleRemove: '删除',
  ruleAdd: '添加规则',
  save: '保存并应用',
  saving: '保存中…',
  loading: '读取中…',
  appliedPrefix: '已应用：',
  storedAt: '配置文件：',
  loadFailed: '读取配置失败：',
}

export const en: Record<NetPolicyKey, string> = {
  navLabel: 'Network',
  title: 'Outbound network policy',
  description: 'Model requests, web search, and HTTP MCP all follow these settings. A save takes effect immediately, with no restart.',
  proxyLabel: 'Default proxy',
  proxyPlaceholder: 'http://127.0.0.1:7890',
  proxyHint: 'Empty means direct. http and https proxy URLs only; SOCKS is not supported.',
  noProxyLabel: 'Hosts that stay direct',
  noProxyPlaceholder: 'example.com, 192.168.31.179',
  noProxyHint: 'Comma separated. An entry also covers its subdomains. Loopback is always direct.',
  caLabel: 'Additional trusted CA certificates',
  caPlaceholder: '/Users/you/certs/root-ca.pem',
  caPlaceholderWindows: 'C:\\Users\\you\\certs\\root-ca.cer',
  caHint: 'One PEM path per line, added on top of what this machine already trusts.',
  insecureLabel: 'Skip certificate verification for every host',
  insecureHint: 'Dangerous: anything on the path can read and change the traffic. Prefer a per-host rule below.',
  rulesTitle: 'Per-host rules',
  rulesHint: 'The first matching rule wins; anything it leaves unset falls back to the defaults above.',
  ruleHostPlaceholder: 'llm.example.com',
  ruleProxyInherit: 'Use default',
  ruleProxyDirect: 'Direct',
  ruleProxyCustom: 'Custom proxy',
  ruleProxyPlaceholder: 'http://127.0.0.1:7890',
  ruleInsecure: 'Skip verification',
  ruleRemove: 'Remove',
  ruleAdd: 'Add rule',
  save: 'Save and apply',
  saving: 'Saving…',
  loading: 'Loading…',
  appliedPrefix: 'Applied: ',
  storedAt: 'Settings file: ',
  loadFailed: 'Could not read the settings file: ',
}
