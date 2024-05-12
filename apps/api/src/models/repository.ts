// @ts-nocheck

export abstract class Repository {
  getAll(page: number, limit: number): Promise<unknown> { throw new Error("Not implemented") }
  getById(id: unknown): Promise<unknown> { throw new Error("Not implemented") }
  insert(data: unknown): Promise<unknown> { throw new Error("Not implemented") }
  update(data: unknown): Promise<unknown> { throw new Error("Not implemented") }
  del(id: unknown): Promise<unknown> { throw new Error("Not implemented") }
}
