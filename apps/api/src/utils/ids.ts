/*
 * Dictionary key for a line. Operator-qualified because line codes are only
 * unique per operator — KCI's "C" and a TJ corridor could collide, and a hub's
 * lines span operators by definition.
 */
export function lineKey(operator: string, lineCode: string): string {
  return `${operator}:${lineCode}`
}

/** The bare line code of an `operator:lineCode` key. */
export function lineCodeOf(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

/** The station code of an `OPERATOR-CODE` station id. */
export function stationCodeOf(operator: string, stationId: string): string {
  return stationId.slice(operator.length + 1)
}
