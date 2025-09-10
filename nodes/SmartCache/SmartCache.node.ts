/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2025, Victor Duarte
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { strict as assert } from 'node:assert'
import {
  IContextObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionType,
} from 'n8n-workflow'

const getItemIndex = (pairedItem: INodeExecutionData['pairedItem']): number => {
  if (Array.isArray(pairedItem)) {
    return pairedItem[0]?.item ?? 0
  }

  if (typeof pairedItem === 'object') {
    return pairedItem?.item ?? 0
  }

  assert(pairedItem, 'PairedItem index cannot be undefined')
  return pairedItem
}

const getCachePathFromItem = (item: INodeExecutionData, context: IContextObject) => {
  const ctx = context[getItemIndex(item.pairedItem)]
  assert(ctx, 'Context not found in input data')
  const cachePath = ctx.cachePath
  assert(cachePath, 'Cache path not found in input data')
  return cachePath
}

const processItemData = (item: INodeExecutionData, cacheKeyFields: string) =>
  cacheKeyFields
    ? cacheKeyFields.split(',').reduce(
        (acc, field) => {
          acc[field.trim()] = item.json[field.trim()]
          return acc
        },
        {} as Record<string, unknown>,
      )
    : item.json

const generateCacheMetadata = (
  items: INodeExecutionData | INodeExecutionData[],
  cacheKeyFields: string,
  cacheDir: string,
  nodeId: string,
) => {
  const dataToHash = Array.isArray(items)
    ? items.map((item) => processItemData(item, cacheKeyFields))
    : processItemData(items, cacheKeyFields)

  // Sort keys to ensure consistent hash generation
  const sortedData = Array.isArray(dataToHash)
    ? dataToHash.map((item) =>
        Object.keys(item)
          .sort()
          .reduce(
            (acc, key) => {
              acc[key] = item[key]
              return acc
            },
            {} as Record<string, unknown>,
          ),
      )
    : Object.keys(dataToHash)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = dataToHash[key]
            return acc
          },
          {} as Record<string, unknown>,
        )

  // Include nodeId in hash generation to separate caches for different node instances
  const hash = createHash('sha256')
    .update(JSON.stringify({ nodeId, data: sortedData }))
    .digest('hex')
  const cachePath = path.join(cacheDir, `${hash}.cache`)

  return {
    cacheKey: hash,
    cachePath,
  }
}

const writeToCacheFile = async (
  items: INodeExecutionData | INodeExecutionData[],
  context: IContextObject,
  batchMode = false,
) => {
  // If array, any item serves as they all share the same $smartcache object
  const firstItem = Array.isArray(items) ? items[0] : items
  assert(firstItem, 'Items cannot be empty')
  const cachePath = getCachePathFromItem(firstItem, context)
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify(items))
  console.log(`Wrote ${batchMode ? 'batch' : 'item'} to cache file: ${cachePath}`)
}

const handleCacheHit = async (cachePath: string, ttl: number) => {
  const stats = await fs.stat(cachePath)
  const cacheAge = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60)

  if (ttl > 0 && cacheAge >= ttl) {
    return { status: 'expired', cacheAge }
  }

  const cachedContent = JSON.parse(await fs.readFile(cachePath, 'utf-8'))
  return { status: 'hit', content: cachedContent }
}

