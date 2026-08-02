# Conformance Plan: Stateless MCP Incident Lab

## Goal

Author one language-neutral conformance suite for two independent TypeScript client/server realizations of MCP `2026-07-28`: a raw HTTP/JSON-RPC implementation and an official-SDK implementation. Prove all four client/server combinations locally and on AWS, including cross-replica MRTR retries and absence of protocol sessions.

## Approach

**Recommendation: two independent ports-and-adapters implementations behind one shared contract.** Each repository contains a CLI client and an MCP server exposing the same fictional incident-response domain. The raw realization implements codecs, validation, Streamable HTTP, SSE, caching, and MRTR directly. The SDK realization uses official SDK APIs but remains responsible for domain, security, persistence, and observability. Neither imports code from the other. Shared behavior lives only in conformance goldens and acceptance scenarios.

The architectural shape is **hexagonal / ports-and-adapters**:

- domain: incidents, diagnostics, remediation lifecycle;
- application: protocol-independent use cases;
- inbound adapters: MCP raw or SDK server, CLI raw or SDK client;
- outbound adapters: DynamoDB, clock/ID generation, logging/tracing;
- deployment adapters: native HTTP locally/containers and ECS Fargate.

### Alternatives considered

1. **SDK only — rejected.** Fastest delivery but hides the mechanics the project exists to learn: per-request metadata, header validation, result polymorphism, SSE framing, MRTR retry construction, and cache keys.
2. **Raw implementation followed by an in-place SDK refactor — rejected.** Shows abstraction differences but loses side-by-side behavior and cannot prove cross-implementation interoperability.
3. **One monorepo with four packages — viable but not chosen.** Easier sharing risks accidental coupling and makes “independent implementation of one protocol” less credible.
4. **Lambda + API Gateway — not selected initially.** Excellent for stateless JSON requests, but request-scoped SSE progress and disconnect cancellation add platform-specific streaming constraints. Two-task ECS Fargate services behind an ALB preserve the selected transport behavior while still proving horizontal statelessness. Reconsider if AWS's validated response-streaming path satisfies every streaming golden without adapters that distort MCP semantics.

## Repo family

| Role | Repo | Purpose |
|---|---|---|
| PRD | `stateless-mcp-incident-lab-prd` | Living requirements, plans, source captures, implementation registry, and acceptance demo |
| Conformance | `stateless-mcp-incident-lab-conformance` | Shared protocol, CLI, domain, architecture, security, performance, IaC, and CI golden suite |
| Frontend Conformance | N/A | No graphical frontend |
| Implementation: raw | `stateless-mcp-incident-lab-typescript-raw` | Raw client and server using `node:http`, `fetch`, and direct JSON-RPC/SSE handling |
| Implementation: SDK | `stateless-mcp-incident-lab-typescript-sdk` | Equivalent client and server using the official MCP TypeScript SDK |
| Architecture | `stateless-mcp-incident-lab-architecture` | ADRs, topology diagrams, and per-implementation boundary rules; scaffold after plan approval |
| CI/CD | `stateless-mcp-incident-lab-cicd` | Reusable GitHub Actions workflows and image/deploy quality gates |
| Infrastructure | `stateless-mcp-incident-lab-infrastructure` | AWS CDK for DynamoDB, ECR, ECS Fargate, ALB, WAF, Secrets Manager, and CloudWatch |

The raw and SDK implementations are declared in `implementations/*.manifest`. Each is a service implementation containing both server and matching CLI. The shared acceptance demo composes both entries to run the 2×2 client/server matrix.

## Categories (core — language-neutral)

