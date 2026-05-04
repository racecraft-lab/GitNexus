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
 *     `try`, for-in element types, named closure parameters, and shorthand
 *     closure receivers.
 *   - Class, struct, enum, protocol, actor, extension, associatedtype,
 *     subscript, method, field, annotation, property-wrapper, overload-label,
 *     protocol-dispatch, inherited-member, and field read/write edges.
 *
 * ## Known limitations
 *
 * Swift support intentionally leaves the following unresolved or partially
 * modeled, matching the documented trade-off style used by the Python and
 * TypeScript registry-primary paths.
 *
 *   1. **Generated declarations** - Swift macros and build-plugin generated
 *      code are not expanded before indexing.
 *   2. **Runtime dynamic dispatch** - Objective-C selectors, KVC/KVO,
 *      `@dynamicMemberLookup`, and reflection-driven calls are not followed.
 *   3. **Conditional compilation** - `#if canImport(...)` / platform guards
 *      are parsed as source text; GitNexus does not evaluate active build
 *      conditions per target.
 *   4. **Advanced generic constraints** - conditional conformances,
 *      `where` clauses, protocol-composition aliases, and associated-type
 *      equality constraints are indexed structurally but not expanded into
 *      alternate dispatch branches.
 *   5. **Pattern-heavy type flow** - tuple destructuring, switch/case pattern
 *      bindings, and `while let` iterator bindings do not currently propagate
 *      receiver types.
 *   6. **Nonstandard callable declarations** - operator overloads, enum case
 *      constructor calls, and `deinit` declarations are not first-class call
 *      targets in the scope resolver.
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
