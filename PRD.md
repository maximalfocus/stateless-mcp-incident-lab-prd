# PRD: Stateless MCP Incident Lab

## Overview

Stateless MCP Incident Lab is a hands-on TypeScript project for learning the Model Context Protocol revision `2026-07-28` by implementing the same simulated incident-response system twice: once directly over HTTP and JSON-RPC, and once with the official MCP SDK. Matching raw and SDK clients and servers must interoperate in all four combinations. The project proves the defining property of the revision—each request is self-contained and may reach any server replica—locally through Docker Compose and in AWS through an Application Load Balancer and horizontally scaled ECS Fargate services.

The lab is intentionally a simulator. It exposes fictional services, telemetry, runbooks, incidents, and remediation effects; it never reads or changes real infrastructure. The project is motivated by Simon Willison's observation that building a probing CLI is a productive way to learn a protocol and that constrained MCP capabilities are easier to audit than arbitrary shell and network access. The normative source is the MCP `2026-07-28` specification and TypeScript schema captured under [`sources/`](sources/README.md).

## Goals

1. Learn the stateless core at the wire level rather than only through SDK abstractions.
2. Compare raw and SDK implementations against one language-neutral contract.
3. Demonstrate that protocol statelessness does not prohibit explicit application state in DynamoDB.
4. Exercise discovery, tools, resources, prompts, caching hints, per-request capabilities, MRTR elicitation, request-scoped progress, cancellation, and protocol errors.
5. Prove interoperability and non-affinity across local and AWS deployments.
6. Produce a reusable CLI for inspecting and invoking `2026-07-28` MCP endpoints.

## User model

### Learner/operator

The sole user is a developer learning MCP. They can:

- start a deterministic local incident simulation;
- run either the raw or SDK CLI against either server;
- discover server versions and capabilities;
- list and inspect tools, resources, and prompts;
- open an incident and investigate fictional telemetry;
- run a streamed diagnostic and observe progress;
- approve, decline, or cancel a simulated disruptive remediation;
- inspect wire-level requests, response headers, cache decisions, replica IDs, and traces;
- deploy both server implementations to an ephemeral AWS environment, run the same acceptance matrix, and tear it down.

There is no administrator role, user account, or tenant boundary in the initial project.

## Domain and data model

### Entities

| Entity | Key fields | Purpose |
|---|---|---|
| `Service` | `service_id`, name, dependencies, region, health | Fictional production topology; seeded and stable |
| `TelemetryEvent` | `service_id`, timestamp, signal, severity, message, attributes | Deterministic logs and metrics used for diagnosis |
| `Runbook` | `service_id`, revision, markdown, updated_at | Context exposed as MCP resources |
| `Incident` | `incident_id`, title, severity, status, suspected_services, created_at, expires_at | Explicit application state carried between calls by opaque handle |
| `DiagnosticRun` | `diagnostic_id`, `incident_id`, status, findings | Records completed simulated diagnostics |
| `Remediation` | `remediation_id`, `incident_id`, action, target, status, effect, executed_at | Records a simulated action and enforces at-most-once execution |

DynamoDB uses a single-table design with `PK` and `SK`, conditional writes for lifecycle transitions and idempotency, and TTL for learner-created incidents. Static scenario data is seeded deterministically.

### Incident lifecycle

```mermaid
stateDiagram-v2
    [*] --> OPEN: create_incident
    OPEN --> INVESTIGATING: run_diagnostic
    INVESTIGATING --> MITIGATED: execute_remediation + accepted MRTR
    OPEN --> RESOLVED: resolve_incident
    INVESTIGATING --> RESOLVED: resolve_incident
    MITIGATED --> RESOLVED: resolve_incident
    RESOLVED --> [*]
```

Invalid transitions return actionable tool execution errors rather than protocol errors. Unknown or expired handles return a recoverable error telling the caller to create another incident.

## Product topology

