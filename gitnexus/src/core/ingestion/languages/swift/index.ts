/**
 * Swift scope-resolution hooks (RFC #909 Ring 3, RFC §5).
 *
 * Public API barrel. Consumers should import from this file rather than
 * individual modules.
 *
 * Module layout:
 *
 *   - `scope.ts`           - tree-sitter capture emission, import/type-binding
 *                            interpretation, SwiftPM resolution, same-module
 *                            visibility, `@testable` imports, `@_exported`
 *                            import re-exports, and Swift arity checks.
 *   - `scope-resolver.ts` - `ScopeResolver` wiring, MRO construction,
 *                            extension-member merge, and registry-primary
 *                            feature flags.
 *
 * Supported registry-primary behavior:
 *
 *   - SwiftPM target import resolution, same-target implicit visibility,
 *     module selectors, `@testable import`, and `@_exported import` barrels.
 *   - Receiver inference from explicit annotations, constructor calls,
 *     function return types, direct call-result chains, assignment aliases,
 *     `self`, `super`, optional chaining, `if let` / `guard let`, `await` /
 *     `try`, for-in element types, tuple and switch/case patterns, `while let`
 *     iterator bindings, named closure parameters, and shorthand closure
 *     receivers.
 *   - Class, struct, enum, protocol, actor, extension, associatedtype,
 *     subscript, method, field, annotation, property-wrapper, overload-label,
 *     protocol-dispatch, inherited-member, attached macro-member,
 *     `@dynamicMemberLookup`, constant Objective-C selector, conditional
 *     compilation, generic-constraint, operator, enum-case constructor, `deinit`,
 *     and field read/write edges.
 *
 * ## Known limitations
 *
 * Swift support now covers the first-class static surface expected from a
 * registry-primary GitNexus language. It still intentionally leaves the same
 * kinds of runtime-only behavior unresolved that Python and TypeScript also
 * document as trade-offs.
 *
 *   1. **Arbitrary generated source** - attached macro declarations that
 *      advertise `names: named(...)` are materialized as synthetic call targets,
 *      but GitNexus does not run arbitrary build plugins or external macro
 *      implementations before indexing.
 *   2. **Runtime-only dynamic dispatch** - constant Objective-C selectors and
 *      `@dynamicMemberLookup` subscripts are modeled statically. KVC/KVO,
 *      reflection, dynamically constructed selectors, and other runtime-only
 *      dispatch remain unresolved.
 *   3. **Full Swift type checker semantics** - common `where`/associated-type
 *      equality and typealias paths are resolved structurally. Exhaustive
 *      conditional-conformance proof search and control-flow type checking are
 *      outside the static indexer, matching Python/TypeScript's advanced type
 *      flow limits.
 */
export {
  emitSwiftScopeCaptures,
  interpretSwiftImport,
  interpretSwiftTypeBinding,
  loadSwiftResolutionConfig,
  populateSwiftModuleSiblings,
  resolveSwiftImportTarget,
  resolveSwiftImportTargetForProvider,
  swiftArityCompatibility,
  swiftBindingScopeFor,
  swiftImportOwningScope,
  swiftMergeBindings,
  swiftReceiverBinding,
} from './scope.js';
export { swiftScopeResolver } from './scope-resolver.js';
