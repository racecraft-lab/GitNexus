/**
 * Capture-match → semantic-shape interpreters for Swift.
 *
 *   - `interpretSwiftImport`      → `ParsedImport`
 *   - `interpretSwiftTypeBinding`  → `ParsedTypeBinding`
 *
 * Import matches arrive pre-decomposed by `emitSwiftScopeCaptures` (one
 * import per match, with synthesized `@import.kind/source/name` markers
 * and an optional `@import.testable` flag). Type-binding matches arrive
 * from the raw query captures — each `@type-binding.*` anchor carries
 * `@type-binding.name` + `@type-binding.type`.
 */

import type { CaptureMatch, ParsedImport, ParsedTypeBinding, TypeRef } from 'gitnexus-shared';

// ─── interpretImport ──────────────────────────────────────────────────────

export function interpretSwiftImport(captures: CaptureMatch): ParsedImport | null {
  const sourceCap = captures['@import.source'];
  if (sourceCap === undefined) return null;

  // Swift imports are whole-module (wildcard semantics): `import Foundation`
  // brings the entire module into scope, no named members. The SPM target
  // (first dotted segment) is the resolution target; the full path is kept
  // as importedName for reference. `@testable` resolves identically to a
  // plain import (same module is visible in test scope).
  const source = sourceCap.text;
  const fullPath = captures['@import.name']?.text ?? source;
  return {
    kind: 'namespace',
    localName: source,
    importedName: fullPath,
    targetRaw: source,
  };
}

// ─── interpretTypeBinding ─────────────────────────────────────────────────

export function interpretSwiftTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null {
  const nameCap = captures['@type-binding.name'];
  const typeCap = captures['@type-binding.type'];
  if (nameCap === undefined || typeCap === undefined) return null;

  // Normalize so receiver-typed resolution treats these identically:
  //   `User?` / `User!`                 → User   (optional / IUO)
  //   `[User]`                          → User   (array sugar)
  //   `Array<User>` / `Optional<User>`  → User   (single-arg generic)
  //   `Array<Optional<User>>` / `[User?]` → User (nested single-arg wrappers,
  //                                        unwrapped to a fixpoint)
  //   `Foundation.URL`                  → URL    (qualifier)
  // Multi-arg generics (`Result<T, E>`, `Dictionary<K, V>`) and dictionary
  // literals (`[K: V]`) are DELIBERATELY left alone — element semantics aren't
  // unambiguous (accepted upstream divergence, sync ledger §4z / CAT-B #12).
  const rawType = normalizeSwiftTypeName(typeCap.text.trim());

  let source: TypeRef['source'] = 'parameter-annotation';
  if (captures['@type-binding.self'] !== undefined) source = 'self';
  else if (captures['@type-binding.constructor'] !== undefined) source = 'constructor-inferred';
  else if (captures['@type-binding.annotation'] !== undefined) source = 'annotation';
  else if (captures['@type-binding.alias'] !== undefined) source = 'assignment-inferred';
  else if (captures['@type-binding.return'] !== undefined) source = 'return-annotation';

  return { boundName: nameCap.text, rawTypeName: rawType, source };
}

/** `User?` / `User!` → `User`. */
function stripOptional(text: string): string {
  if (text.endsWith('?') || text.endsWith('!')) return text.slice(0, -1).trim();
  return text;
}

/** `[User]` → `User` (array sugar). `[K: V]` (dictionary) is left alone —
 *  element semantics aren't unambiguous. */
function stripArraySugar(text: string): string {
  if (text.startsWith('[') && text.endsWith(']') && !text.includes(':')) {
    return text.slice(1, -1).trim();
  }
  return text;
}

/**
 * Unwrap a single-arg generic collection wrapper — `Array<User>`,
 * `Optional<User>`, `Set<User>` — to its element type. Mirrors C#'s
 * `stripGeneric`. Multi-arg generics (`Dictionary<K, V>`, `Result<T, E>`) are
 * left alone: the balanced inner is unwrapped only when it holds a SINGLE type
 * argument (no top-level comma), so a nested `Array<Optional<User>>` peels one
 * layer here and the rest resolves via the `normalizeSwiftTypeName` fixpoint.
 */
function stripGeneric(text: string): string {
  const m = text.match(
    /^(?:[A-Za-z_][A-Za-z0-9_.]*\.)?(?:Array|Optional|Set|ContiguousArray|ArraySlice)<(.+)>$/,
  );
  if (m === null) return text;
  const inner = m[1].trim();
  return hasTopLevelComma(inner) ? text : inner;
}

/** True when `s` contains a comma outside every `<>` / `[]` / `()` bracket —
 *  i.e. it holds more than one top-level type argument. */
function hasTopLevelComma(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '<' || ch === '[' || ch === '(') depth++;
    else if (ch === '>' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

/**
 * Fixpoint-normalize a Swift type spelling to its receiver-resolution base by
 * repeatedly peeling optional (`?`/`!`), array sugar (`[T]`), single-arg
 * generic wrappers, and module qualifiers until stable. Iterating handles
 * nested single-arg wrappers (`Array<Optional<User>>`, `[User?]`) that a single
 * pass would leave partly wrapped. Bounded so a pathological spelling can't
 * loop. Multi-arg generics and dictionary literals are fixed points (unchanged)
 * by construction — see `stripGeneric` / `stripArraySugar`.
 */
function normalizeSwiftTypeName(text: string): string {
  let current = text;
  for (let i = 0; i < 8; i++) {
    const next = stripQualifier(stripGeneric(stripArraySugar(stripOptional(current))));
    if (next === current) break;
    current = next;
  }
  return current;
}

/** `Foundation.URL` → `URL`. */
function stripQualifier(text: string): string {
  const lastDot = text.lastIndexOf('.');
  if (lastDot === -1) return text;
  return text.slice(lastDot + 1);
}
