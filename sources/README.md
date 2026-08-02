# Requirements sources

Captured on 2026-08-01 for offline, reviewable planning. `SHA256SUMS` records the exact captured bytes.

| Source | Local capture | Role |
|---|---|---|
| [MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) | `spec-2026-07-28/*.md` | Normative protocol requirements |
| [Authoritative TypeScript schema](https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts) | `spec-2026-07-28/schema.ts` | Normative message and type definitions |
| [The 2026-07-28 Specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/) | `mcp-release-2026-07-28.html` | Release rationale and migration summary |
| [Stateless MCP has recaptured my interest](https://simonwillison.net/2026/Jul/31/stateless-mcp/) | `simon-willison-stateless-mcp.html` | Learning-project motivation and prior art |
| [mcp-explorer README](https://github.com/simonw/mcp-explorer/blob/main/README.md) | `mcp-explorer-README.md` | CLI capability requirements input |

## Captured specification pages

The specification capture includes architecture, base messages, versioning, Streamable HTTP, MRTR, progress, cancellation, discovery, tools, resources, prompts, caching, pagination, elicitation, deprecations, changelog, and the schema reference/index. Authorization pages and extension specifications were not copied because they are explicitly outside this plan; the top-level index still records their existence.

## Interpretation rule

When commentary or prior art conflicts with the specification, the specification and `schema.ts` win. RFC 2119/8174 normative words are converted into conformance tests only for the selected project scope. Captures are requirements evidence, not implementation blueprints.
