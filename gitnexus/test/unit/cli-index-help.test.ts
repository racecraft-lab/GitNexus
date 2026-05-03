import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../..');
const cliEntry = path.join(repoRoot, 'src/cli/index.ts');

function runHelp(command: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliEntry, command, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('CLI help surface', () => {
  it('analyze help exposes opt-in cluster enrichment flags', () => {
    const result = runHelp('analyze');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--incremental');
    expect(result.stdout).toContain('--enrich-clusters');
    expect(result.stdout).toContain('--cluster-enrichment-batch-size <n>');
    expect(result.stdout).toContain('GITNEXUS_EMBEDDING_HTTP_BATCH_SIZE=N');
    expect(result.stdout).toContain('GITNEXUS_EMBEDDING_HTTP_CONCURRENCY=N');
    expect(result.stdout).toContain('GITNEXUS_EMBEDDING_HTTP_TIMEOUT_MS=N');
    expect(result.stdout).toContain('GITNEXUS_PROGRESS=plain');
    expect(result.stdout).toContain('GITNEXUS_CLUSTER_ENRICHMENT=1');
  });

  it('query help keeps advanced search options without importing analyze deps', () => {
    const result = runHelp('query');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--context <text>');
    expect(result.stdout).toContain('--goal <text>');
    expect(result.stdout).toContain('--content');
    expect(result.stderr).not.toContain('tree-sitter-kotlin');
  });

  it('context help keeps optional name and disambiguation flags', () => {
    const result = runHelp('context');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('context [options] [name]');
    expect(result.stdout).toContain('--uid <uid>');
    expect(result.stdout).toContain('--file <path>');
  });

  it('impact help keeps repo and include-tests flags', () => {
    const result = runHelp('impact');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--depth <n>');
    expect(result.stdout).toContain('--include-tests');
    expect(result.stdout).toContain('--repo <name>');
  });

  it('detect-changes help exposes compare scope and base-ref flags', () => {
    const result = runHelp('detect-changes');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('gitnexus detect-changes|detect_changes [options]');
    expect(result.stdout).toContain('--scope <scope>');
    expect(result.stdout).toContain('--base-ref <ref>');
    expect(result.stdout).toContain('--repo <name>');
  });

  it('wiki help shows provider, review, and verbose flags', () => {
    const result = runHelp('wiki');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--provider <provider>');
    expect(result.stdout).toContain('--review');
    expect(result.stdout).toContain('-v, --verbose');
    expect(result.stdout).toContain('--model <model>');
    expect(result.stdout).toContain('--gist');
  });
});