| # | Category | Boundary | Key behaviors | Est. tests | Deps | Risk |
|---|---|---|---|---:|---|---|
| 1 | `protocol/` | `function` | JSON-RPC request/result/error/notification shapes; IDs; `resultType`; standard and reserved errors; JSON Schema dialect handling | 12 | — | High |
| 2 | `versioning/` | `http` | Required per-request `_meta`; unsupported version retry; required capabilities; no handshake/session inference | 10 | 1 | High |
| 3 | `transport/` | `http`, `sse` | POST endpoint, Accept/content types, required mirrored headers, Base64 sentinel encoding, `x-mcp-header`, mismatch errors, Origin, GET/DELETE rejection | 18 | 1,2 | High |
| 4 | `discovery/` | `http` | Mandatory `server/discover`, capabilities, identity, instructions, cache hints, direct-call-without-discovery | 6 | 1–3 | Medium |
| 5 | `primitives/` | `http`, `tool-call` | Deterministic list/get/read/call for tools, resources, templates, prompts; schemas, structured output, error split | 20 | 1–4 | High |
| 6 | `incidents/` | `state-machine`, `http` | Explicit opaque handles, incident transitions, diagnostics, proposals, expiry, conditional at-most-once remediation | 12 | 5 | High |
| 7 | `mrtr/` | `tool-call` | `input_required`, capability check, form elicitation, new retry ID, exact state echo, accept/decline/cancel, signed state tamper/expiry/binding, cross-replica retry | 16 | 2,5,6 | Critical |
| 8 | `streaming/` | `sse` | Request-scoped progress, monotonic token updates, final response and close, disconnect cancellation, no post-completion events | 9 | 3,6 | High |
| 9 | `cache/` | `function`, `http` | Mandatory hints, key method+params, TTL freshness, public/private scope, no MRTR caching, stale-on-error warning, deterministic pages | 10 | 4,5 | Medium |
| 10 | `cli/` | `cli` | Equivalent commands, JSON stdout/stderr separation, exit codes, wire redaction, inspect/call, cache bypass, interactive MRTR actions | 14 | 3–9 | High |
| 11 | `interoperability/` | `contract` | Raw→raw, raw→SDK, SDK→raw, SDK→SDK workflows and equivalent observables | 12 | 5–10 | Critical |
| 12 | `properties/` | `property` | Header encode/decode round trip, cache-key stability, deterministic ordering, request-state tamper rejection, replica-independence | 7 | 1–9 | High |
| 13 | `security/` | `http`, `lint-assertion` | Origin rebinding defense, malformed/unbounded schemas, header injection, request size/time bounds, output/state redaction, simulated-only actions | 12 | 3,5–8 | Critical |
| 14 | `observability/` | `http`, `trace-span` | Health, structured logs, W3C trace context in `_meta`, method/name/replica/result metrics, sensitive-field absence | 7 | 3,6 | Medium |
| 15 | `performance/` | `metric-assertion` | Warm p95/error target, 100-request two-replica distribution, concurrent MRTR idempotency | 3 | 7,8,11 | High |
| 16 | `architecture/` | `lint-assertion`, `decision-record` | Mandatory dependency direction and boundaries; raw repo cannot import MCP SDK; domain cannot import transport/persistence | 6 | — | High |
| 17 | `infra/` | `function` | CDK assertions for encryption, TTL, least-privilege IAM/SG, ≥2 tasks, health checks, WAF rate rule, tags, log retention, destroyability | 10 | 3,13–15 | High |
| 18 | `cicd/` | `workflow-assertion` | lint/typecheck/test/audit/build gates, four-way matrix, immutable image digest, AWS OIDC, deploy/verify/destroy ordering | 8 | 11,13,17 | High |
| 19 | `dependencies/` | `function` | Lockfile reproducibility, approved licenses, `npm audit` high/critical floor, SDK absent from raw dependency graph | 5 | 16 | Medium |

**Estimated total: 197 golden tests.** This is a large conformance plan because the selected goal includes both sides of the protocol, two implementations, streaming, cloud infrastructure, and a four-way matrix. Authoring should use category-sized rounds and risk-first ordering; estimates may shrink when one property test replaces many finite examples, but normative behaviors must not be dropped to hit a count.

## Stack categories (tier-1, optional)

N/A. TypeScript/Node.js is currently tier 2 in CDD; all behavior remains in the language-neutral core. Implementation-native Vitest tests may supplement but never replace shared goldens.

## Implementation order

1. **Architecture seams and protocol schema (`architecture`, `protocol`)** — establish enforceable independence and message vocabulary before any transport code.
2. **Versioning and Streamable HTTP (`versioning`, `transport`)** — highest-risk stateless boundary; everything else consumes its request/response contract.
3. **Discovery and primitive catalogs (`discovery`, `primitives`)** — first useful thin vertical slice and foundation for client inspection.
4. **Incident domain (`incidents`)** — introduces explicit application handles independently of transport sessions.
5. **MRTR (`mrtr`)** — critical differentiator; authored once the tool/domain contracts it retries are stable.
6. **Streaming (`streaming`)** — independent of MRTR but consumes transport and diagnostic use case; bring forward in parallel with MRTR if capacity permits.
7. **Caching (`cache`)** — consumes stable discovery/catalog results and must know MRTR exclusions.
8. **CLI (`cli`)** — consumes all client-side protocol contracts and exposes them to the learner.
9. **Security and properties (`security`, `properties`, `dependencies`)** — adversarial and universal checks over the stable codec/transport surface; security cases for earlier categories are authored in the same rounds, then swept here.
10. **Interoperability (`interoperability`)** — only meaningful after both server/client boundaries exist; run all four combinations.
11. **Observability and performance (`observability`, `performance`)** — measure the assembled request path and replica behavior.
12. **Infrastructure and pipeline (`infra`, `cicd`)** — consume health, performance, image, and acceptance contracts; cloud integration last.