```mermaid
flowchart LR
    RCLI[Raw CLI] --> LB[Nginx locally / ALB in AWS]
    SCLI[SDK CLI] --> LB
    LB --> R1[Raw server replica 1]
    LB --> R2[Raw server replica 2]
    LB --> S1[SDK server replica 1]
    LB --> S2[SDK server replica 2]
    R1 & R2 & S1 & S2 --> DDB[(DynamoDB Local / DynamoDB)]
    R1 & R2 & S1 & S2 --> OBS[JSON logs / traces]
```

The endpoint paths distinguish implementations (`/raw/mcp` and `/sdk/mcp`); replicas behind each path are interchangeable. Every response includes a non-security `serverInfo` and diagnostic replica identifier so acceptance tests can prove distribution. No behavior may depend on that identifier.

## MCP surface

### Required request metadata

Every request includes:

- body `_meta.io.modelcontextprotocol/protocolVersion = "2026-07-28"`;
- body `_meta.io.modelcontextprotocol/clientCapabilities`;
- body `_meta.io.modelcontextprotocol/clientInfo` unless explicitly disabled for a negative test;
- HTTP `MCP-Protocol-Version` matching the body;
- HTTP `Mcp-Method` matching the JSON-RPC method;
- HTTP `Mcp-Name` for `tools/call`, `resources/read`, and `prompts/get`;
- `Accept: application/json, text/event-stream`.

The client implements Base64 sentinel encoding for non-header-safe `Mcp-Name` and `Mcp-Param-*` values. The server validates header/body equality case-insensitively for header names and case-sensitively for values.

### Discovery

`server/discover` returns:

- supported version `2026-07-28`;
- tools, resources, prompts, and form-elicitation-relevant capabilities;
- server identity and learner guidance;
- public cache hints.

Clients may invoke another RPC without discovery and recover from `UnsupportedProtocolVersionError` by selecting a mutually supported version.

### Tools

| Tool | Inputs | Output / behavior |
|---|---|---|
| `create_incident` | title, severity, suspected services | Creates an incident and returns opaque `incident_id` plus expiry |
| `get_incident` | `incident_id` | Returns current lifecycle state and related handles |
| `query_telemetry` | `incident_id`, service, signal, time range | Returns deterministic structured events; service is mirrored via `x-mcp-header` |
| `run_diagnostic` | `incident_id`, service | Streams monotonic progress and returns findings plus `diagnostic_id` |
| `propose_remediation` | `incident_id`, finding | Returns a safe simulated proposal and opaque `remediation_id` |
| `execute_remediation` | `incident_id`, `remediation_id` | Uses MRTR form elicitation; accepted retry executes once, decline/cancel has no effect |
| `resolve_incident` | `incident_id`, summary | Performs a valid terminal transition |

All tools have JSON Schema 2020-12 input and output schemas. Structured results are validated and duplicated as text for compatibility. Unknown tools and malformed protocol inputs use JSON-RPC errors; domain failures use `isError: true` tool results.

### Resources

- `incident://topology/services` — stable fictional service map.
- `incident://runbooks/{service_id}` — versioned runbook markdown.
- `incident://incidents/{incident_id}/timeline` — incident-specific telemetry timeline.
- `resources/list`, `resources/templates/list`, and `resources/read` use deterministic ordering and appropriate cache hints.
- Unknown resources return `-32602`; they never return an ambiguous empty `contents` array.

### Prompts

- `triage_incident(incident_id)` — user-controlled prompt containing investigation instructions and links to relevant resources.
- `review_remediation(incident_id, remediation_id)` — user-controlled prompt for reviewing evidence before execution.
- `prompts/list` is deterministic and cacheable; `prompts/get` validates required arguments.

### MRTR elicitation

`execute_remediation` follows the stateless MRTR sequence:

```mermaid
sequenceDiagram
    participant C as CLI client
    participant A as Server replica A
    participant B as Server replica B
    participant D as DynamoDB
    C->>A: tools/call execute_remediation (id 1)
    A-->>C: input_required + elicitation/create + signed requestState
    Note over C: learner accepts, declines, or cancels
    C->>B: retry original tools/call (id 2) + exact requestState + inputResponses
    B->>B: verify HMAC, expiry, method and argument digest
    B->>D: conditional at-most-once simulated effect
    B-->>C: complete result
```

