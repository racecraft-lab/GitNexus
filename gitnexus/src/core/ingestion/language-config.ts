import fs from 'fs/promises';
import path from 'path';
import type { ImportConfigs } from './import-resolvers/types.js';

import { isDev } from './utils/env.js';

// ============================================================================
// LANGUAGE-SPECIFIC CONFIG TYPES
// ============================================================================

/** TypeScript path alias config parsed from tsconfig.json */
export interface TsconfigPaths {
  /** Map of alias prefix -> target prefix (e.g., "@/" -> "src/") */
  aliases: Map<string, string>;
  /** Base URL for path resolution (relative to repo root) */
  baseUrl: string;
}

/** Go module config parsed from go.mod */
export interface GoModuleConfig {
  /** Module path (e.g., "github.com/user/repo") */
  modulePath: string;
}

/** PHP Composer PSR-4 autoload config */
export interface ComposerConfig {
  /** Map of namespace prefix -> directory (e.g., "App\\" -> "app/") */
  psr4: Map<string, string>;
  /** PSR-4 entries sorted by namespace length descending (longest match wins).
   *  Cached once at config load time to avoid re-sorting on every import. */
  psr4Sorted?: readonly [string, string][];
}

/** C# project config parsed from .csproj files */
export interface CSharpProjectConfig {
  /** Root namespace from <RootNamespace> or assembly name (default: project directory name) */
  rootNamespace: string;
  /** Directory containing the .csproj file */
  projectDir: string;
}

/** Swift Package Manager module config */
export interface SwiftPackageConfig {
  /** Map of target name -> source directory path (e.g., "SiuperModel" -> "Package/Sources/SiuperModel") */
  targets: Map<string, string>;
  /** Map of target name -> same-package target dependencies. */
  targetDependencies?: Map<string, string[]>;
  /** Map of target name -> SwiftPM target kind. */
  targetKinds?: Map<string, 'target' | 'executableTarget' | 'testTarget'>;
}

// ============================================================================
// LANGUAGE-SPECIFIC CONFIG LOADERS
// ============================================================================

/**
 * Parse tsconfig.json to extract path aliases.
 * Tries tsconfig.json, tsconfig.app.json, tsconfig.base.json in order.
 */
export async function loadTsconfigPaths(repoRoot: string): Promise<TsconfigPaths | null> {
  const candidates = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json'];

  for (const filename of candidates) {
    try {
      const tsconfigPath = path.join(repoRoot, filename);
      const raw = await fs.readFile(tsconfigPath, 'utf-8');
      // Strip JSON comments (// and /* */ style) for robustness
      const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const tsconfig = JSON.parse(stripped);
      const compilerOptions = tsconfig.compilerOptions;
      if (!compilerOptions?.paths) continue;

      const baseUrl = compilerOptions.baseUrl || '.';
      const aliases = new Map<string, string>();

      for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        const target = targets[0] as string;

        // Convert glob patterns: "@/*" -> "@/", "src/*" -> "src/"
        const aliasPrefix = pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern;
        const targetPrefix = target.endsWith('/*') ? target.slice(0, -1) : target;

        aliases.set(aliasPrefix, targetPrefix);
      }

      if (aliases.size > 0) {
        if (isDev) {
          console.log(`📦 Loaded ${aliases.size} path aliases from ${filename}`);
        }
        return { aliases, baseUrl };
      }
    } catch {
      // File doesn't exist or isn't valid JSON - try next
    }
  }

  return null;
}

/**
 * Parse go.mod to extract module path.
 */
