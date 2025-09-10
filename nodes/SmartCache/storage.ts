import type { IExecuteFunctions } from 'n8n-workflow'
import { createHmac, createHash } from 'node:crypto'

export interface CacheBackend {
  head(key: string): Promise<{ lastModified: Date } | null>
  get<T = unknown>(key: string): Promise<T | null>
  put<T = unknown>(key: string, value: T): Promise<void>
}

export class MemoryBackend implements CacheBackend {
  private store: Map<string, { value: unknown; updatedAt: number }>

  constructor(store?: Map<string, { value: unknown; updatedAt: number }>) {
    this.store = store ?? new Map()
  }

  async head(key: string) {
    const entry = this.store.get(key)
    if (!entry) return null
    return { lastModified: new Date(entry.updatedAt) }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    return entry.value as T
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, { value, updatedAt: Date.now() })
  }
}

export type S3Credentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  bucket: string
  endpoint?: string
  forcePathStyle?: boolean
  ignoreSSL?: boolean
}

export class S3Backend implements CacheBackend {
  private bucket: string
  private logger: IExecuteFunctions['logger']
  private endpoint?: string
  private region?: string
  private forcePathStyle?: boolean
  private ignoreSSL?: boolean
  private ctx: IExecuteFunctions
  private accessKeyId: string
  private secretAccessKey: string
  private sessionToken?: string

  constructor(creds: S3Credentials, logger: IExecuteFunctions['logger'], ctx: IExecuteFunctions) {
    this.bucket = creds.bucket
    this.logger = logger
    this.endpoint = creds.endpoint
    this.region = creds.region
    // Prefer provided flag; otherwise default to path-style for custom endpoints (non-AWS)
    if (typeof creds.forcePathStyle === 'boolean') {
      this.forcePathStyle = creds.forcePathStyle
    } else if (this.endpoint) {
      try {
        const h = new URL(this.endpoint).hostname
        this.forcePathStyle = !/amazonaws\.com$/i.test(h)
      } catch {
        this.forcePathStyle = true
      }
    } else {
      this.forcePathStyle = false
    }
    this.ignoreSSL = (creds as { ignoreSSL?: boolean }).ignoreSSL
    this.ctx = ctx
    this.accessKeyId = creds.accessKeyId
    this.secretAccessKey = creds.secretAccessKey
    this.sessionToken = creds.sessionToken
  }

  async ensureBucketAccessible(): Promise<void> {
    const url = this.buildUrl('')
    try {
      const { headers } = this.signV4('HEAD', url, {}, undefined)
      await this.httpRequest({
        method: 'HEAD',
        url,
        headers,
        returnFullResponse: true,
        rejectUnauthorized: this.ignoreSSL ? false : true,
      })
    } catch (e) {
      const msg = String(e)
      if (msg.includes('status code 404')) {
        throw new Error(
          `S3 bucket "${this.bucket}" was not found at endpoint. Check bucket name, region, and Force Path Style.`,
        )
      }
      // For 403 or others, let operations continue; permissions may still allow object-level actions.
    }
  }

  private buildBaseUrl(): string {
    if (this.endpoint && this.endpoint.trim().length > 0) {
      return this.endpoint.replace(/\/$/, '')
    }
    const region = this.region || 'us-east-1'
    return `https://s3.${region}.amazonaws.com`
  }

  private buildUrl(key: string): string {
    const safeKey = key.replace(/^\/+/, '')
    const base = this.buildBaseUrl()
    if (this.forcePathStyle) {
      return `${base}/${this.bucket}/${safeKey}`
    }
    const u = new URL(base)
    u.hostname = `${this.bucket}.${u.hostname}`
    u.pathname = `/${safeKey}`
    return u.toString()
  }

  private async httpRequest(options: Record<string, unknown>) {
    const fn = (this.ctx.helpers.httpRequest as unknown) as (
      this: IExecuteFunctions,
      opts: Record<string, unknown>,
    ) => Promise<unknown>
    return fn.call(this.ctx, options)
  }

