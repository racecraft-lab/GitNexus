# Swift Language Support Audit

Last updated: 2026-05-04

This file records the Swift support comparison against the registry-primary
Python and TypeScript paths. Swift is now first-class in the same sense as those
languages: the resolver is registry-primary by default, has parity coverage for
the common static-resolution surface, and documents the remaining limits as
explicit trade-offs instead of silent unknowns.

## First-Class Support Surface

| Area | Swift support |
|------|---------------|
| Registry path | `SupportedLanguages.Swift` is in `MIGRATED_LANGUAGES`; scope-resolution owns `CALLS`, `ACCESSES`, and `USES` emission. |
| Module/import resolution | Same-target implicit visibility, SwiftPM target dependencies/custom target paths, module selectors, `@testable import`, and `@_exported import` barrels. |
| Receiver inference | Explicit annotations, constructors, function return types, direct call-result chains, multi-hop assignment aliases, `self`, `super`, optional chaining, `if let` / `guard let`, `await` / `try`, for-in element types, named closure parameters, and `$0` shorthand closures. |
| Dispatch | Same-file and cross-file functions, inherited members, protocol/abstract dispatch, overload disambiguation by external labels, trailing closure arity, extension-member merge, and Swift 6.3 module selector calls. |
| Symbols | Classes, structs, enums, protocols, actors, extensions, methods, fields, associated types, subscripts, attributes, property wrappers, static/class methods, visibility, async/final/override metadata. |
| Graph edges | `CALLS`, `USES`, `ACCESSES` reads, `ACCESSES` writes, `EXTENDS`, `IMPLEMENTS`, and `METHOD_IMPLEMENTS` edges for the covered static surface. |

## Closed Gaps

| Gap | Resolution | Evidence |
|-----|------------|----------|
| Assignment aliases | `inferTypeFromExpression` now captures identifier RHS aliases, allowing chain-following to collapse `let second = alias` to the terminal receiver type. | `swift-assignment-nullable-write` fixture and resolver tests. |
| Field writes | Swift assignments now emit `@reference.write.member` captures and suppress false read edges on assignment targets. | `emits write ACCESSES edges for Swift field assignments`. |
| `@_exported import` barrels | `populateSwiftModuleSiblings` now propagates visible re-exported bindings through SwiftPM target barrels. | `swift-exported-import` fixture and resolver tests. |
| Optional/direct call-result chains | Covered together with alias regressions to prevent backsliding on `maybeUser?.save()` and `makeUser().save()`. | `Swift assignment aliases, optional chaining, and writes`. |
| `super.member()` dispatch | Covered in the alias/write fixture to keep inherited Swift member dispatch aligned with Python/TypeScript parent-resolution coverage. | `resolves super.member() to inherited Swift members`. |

## Remaining Documented Limits

These are not unique Swift defects relative to Python/TypeScript support. They
are the Swift equivalents of the documented dynamic and advanced type-flow
limits in `languages/python/index.ts` and `languages/typescript/index.ts`.

| Gap | Current behavior | Impact |
|-----|------------------|--------|
| Macro/build-plugin generated declarations | Source is indexed as parsed; generated declarations are not expanded. | Calls to macro-generated members may remain unresolved. |
| Objective-C/dynamic runtime dispatch | Selectors, KVC/KVO, reflection, and `@dynamicMemberLookup` are not followed. | Runtime-only call targets remain unresolved, as with Python/TS dynamic access. |
| Conditional compilation | `#if canImport(...)` and platform guards are not evaluated per target. | Inactive branches may still be parsed structurally; active-platform precision is out of scope. |
| Advanced generic constraints | Conditional conformance, `where` clauses, protocol-composition aliases, and associated-type equality constraints are indexed structurally but not expanded into alternate dispatch branches. | Highly generic APIs can miss precise protocol/implementation edges. |
| Pattern-heavy type flow | Tuple destructuring, `switch`/`case` pattern bindings, and `while let` iterator bindings do not propagate receiver types. | Calls through those local bindings can remain unresolved. |
| Nonstandard callable declarations | Operator overloads, enum case constructor calls, and `deinit` are not first-class call targets in the scope resolver. | Specialized Swift syntax may be indexed as symbols without full call edges. |

## Verification Corpus

The Swift resolver coverage lives primarily in
`gitnexus/test/integration/resolvers/swift.test.ts`, with supporting unit
coverage in `gitnexus/test/unit/swift-scope.test.ts`,
`gitnexus/test/unit/method-extraction.test.ts`, and
`gitnexus/test/unit/import-resolver-factory.test.ts`. The integration corpus now
covers the same high-value categories used to judge Python and TypeScript:
imports, aliasing, re-exports, receiver inference, parent dispatch, field
reads/writes, overloads, closure receivers, declaration shapes, and module
visibility.
