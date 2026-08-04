async function rpc(url, method, params, id) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': method,
      ...(method === 'tools/call' && typeof params?.name === 'string' ? { 'Mcp-Name': params.name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id, method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'incident-lab-performance', version: '0.1.0' },
          'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
        },
      },
    }),
  })
  const payload = await response.json()
  if (!response.ok || payload.error) throw new Error(JSON.stringify(payload.error ?? payload))
  return payload.result
}

function structured(result) {
  if (!result || typeof result !== 'object' || !result.structuredContent) throw new Error('structuredContent missing')
  return result.structuredContent
}

export async function concurrentAcceptedRetries({ url, concurrentRetries }) {
  const created = structured(await rpc(url, 'tools/call', {
    name: 'create_incident',
    arguments: { title: 'Concurrent retry benchmark', severity: 'high', suspected_services: ['api'] },
  }, 1))
  const incidentId = created.incident_id
  await rpc(url, 'tools/call', { name: 'run_diagnostic', arguments: { incident_id: incidentId, service: 'api' } }, 2)
  const proposal = structured(await rpc(url, 'tools/call', {
    name: 'propose_remediation', arguments: { incident_id: incidentId, finding: 'DB_LATENCY' },
  }, 3))
  const args = { incident_id: incidentId, remediation_id: proposal.remediation_id }
  const initial = await rpc(url, 'tools/call', { name: 'execute_remediation', arguments: args }, 4)
  if (initial.resultType !== 'input_required' || typeof initial.requestState !== 'string') {
    throw new Error('initial remediation did not request input')
  }
  const retries = await Promise.all(Array.from({ length: concurrentRetries }, (_, index) => rpc(url, 'tools/call', {
    name: 'execute_remediation',
    arguments: args,
    requestState: initial.requestState,
    inputResponses: { approval: { action: 'accept', content: { confirmation: true } } },
  }, index + 10)))
  const counts = retries.map((result) => Number(structured(result).effect_count))
  const effectCount = counts.reduce((sum, count) => sum + count, 0)
  if (effectCount !== 1) throw new Error(`non-idempotent effect counts: ${counts.join(',')}`)
  return { effect_count: effectCount }
}
