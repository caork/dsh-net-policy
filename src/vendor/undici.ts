/**
 * The undici surface this plugin uses, bundled into the package.
 *
 * The plugin must install itself on a machine whose network is the very thing
 * being fixed, so it carries no runtime dependency to fetch: `dsh plugin add`
 * on an unreachable registry would otherwise hang before the proxy that would
 * have made the registry reachable exists.
 */

export { Agent, Pool, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