  private signV4(method: string, urlStr: string, headers: Record<string, string>, body?: string) {
    const url = new URL(urlStr)
    const host = url.host
    const now = new Date()
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const dateStamp = amzDate.slice(0, 8)

    const region = this.region || 'us-east-1'
    const service = 's3'

    const payloadHash = createHash('sha256').update(body ?? '').digest('hex')

    const canonicalHeaders: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    }
    // Access keys are provided by constructor via node parameters
    const accessKeyId = this.accessKeyId
    const secretAccessKey = this.secretAccessKey
    const sessionToken = this.sessionToken

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Missing S3 credentials for signing')
    }

    // Merge in provided headers (lowercase)
    for (const [k, v] of Object.entries(headers)) {
      canonicalHeaders[k.toLowerCase()] = v
    }
    if (sessionToken) {
      canonicalHeaders['x-amz-security-token'] = sessionToken as string
    }

    const signedHeaders = Object.keys(canonicalHeaders)
      .map((k) => k.toLowerCase())
      .sort()
      .join(';')

    const canonicalHeadersString = Object.keys(canonicalHeaders)
      .map((k) => k.toLowerCase())
      .sort()
      .map((k) => `${k}:${canonicalHeaders[k].trim()}\n`)
      .join('')

    const canonicalQuery = url.searchParams.toString()
    const canonicalUri = url.pathname || '/'

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeadersString,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const algorithm = 'AWS4-HMAC-SHA256'
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n')

    const getSignatureKey = (key: string, date: string, reg: string, svc: string) => {
      const kDate = createHmac('sha256', 'AWS4' + key).update(date).digest()
      const kRegion = createHmac('sha256', kDate).update(reg).digest()
      const kService = createHmac('sha256', kRegion).update(svc).digest()
      const kSigning = createHmac('sha256', kService).update('aws4_request').digest()
      return kSigning
    }

    const signingKey = getSignatureKey(String(secretAccessKey), dateStamp, region, service)
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    const authorizationHeader =
      `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const finalHeaders = {
      ...Object.fromEntries(Object.entries(canonicalHeaders).map(([k, v]) => [k, v])),
      Authorization: authorizationHeader,
    }
    return { headers: finalHeaders }
  }

  async head(key: string) {
    const url = this.buildUrl(key)
    try {
      const { headers } = this.signV4('HEAD', url, {}, undefined)
      const res = (await this.httpRequest({
        method: 'HEAD',
        url,
        headers,
        returnFullResponse: true,
        rejectUnauthorized: this.ignoreSSL ? false : true,
      })) as unknown as { headers?: Record<string, string> }
      const last = res.headers?.['last-modified'] || res.headers?.['Last-Modified']
      if (!last) return { lastModified: new Date() }
      return { lastModified: new Date(last) }
    } catch (e) {
      this.logger.debug('[SmartCache] S3 head error', { key, url, message: String(e) })
      return null
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const url = this.buildUrl(key)
    try {
      const { headers } = this.signV4('GET', url, {}, undefined)
      const res = (await this.httpRequest({
        method: 'GET',
        url,
        headers,
        rejectUnauthorized: this.ignoreSSL ? false : true,
      })) as unknown
      if (typeof res === 'string') {
        return JSON.parse(res) as T
      }
      return res as T
    } catch (e) {
      this.logger.debug('[SmartCache] S3 get error', { key, url, message: String(e) })
      return null
    }
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const url = this.buildUrl(key)
    const body = JSON.stringify(value)
    const { headers } = this.signV4('PUT', url, { 'content-type': 'application/json' }, body)
    // Some providers require Content-Length header
    ;(headers as Record<string, string>)['content-length'] = Buffer.byteLength(body).toString()
    try {
      await this.httpRequest({
        method: 'PUT',
        url,
        headers,
        body,
        rejectUnauthorized: this.ignoreSSL ? false : true,
      })
    } catch (e) {
      const message = `S3 PUT failed. URL: ${url}. Hint: Ensure the bucket exists and Force Path Style matches your provider.`
      this.logger.debug('[SmartCache] S3 put error', { url, error: String(e) })
      throw new Error(message)
    }
  }
}

export const joinPrefix = (prefix: string, key: string) => {
  const cleanPrefix = (prefix || '').replace(/^\/+|\/+$/g, '')
  return cleanPrefix ? `${cleanPrefix}/${key}` : key
}