export async function loadGoModulePath(repoRoot: string): Promise<GoModuleConfig | null> {
  try {
    const goModPath = path.join(repoRoot, 'go.mod');
    const content = await fs.readFile(goModPath, 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    if (match) {
      if (isDev) {
        console.log(`📦 Loaded Go module path: ${match[1]}`);
      }
      return { modulePath: match[1] };
    }
  } catch {
    // No go.mod
  }
  return null;
}

/** Parse composer.json to extract PSR-4 autoload mappings (including autoload-dev). */
export async function loadComposerConfig(repoRoot: string): Promise<ComposerConfig | null> {
  try {
    const composerPath = path.join(repoRoot, 'composer.json');
    const raw = await fs.readFile(composerPath, 'utf-8');
    const composer = JSON.parse(raw);
    const psr4Raw = composer.autoload?.['psr-4'] ?? {};
    const psr4Dev = composer['autoload-dev']?.['psr-4'] ?? {};
    const merged = { ...psr4Raw, ...psr4Dev };

    const psr4 = new Map<string, string>();
    for (const [ns, dir] of Object.entries(merged)) {
      const nsNorm = (ns as string).replace(/\\+$/, '');
      const dirNorm = (dir as string).replace(/\\/g, '/').replace(/\/+$/, '');
      psr4.set(nsNorm, dirNorm);
    }

    if (isDev) {
      console.log(`📦 Loaded ${psr4.size} PSR-4 mappings from composer.json`);
    }
    return { psr4 };
  } catch {
    return null;
  }
}

/**
 * Parse .csproj files to extract RootNamespace.
 * Scans the repo root for .csproj files and returns configs for each.
 */
export async function loadCSharpProjectConfig(repoRoot: string): Promise<CSharpProjectConfig[]> {
  const configs: CSharpProjectConfig[] = [];
  // BFS scan for .csproj files up to 5 levels deep, cap at 100 dirs to avoid runaway scanning
  const scanQueue: { dir: string; depth: number }[] = [{ dir: repoRoot, depth: 0 }];
  const maxDepth = 5;
  const maxDirs = 100;
  let dirsScanned = 0;

  while (scanQueue.length > 0 && dirsScanned < maxDirs) {
    const { dir, depth } = scanQueue.shift()!;
    dirsScanned++;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && depth < maxDepth) {
          // Skip common non-project directories
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === 'bin' ||
            entry.name === 'obj'
          )
            continue;
          scanQueue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
        if (entry.isFile() && entry.name.endsWith('.csproj')) {
          try {
            const csprojPath = path.join(dir, entry.name);
            const content = await fs.readFile(csprojPath, 'utf-8');
            const nsMatch = content.match(/<RootNamespace>\s*([^<]+)\s*<\/RootNamespace>/);
            const rootNamespace = nsMatch ? nsMatch[1].trim() : entry.name.replace(/\.csproj$/, '');
            const projectDir = path.relative(repoRoot, dir).replace(/\\/g, '/');
            configs.push({ rootNamespace, projectDir });
            if (isDev) {
              console.log(
                `📦 Loaded C# project: ${entry.name} (namespace: ${rootNamespace}, dir: ${projectDir})`,
              );
            }
          } catch {
            // Can't read .csproj
          }
        }
      }
    } catch {
      // Can't read directory
    }
  }
  return configs;
}

