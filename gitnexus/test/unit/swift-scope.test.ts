import { describe, expect, it } from 'vitest';
import type { Capture, CaptureMatch } from 'gitnexus-shared';
import { parseSwiftPackageManifest } from '../../src/core/ingestion/language-config.js';
import { interpretSwiftTypeBinding } from '../../src/core/ingestion/languages/swift/scope.js';

function cap(name: string, text: string): Capture {
  return {
    name,
    text,
    range: { startLine: 0, startCol: 0, endLine: 0, endCol: text.length },
  };
}

function typeBinding(type: string): CaptureMatch {
  return {
    '@type-binding.annotation': cap('@type-binding.annotation', type),
    '@type-binding.name': cap('@type-binding.name', 'value'),
    '@type-binding.type': cap('@type-binding.type', type),
  };
}

describe('Swift scope type normalization', () => {
  it('unwraps nested collection and optional wrappers with balanced generic parsing', () => {
    expect(interpretSwiftTypeBinding(typeBinding('Array<Optional<User>>'))?.rawTypeName).toBe(
      'User',
    );
    expect(interpretSwiftTypeBinding(typeBinding('[String: Optional<User>]'))?.rawTypeName).toBe(
      'User',
    );
  });

  it('unwraps Result by success type instead of the error argument', () => {
    expect(
      interpretSwiftTypeBinding(typeBinding('Result<User, RepositoryError>'))?.rawTypeName,
    ).toBe('User');
  });
});

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
