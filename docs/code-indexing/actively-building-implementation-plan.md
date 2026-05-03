# Actively Building Implementation Plan

Date: 2026-05-03
Source: README Roadmap, `### Actively Building`

This plan decomposes the three active roadmap items into implementation tasks,
acceptance criteria, and validation gates. Roadmap items are closed only after
the listed tests and end-to-end checks pass on representative repositories.

## Scope

- LLM Cluster Enrichment - semantic cluster names and summaries via an opt-in LLM API.
- AST Decorator Detection - first-class decorator, attribute, and annotation parsing for frameworks.
- Incremental Indexing - re-index only changed files while preserving graph, FTS, and embeddings.

## Grounding References

- GitNexus README, Supported Languages and Actively Building roadmap:
  https://github.com/racecraft-lab/GitNexus#supported-languages and
  https://github.com/racecraft-lab/GitNexus#actively-building.
- Tree-sitter query syntax and operators: queries are S-expression patterns,
  captures use `@name`, and operators such as `+`, `*`, and `?` support repeated
  or optional decorator/attribute nodes. The operator guide includes a class
  decorator capture example.
  https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html
  and
  https://tree-sitter.github.io/tree-sitter/using-parsers/queries/2-operators.html.
- Tree-sitter incremental parsing: after a source edit, edit the old syntax tree
  and pass it back into the parser so the new tree can share unchanged
  structure.
  https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html.
- Swift language reference, Attributes: Swift attributes are written with `@`
  plus an attribute name and optional arguments; attached macros and property
  wrappers use attribute syntax, and attributes such as `@main` and `@testable`
  affect declarations/imports.
  https://raw.githubusercontent.com/swiftlang/swift-book/main/TSPL.docc/ReferenceManual/Attributes.md.
- NestJS controllers: `@Controller()` and method decorators such as `@Get()`,
  `@Post()`, `@Param()`, `@Body()`, and `@Query()` define routing metadata; the
  controller prefix and method decorator path compose the route.
  https://docs.nestjs.com/controllers.
- OpenAI Structured Outputs: schema-constrained model responses should use
  Structured Outputs with strict JSON schema support when available, rather than
  relying on prompt-only JSON formatting.
  https://developers.openai.com/api/docs/guides/structured-outputs.

## Milestone 1: AST Decorator Detection

Goal: Parse decorator and annotation syntax into normalized graph metadata so
framework detection can identify routes, controllers, injectable services,
MCP tools, and app entry points more precisely.

Tasks:

- [ ] Add a language-provider hook for decorator and annotation extraction.
- [ ] Define a normalized `DecoratorDetection` shape with name, arguments, receiver symbol, source range, and confidence.
- [ ] Implement TypeScript and JavaScript decorators for NestJS-style `@Controller`, `@Get`, `@Post`, `@Injectable`, and class/member decorators.
- [ ] Implement Python decorators for FastAPI, Flask, Click, pytest, and class/function decorators.
- [ ] Implement JVM annotations for Java and Kotlin, including Spring `@Controller`, `@RestController`, `@GetMapping`, and dependency annotations.
- [ ] Implement C# attributes for ASP.NET controllers, HTTP verbs, DI, and test attributes.
- [x] Implement Swift attributes and property wrappers for `@main`, `@Schemable`, `@Observable`, `@Model`, and app/tool entry-point patterns.
- [x] Treat Swift attributes as decorator detections across declaration,
      property-wrapper, macro, and import positions, including `@testable`,
      `@_exported`, and qualified attributes such as `@SwiftUI.State`.
- [ ] Store decorator detections in graph node properties and expose them through `context`, `query`, `route_map`, and framework summaries.
- [ ] Update framework detectors to prefer AST decorator evidence over text regex evidence.
- [ ] Add fixtures covering class decorators, method decorators, nested decorators, argument extraction, aliases, and disabled or commented code.

Acceptance criteria:

- Exact decorators such as `@Controller("/users")` and `@Get(":id")` map to route/controller metadata without relying on text search.
- NestJS route metadata composes controller prefixes with method decorator paths.
- Swift AST decorator detection captures declaration, import, macro, and
  property-wrapper attributes such as `@main`, `@testable`, `@_exported`,
  `@Schemable`, and `@SwiftUI.State`.
- Decorator metadata survives analyze, query, context, and MCP responses.
- Unsupported decorators degrade to generic annotation metadata instead of failing parsing.
- Tests cover TypeScript, Python, Java, Kotlin, C#, and Swift.

Progress:

- 2026-05-03: Swift attributes now emit `@decorator.name` captures in the
  Swift tree-sitter query and are associated with decorated class, function,
  and property graph nodes as `annotations` in both sequential and worker
  parsing paths. Tests cover `@MainActor`, `@available`, and
  `@SwiftUI.State`, plus `@main`, `@Schemable`, `@testable`, and
  `@_exported` query capture.

Validation:

- `cd gitnexus && npx vitest run test/unit/*decorator* test/unit/*framework*`
- `cd gitnexus && npx vitest run test/integration/resolvers/typescript.test.ts test/integration/resolvers/python.test.ts test/integration/resolvers/swift.test.ts`
- `cd gitnexus && npx tsc --noEmit`