The retry uses a new JSON-RPC ID and can land on another replica. `requestState` is opaque to the client, integrity-protected, expires after five minutes, and binds the original method and salient arguments. Tampering, expiry, cross-request reuse, duplicate execution, missing capability, acceptance, decline, and cancel are all tested.

### Progress and cancellation

`run_diagnostic` may return request-scoped SSE when the client supplies a unique `progressToken`. Progress is monotonic, rate-limited, ends before the final response, and is never emitted after completion. Closing the HTTP response stream cancels work and releases resources. Simple requests may return `application/json`.

### Caching

The server includes `ttlMs >= 0` and `cacheScope` on every complete cacheable result. The client keeps only an in-process cache keyed by method and all result-affecting parameters. It never caches `input_required` results or MRTR retries, does not treat TTL as a polling interval, and can serve stale data only after a failed refresh with a visible warning. There is no Redis, shared cache, or queue.

### CLI surface

Both implementations expose equivalent commands:

```text
incident-mcp discover <url>
incident-mcp tools list <url>
incident-mcp tools inspect <url> <name>
incident-mcp tools call <url> <name> --json '<arguments>'
incident-mcp resources list <url>
incident-mcp resources read <url> <uri>
incident-mcp prompts list <url>
incident-mcp prompts get <url> <name> --json '<arguments>'
incident-mcp demo <url> [--approve|--decline|--cancel]
```

`--wire` prints redacted HTTP metadata and JSON-RPC messages; `--no-cache` bypasses the client cache. Commands return stable exit codes and machine-readable JSON by default, with diagnostics on stderr.

## Business rules

1. MCP transport context is never inferred from a connection, process, cookie, source IP, prior request, or replica.
2. Protocol version and client capabilities are evaluated independently on every request.
3. No response creates, returns, or relies on `Mcp-Session-Id`.
4. Incident continuity uses only explicit opaque handles supplied in request arguments.
5. Tool, prompt, and resource lists are deterministic when their underlying sets are unchanged.
6. Every mirrored HTTP header must match its body source; mismatches return HTTP 400 and JSON-RPC `-32020`.
7. Unsupported protocol versions return HTTP 400 and `-32022` with supported versions.
8. Missing required client capability returns HTTP 400 and `-32021`.
9. Missing methods return HTTP 404 and `-32601`; malformed requests use the applicable JSON-RPC standard code.
10. An invalid `Origin` returns HTTP 403. Local servers bind to localhost unless running inside the isolated Compose network.
11. Remediation effects are fictional, reviewable, and conditionally written at most once.
12. A declined or cancelled elicitation never applies remediation.
13. Both raw and SDK realizations must produce equivalent observable behavior; implementation-specific metadata may differ only where explicitly allowed.

## Interoperability and acceptance

The mandatory matrix is:

| Client | Server | Required |
|---|---|---|
| Raw | Raw | Yes |
| Raw | SDK | Yes |
| SDK | Raw | Yes |
| SDK | SDK | Yes |

Each pair runs discovery, catalog reads, resource/prompt retrieval, an incident workflow, MRTR acceptance/decline/cancel, error recovery, cache behavior, SSE progress/cancellation, and structured output validation. The local and AWS deployments each prove requests reach at least two replicas without sticky sessions and that an MRTR retry can complete on a different replica from its initial call.

## Non-functional requirements

| Area | Target |
|---|---|
| Correctness | All selected MCP normative requirements and all four interoperability combinations pass the shared conformance suite |
| Statelessness | At least 100 sequential requests distribute across at least two healthy replicas; behavior and result equivalence do not depend on replica |
| Reliability | Zero duplicate simulated remediation effects under 20 concurrent retries of one accepted MRTR state |
| Performance | After warm-up, catalog requests at 10 requests/s achieve p95 ≤ 750 ms and error rate < 1% locally and in AWS |
| Security | Origin validation, schema validation, header/body validation, requestState integrity/expiry, dependency audit with no unsuppressed high/critical findings, no real remediation |
| Observability | Structured JSON logs include method, name, request ID, replica, latency, result type, trace ID, and no unredacted requestState or elicitation content |
| Portability | Node.js 24 LTS; local workflow runs on Docker Compose; cloud stack targets `ap-southeast-1` by default |
| Test quality | 100% statement and branch coverage for protocol codecs/validators; mutation score ≥ 90% for raw protocol core |
| Cost/lifecycle | AWS environment is ephemeral and `cdk destroy` is part of acceptance; actual cost is measured and disclosed rather than guaranteed |

