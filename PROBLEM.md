# Problem charter: Stateless MCP Incident Lab planning

## Problem

A learner can use an MCP SDK without understanding what makes MCP `2026-07-28` stateless or whether independently built clients and servers truly interoperate. The project needs a bounded, testable learning specification that exposes wire behavior, explicit application state, MRTR, caching, streaming, horizontal routing, and SDK abstraction without drifting into authentication, extensions, real operations, or a toy that merely claims statelessness.

## Scope

Review `PRD.md`, `PLAN-001-stateless-core.md`, `PLAN.md`, the implementation registry, and their captured requirements sources. Assess the forecast contract before conformance authoring begins. The review may make minimal corrections to these planning artifacts and this charter. It must not author conformance goldens, implementation code, architecture ADRs, deployment resources, or new product scope.

The source-of-truth order is:

1. Captured MCP `2026-07-28` specification and `schema.ts` for protocol claims.
2. User-confirmed decisions recorded in PRD/PLAN: incident simulator, raw plus SDK, TypeScript/Node.js 24, DynamoDB, local and AWS deployment, Vitest/Testcontainers, no auth, no external cache/queue, and the selected protocol envelope.
3. Simon Willison's article and `mcp-explorer` as motivation and prior art only.

## Non-goals

- Choosing a more ambitious domain or adding auth, extensions, subscriptions, legacy support, GUI, or an LLM provider.
- Reviewing an implementation or asserting that planned cloud behavior has already been executed.
- Treating forecast test counts as authored-suite counts.
- Optimizing prose style where meaning and traceability are already precise.

## Acceptance criteria

1. **Requirements-to-plan closure:** every PRD behavior and NFR maps to one-or-more PLAN categories, an explicit non-goal, or a disclosed unverified-by-design state; every PLAN category has a PRD source.
2. **Normative fidelity:** selected protocol requirements agree with captured MCP `2026-07-28` sources, including per-request metadata, HTTP headers/statuses, MRTR, cacheability, SSE, cancellation, and deprecated exclusions.
3. **Internal consistency:** data model, lifecycle, tool/resource/prompt/CLI surfaces, business rules, NFRs, deployment topology, decision boundaries, and out-of-scope statements do not contradict each other.
4. **Technology integrity:** all seven technology decisions are concrete and mutually compatible with the selected protocol and NFRs.
5. **Approach soundness:** the chosen independent raw/SDK approach has at least two honestly evaluated alternatives and no load-bearing assumption contradicted by a pinned requirement.
6. **Interoperability testability:** the four client/server combinations and cross-replica statelessness/MRTR claims have observable, implementation-neutral verification paths.
7. **Security honesty:** the unauthenticated cloud boundary is explicitly ephemeral and synthetic; requestState, rate limiting, input/header validation, secrets, dependency scanning, and teardown controls are neither omitted nor presented as production authorization.
8. **Structural integrity:** required PRD/PLAN sections, category/test arithmetic, implementation manifests, source hashes, diagrams, and internal links validate.
9. **Scope realism:** the plan can be executed in category-sized slices without silently dropping selected normative behavior; risks and return-to-user boundaries cover material uncertainty.

## Verification

Run from the repository root after every round:

```bash
python3 scripts/verify-prd.py
sha256sum -c sources/SHA256SUMS
bash ~/personal/cdd-skills/tools/cdd-impls.sh \
  --root ~/personal --project stateless-mcp-incident-lab --cwd "$PWD" --table
git diff --check
git status --short
```

Additionally:

- Compare every normative protocol claim touched in a round against the captured specification page and `sources/spec-2026-07-28/schema.ts`.
- Recompute PRD→PLAN semantic coverage and category preconditions adversarially; `scripts/verify-prd.py` verifies structural closure but does not claim to understand prose semantics.
- Validate each Mermaid block with `mmdc` when available; otherwise record renderer validation as a residual rather than claiming it ran.
- Confirm no sibling architecture/conformance/implementation/infrastructure repositories exist yet; if one appears during review, reconcile PLAN claims against it.

## Residuals

- Cloud transport, performance, cost, and teardown claims are forecasts until deployed acceptance runs; this PRD review can judge their testability and honesty, not execute them.
- Exact official MCP SDK package version remains intentionally selected at authoring from a live registry release declaring `2026-07-28` support.
- Mermaid rendering is residual if no validator is installed; static diagram-to-text reconciliation still runs.

## Review objective

Determine whether the planning artifacts are complete, internally consistent, faithful to the captured MCP specification, feasible for two independent TypeScript implementations, and appropriately scoped for a learning project.

## Required review lenses

1. Normative MCP fidelity, especially per-request `_meta`, mirrored headers, result types, MRTR, caching, SSE, and error/status mappings.
2. Whether every dependency in the implementation order consumes a real upstream contract.
3. Whether raw/SDK independence and the four-way matrix can detect meaningful divergence.
4. Whether local and AWS topology genuinely prove replica independence without hidden connection/session state.
5. Security of an ephemeral unauthenticated synthetic endpoint, signed MRTR state, and simulated remediation.
6. Traceability from requirements and NFRs to conformance categories or disclosed non-verification.
7. Scope realism: identify redundant categories as well as missing high-risk behaviors.

## Non-negotiable intent

- Learn the stateless core at both wire and SDK levels.
- Keep all incidents and remediation fictional.
- Preserve two independent implementations and four interoperability combinations.
- Exclude auth, extensions, legacy protocol support, subscriptions, GUI, and LLM-provider integration from PLAN-001.
- Require local Compose and ephemeral AWS deploy/verify/teardown.

## Evidence

Normative and contextual source captures are under `sources/` with hashes in `sources/SHA256SUMS`. The authoritative source is `sources/spec-2026-07-28/schema.ts` plus the captured specification pages.
