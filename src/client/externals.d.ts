/**
 * Browser platform words the shell resolves from its own frozen module table.
 * They are externals at build time and are not installed here, so this file
 * declares the surface this plugin actually uses.
 */

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode } from 'react'

  export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'ghost' | 'outline' | 'primary' | 'toolbar'
    size?: 'sm' | 'md'
    icon?: ReactNode
  }): ReactElement

  export function Input(props: InputHTMLAttributes<HTMLInputElement> & {
    icon?: ReactNode
  }): ReactElement
}
