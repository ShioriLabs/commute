import { Operator, OPERATORS } from '@commute/constants'

export function getOperatorByCode(code: string): typeof OPERATORS[Operator] | null {
  // Own-property check so inherited members (toString, constructor, __proto__)
  // don't resolve to prototype functions instead of null.
  if (!Object.hasOwn(OPERATORS, code)) return null
  return OPERATORS[code as Operator] ?? null
}
