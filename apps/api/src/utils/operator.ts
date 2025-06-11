import { OPERATORS } from '@commute/constants'

export function getOperatorByCode(code: string) {
  const operators = Object.entries(OPERATORS)

  const operator = operators.find(([op]) => op === code)
  if (!operator) return null
  return operator[1]
}