const processBatch = async (
  items: INodeExecutionData[],
  context: IContextObject,
  cacheKeyFields: string,
  cacheDir: string,
  force: boolean,
  ttl: number,
  logger: IExecuteFunctions['logger'],
  nodeId: string,
) => {
  const $smartCache = generateCacheMetadata(items, cacheKeyFields, cacheDir, nodeId)

  // Store cache metadata for each item
  items.forEach((item) => {
    const itemIndex = getItemIndex(item.pairedItem)
    context[itemIndex] = $smartCache
  })

  logger.debug('[SmartCache] Generated batch cache metadata:', {
    cacheKey: $smartCache.cacheKey,
    cachePath: $smartCache.cachePath,
    hashedData: cacheKeyFields ? 'Selected JSON fields' : 'Full JSON',
    itemCount: items.length,
  })

  if (force) {
    return { hits: [], misses: items }
  }

  try {
    const result = await handleCacheHit($smartCache.cachePath, ttl)
    if (result.status === 'hit') {
      return { hits: Array.isArray(result.content) ? result.content : [result.content], misses: [] }
    }
    return { hits: [], misses: items }
  } catch (error) {
    logger.debug('[SmartCache] Batch cache miss:', {
      cacheKey: $smartCache.cacheKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return { hits: [], misses: items }
  }
}

const processSingleItem = async (
  item: INodeExecutionData,
  context: IContextObject,
  cacheKeyFields: string,
  cacheDir: string,
  force: boolean,
  ttl: number,
  logger: IExecuteFunctions['logger'],
  nodeId: string,
) => {
  const $smartCache = generateCacheMetadata(item, cacheKeyFields, cacheDir, nodeId)
  const itemIndex = getItemIndex(item.pairedItem)
  context[itemIndex] = $smartCache

  logger.debug('[SmartCache] Generated cache metadata:', {
    cacheKey: $smartCache.cacheKey,
    cachePath: $smartCache.cachePath,
    hashedData: cacheKeyFields ? 'Selected JSON fields' : 'Full JSON',
    itemJson: item.json,
  })

  if (force) {
    return { hit: null, miss: item }
  }

  try {
    const result = await handleCacheHit($smartCache.cachePath, ttl)
    if (result.status === 'hit') {
      return { hit: result.content, miss: null }
    }
    return { hit: null, miss: item }
  } catch (error) {
    logger.debug('[SmartCache] Cache miss:', {
      cacheKey: $smartCache.cacheKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return { hit: null, miss: item }
  }
}

export class SmartCache implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Smart Cache',
    name: 'smartCache',
    icon: 'file:smartCache.svg',
    group: ['transform'],
    version: 1,
    description: 'Intelligent caching node with automatic hash generation and TTL support',
    subtitle:
      '={{ ($parameter["batchMode"] ? "Batch" : "Individual") + ($parameter["force"] ? " • ⚠️ Force Miss" : "") }}',
    documentationUrl: 'https://github.com/skadaai/n8n-nodes-smartcache/tree/local#readme',
    defaults: {
      name: 'Smart Cache',
    },
    inputs: [
      {
        displayName: 'Input',
        type: NodeConnectionType.Main,
        required: true,
      },
      {
        displayName: 'Write',
        type: NodeConnectionType.Main,
        required: true,
      },
    ],
    outputs: [
      {
        displayName: 'Cache Hit',
        type: NodeConnectionType.Main,
      },
      {
        displayName: 'Cache Miss',
        type: NodeConnectionType.Main,
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Batch Mode',
        name: 'batchMode',
        type: 'boolean',
        default: false,
        description:
          'Whether to process all input items as a single unit for caching, similar to "Run Once for All Items"',
      },
      {
        displayName: 'Force Miss',
        name: 'force',
        type: 'boolean',
        default: false,
        description:
          'Whether to force cache miss and regeneration of data, ignoring any existing cache',
      },
      {
        displayName: 'Cache Key Fields',
        name: 'cacheKeyFields',
        type: 'string',
        default: '',
        placeholder: 'id,name,url',
        description:
          'Comma-separated list of fields to use for cache key generation. Leave empty to use entire input for more precise caching.',
      },
      {
        displayName: 'TTL (Hours)',
        name: 'ttl',
        type: 'number',
        default: 24,
        description: 'Time-to-live for cache entries in hours. Use 0 for infinite.',
      },
      {
        displayName: 'Cache Directory',
        name: 'cacheDir',
        type: 'string',
        default: '/tmp/n8n-smartcache',
        description:
          'Directory where cache files will be stored. Must be writable by the n8n process.',
        noDataExpression: true,
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const force = this.getNodeParameter('force', 0) as boolean
    const ttl = this.getNodeParameter('ttl', 0) as number
    const cacheDir = this.getNodeParameter('cacheDir', 0) as string
    const cacheKeyFields = (this.getNodeParameter('cacheKeyFields', 0) as string).trim()
    const batchMode = this.getNodeParameter('batchMode', 0) as boolean
    const context = this.getContext('node')

    const mainInput = this.getInputData(0) // Input 1
    const cacheInput = this.getInputData(1) // Input 2 (write)

    this.logger.debug('[SmartCache] SmartCache initialized with parameters:', {
      force,
      ttl,
      cacheDir,
      cacheKeyFields,
    })

    // Early return if both inputs are empty
    if (mainInput.length === 0 && cacheInput.length === 0) {
      this.logger.debug('[SmartCache] Both inputs empty, returning early')
      return [[], []]
    }

    // Process main input
    if (mainInput.length > 0) {
      const nodeId = this.getNode().id
      const { hits, misses } = batchMode
        ? await processBatch(
            mainInput,
            context,
            cacheKeyFields,
            cacheDir,
            force,
            ttl,
            this.logger,
            nodeId,
          )
        : await Promise.all(
            mainInput.map((item) =>
              processSingleItem(
                item,
                context,
                cacheKeyFields,
                cacheDir,
                force,
                ttl,
                this.logger,
                nodeId,
              ),
            ),
          ).then((results) => ({
            hits: results.filter((r) => r.hit).map((r) => r.hit!),
            misses: results.filter((r) => r.miss).map((r) => r.miss!),
          }))

      this.logger.debug('[SmartCache] Finished processing main input:', {
        totalItems: mainInput.length,
        cacheHits: hits.length,
        cacheMisses: misses.length,
      })

      return [hits, misses]
    }

    // Process cache writes
    if (cacheInput.length > 0) {
      if (batchMode) {
        const firstItem = cacheInput[0]
        assert(firstItem, 'Cache input cannot be empty')
        assert(
          getItemIndex(firstItem.pairedItem) !== undefined,
          'Write input items must come from cache miss output',
        )
        await writeToCacheFile(cacheInput, context, true)
        return [cacheInput, []]
      }

      const results: INodeExecutionData[] = []
      for (const item of cacheInput) {
        assert(
          getItemIndex(item.pairedItem) !== undefined,
          'Write input items must come from cache miss output',
        )
        await writeToCacheFile(item, context)
        results.push(item)
      }

      this.logger.debug('[SmartCache] Finished processing cache writes')
      return [results, []]
    }

    return [[], []]
  }
}
