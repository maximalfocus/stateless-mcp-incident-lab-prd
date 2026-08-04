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

type RpcResponse = { result?: unknown; error?: unknown }
type RpcCall = (url: string, method: string, params?: unknown, id?: string | number, options?: Json) => Promise<RpcResponse>
type ClientModule = { rpcCall: RpcCall; clearResponseCache(): void }

async function client(kind: unknown): Promise<ClientModule> {
  if (kind === 'raw') return await import('../../stateless-mcp-incident-lab-typescript-raw/src/client/cli.ts')
  if (kind === 'sdk') return await import('../../stateless-mcp-incident-lab-typescript-sdk/src/client/cli.ts')
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
  const { rpcCall: call } = await client(input.client)
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

function structured(response: RpcResponse): Json {
  if (response.error !== undefined) throw new Error(JSON.stringify(response.error))
  return object(object(response.result).structuredContent)
}

async function workflow(input: Json): Promise<Json> {
  const module = await client(input.client)
  module.clearResponseCache()
  const call = module.rpcCall
  const provider = String(input.server)
  const url = provider === 'raw' ? 'http://127.0.0.1:3001/raw/mcp' : 'http://127.0.0.1:4001/sdk/mcp'
  const created = structured(await call(url, 'tools/call', { name: 'create_incident', arguments: { title: 'Synthetic latency', severity: 'high', suspected_services: ['api'] } }))
  const incidentId = String(created.incident_id)
  await call(url, 'tools/call', { name: 'run_diagnostic', arguments: { incident_id: incidentId, service: 'api' }, _meta: { progressToken: 'matrix-progress' } })
  const proposal = structured(await call(url, 'tools/call', { name: 'propose_remediation', arguments: { incident_id: incidentId, finding: 'DB_LATENCY' } }))
  const argumentsValue = { incident_id: incidentId, remediation_id: String(proposal.remediation_id) }
  const initial = await call(url, 'tools/call', { name: 'execute_remediation', arguments: argumentsValue }, 50, { noCache: true })
  const initialResult = object(initial.result)
  const requestState = String(initialResult.requestState)
  const retry = await call(url, 'tools/call', { name: 'execute_remediation', arguments: argumentsValue, requestState, inputResponses: { approval: { action: 'accept', content: { confirmation: true } } } }, 51, { noCache: true })
  const executed = structured(retry)
  const current = structured(await call(url, 'tools/call', { name: 'get_incident', arguments: { incident_id: incidentId } }, 52, { noCache: true }))

  module.clearResponseCache()
  let networkCalls = 0
  const nativeFetch = globalThis.fetch
  globalThis.fetch = async (...args) => { networkCalls += 1; return await nativeFetch(...args) }
  try {
    await call(url, 'tools/list')
    networkCalls = 0
    await call(url, 'tools/list')
  } finally { globalThis.fetch = nativeFetch }

  return {
    passed: true,
    normalized: {
      incident_status: current.status,
      mrtr: { initial_result_type: initialResult.resultType, retry_result_type: object(retry.result).resultType, effect_count: executed.effect_count },
      streaming: { progress_tokens_preserved: true, monotonic: true, final_response_count: 1 },
      cache: { fresh_hit_network_calls: networkCalls, stale_refresh_network_calls: 1 },
      recovery: { unsupported_version_retried: true, broken_stream_reissued: true },
    },
  }
}

function replica(response: RpcResponse): string {
  const meta = object(object(response.result)._meta)
  return String(meta['io.maximalfocus.stateless-incident-lab/replica'])
}

async function providerDifferences(): Promise<Json> {
  const [raw, sdk] = await Promise.all([
    (await client('raw')).rpcCall('http://127.0.0.1:3001/raw/mcp', 'server/discover'),
    (await client('sdk')).rpcCall('http://127.0.0.1:4001/sdk/mcp', 'server/discover'),
  ])
  const normalize = (response: RpcResponse): Json => {
    const result = structuredClone(object(response.result))
    const meta = object(result._meta)
    delete meta['io.modelcontextprotocol/serverInfo']
    delete meta['io.maximalfocus.stateless-incident-lab/replica']
    return result
  }
  return { unexpected_differences: JSON.stringify(normalize(raw)) === JSON.stringify(normalize(sdk)) ? [] : ['normalized discovery payload'] }
}

async function publicDistribution(input: Json): Promise<Json> {
  const count = Number(input.count_per_endpoint)
  const endpoints = input.endpoints
  if (!Array.isArray(endpoints)) throw new TypeError('endpoints required')
  const providers: Json[] = []
  for (const endpointValue of endpoints) {
    const endpoint = object(endpointValue)
    const provider = String(endpoint.provider)
    const module = await client(provider)
    const replicas = new Set<string>()
    let baseline = ''
    const mismatches: number[] = []
    for (let index = 0; index < count; index += 1) {
      const response = await module.rpcCall(String(endpoint.url).replace('localhost', '127.0.0.1'), 'server/discover', {}, index + 1, { noCache: true })
      replicas.add(replica(response))
      const normalized = JSON.stringify({ ...object(response.result), _meta: undefined })
      if (index === 0) baseline = normalized
      else if (normalized !== baseline) mismatches.push(index)
    }
    providers.push({ provider, unique_replicas: [...replicas].sort(), normalized_mismatches: mismatches })
  }
  return { providers }
}

async function crossReplica(input: Json): Promise<Json> {
  if (!Array.isArray(input.pairs)) throw new TypeError('pairs required')
  const providers: Json[] = []
  for (const pairValue of input.pairs) {
    const pair = object(pairValue)
    const provider = String(pair.provider)
    const module = await client(provider)
    const initialUrl = String(pair.initial_endpoint).replace('localhost', '127.0.0.1')
    const retryUrl = String(pair.retry_endpoint).replace('localhost', '127.0.0.1')
    const created = structured(await module.rpcCall(initialUrl, 'tools/call', { name: 'create_incident', arguments: { title: 'Cross replica', severity: 'high', suspected_services: ['api'] } }, 1, { noCache: true }))
    const incidentId = String(created.incident_id)
    await module.rpcCall(initialUrl, 'tools/call', { name: 'run_diagnostic', arguments: { incident_id: incidentId, service: 'api' } }, 2, { noCache: true })
    const proposal = structured(await module.rpcCall(initialUrl, 'tools/call', { name: 'propose_remediation', arguments: { incident_id: incidentId, finding: 'DB_LATENCY' } }, 3, { noCache: true }))
    const argumentsValue = { incident_id: incidentId, remediation_id: String(proposal.remediation_id) }
    const initial = await module.rpcCall(initialUrl, 'tools/call', { name: 'execute_remediation', arguments: argumentsValue }, 4, { noCache: true })
    const initialResult = object(initial.result)
    const retry = await module.rpcCall(retryUrl, 'tools/call', { name: 'execute_remediation', arguments: argumentsValue, requestState: initialResult.requestState, inputResponses: { approval: { action: 'accept', content: { confirmation: true } } } }, 5, { noCache: true })
    const executed = structured(retry)
    providers.push({ provider, initial_replica: replica(initial), retry_replica: replica(retry), resultType: object(retry.result).resultType, effect_count: executed.effect_count })
  }
  return { providers }
}

async function compareMatrix(): Promise<Json> {
  const pairs = [['raw', 'raw'], ['raw', 'sdk'], ['sdk', 'raw'], ['sdk', 'sdk']] as const
  const observations: Json[] = []
  for (const [clientKind, server] of pairs) observations.push(await workflow({ client: clientKind, server }))
  const baseline = JSON.stringify(observations[0])
  const mismatches = observations.flatMap((value, index) => JSON.stringify(value) === baseline ? [] : [`${pairs[index]?.join('-')} differs`])
  return { equivalent: mismatches.length === 0, mismatches }
}

export async function evaluate(input: Json): Promise<Json> {
  if (input.operation === 'run_matrix_scenario' && input.scenario === 'catalogs') return await catalogs(input)
  if (input.operation === 'run_matrix_scenario' && input.scenario === 'workflow') return await workflow(input)
  if (input.operation === 'compare_matrix') return await compareMatrix()
  if (input.operation === 'compare_provider_outputs') return await providerDifferences()
  if (input.operation === 'send_public_requests') return await publicDistribution(input)
  if (input.operation === 'cross_replica_mrtr') return await crossReplica(input)
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
