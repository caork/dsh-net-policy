/**
 * dsh-net-policy browser half: one Settings section ("Network") over the same
 * document the host half applies. Every value is read and written through this
 * plugin's own routes, so the browser never holds policy state of its own.
 */

import { createElement as h } from 'react'
import { NetPolicySection } from './NetPolicySection.tsx'
import { en, zh } from './locales.ts'

/** Dictionary and section namespace owned by this plugin. */
const NS = 'net-policy'

/** Required client services: the slot ledger and the copy service. */
export const inject = ['slots', 'locale']

export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-net-policy: dictionaries')
  const t = ctx.locale.bind(NS)
  // The section's copy comes in as a prop rather than through the slot's
  // injected share: the component then depends on nothing but react.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'net-policy',
    order: 45,
    label: () => t('navLabel'),
    locale: NS,
    inject: () => ({ t }),
  }, () => h(NetPolicySection, { t })))
}
