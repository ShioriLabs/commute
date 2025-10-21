import { Operator, OPERATORS } from '@commute/constants'

export function getOperatorByCode(code: string): typeof OPERATORS[Operator] | null {
  return OPERATORS[code as Operator] ?? null
}
