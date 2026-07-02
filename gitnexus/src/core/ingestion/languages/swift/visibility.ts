/**
 * Swift cross-module visibility gating for the `isCallableVisibleFromCaller`
 * hook (free-call fallback, `pickUniqueGlobalCallable`).
 *
 * Swift's access control is MODULE-scoped (an SPM *target*), not file-scoped:
 *   - `public` / `open`  — visible everywhere (any importing target).
 *   - `internal` (the default) / `package` — visible only within the same
 *     module, OR to a target that `@testable import`s the module.
 *   - `private` / `fileprivate` — visible only within the declaring file.
 *
 * The `isCallableVisibleFromCaller` hook only receives the caller's
 * `ParsedFile` and the candidate `SymbolDefinition`, which is not enough to
 * compute SPM-target membership. So — mirroring PHP's `namespaceByFilePath`
 * side-channel — `populateSwiftTargetSiblings` seeds these caches during its
 * whole-module-visibility pass (it already groups files by SPM target), and
 * the hook reads them. Cleared + reseeded every resolution so no stale entry
 * leaks across runs.
 */

import type { ParsedFile, ScopeId, SymbolDefinition } from 'gitnexus-shared';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';

/** filePath → SPM target name (the module). Every parsed Swift file gets an
 *  entry; files outside any configured target share the `__default__` bucket,
 *  so same-`__default__` files count as one module (flat-fixture behavior). */
const targetByFilePath = new Map<string, string>();

/** filePath → set of module names the file `@testable import`s. */
const testableModulesByFile = new Map<string, Set<string>>();

/** Seed the visibility caches from the SPM-target grouping already computed by
 *  `populateSwiftTargetSiblings`. `filesByTarget` maps target name → files. */
export function seedSwiftVisibilityCaches(
  filesByTarget: ReadonlyMap<string, ReadonlyArray<{ readonly filePath: string }>>,
  fileContents: ReadonlyMap<string, string>,
): void {
  targetByFilePath.clear();
  testableModulesByFile.clear();
  for (const [targetName, group] of filesByTarget) {
    for (const f of group) targetByFilePath.set(f.filePath, targetName);
  }
  for (const [filePath, content] of fileContents) {
    const mods = extractTestableModules(content);
    if (mods.size > 0) testableModulesByFile.set(filePath, mods);
  }
}

/** Extract the module names of every `@testable import X` in a file. */
function extractTestableModules(content: string): Set<string> {
  const out = new Set<string>();
  const re = /@testable\s+import\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.add(m[1]!);
  return out;
}

/**
 * `ScopeResolver.isCallableVisibleFromCaller` for Swift. Returns `false` when
 * the caller cannot legally reach the candidate free function under Swift
 * access control, so the free-call fallback suppresses the edge.
 */
export function swiftIsCallableVisibleFromCaller(ctx: {
  readonly callerParsed: ParsedFile;
  readonly candidate: SymbolDefinition;
  readonly callerScope?: ScopeId;
  readonly scopes?: ScopeResolutionIndexes;
}): boolean {
  const vis = ctx.candidate.visibility;
  // Unstamped (non-Swift or pre-visibility) or public → always visible.
  if (vis === undefined || vis === 'public' || vis === 'open') return true;

  const callerFile = ctx.callerParsed.filePath;
  const candFile = ctx.candidate.filePath;
  // Same file: everything is visible (`private` / `fileprivate` included).
  if (callerFile === candFile) return true;

  const callerTarget = targetByFilePath.get(callerFile);
  const candTarget = targetByFilePath.get(candFile);

  // Same module, different file: `internal` / `package` are visible;
  // `private` / `fileprivate` are file-scoped and are not.
  if (callerTarget !== undefined && callerTarget === candTarget) {
    return vis !== 'private' && vis !== 'fileprivate';
  }

  // Cross-module: only `internal` / `package` can cross, and only via a
  // `@testable import` of the candidate's module.
  if (vis === 'internal' || vis === 'package') {
    const testable = testableModulesByFile.get(callerFile);
    return testable !== undefined && candTarget !== undefined && testable.has(candTarget);
  }

  // Cross-module `private` / `fileprivate` — never visible.
  return false;
}
