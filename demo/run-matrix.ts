import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

type Json = Record<string, unknown>
const root = resolve(process.env.CONFORMANCE_PATH ?? '../stateless-mcp-incident-lab-conformance/conformance')
const selected = new Set(process.argv.slice(2).filter((arg) => /^[A-Z]+-\d+$/.test(arg)))

async function fixtures(category: string): Promise<{ id: string; input: Json; expected: Json }[]> {
  const base = resolve(root, category)
  const entries = await readdir(base, { withFileTypes: true })
  return await Promise.all(entries.filter((e) => e.isDirectory()).map(async (entry) => {
    const dir = resolve(base, entry.name)
    const test = JSON.parse(await readFile(resolve(dir, 'test.json'), 'utf8')) as Json
    return {
      id: String(test.spec_id),
      input: JSON.parse(await readFile(resolve(dir, 'input.json'), 'utf8')) as Json,
      expected: JSON.parse(await readFile(resolve(dir, 'expected.json'), 'utf8')) as Json,
    }
  }))
}

type RpcCall = (url: string, method: string, params?: unknown, id?: string | number, options?: Json) => Promise<{ result?: unknown; error?: unknown }>

async function client(kind: unknown): Promise<RpcCall> {
  if (kind === 'raw') return (await import('../../stateless-mcp-incident-lab-typescript-raw/src/client/cli.ts')).rpcCall
  if (kind === 'sdk') return (await import('../../stateless-mcp-incident-lab-typescript-sdk/src/client/cli.ts')).rpcCall
  throw new TypeError(`Unknown client ${String(kind)}`)
}

function object(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Expected object')
  return value as Json
}

function names(result: unknown, field: string, key: string): string[] {
  const values = object(result)[field]
  if (!Array.isArray(values)) throw new TypeError(`Missing ${field}`)
  return values.map((value) => String(object(value)[key]))
}

async function catalogs(input: Json): Promise<Json> {
  const call = await client(input.client)
  const provider = String(input.server)
  const url = provider === 'raw' ? 'http://127.0.0.1/raw/mcp' : 'http://127.0.0.1/sdk/mcp'
  const [discovery, tools, resources, prompts] = await Promise.all([
    call(url, 'server/discover'), call(url, 'tools/list'), call(url, 'resources/list'), call(url, 'prompts/list'),
  ])
  for (const response of [discovery, tools, resources, prompts]) if (response.error !== undefined) throw new Error(JSON.stringify(response.error))
  const discovered = object(discovery.result)
  return {
    passed: true,
    normalized: {
      supportedVersions: Array.isArray(discovered.supportedVersions) ? discovered.supportedVersions : [],
      tools: names(tools.result, 'tools', 'name'),
      resources: names(resources.result, 'resources', 'uri'),
      prompts: names(prompts.result, 'prompts', 'name'),
    },
  }
}

export async function evaluate(input: Json): Promise<Json> {
  if (input.operation === 'run_matrix_scenario' && input.scenario === 'catalogs') return await catalogs(input)
  throw new RangeError(`Unsupported integration operation: ${String(input.operation)}`)
}

async function main(): Promise<void> {
  const all = [...await fixtures('interoperability'), ...await fixtures('performance')]
  const tests = selected.size === 0 ? all : all.filter((test) => selected.has(test.id))
  let failed = 0
  for (const test of tests) {
    try {
      const actual = await evaluate(test.input)
      if (JSON.stringify(actual) !== JSON.stringify(test.expected)) throw new Error(`expected ${JSON.stringify(test.expected)} got ${JSON.stringify(actual)}`)
      console.log(`PASS ${test.id}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${test.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(`SUMMARY ${tests.length - failed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) await main()
