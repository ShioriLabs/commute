import clsx from 'clsx'

export const muted = 'text-neutral-500 dark:text-neutral-400'
export const cell = 'border-b border-neutral-200 p-2 text-left align-top dark:border-neutral-800'
export const field = 'w-full rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900'
export const stack = 'grid max-w-md gap-3'
export const errorBox = 'rounded-md bg-red-700 px-3 py-2 text-white'

export const button = (variant: 'primary' | 'secondary' = 'primary') => clsx(
  'cursor-pointer rounded-md px-3 py-2 font-medium',
  variant === 'primary' && 'bg-pink-700 text-white hover:bg-pink-800',
  variant === 'secondary' && 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
)

export const badge = (tone: 'neutral' | 'warn' = 'neutral') => clsx(
  'rounded border px-1.5 text-xs',
  tone === 'neutral' && 'border-neutral-400 text-neutral-600 dark:text-neutral-300',
  tone === 'warn' && 'border-amber-600 text-amber-700 dark:text-amber-400'
)
