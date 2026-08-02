# Problem charter: Stateless MCP Incident Lab planning

## Problem

A learner can use an MCP SDK without understanding what makes MCP `2026-07-28` stateless or whether independently built clients and servers truly interoperate. The project needs a bounded, testable learning specification that exposes wire behavior, explicit application state, MRTR, caching, streaming, horizontal routing, and SDK abstraction without drifting into authentication, extensions, real operations, or a toy that merely claims statelessness.

## Review objective

Determine whether `PRD.md` and `PLAN-001-stateless-core.md` are complete, internally consistent, faithful to the captured MCP specification, feasible for two independent TypeScript implementations, and appropriately scoped for a learning project.

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
