# Actively Building Implementation Plan

Date: 2026-05-03
Source: README Roadmap, `### Actively Building`

This plan decomposes the three active roadmap items into implementation tasks,
acceptance criteria, and validation gates. It does not mark the roadmap items
complete; each item should be closed only after the listed tests and end-to-end
checks pass on a representative multi-language repository.

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
- [ ] Implement Swift attributes and property wrappers for `@main`, `@Schemable`, `@Observable`, `@Model`, and app/tool entry-point patterns.
- [ ] Treat Swift attributes as decorator detections across declaration,
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

## Milestone 3: Incremental Indexing

Goal: Rebuild only changed files while keeping graph consistency, search
indexes, embeddings, and repo metadata correct.

Tasks:

- [ ] Add a manifest keyed by repo commit, file path, content hash, parser version, language provider version, and config fingerprint.
- [ ] Detect added, modified, deleted, renamed, and config-affected files before ingestion.
- [ ] Reparse changed files and remove deleted-file symbols and edges from LadybugDB.
- [ ] Recompute cross-file imports and call edges only for affected source and target neighborhoods.
- [ ] Preserve embeddings for unchanged nodes and enqueue embeddings only for new or changed nodes.
- [ ] Update FTS indexes for changed/deleted content without requiring a full rebuild when LadybugDB supports it; otherwise use a documented targeted rebuild fallback.
- [ ] Add invalidation rules for language config changes such as `tsconfig`, `Package.swift`, `go.mod`, and composer config.
- [ ] Add `--incremental`, `--force`, and fallback behavior with clear CLI progress and status output.
- [ ] Add corruption and rollback handling so failed incremental runs leave the previous index usable.

Acceptance criteria:

- A one-file edit updates only that file's symbols, local relationships, changed embeddings, and affected cross-file edges.
- File deletion removes stale symbols from query and context results.
- Config changes invalidate all files whose resolution may have changed.
- Full analyze and incremental analyze produce equivalent graph/query results on the same repo state.

Validation:

- `cd gitnexus && npx vitest run test/unit/*incremental* test/integration/*incremental*`
- `cd gitnexus && npx tsc --noEmit`
- Golden comparison: full analyze vs incremental analyze on a fixture repo with add, edit, delete, and config-change steps.

## Release Checklist

- [ ] Update README roadmap checkboxes only after each milestone is merged and verified.
- [ ] Update `docs/guides` with configuration and troubleshooting for new flags.
- [ ] Add migration notes for existing `.gitnexus` indexes if schema changes.
- [ ] Run `cd gitnexus && npm test`.
- [ ] Run `cd gitnexus && npx tsc --noEmit`.
- [ ] Reindex GitNexus itself and verify `gitnexus query`, `gitnexus context`, and `gitnexus detect_changes`.
