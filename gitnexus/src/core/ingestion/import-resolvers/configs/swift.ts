/**
 * Swift import resolution config.
 * Package.swift target map strategy — no standard fallback (unresolved = external framework).
 */

import { SupportedLanguages } from 'gitnexus-shared';
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';

const splitSwiftImportPath = (
  rawImportPath: string,
): { moduleName: string; declarationName: string | null } | null => {
  const parts = rawImportPath.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  return {
    moduleName: parts[0],
    declarationName: parts.length > 1 ? parts[1] : null,
  };
};

const swiftBasenameWithoutExtension = (normalizedPath: string): string => {
  const slashIndex = normalizedPath.lastIndexOf('/');
  const basename = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  return basename.replace(/\.swift$/i, '');
};

/** Swift Package.swift target map resolution strategy. */
export const swiftPackageStrategy: ImportResolverStrategy = (rawImportPath, _filePath, ctx) => {
  const swiftPackageConfig = ctx.configs.swiftPackageConfig;
  if (swiftPackageConfig) {
    const importPath = splitSwiftImportPath(rawImportPath);
    if (!importPath) return null;
    const targetDir = swiftPackageConfig.targets.get(importPath.moduleName);
    if (targetDir) {
      const normalizedTargetDir = targetDir.replace(/\\/g, '/').replace(/\/+$/, '');
      const dirPrefix = normalizedTargetDir + '/';
      const targetFiles: { file: string; normalized: string }[] = [];
      for (let i = 0; i < ctx.normalizedFileList.length; i++) {
        if (
          ctx.normalizedFileList[i].startsWith(dirPrefix) &&
          ctx.normalizedFileList[i].endsWith('.swift')
        ) {
          targetFiles.push({ file: ctx.allFileList[i], normalized: ctx.normalizedFileList[i] });
        }
      }
      if (targetFiles.length === 0) return null;
      if (importPath.declarationName) {
        const declarationFiles = targetFiles
          .filter(
            ({ normalized }) =>
              swiftBasenameWithoutExtension(normalized) === importPath.declarationName,
          )
          .map(({ file }) => file);
        return declarationFiles.length > 0 ? { kind: 'files', files: declarationFiles } : null;
      }
      return { kind: 'files', files: targetFiles.map(({ file }) => file) };
    }
  }
  return null; // External framework (Foundation, UIKit, etc.)
};

export const swiftImportConfig: ImportResolutionConfig = {
  language: SupportedLanguages.Swift,
  strategies: [swiftPackageStrategy],
};
