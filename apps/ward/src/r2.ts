import crypto from 'node:crypto'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { R2Config } from './config.ts'

/*
 * The slice of R2 ward needs, over its S3-compatible API.
 *
 * Credentials are an R2 API token scoped to Object Read & Write on the ward
 * bucket only: a compromised VPS can touch this bucket and nothing else in the
 * Cloudflare account.
 */

export interface ArchiveMeta {
  sha256: string
  /** Hourly files that went into the archive. */
  hours: number
  snapshots: number
}

export interface RemoteObject {
  key: string
  size: number
  meta: Partial<ArchiveMeta>
}

/** What checkpoint.ts and pull.ts need; faked in tests. */
export interface ArchiveStore {
  put(key: string, filePath: string, meta: ArchiveMeta): Promise<void>
  head(key: string): Promise<RemoteObject | undefined>
  list(prefix: string): Promise<RemoteObject[]>
  download(key: string, filePath: string): Promise<void>
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(filePath), hash)
  return hash.digest('hex')
}

function parseMeta(metadata: Record<string, string> | undefined): Partial<ArchiveMeta> {
  if (!metadata) return {}
  return {
    sha256: metadata.sha256,
    hours: metadata.hours === undefined ? undefined : Number(metadata.hours),
    snapshots: metadata.snapshots === undefined ? undefined : Number(metadata.snapshots)
  }
}

export function createR2Store(config: R2Config): ArchiveStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  })
  const Bucket = config.bucket

  return {
    async put(key, filePath, meta) {
      // A day is ~35MB: a single PutObject, no multipart.
      await client.send(new PutObjectCommand({
        Bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: fs.statSync(filePath).size,
        ContentType: 'application/zstd',
        Metadata: { sha256: meta.sha256, hours: String(meta.hours), snapshots: String(meta.snapshots) }
      }))
    },

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }))
        return { key, size: res.ContentLength ?? 0, meta: parseMeta(res.Metadata) }
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFound') return undefined
        throw err
      }
    },

    async list(prefix) {
      const out: RemoteObject[] = []
      let ContinuationToken: string | undefined
      do {
        const res = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken }))
        for (const object of res.Contents ?? []) {
          if (object.Key) out.push({ key: object.Key, size: object.Size ?? 0, meta: {} })
        }
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
      } while (ContinuationToken)
      return out
    },

    async download(key, filePath) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }))
      if (!res.Body) throw new Error(`empty body for ${key}`)
      await pipeline(res.Body as Readable, fs.createWriteStream(filePath))
    }
  }
}
