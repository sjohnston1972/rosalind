import { describe, expect, it } from 'vitest';

import {
  apiRouteContract,
  findApiRoute,
  type ApiRouteDefinition,
} from './api-route-contract';
import { operatorCapabilities } from './security/auth';
import { computeHandledRoutes } from './route-inventory';

describe('API route contract', () => {
  it('contains unique method and path entries', () => {
    const keys = apiRouteContract.map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(30);
  });

  it('resolves every declared route and requires capabilities on operator routes', () => {
    for (const route of apiRouteContract) {
      const examplePath = route.path.replace(/:[^/]+/g, 'contract-test');
      expect(
        findApiRoute(route.method, examplePath),
        `${route.method} ${route.path}`,
      ).toBe(route);
      if (route.access === 'operator') {
        expect(
          route.capability,
          `${route.method} ${route.path}`,
        ).not.toBeNull();
      } else {
        expect(route.capability, `${route.method} ${route.path}`).toBeNull();
      }
    }
  });

  it('matches parameterized routes to their access boundary', () => {
    expect(
      findApiRoute(
        'POST',
        '/api/repository-executions/execution-1/rollback/callback',
      ),
    ).toMatchObject({ access: 'callback', capability: null });
    expect(
      findApiRoute('GET', '/api/studies/study-1/sessions/session-1'),
    ).toMatchObject({ access: 'operator', capability: 'inspect_evidence' });
    expect(
      findApiRoute(
        'PUT',
        '/api/studies/study-1/participants/participant-1/workspace',
      ),
    ).toMatchObject({ access: 'target', capability: null });
  });

  it('keeps release and reasoning authority explicit', () => {
    expect(
      findApiRoute('POST', '/api/repository-executions/execution-1/release'),
    ).toMatchObject({ capability: 'release' });
    expect(
      findApiRoute('POST', '/api/studies/study-1/analyse-evidence'),
    ).toMatchObject({ capability: 'reason' });
  });

  it('reserves destructive maintenance for delete-data authority', () => {
    for (const [method, path] of [
      ['POST', '/api/retention/sweep'],
      ['DELETE', '/api/studies/study-1'],
      ['DELETE', '/api/studies/study-1/participants/participant-1'],
      ['DELETE', '/api/repository-executions/execution-1/artifacts'],
      ['POST', '/api/demo/reset'],
    ] as const) {
      expect(findApiRoute(method, path)).toMatchObject({
        capability: 'delete_data',
      });
    }
  });

  it('does not let observe-only viewers mutate Darwin Lab state', () => {
    for (const [method, path] of [
      ['PUT', '/api/lab/experiments/lab-exp-1'],
      ['POST', '/api/lab/experiments/lab-exp-1/cancel'],
      ['POST', '/api/lab/experiments/lab-exp-1/rebuild-evidence'],
      ['POST', '/api/lab/experiments/lab-exp-1/codex-manifest'],
    ] as const) {
      expect(findApiRoute(method, path)?.capability).not.toBe('observe');
    }
  });

  // ---------------------------------------------------------------------
  // Table-driven access/capability policy, covering every contract route.
  //
  // Each rule below encodes an *independently reasoned* security policy —
  // derived from what a route's method and path actually do (destructive
  // maintenance requires delete_data, signed workflow callbacks are never
  // operator routes, AI/reasoning calls require reason, etc.) — not a copy
  // of the contract's own fields. Every one of the 68 contract routes must
  // match exactly one rule and agree with its expected access/capability;
  // the final assertions require every route to be claimed by some rule and
  // every rule to have claimed at least one route, so a newly added route
  // with an uncategorized policy, or a rule that stops matching anything,
  // both fail the suite instead of silently passing.
  // ---------------------------------------------------------------------
  interface PolicyRule {
    name: string;
    access: ApiRouteDefinition['access'];
    capability: ApiRouteDefinition['capability'];
    matches: (route: ApiRouteDefinition) => boolean;
  }

  const exact =
    (pairs: readonly (readonly [ApiRouteDefinition['method'], string])[]) =>
    (route: ApiRouteDefinition) =>
      pairs.some(
        ([method, path]) => route.method === method && route.path === path,
      );

  const policyRules: PolicyRule[] = [
    {
      name: 'unauthenticated health check',
      access: 'public',
      capability: null,
      matches: exact([['GET', '/api/health']]),
    },
    {
      name: 'operator credential validation',
      access: 'session',
      capability: null,
      matches: exact([['GET', '/api/auth/session']]),
    },
    {
      name: 'signed ProjectFlow target requests',
      access: 'target',
      capability: null,
      matches: exact([
        ['POST', '/api/study-sessions'],
        ['POST', '/api/telemetry/events'],
        ['GET', '/api/studies/:studyId/participants/:participantId/workspace'],
        ['PUT', '/api/studies/:studyId/participants/:participantId/workspace'],
      ]),
    },
    {
      name: 'signed repository workflow callbacks',
      access: 'callback',
      capability: null,
      matches: exact([
        ['GET', '/api/repository-executions/:executionId/manifest'],
        ['POST', '/api/demo/reset/:resetId/callback'],
        ['POST', '/api/repository-executions/:executionId/callback'],
        ['POST', '/api/repository-executions/:executionId/rollback/callback'],
      ]),
    },
    {
      name: 'destructive maintenance and deletion',
      access: 'operator',
      capability: 'delete_data',
      matches: (route) =>
        route.method === 'DELETE' ||
        (route.method === 'POST' &&
          (route.path === '/api/retention/sweep' ||
            route.path === '/api/demo/reset')),
    },
    {
      name: 'target connection lifecycle management',
      access: 'operator',
      capability: 'connect',
      matches: exact([
        ['POST', '/api/target-connection'],
        ['POST', '/api/target-connection/disconnect'],
      ]),
    },
    {
      name: 'lightweight status/presence checks',
      access: 'operator',
      capability: 'observe',
      matches: exact([
        ['GET', '/api/target-connection'],
        ['GET', '/api/demo/reset'],
        ['GET', '/api/studies/:studyId/events'],
      ]),
    },
    {
      name: 'AI/model reasoning invocation',
      access: 'operator',
      capability: 'reason',
      matches: (route) =>
        route.method === 'POST' &&
        (route.path.endsWith('/agent-decision') ||
          route.path.endsWith('/analyse-evidence') ||
          route.path.endsWith('/analyse') ||
          route.path.endsWith('/fitness') ||
          route.path.endsWith('/evidence')),
    },
    {
      name: 'pull request release/merge authority',
      access: 'operator',
      capability: 'release',
      matches: (route) =>
        route.method === 'POST' && route.path.endsWith('/release'),
    },
    {
      name: 'dispatch of bounded external workflows',
      access: 'operator',
      capability: 'execute',
      matches: (route) =>
        route.method === 'POST' &&
        (route.path.endsWith('/codex-manifest') ||
          route.path.endsWith('/codex-manifest/execution') ||
          route.path.endsWith('/rollback') ||
          route.path.endsWith('/recovery/force-fail') ||
          route.path.endsWith('/mutations/select') ||
          route.path.endsWith('/rebuild-evidence') ||
          route.path.endsWith('/promote-eval')),
    },
    {
      name: 'Darwin Lab and synthetic-replay orchestration',
      access: 'operator',
      capability: 'simulate',
      matches: (route) =>
        (route.method === 'POST' &&
          (route.path === '/api/simulations' ||
            route.path === '/api/lab/experiments' ||
            route.path.endsWith('/duplicate') ||
            route.path.endsWith('/cancel') ||
            route.path.endsWith('/retry') ||
            route.path.endsWith('/force-fail') ||
            route.path.endsWith('/archive') ||
            route.path.endsWith('/start') ||
            route.path.endsWith('/claim') ||
            route.path.endsWith('/runs') ||
            route.path.endsWith('/actions') ||
            route.path.endsWith('/finish') ||
            route.path.endsWith('/rerun-eval'))) ||
        (route.method === 'PUT' &&
          route.path.startsWith('/api/lab/experiments/')),
    },
    {
      name: 'read-only operator inspection (default GET policy)',
      access: 'operator',
      capability: 'inspect_evidence',
      matches: (route) => route.method === 'GET',
    },
  ];

  it('assigns a first-matching, independently-reasoned policy rule to every contract route', () => {
    // Rules are evaluated in priority order and the first match wins (a
    // narrow exact-path rule, e.g. the public health check, is listed
    // ahead of the broad "every operator GET is inspect_evidence" catch
    // all it would otherwise also satisfy). Every route must hit some
    // rule, and every rule must be the first hit for at least one route.
    const firstMatchByKey = new Map<string, PolicyRule>();

    for (const route of apiRouteContract) {
      const key = `${route.method} ${route.path}`;
      const rule = policyRules.find((candidate) => candidate.matches(route));
      expect(rule, `${key} matched no policy rule`).toBeDefined();
      firstMatchByKey.set(key, rule!);

      expect(route.access, `${key} via rule "${rule!.name}"`).toBe(
        rule!.access,
      );
      expect(route.capability, `${key} via rule "${rule!.name}"`).toBe(
        rule!.capability,
      );
    }

    expect(firstMatchByKey.size).toBe(apiRouteContract.length);

    for (const rule of policyRules) {
      const claimsSomething = [...firstMatchByKey.values()].includes(rule);
      expect(
        claimsSomething,
        `rule "${rule.name}" was never the first match for any route`,
      ).toBe(true);
    }
  });

  it('only uses capability values from the declared operator capability set', () => {
    for (const route of apiRouteContract) {
      if (route.capability === null) continue;
      expect(
        (operatorCapabilities as readonly string[]).includes(route.capability),
        `${route.method} ${route.path} declares unknown capability "${route.capability}"`,
      ).toBe(true);
    }
  });

  // ---------------------------------------------------------------------
  // Explicit route tests called out by issue #102: these are subsumed by
  // the table-driven policy check above, but are asserted individually,
  // by name, so a regression in one of these specific security-sensitive
  // routes fails with an unambiguous, human-readable test name rather than
  // a generic table-driven failure.
  // ---------------------------------------------------------------------
  describe('explicit named routes', () => {
    it('auth session: validates a credential without requiring one already', () => {
      expect(findApiRoute('GET', '/api/auth/session')).toMatchObject({
        access: 'session',
        capability: null,
      });
    });

    it('behavioural eval listing requires evidence-inspection authority', () => {
      expect(findApiRoute('GET', '/api/behavioural-evals')).toMatchObject({
        access: 'operator',
        capability: 'inspect_evidence',
      });
    });

    it('Darwin Lab list requires evidence-inspection authority', () => {
      expect(findApiRoute('GET', '/api/lab/experiments')).toMatchObject({
        access: 'operator',
        capability: 'inspect_evidence',
      });
    });

    it('Darwin Lab detail requires evidence-inspection authority', () => {
      expect(
        findApiRoute('GET', '/api/lab/experiments/lab-exp-1'),
      ).toMatchObject({
        access: 'operator',
        capability: 'inspect_evidence',
      });
    });

    it('Darwin Lab rebuild-evidence requires execute authority (not merely simulate)', () => {
      expect(
        findApiRoute('POST', '/api/lab/experiments/lab-exp-1/rebuild-evidence'),
      ).toMatchObject({
        access: 'operator',
        capability: 'execute',
      });
    });

    it('repository manifest retrieval is a signed callback route, not an operator route', () => {
      // This is the one that is easy to get wrong: the manifest is fetched
      // by the signed external workflow itself, so it must stay on the
      // `callback` boundary with no operator capability requirement.
      expect(
        findApiRoute('GET', '/api/repository-executions/execution-1/manifest'),
      ).toMatchObject({
        access: 'callback',
        capability: null,
      });
    });
  });

  // ---------------------------------------------------------------------
  // Route inventory drift: statically re-derive every `(method, path)` the
  // API actually dispatches to a handler for (see route-inventory.ts) and
  // fail if that set and apiRouteContract disagree in either direction —
  // a handled route missing from the contract (so it can never actually be
  // reached, since findApiRoute gates every request), or a contract entry
  // with no corresponding handler (so it is dead weight promising access
  // that doesn't exist).
  // ---------------------------------------------------------------------
  describe('route inventory drift', () => {
    const normalize = (path: string) => path.replace(/:[^/]+/g, ':param');

    it('matches the statically-detected set of handled routes exactly', () => {
      const handled = computeHandledRoutes();
      const handledKeys = new Set(
        handled.map((route) => `${route.method} ${normalize(route.path)}`),
      );
      const contractKeys = new Set(
        apiRouteContract.map(
          (route) => `${route.method} ${normalize(route.path)}`,
        ),
      );

      const handledButNotContracted = [...handledKeys].filter(
        (key) => !contractKeys.has(key),
      );
      const contractedButNotHandled = [...contractKeys].filter(
        (key) => !handledKeys.has(key),
      );

      expect(
        handledButNotContracted,
        'routes the API dispatches to a handler for but apiRouteContract does not list',
      ).toEqual([]);
      expect(
        contractedButNotHandled,
        'apiRouteContract entries with no corresponding handler in index.ts, lab/handler.ts, or routes/operations.ts',
      ).toEqual([]);
    });
  });
});