Real dependency edges are contract consumption, not narrative sequence. `mrtr` and `streaming` are related but do not depend on each other. Infrastructure may be authored in parallel once health and deployment contracts are fixed, but deployed verification waits for interoperability and security.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SDK lacks or interprets a new `2026-07-28` behavior differently | Blocks parity or exposes a real SDK defect | Pin a supporting SDK version, test raw wire output, record minimal reproducer; never weaken shared contract merely to fit SDK behavior |
| Raw and SDK repos accidentally share implementation logic | Invalidates the learning comparison | Separate repos; architecture lint; raw dependency graph forbids MCP SDK; shared artifacts limited to goldens and fixtures |
| “Stateless” is claimed while state leaks through process/connection | Core learning objective fails | Randomized replica routing, process restarts, connection churn, cross-replica MRTR, and property tests |
| MRTR requestState tampering or replay duplicates remediation | Unsafe protocol example | HMAC, five-minute TTL, method/argument digest, exact echo, DynamoDB conditional single-use write, concurrency test |
| ALB/proxy buffers SSE or disconnect is not propagated | Progress/cancellation conformance fails in AWS | Disable local proxy buffering; validate ALB behavior early with a spike; reconsider Lambda only if streaming contract is preserved |
| Two implementations × two clients causes scope growth | Project stalls | Build thin vertical slices in risk order; one domain and one protocol revision; explicitly exclude extensions, auth, subscriptions, legacy, and GUI |
| Unauthenticated cloud endpoint is abused | Cost or availability impact | Synthetic data only, WAF rate rule, bounded payload/work, short deployment window, immediate automated teardown |
| DynamoDB Local differs from AWS | Local green/cloud red | Repository adapter contract tests plus deployed acceptance against real DynamoDB; avoid emulator-specific APIs |
| Cloud teardown leaves billable resources | Unexpected cost | Ephemeral tags, `cdk destroy` acceptance step, ECR `emptyOnDelete`, post-destroy resource inventory |
| Arbitrary NFR thresholds create flaky CI | False failures | Warm-up, fixed load profile, separate controlled performance job, report raw measurements, no network-dependent third party |
| Captured prose and schema diverge | Incorrect implementation | Treat captured `schema.ts` as message source of truth; pin source hash and SDK version; conformance cites source page/section |

## Open questions

None block plan approval. Exact SDK package version is selected during authoring from the first stable TypeScript SDK release that declares `2026-07-28` support, then pinned in lockfiles and an ADR. If no such stable release satisfies the selected envelope, implementation must stop and return to the user rather than silently using prerelease behavior.

## Out of scope / Non-goals

- Authentication, OAuth, CIMD, DCR, identity, authorization-context cache isolation, or multi-tenancy.
- MCP extensions including Tasks, Apps, Skills, and EMA.
- Legacy `initialize`/`initialized`, `Mcp-Session-Id`, dual-era behavior, HTTP+SSE, GET stream endpoints, resumability, Roots, Sampling, and Logging.
- `subscriptions/listen`, list-change notifications, and resource subscriptions.
- URL elicitation, real secrets, real telemetry, shell access, cloud control APIs, or actual remediation.
- GUI/frontend, LLM provider integration, model evaluation, mobile/desktop packaging.
- Permanent hosting, production SLOs, multi-region, disaster recovery, or production data durability.
- Redis, queues, relational databases, or alternate language ports.

These receive no golden files in PLAN-001.

## Decision boundaries

### Authoring and implementation may decide

- Fixture prose and exact deterministic telemetry values.
- Internal APIs within the approved hexagonal boundaries.
- Cache TTLs, retry backoff, and progress cadence within specified semantics and bounds.
- CDK construct layout, ECS CPU/memory at the smallest size meeting measured targets, and log retention up to seven days.
- Exact schema validator and CLI formatting library, provided the raw repo does not import the MCP SDK and the CLI contract remains stable.

### Return to the user before changing

