export interface Searchable<BodyType = unknown> {
  type: 'STATION' | 'LINE' | 'HUB' | 'OPERATOR'
  title: string
  to: string
  keywords: string[]
  subtitle?: string
  body?: BodyType
  data?: Record<string, string>
}
