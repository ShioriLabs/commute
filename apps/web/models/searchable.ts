export interface Searchable<BodyType = unknown> {
  type: 'STATION' | 'LINE' | 'HUB' | 'OPERATOR'
  title: string
  to: string
  keywords: string[]
  subtitle?: string
  body?: BodyType
  data?: Record<string, string>
  // Operator code, supplied by /_internal/searchables. Saves parsing it back
  // out of `to` for roundel styling and rank nudging. Absent on hubs, which
  // span operators.
  operator?: string
  // Popularity. Optional because the API omits it when 0; read as `?? 0`.
  score?: number
}
