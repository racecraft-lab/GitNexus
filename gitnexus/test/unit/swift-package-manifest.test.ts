/**
 * Package.swift manifest parsing (`parseSwiftPackageManifest`).
 *
 * Ported from the fork's `swift-scope.test.ts` (stream-4a CAT-A'): the fork file
 * imported the deleted `languages/swift/scope.js` for its other blocks, so only
 * the manifest describe — which depends solely on the surviving
 * `language-config.js` export — is carried here.
 */
import { describe, expect, it } from 'vitest';
import { parseSwiftPackageManifest } from '../../src/core/ingestion/language-config.js';

describe('Swift Package.swift manifest parsing', () => {
  it('extracts custom target paths, dependencies, and test targets', () => {
    const config = parseSwiftPackageManifest(`
      import PackageDescription

      let package = Package(
        name: "Workspace",
        targets: [
          .target(name: "Core", dependencies: [.target(name: "Models")], path: "Modules/Core"),
          .executableTarget(name: "App", dependencies: ["Core"], path: "Apps/App"),
          .testTarget(name: "CoreTests", dependencies: ["Core"])
        ]
      )
    `);

    expect(config.targets.get('Core')).toBe('Modules/Core');
    expect(config.targets.get('App')).toBe('Apps/App');
    expect(config.targets.get('CoreTests')).toBe('Tests/CoreTests');
    expect(config.targetDependencies?.get('Core')).toEqual(['Models']);
    expect(config.targetDependencies?.get('App')).toEqual(['Core']);
    expect(config.targetKinds?.get('CoreTests')).toBe('testTarget');
  });
});
