export class KVRepository {
  private kv?: KVNamespace

  constructor(kv?: KVNamespace) {
    this.kv = kv
  }

  async get<T = unknown>(id: string): Promise<T | null> {
    if (!this.kv) {
      return null
    }

    const value = await this.kv.get(id)
    if (value === null) {
      return null
    }

    try {
      return JSON.parse(value) as T
    } catch (error) {
      return null
    }
  }

  async set<T>(id: string, data: T, ttl = 60 * 60 * 20): Promise<T> {
    if (!this.kv) {
      return data
    }

    await this.kv.put(
      id,
      JSON.stringify(data),
      {
        expirationTtl: ttl
      }
    )

    return data
  }

  async del(id: string): Promise<void> {
    if (!this.kv) {
      return
    }

    await this.kv.delete(id)
  }
}
