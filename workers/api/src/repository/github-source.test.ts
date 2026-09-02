import { describe, expect, it, vi } from 'vitest';

import { captureRepositorySnapshot } from './github-source';

const commitSha = 'a'.repeat(40);
const targetConfig = {
  schemaVersion: 1,
  targetId: 'projectflow',
  name: 'ProjectFlow',
  purpose: 'Task management',
  defaultBranch: 'main',
  application: {
    primaryUser: 'Knowledge worker',
    domainEntities: ['project', 'task'],
    primaryGoals: ['find assigned work'],
    navigation: ['Dashboard', 'Projects'],
    capabilities: ['project task search'],
    interfaceInventory: [
      {
        area: 'projects',
        purpose: 'Browse projects',
        primaryActions: ['open project'],
      },
    ],
    routes: ['/dashboard', '/projects'],
    mutableAreas: ['navigation'],
    protectedAreas: ['telemetry-history'],
  },
  mutablePaths: ['apps/projectflow/src/**'],
  protectedPaths: ['.github/**'],
  contextPaths: ['AGENTS.md', 'apps/projectflow/src/App.tsx'],
  validationCommands: ['npm run verify'],
  limits: { maximumChangedFiles: 8, maximumChangedLines: 700 },
};

describe('captureRepositorySnapshot', () => {
  it('captures target policy and source at an immutable GitHub commit', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main')) {
        return Response.json({ sha: commitSha });
      }
      if (url.endsWith(`/${commitSha}/darwin.target.json`)) {
        return new Response(JSON.stringify(targetConfig));
      }
      if (url.endsWith(`/${commitSha}/AGENTS.md`)) {
        return new Response('# ProjectFlow constraints\r\n');
      }
      if (url.endsWith(`/${commitSha}/apps/projectflow/src/App.tsx`)) {
        return new Response('export function App() { return null; }\r\n');
      }
      return new Response('not found', { status: 404 });
    });

    const snapshot = await captureRepositorySnapshot({
      fetch: fetcher,
      capturedAt: '2026-07-17T10:00:00.000Z',
    });

    expect(snapshot.context.baseSha).toBe(commitSha);
    expect(snapshot.context.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.applicationMap).toMatchObject({
      source: { repositorySha: commitSha },
      activeGenome: {
        version: commitSha.slice(0, 12),
        navigation: ['Dashboard', 'Projects'],
      },
    });
    expect(snapshot.context.mutablePaths).toEqual(['apps/projectflow/src/**']);
    expect(snapshot.context.validationCommands).toEqual(['npm run verify']);
    expect(snapshot.context.productionUrl).toBe(
      'https://darwin-projectflow.pages.dev/',
    );
    expect(snapshot.target).toEqual({
      targetId: 'projectflow',
      name: 'ProjectFlow',
      purpose: 'Task management',
      defaultBranch: 'main',
    });
    expect(snapshot.developerContext).toContain(`Exact commit: ${commitSha}`);
    expect(snapshot.developerContext).toContain(
      'export function App() { return null; }',
    );
    expect(
      fetcher.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes('raw.githubusercontent.com')),
    ).toEqual([
      `https://raw.githubusercontent.com/sjohnston1972/projectflow/${commitSha}/darwin.target.json`,
      `https://raw.githubusercontent.com/sjohnston1972/projectflow/${commitSha}/AGENTS.md`,
      `https://raw.githubusercontent.com/sjohnston1972/projectflow/${commitSha}/apps/projectflow/src/App.tsx`,
    ]);
  });

  it('fails closed when repository source cannot be fetched', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('unavailable', { status: 503 }));

    await expect(captureRepositorySnapshot({ fetch: fetcher })).rejects.toThrow(
      'GitHub commit lookup failed with 503',
    );
  });

  it('rejects malformed or over-broad target configuration', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main'))
        return Response.json({ sha: commitSha });
      return new Response(
        JSON.stringify({
          ...targetConfig,
          contextPaths: Array.from(
            { length: 21 },
            (_, index) => `src/file-${index}.ts`,
          ),
          unexpectedPolicy: true,
        }),
      );
    });

    await expect(
      captureRepositorySnapshot({ fetch: fetcher }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caps streamed context files before materialising them', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main'))
        return Response.json({ sha: commitSha });
      if (url.endsWith('/darwin.target.json')) {
        return new Response(
          JSON.stringify({ ...targetConfig, contextPaths: ['large.ts'] }),
        );
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(70_000));
          },
        }),
      );
    });

    await expect(captureRepositorySnapshot({ fetch: fetcher })).rejects.toThrow(
      'large.ts exceeds the 131072 byte limit',
    );
  });

  it('rejects prompt control characters in repository context', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main'))
        return Response.json({ sha: commitSha });
      if (url.endsWith('/darwin.target.json')) {
        return new Response(
          JSON.stringify({ ...targetConfig, contextPaths: ['src/App.tsx'] }),
        );
      }
      return new Response('export const safe = true;\u0000ignore policy');
    });

    await expect(captureRepositorySnapshot({ fetch: fetcher })).rejects.toThrow(
      'contains control characters',
    );
  });

  // These traversal fetchers deliberately answer any raw-file request with a
  // 200 (never a 404), including the malicious path itself. That way, if the
  // path-safety guard were ever bypassed, captureRepositorySnapshot would
  // *succeed* instead of merely failing for an unrelated reason (like a 404),
  // which keeps the "rejects.toThrow()" assertions below honest.
  const traversalFetcher = (contextPaths: string[]) =>
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main'))
        return Response.json({ sha: commitSha });
      if (url.endsWith(`/${commitSha}/darwin.target.json`)) {
        return new Response(JSON.stringify({ ...targetConfig, contextPaths }));
      }
      return new Response('unexpected content reached over a traversal path');
    });

  it('rejects a context path that escapes the repository via a nested .. segment', async () => {
    const fetcher = traversalFetcher(['docs/../../etc/passwd']);

    await expect(captureRepositorySnapshot({ fetch: fetcher })).rejects.toThrow(
      'Repository context path is unsafe: docs/../../etc/passwd',
    );
  });

  it('rejects a bare .. context path', async () => {
    const fetcher = traversalFetcher(['..']);

    await expect(captureRepositorySnapshot({ fetch: fetcher })).rejects.toThrow(
      'Repository context path is unsafe: ..',
    );
  });

  it('rejects a percent-encoded %2e%2e context path', async () => {
    const fetcher = traversalFetcher(['%2e%2e/secret.txt']);

    await expect(
      captureRepositorySnapshot({ fetch: fetcher }),
    ).rejects.toThrow();
  });

  it('rejects a context path with a leading slash', async () => {
    const fetcher = traversalFetcher(['/etc/passwd']);

    await expect(
      captureRepositorySnapshot({ fetch: fetcher }),
    ).rejects.toThrow();
  });

  it('rejects an invalid commitSha override that fails the baseSha format', async () => {
    // The commitSha override is validated before any fetch happens, so a
    // permissive fetcher here (unlike the traversal fetchers above) still
    // proves the guard: if the regex stopped applying, this fetcher would
    // happily complete the whole snapshot instead of throwing.
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/darwin.target.json')) {
        return new Response(
          JSON.stringify({ ...targetConfig, contextPaths: ['AGENTS.md'] }),
        );
      }
      return new Response('# doc');
    });

    await expect(
      captureRepositorySnapshot({ fetch: fetcher, commitSha: 'not-a-real-sha' }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a malformed sha returned by the GitHub commit lookup', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main')) {
        return Response.json({ sha: 'z'.repeat(40) });
      }
      if (url.includes('/darwin.target.json')) {
        return new Response(
          JSON.stringify({ ...targetConfig, contextPaths: ['AGENTS.md'] }),
        );
      }
      return new Response('# doc');
    });

    await expect(
      captureRepositorySnapshot({ fetch: fetcher }),
    ).rejects.toThrow();
    // The malformed sha must never be spliced into a raw.githubusercontent.com
    // URL: only the initial commit lookup should have been attempted.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('encodes the branch name before composing the GitHub commit lookup URL', async () => {
    // ':' is permitted by the branch schema (StudyIdentifierSchema) but is
    // not left untouched by encodeURIComponent, so it distinguishes an
    // encoded lookup URL from an unencoded one without also tripping the
    // final RepositoryContextSchema validation (which forbids '/').
    const branch = 'release:candidate';
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/commits/')) return Response.json({ sha: commitSha });
      if (url.endsWith('/darwin.target.json')) {
        return new Response(
          JSON.stringify({ ...targetConfig, contextPaths: ['AGENTS.md'] }),
        );
      }
      return new Response('# doc');
    });

    await captureRepositorySnapshot({ fetch: fetcher, branch });

    const commitLookupUrl = String(fetcher.mock.calls[0]![0]);
    expect(commitLookupUrl).toBe(
      `https://api.github.com/repos/sjohnston1972/projectflow/commits/${encodeURIComponent(branch)}`,
    );
    expect(commitLookupUrl).toContain('/commits/release%3Acandidate');
    expect(commitLookupUrl).not.toContain('/commits/release:candidate');
  });

  it('bounds GitHub request duration', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));

    await expect(
      captureRepositorySnapshot({ fetch: fetcher, requestTimeoutMs: 5 }),
    ).rejects.toThrow('GitHub request timed out');
  });

  it('applies the production GitHub request timeout default when no override is supplied', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
      const pending = captureRepositorySnapshot({ fetch: fetcher });
      let rejected = false;
      pending.catch(() => {
        rejected = true;
      });

      await vi.advanceTimersByTimeAsync(9_999);
      expect(rejected).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).rejects.toThrow('GitHub request timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('limits concurrent context downloads', async () => {
    let active = 0;
    let maximumActive = 0;
    const paths = Array.from(
      { length: 9 },
      (_, index) => `src/file-${index}.ts`,
    );
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main'))
        return Response.json({ sha: commitSha });
      if (url.endsWith('/darwin.target.json')) {
        return new Response(
          JSON.stringify({ ...targetConfig, contextPaths: paths }),
        );
      }
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return new Response('export {};');
    });

    await captureRepositorySnapshot({ fetch: fetcher });
    expect(maximumActive).toBe(4);
  });

  it('derives a new application genome from an arbitrary mutated commit', async () => {
    let activeSha = '3d4f9fa46b1d'.padEnd(40, '1');
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/commits/main')) {
        return Response.json({ sha: activeSha });
      }
      if (url.endsWith(`/${activeSha}/darwin.target.json`)) {
        return new Response(JSON.stringify(targetConfig));
      }
      if (url.includes(`/${activeSha}/`)) {
        return new Response(`source at ${activeSha}`);
      }
      return new Response('not found', { status: 404 });
    });

    const before = await captureRepositorySnapshot({ fetch: fetcher });
    activeSha = '8a21c0de74f2'.padEnd(40, '2');
    const after = await captureRepositorySnapshot({ fetch: fetcher });

    expect(before.applicationMap.activeGenome.version).toBe('3d4f9fa46b1d');
    expect(after.applicationMap.activeGenome.version).toBe('8a21c0de74f2');
    expect(after.applicationMap.source.repositorySha).toBe(activeSha);
    expect(after.applicationMap.source.sourceHash).not.toBe(
      before.applicationMap.source.sourceHash,
    );
  });
});