## Deployment

### Local

Docker Compose runs DynamoDB Local, a deterministic seed job, Nginx, two raw-server replicas, and two SDK-server replicas. Health checks gate readiness. The same images and environment contracts are used in CI.

### AWS

AWS CDK provisions:

- one DynamoDB table with on-demand capacity, encryption, point-in-time recovery disabled for the ephemeral lab, and TTL;
- ECR repositories for immutable raw and SDK images;
- an ECS Fargate service per server realization, each with at least two tasks;
- an internet-facing ALB routing `/raw/mcp` and `/sdk/mcp` to separate target groups;
- AWS WAF rate-based protection, strict security groups, and TLS where a temporary certificate/domain is available;
- Secrets Manager material for MRTR state integrity;
- CloudWatch logs and metrics;
- required project/environment/owner tags.

The deployment uses the authenticated `cc-sandbox` profile interactively. Credentials are never committed. Cloud apply and teardown remain separately gated actions.

## Security posture

The initial endpoint is unauthenticated to keep the project focused on the stateless core. It contains only synthetic shared data and simulated effects. The cloud environment is deployed only for acceptance and torn down immediately afterward. WAF rate limiting, bounded request sizes, timeouts, least-privilege IAM, origin validation, schema complexity bounds, safe header encoding, output sanitization, and dependency scanning remain required.

This is a deliberate learning boundary, not a claim that unauthenticated remote MCP is production-ready. OAuth issuer validation, Client ID Metadata Documents, authorization-context cache isolation, and user-bound handles belong in a later plan.

## Out of scope

- MCP authorization, OAuth, CIMD, DCR, user identity, roles, and tenancy.
- Tasks, MCP Apps, Skills over MCP, Enterprise Managed Authorization, or other extensions.
- Legacy initialization/session behavior, dual-era compatibility, HTTP+SSE, resumable streams, Roots, Sampling, and Logging.
- `subscriptions/listen`, list-change notifications, and resource subscriptions.
- URL-mode elicitation or handling secrets through elicitation.
- Real logs, credentials, cloud APIs, shell execution, service restarts, host isolation, or production remediation.
- A graphical frontend or LLM/chat-host integration.
- Multi-region failover, production uptime, permanent public hosting, or a production authorization posture.
- External shared caches and queues.

## Decision boundaries

### Later phases may decide autonomously

- Internal class/function names and file layout within the approved hexagonal boundaries.
- Exact fictional service names, telemetry messages, runbook prose, and seeded incident values.
- CLI presentation details that preserve JSON output and stable exit codes.
- Cache TTL values within documented safe bounds.
- CDK construct decomposition and test fixture organization.
- Dependency patch versions compatible with Node.js 24 and MCP `2026-07-28`.

### Must return to the user

- Adding real infrastructure access or any non-simulated mutating capability.
- Making the AWS deployment persistent or production-facing.
- Adding authentication, identity, paid third-party services, or another cloud.
- Adding an MCP extension, legacy compatibility, GUI, or LLM provider integration.
- Weakening the four-way interoperability matrix, statelessness proof, security controls, or teardown requirement.

## Sources

See [`sources/README.md`](sources/README.md) for captured URLs, authority, scope, and hashes. In priority order:

1. MCP `2026-07-28` specification and `schema.ts` — normative.
2. MCP release announcement — release rationale and migration summary.
3. Simon Willison's stateless MCP article — project-learning motivation and CLI prior art.
4. `mcp-explorer` README — requirements input for a usable explorer CLI, not an architecture blueprint.
