import { performance } from 'node:perf_hooks'

function rpcBody(id = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} })
}

async function request(url, id) {
  const started = performance.now()
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: rpcBody(id),
  })
  const text = await response.text()
  let failed = !response.ok
  try {
    const payload = JSON.parse(text)
    failed ||= payload.error !== undefined
  } catch {
    failed = true
  }
  return { latency: performance.now() - started, failed }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? Number.POSITIVE_INFINITY
}

export async function measureCatalog({ url, warmupRequests, ratePerSecond, durationSeconds }) {
  for (let index = 0; index < warmupRequests; index += 1) await request(url, -(index + 1))

  const total = ratePerSecond * durationSeconds
  const interval = 1000 / ratePerSecond
  const started = performance.now()
  const samples = []
  for (let index = 0; index < total; index += 1) {
    const due = started + index * interval
    const delay = due - performance.now()
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    samples.push(request(url, index + 1))
  }
  const observations = await Promise.all(samples)
  const failures = observations.filter(({ failed }) => failed).length
  return {
    p95_ms: percentile(observations.map(({ latency }) => latency), 0.95),
    error_rate: failures / observations.length,
    requests: observations.length,
  }
}

export function configuredTargets(environments) {
  return environments.map((environment) => {
    const key = `PERF_${String(environment).toUpperCase()}_URL`
    const url = process.env[key]
    if (!url) throw new Error(`${key} is required; do not substitute a local endpoint for real ${environment} evidence`)
    return { environment, url }
  })
}