- Protocol revision or feature envelope.
- Deployment compute model if it changes externally observable streaming/cancellation behavior.
- Real infrastructure access, persistent deployment, auth, extensions, subscriptions, legacy support, GUI, or LLM integration.
- Shared implementation package between raw and SDK repos.
- Any relaxation of the four-way matrix, cross-replica proof, simulated-only safety boundary, cloud teardown, or high/critical dependency gate.

## Non-functional requirements

| Requirement | Target | Category | Boundary | Verified by |
|---|---|---|---|---|
| Protocol correctness | Selected `2026-07-28` MUSTs pass both implementations | `protocol`–`cache` | function/http/sse/tool-call | Shared conformance runner + captured schema hash |
| Interoperability | 4/4 client-server combinations green | `interoperability` | contract | Matrix acceptance scenario `INT-001` |
| Replica independence | 100 requests hit ≥2 replicas; cross-replica MRTR succeeds | `performance`, `mrtr` | metric-assertion/tool-call | k6 distribution check + `MRTR-012` |
| Idempotency | One effect from 20 concurrent accepted retries | `incidents`, `performance` | state-machine/metric-assertion | DynamoDB conditional-write scenario `PERF-003` |
| Latency | Warm p95 ≤750 ms at 10 rps; errors <1% | `performance` | metric-assertion | k6 local and deployed profiles |
| Protocol-core coverage | 100% statements and branches | implementation quality gate | metric-assertion | Vitest V8 coverage in each repo |
| Mutation resistance | ≥90% raw protocol-core mutation score | implementation quality gate | metric-assertion | Stryker report in raw repo |
| Input safety | Bounded bodies/schemas, header injection rejected, Origin enforced | `security`, `transport` | http | adversarial HTTP goldens |
| MRTR integrity | Tamper, expiry, wrong-call reuse rejected; state redacted | `mrtr`, `security` | tool-call/http | MRTR negative suite + log assertions |
| Dependency safety | No unsuppressed high/critical known CVEs | `dependencies` | function | `npm audit --audit-level=high`; dated expiring suppressions only |
| Observability | Required structured fields and W3C trace propagation | `observability` | http/trace-span | log capture + trace goldens |
| Local reproducibility | One Compose command reaches healthy full matrix | acceptance demo | structural-contract | `demo/*.compose.yaml up -d --wait` + DEMO scenario |
| Cloud teardown | Stack destroy succeeds and inventory is empty | `infra`, acceptance | function | CDK assertions + post-destroy AWS inventory |
| Cost | Measured after ephemeral run | acceptance report | documentation-contract | AWS Cost Explorer value, or `unverified (disclosed)` if billing data is delayed |

## Technology choices

| Decision | Choice | Rationale |
|---|---|---|
| Database | DynamoDB Local in Compose; Amazon DynamoDB on AWS | Same persistence model locally/cloud; explicit handles and conditional idempotency work across replicas |
| Runtime/language version | Node.js 24 LTS; strict TypeScript | User-selected; aligns with authoritative TypeScript schema and native Fetch/streams |
| Framework | Raw: `node:http`, native Fetch/Web Streams, `node:util.parseArgs`; SDK: official `@modelcontextprotocol/sdk`; no Express/Fastify | Keeps comparison focused on MCP abstractions, not web-framework behavior |
| Deployment target | Local Docker Compose with Nginx; AWS ECS Fargate (≥2 tasks/implementation) behind ALB in `ap-southeast-1`; AWS CDK | Supports JSON and request-scoped SSE/disconnect semantics while proving horizontal routing |
| Testing framework | Vitest + Testcontainers; k6 for controlled load; Stryker for raw-core mutation | User-approved unit/integration stack plus explicit performance and test-strength tools |
| Auth provider | None in PLAN-001; ephemeral synthetic deployment only | Deliberately isolates stateless core; WAF throttling, IAM, origin checks, and teardown remain |
| Cache/queue | Client in-process MCP hint cache only; no external cache; no queue | User-approved protocol-cache focus; Tasks/subscriptions are excluded |

## Authoring slices

Because the estimate exceeds 100 goldens, author category-sized slices with a separate commit and reconciliation pass for each risk-bearing unit:

1. `architecture` + `protocol`
2. `versioning` + `transport`
3. `discovery` + primitive lists
4. primitive calls/reads/gets + `incidents`
5. `mrtr`
6. `streaming`
7. `cache` + `cli`
8. `properties` + `security` + `dependencies`
9. `interoperability`
10. `observability` + `performance`
11. `infra` + `cicd`

Each slice first authors the language-neutral golden, validates golden shape/non-vacuity, and stops for its conformance-repo review discipline. Implementation follows only after the complete conformance repository converges.
