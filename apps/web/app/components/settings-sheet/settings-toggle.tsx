import { Description, Field, Label, Switch } from '@headlessui/react'
import clsx from 'clsx'

interface Props {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/*
 * A settings row with an on/off switch. Wraps Headless UI's Switch rather than
 * hand-rolling one so role="switch", aria-checked and keyboard handling come
 * for free; Field/Label/Description wire up the labelling.
 */
export default function SettingsToggle({ title, description, checked, onChange }: Props) {
  return (
    <li>
      <Field className="px-8 py-6 flex items-center gap-4 justify-between">
        <div>
          <Label className="font-semibold text-lg block cursor-pointer">{ title }</Label>
          <Description className="font-semibold text-sm text-slate-700">{ description }</Description>
        </div>
        <Switch
          checked={checked}
          onChange={onChange}
          className={clsx(
            'relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F55875] focus-visible:ring-offset-2',
            checked ? 'bg-[#F55875]' : 'bg-slate-300'
          )}
        >
          <span
            aria-hidden="true"
            className={clsx(
              'pointer-events-none inline-block h-5 w-5 translate-y-1 rounded-full bg-white shadow transition-transform',
              checked ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </Switch>
      </Field>
    </li>
  )
}