export async function loadSwiftPackageConfig(repoRoot: string): Promise<SwiftPackageConfig | null> {
  const targets = new Map<string, string>();
  const targetDependencies = new Map<string, string[]>();
  const targetKinds = new Map<string, 'target' | 'executableTarget' | 'testTarget'>();

  try {
    const manifest = await fs.readFile(path.join(repoRoot, 'Package.swift'), 'utf-8');
    const parsed = parseSwiftPackageManifest(manifest);
    for (const [name, targetPath] of parsed.targets) targets.set(name, targetPath);
    for (const [name, deps] of parsed.targetDependencies ?? new Map()) {
      targetDependencies.set(name, deps);
    }
    for (const [name, kind] of parsed.targetKinds ?? new Map()) targetKinds.set(name, kind);
  } catch {
    // No Package.swift or unreadable manifest — fall back to directory conventions.
  }

  // Swift imports are module-name based (e.g., `import SiuperModel`).
  // SPM conventions include Sources/Source/src/srcs for regular targets
  // and Tests for test targets when the manifest omits a custom path.
  const sourceDirs = ['Sources', 'Source', 'src', 'srcs', 'Package/Sources', 'Tests'];
  for (const sourceDir of sourceDirs) {
    try {
      const fullPath = path.join(repoRoot, sourceDir);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !targets.has(entry.name)) {
          targets.set(entry.name, sourceDir + '/' + entry.name);
          targetDependencies.set(entry.name, []);
          targetKinds.set(entry.name, sourceDir === 'Tests' ? 'testTarget' : 'target');
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  if (targets.size > 0) {
    if (isDev) {
      console.log(`📦 Loaded ${targets.size} Swift package targets`);
    }
    return { targets, targetDependencies, targetKinds };
  }
  return null;
}

export function parseSwiftPackageManifest(manifest: string): SwiftPackageConfig {
  const targets = new Map<string, string>();
  const targetDependencies = new Map<string, string[]>();
  const targetKinds = new Map<string, 'target' | 'executableTarget' | 'testTarget'>();
  const calls = extractSwiftPackageTargetCalls(manifest);

  for (const call of calls) {
    const name = labeledStringArgument(call.body, 'name');
    if (name === null) continue;
    const customPath = labeledStringArgument(call.body, 'path');
    const defaultPath = call.kind === 'testTarget' ? `Tests/${name}` : `Sources/${name}`;
    targets.set(name, normalizeConfigPath(customPath ?? defaultPath));
    targetDependencies.set(name, extractSwiftTargetDependencies(call.body));
    targetKinds.set(name, call.kind);
  }

  return { targets, targetDependencies, targetKinds };
}

function extractSwiftPackageTargetCalls(
  manifest: string,
): Array<{ kind: 'target' | 'executableTarget' | 'testTarget'; body: string }> {
  const out: Array<{ kind: 'target' | 'executableTarget' | 'testTarget'; body: string }> = [];
  const re = /\.(target|executableTarget|testTarget)\s*\(/g;
  for (const match of manifest.matchAll(re)) {
    const kind = match[1] as 'target' | 'executableTarget' | 'testTarget';
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = findBalancedClose(manifest, open, '(', ')');
    if (close === -1) continue;
    out.push({ kind, body: manifest.slice(open + 1, close) });
  }
  return out;
}

function labeledStringArgument(body: string, label: string): string | null {
  const re = new RegExp(`\\b${label}\\s*:\\s*"([^"]+)"`);
  return body.match(re)?.[1] ?? null;
}

function extractSwiftTargetDependencies(body: string): string[] {
  const label = body.search(/\bdependencies\s*:/);
  if (label === -1) return [];
  const open = body.indexOf('[', label);
  if (open === -1) return [];
  const close = findBalancedClose(body, open, '[', ']');
  if (close === -1) return [];
  const text = body.slice(open + 1, close);
  const deps = new Set<string>();
  for (const match of text.matchAll(/"([^"]+)"/g)) deps.add(match[1]!);
  for (const match of text.matchAll(/\.(?:target|byName)\s*\(\s*name\s*:\s*"([^"]+)"/g)) {
    deps.add(match[1]!);
  }
  return [...deps].sort();
}

function findBalancedClose(text: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function normalizeConfigPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

// ============================================================================
// BUNDLED CONFIG LOADER
// ============================================================================

/** Load all language-specific configs once for an ingestion run. */
export async function loadImportConfigs(repoRoot: string): Promise<ImportConfigs> {
  return {
    tsconfigPaths: await loadTsconfigPaths(repoRoot),
    goModule: await loadGoModulePath(repoRoot),
    composerConfig: await loadComposerConfig(repoRoot),
    swiftPackageConfig: await loadSwiftPackageConfig(repoRoot),
    csharpConfigs: await loadCSharpProjectConfig(repoRoot),
  };
}
