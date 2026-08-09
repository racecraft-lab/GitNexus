/**
 * Suffix-index helpers for import path resolution.
 */

/** All file extensions to try during resolution */
export const EXTENSIONS = [
  '',
  // TypeScript/JavaScript
  '.tsx',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
  // Python
  '.py',
  '/__init__.py',
  // Java
  '.java',
  // Kotlin
  '.kt',
  '.kts',
  // C/C++
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cxx',
  '.hxx',
  '.hh',
  '.cu',
  '.cuh',
  // C#
  '.cs',
  // Go
  '.go',
  // Rust
  '.rs',
  '/mod.rs',
  // PHP
  '.php',
  '.phtml',
  // Swift
  '.swift',
  // Ruby
  '.rb',
];

/**
 * Try to match a path (with extensions) against the known file set.
 * Returns the matched file path or null.
 */
export function tryResolveWithExtensions(
  basePath: string,
  allFiles: ReadonlySet<string>,
): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Build a suffix index for O(1) endsWith lookups.
 * Maps every possible path suffix to its original file path.
 * e.g. for "src/com/example/Foo.java":
 *   "Foo.java" -> "src/com/example/Foo.java"
 *   "example/Foo.java" -> "src/com/example/Foo.java"
 *   "com/example/Foo.java" -> "src/com/example/Foo.java"
 *   etc.
 */
export interface SuffixIndex {
  /** Exact suffix lookup (case-sensitive) */
  get(suffix: string): string | undefined;
  /** Case-insensitive suffix lookup */
  getInsensitive(suffix: string): string | undefined;
  /** Get all files in a directory suffix */
  getFilesInDir(dirSuffix: string, extension: string): string[];
}

export function buildSuffixIndex(normalizedFileList: string[], allFileList: string[]): SuffixIndex {
  // Map: normalized suffix -> original file path
  const exactMap = new Map<string, string>();
  // Map: lowercase suffix -> original file path
  const lowerMap = new Map<string, string>();
  // Map: directory suffix -> list of file paths in that directory
  const dirMap = new Map<string, string[]>();

  for (let i = 0; i < normalizedFileList.length; i++) {
    const normalized = normalizedFileList[i];
    const original = allFileList[i];
    const parts = normalized.split('/');

    // Index all suffixes: "a/b/c.java" -> ["c.java", "b/c.java", "a/b/c.java"]
    for (let j = parts.length - 1; j >= 0; j--) {
      const suffix = parts.slice(j).join('/');
      // Keep the FIRST file inserted for a given suffix. Note this is
      // insertion order (i.e. the caller's file-list order), NOT "longest path
      // wins" as an earlier comment here claimed — for a colliding suffix the
      // winner is arbitrary. Callers that cannot tolerate an arbitrary winner
      // should constrain the candidate suffixes they ask for; see
      // `requireDirectorySegment` on suffixResolve.
      if (!exactMap.has(suffix)) {
        exactMap.set(suffix, original);
      }
      const lower = suffix.toLowerCase();
      if (!lowerMap.has(lower)) {
        lowerMap.set(lower, original);
      }
    }

    // Index directory membership
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash >= 0) {
      // Build all directory suffixes
      const dirParts = parts.slice(0, -1);
      const fileName = parts[parts.length - 1];
      const ext = fileName.substring(fileName.lastIndexOf('.'));

      for (let j = dirParts.length - 1; j >= 0; j--) {
        const dirSuffix = dirParts.slice(j).join('/');
        const key = `${dirSuffix}:${ext}`;
        let list = dirMap.get(key);
        if (!list) {
          list = [];
          dirMap.set(key, list);
        }
        list.push(original);
      }
    }
  }

  return {
    get: (suffix: string) => exactMap.get(suffix),
    getInsensitive: (suffix: string) => lowerMap.get(suffix.toLowerCase()),
    getFilesInDir: (dirSuffix: string, extension: string) => {
      return dirMap.get(`${dirSuffix}:${extension}`) || [];
    },
  };
}

/**
 * Suffix-based resolution using index. O(1) per lookup instead of O(files).
 *
 * `requireDirectorySegment` (opt-in) rejects any candidate suffix that is a
 * BARE FILENAME with no directory component — `index.tsx`, `types.ts`. The
 * suffix loop walks progressively shorter suffixes, so its final iteration
 * degenerates to matching on the last path segment alone, and for languages
 * whose bare specifiers name PACKAGES rather than paths that match is always a
 * coincidence. Left unguarded it fabricates edges: in a real monorepo,
 * `import { GraphQLError } from 'graphql/index'` resolved to
 * `apps/frontend/src/index.tsx` purely because both end in `index`, and
 * `@jest/types` resolved to an unrelated `types.ts` in another package. Because
 * `EXTENSIONS` also contains `/index.*` entries, a legitimate workspace hit like
 * `@repo/typescript-config` -> `typescript-config/index.ts` still carries a
 * separator and survives the guard, so specificity is preserved rather than
 * traded away.
 *
 * Opt-in rather than default: for Python and the JVM languages a bare-filename
 * match is legitimate (`import config` -> `config.py`), and Python resolves
 * proximity-first before reaching here.
 */
export function suffixResolve(
  pathParts: string[],
  normalizedFileList: string[],
  allFileList: string[],
  index?: SuffixIndex,
  requireDirectorySegment = false,
): string | null {
  const admissible = (suffixWithExt: string): boolean =>
    !requireDirectorySegment || suffixWithExt.includes('/');

  if (index) {
    for (let i = 0; i < pathParts.length; i++) {
      const suffix = pathParts.slice(i).join('/');
      for (const ext of EXTENSIONS) {
        const suffixWithExt = suffix + ext;
        if (!admissible(suffixWithExt)) continue;
        const result = index.get(suffixWithExt) || index.getInsensitive(suffixWithExt);
        if (result) return result;
      }
    }
    return null;
  }

  // Fallback: linear scan (for backward compatibility)
  for (let i = 0; i < pathParts.length; i++) {
    const suffix = pathParts.slice(i).join('/');
    for (const ext of EXTENSIONS) {
      const suffixWithExt = suffix + ext;
      if (!admissible(suffixWithExt)) continue;
      const suffixPattern = '/' + suffixWithExt;
      const matchIdx = normalizedFileList.findIndex(
        (filePath) =>
          filePath.endsWith(suffixPattern) ||
          filePath.toLowerCase().endsWith(suffixPattern.toLowerCase()),
      );
      if (matchIdx !== -1) {
        return allFileList[matchIdx];
      }
    }
  }
  return null;
}
