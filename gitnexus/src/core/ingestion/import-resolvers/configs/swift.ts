/**
 * Swift import resolution config.
 * Package.swift target map strategy — no standard fallback (unresolved = external framework).
 *
 * ## Performance (anti-O(imports × files))
 *
 * The previous implementation rescanned the whole `normalizedFileList`
 * on every import to collect the `.swift` files under the requested
 * target's directory — O(imports × files) per run, the exact hot path
 * fixed for Python in PR #1918. We now build a `target → files` index
 * ONCE per run, memoized on the stable `allFileList` array reference
 * (the same `ResolveCtx` — and therefore the same array — is passed to
 * every strategy invocation, per `import-processor`'s build-once
 * context). Lookup per import is then O(1).
 *
 * Behavior is preserved bit-for-bit: a file is attributed to a target
 * iff its **forward-slash (backslash-normalized), case-sensitive** path
 * starts with `<targetDir>/`, matching the old
 * `normalizedFileList[i].startsWith(targetDir + '/')` comparison
 * (`normalizedFileList` is only backslash→forward-slash normalized — NOT
 * lowercased — so the match is case-sensitive); the returned paths are
 * the original-case `allFileList` entries; and the per-target file ORDER
 * follows `allFileList`, so the emitted `{ kind: 'files', files }` set and
 * ordering are identical to the old scan.
 */

import { SupportedLanguages } from 'gitnexus-shared';
import type { ImportResolutionConfig, ImportResolverStrategy, ResolveCtx } from '../types.js';

interface SwiftTargetIndex {
  /** Target name → original-case `.swift` file paths under that target dir. */
  readonly byTarget: ReadonlyMap<string, string[]>;
}

/**
 * Memoized on the `allFileList` array identity. `import-processor` builds
 * the `ResolveCtx` once per run and threads the same object (and the same
 * `allFileList`) through every strategy call, so the WeakMap is keyed on a
 * stable reference and the index is built once — not once per import. A
 * fresh run produces a fresh array → a fresh index, so cross-run staleness
 * is impossible.
 */
const SWIFT_TARGET_INDEX_CACHE = new WeakMap<object, SwiftTargetIndex>();

function getSwiftTargetIndex(
  ctx: ResolveCtx,
  targets: ReadonlyMap<string, string>,
): SwiftTargetIndex {
  const key = ctx.allFileList as object;
  const cached = SWIFT_TARGET_INDEX_CACHE.get(key);
  if (cached !== undefined) return cached;

  // Pre-compute each target's directory prefix once (original case, to
  // match the legacy comparison against the forward-slash-normalized,
  // case-sensitive file list — see module docstring).
  const targetPrefixes: { name: string; prefix: string }[] = [];
  const byTarget = new Map<string, string[]>();
  for (const [name, dir] of targets) {
    targetPrefixes.push({ name, prefix: dir + '/' });
    byTarget.set(name, []);
  }

  // Single pass over the file list. `normalizedFileList` is forward-slash
  // (backslash-normalized), case-sensitive, and index-aligned with
  // `allFileList`; attribute the original-case path to every target whose
  // prefix the normalized path starts with (a file under a nested target
  // dir can legitimately belong to multiple configured targets — the
  // legacy per-import scan would have returned it for each).
  for (let i = 0; i < ctx.allFileList.length; i++) {
    const norm = ctx.normalizedFileList[i];
    if (!norm.endsWith('.swift')) continue;
    for (const { name, prefix } of targetPrefixes) {
      if (norm.startsWith(prefix)) {
        byTarget.get(name)!.push(ctx.allFileList[i]);
      }
    }
  }

  const index: SwiftTargetIndex = { byTarget };
  SWIFT_TARGET_INDEX_CACHE.set(key, index);
  return index;
}

/**
 * Split a Swift import path into its module segment and an optional
 * declaration segment. `Models` → `{ moduleName: 'Models', declarationName: null }`;
 * `Models.User` (an `import struct Models.User` decl-import) →
 * `{ moduleName: 'Models', declarationName: 'User' }`.
 */
function splitSwiftImportPath(rawImportPath: string): {
  moduleName: string;
  declarationName: string | null;
} {
  const parts = rawImportPath.split('.').filter(Boolean);
  return {
    moduleName: parts[0] ?? rawImportPath,
    declarationName: parts.length > 1 ? parts[1] : null,
  };
}

/** Basename of a forward-slash path with the `.swift` extension stripped. */
function swiftBasenameWithoutExtension(normalizedPath: string): string {
  const slashIndex = normalizedPath.lastIndexOf('/');
  const basename = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  return basename.replace(/\.swift$/i, '');
}

/** Swift Package.swift target map resolution strategy. */
export const swiftPackageStrategy: ImportResolverStrategy = (rawImportPath, _filePath, ctx) => {
  const swiftPackageConfig = ctx.configs.swiftPackageConfig;
  if (swiftPackageConfig) {
    // Decompose `Module.Decl` decl-imports; whole-module imports have a null
    // declaration segment. Look up on the module segment (not the raw path)
    // so `Models.User` still resolves against the `Models` target.
    const { moduleName, declarationName } = splitSwiftImportPath(rawImportPath);
    // Only the targets map is needed; build the index lazily so repos
    // without a Package.swift config pay nothing.
    if (swiftPackageConfig.targets.has(moduleName)) {
      const index = getSwiftTargetIndex(ctx, swiftPackageConfig.targets);
      const files = index.byTarget.get(moduleName);
      if (files !== undefined && files.length > 0) {
        if (declarationName !== null) {
          // Narrow an explicit declaration import to the source file whose
          // basename matches the declaration (case-sensitive). The per-target
          // bucket order follows `allFileList`, so ordering is preserved.
          const narrowed = files.filter(
            (file) => swiftBasenameWithoutExtension(file.replace(/\\/g, '/')) === declarationName,
          );
          return narrowed.length > 0 ? { kind: 'files', files: narrowed } : null;
        }
        // Copy so callers can't mutate the cached index bucket.
        return { kind: 'files', files: [...files] };
      }
    }
  }
  return null; // External framework (Foundation, UIKit, etc.)
};

export const swiftImportConfig: ImportResolutionConfig = {
  language: SupportedLanguages.Swift,
  strategies: [swiftPackageStrategy],
};