## Milestone 2: LLM Cluster Enrichment

Goal: Give graph communities human-readable names, purposes, and confidence
scores using an optional LLM provider without changing the local-first default.

Tasks:

- [ ] Add opt-in cluster enrichment config: provider, base URL, API key env var, model, timeout, concurrency, and cache policy.
- [ ] Build deterministic cluster prompt inputs from top symbols, files, docstrings, imports, and process participation.
- [ ] Define a strict JSON response schema for cluster name, summary, tags, confidence, and evidence symbols.
- [ ] Prefer provider-native structured-output APIs when available, and validate
      every provider response against the same local JSON schema before writing.
- [ ] Add retry, timeout, and partial-failure handling so analyze succeeds when enrichment fails.
- [ ] Cache enrichment by cluster fingerprint to avoid repeated LLM calls for unchanged clusters.
- [ ] Persist cluster enrichment fields in LadybugDB and expose them through MCP resources, CLI status, query output, and the web UI.
- [ ] Add redaction and privacy controls so raw source is not sent unless explicitly enabled.
- [ ] Add offline tests with mocked LLM responses and malformed response handling.

Acceptance criteria:

- Analyze remains fully local with enrichment disabled by default.
- Enrichment produces stable cluster names for unchanged clusters.
- Bad LLM responses fail closed with warnings and do not corrupt the graph.
- Existing query, context, and wiki flows can display enriched cluster names when present.

Validation:

- `cd gitnexus && npx vitest run test/unit/cluster*.test.ts test/unit/wiki*.test.ts`
- `cd gitnexus && npx tsc --noEmit`
- Manual smoke: analyze a fixture repo with a mocked OpenAI-compatible endpoint and verify enriched clusters.

Progress:

- 2026-05-03: Analyze now supports opt-in cluster enrichment through
  `--enrich-clusters` or `GITNEXUS_CLUSTER_ENRICHMENT=1`, using the existing
  OpenAI-compatible LLM config path plus cluster-specific env overrides.
  The community phase persists enriched `name`, `keywords`, `description`, and
  `enrichedBy` properties on Community graph nodes while keeping enrichment
  disabled by default. Tests cover mocked LLM enrichment, malformed-response
  fallback in the existing enricher tests, and CLI help surface.

## Milestone 3: Incremental Indexing

Goal: Rebuild changed and import-affected files while keeping graph
consistency, search indexes, embeddings, and repo metadata correct.

Tasks:

- [x] Add a manifest keyed by repo commit, file path, content hash, indexer version, and config fingerprint.
- [x] Detect added, modified, deleted, and config-affected files before ingestion.
- [x] Reparse changed and import-affected files while removing stale file-owned symbols and derived community/process nodes from the seeded graph.
- [x] Recompute cross-file imports and call edges for the affected source/importer neighborhood.
- [x] Preserve embeddings for unchanged nodes through the existing content-hash embedding cache and enqueue embeddings only for new or changed nodes.
- [x] Use a documented conservative LadybugDB rewrite fallback for changed/deleted content, with FTS indexes recreated during analyze.
- [x] Add invalidation rules for language config changes such as `tsconfig`, `Package.swift`, `go.mod`, `Cargo.toml`, `composer.json`, `pyproject.toml`, and `.gitnexusignore`.
- [x] Add `--incremental`, `--force`, and fallback behavior with clear CLI progress and status output.
- [x] Add backup and rollback handling so failed incremental DB writes restore the previous index.

Acceptance criteria:

- A one-file edit reparses that file plus its import-affected neighborhood, updates local relationships, and reuses unchanged embedding cache entries.
- File deletion removes stale symbols from query and context results.
- Config changes invalidate all files whose resolution may have changed.
- Full analyze and incremental analyze produce equivalent graph/query results on the same repo state.

Progress:

- 2026-05-03: Incremental indexing now writes `.gitnexus/incremental-manifest.json`,
  detects file/config changes, seeds the pipeline from the previous LadybugDB
  graph, reparses changed and import-affected files, prunes stale file-owned and
  derived graph nodes, rewrites LadybugDB with an automatic backup/rollback, and
  exposes the behavior through `gitnexus analyze --incremental`.
- 2026-05-03: Isolated smoke validation indexed a two-file TypeScript git repo,
  committed a one-file edit, reran `analyze --incremental`, observed
  `1 file(s) to re-index`, and verified `query greet` returned the updated
  symbol.

Validation:

- `cd gitnexus && npx vitest run test/unit/*incremental* test/integration/*incremental*`
- `cd gitnexus && npx tsc --noEmit`
- Golden comparison: full analyze vs incremental analyze on a fixture repo with add, edit, delete, and config-change steps.

## Release Checklist

- [x] Update README roadmap checkboxes only after each milestone is merged and verified.
- [ ] Update `docs/guides` with configuration and troubleshooting for new flags.
- [ ] Add migration notes for existing `.gitnexus` indexes if schema changes.
- [ ] Run `cd gitnexus && npm test`.
- [ ] Run `cd gitnexus && npx tsc --noEmit`.
- [ ] Reindex GitNexus itself and verify `gitnexus query`, `gitnexus context`, and `gitnexus detect_changes`.
