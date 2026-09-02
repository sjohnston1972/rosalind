/**
 * Static route inventory extractor.
 *
 * This module is intentionally decoupled from the Cloudflare Worker runtime
 * entrypoint (`index.ts` never imports it, so it is never bundled into the
 * deployed worker). It exists so a Node-side script and a Vitest test can
 * both ask the same question: "which `(method, path)` pairs does the API
 * actually dispatch to a handler for?" — and compare that answer against
 * `apiRouteContract`, the hand-maintained allowlist enforced at the top of
 * `handleRequest` via `findApiRoute`.
 *
 * It works by statically scanning the three files that contain route
 * dispatch logic (`index.ts`, `lab/handler.ts`, `routes/operations.ts`) for
 * the handful of conditional shapes actually used in this codebase:
 *
 *   1. `if (request.method === 'X' && pathname === 'literal') { ... }`
 *   2. `const nameMatch = pathname.match(/regex/);`
 *      `if (request.method === 'X' && nameMatch) { ... }`
 *   3. `if ((request.method === 'X' || request.method === 'Y') && nameMatch)`
 *      (or the same with the match check and the method check swapped)
 *   4. `if (nameMatch) { ... if (request.method === 'X') { ... } ... }`
 *      (method decided inside the block body rather than the `if` header)
 *   5. `if (request.method !== 'X' || !nameMatch) return ...;`
 *      (negated early-return guard clause)
 *
 * This is a purpose-built scanner for those five shapes, not a general
 * control-flow analyzer. If a sixth shape is introduced, the drift check
 * this powers will fail loudly (a route present in the contract but not
 * found by the scanner, or vice versa) rather than silently under-counting,
 * because `api-route-contract.test.ts` asserts the extracted inventory is
 * exactly the contract — any file this scanner cannot parse into the
 * expected shape should be reflected as a mismatch, not swallowed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface HandledRoute {
  method: string;
  path: string;
}

interface SourceFile {
  label: string;
  path: string;
}

const sourceFiles: SourceFile[] = [
  { label: 'index.ts', path: '../../../workers/api/src/index.ts' },
  { label: 'lab/handler.ts', path: '../../../workers/api/src/lab/handler.ts' },
  {
    label: 'routes/operations.ts',
    path: '../../../workers/api/src/routes/operations.ts',
  },
];

const resolve = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

/** Read the three route-dispatch source files relative to this module. */
export const readRouteSources = (): { label: string; source: string }[] =>
  sourceFiles.map(({ label, path }) => ({
    label,
    source: readFileSync(resolve(path), 'utf8'),
  }));

// Matches `const NAME = pathname.match(/BODY/flags);` allowing the call to
// span multiple lines and the regex body to contain escaped slashes and
// character classes (e.g. `[^/]`, whose interior `/` is not a delimiter).
const matchVarPattern =
  /const\s+(\w+)\s*=\s*pathname\.match\(\s*\/((?:\\.|\[[^\]]*\]|[^\\/])*)\/[a-z]*\s*,?\s*\)\s*;/gs;

/** Expand a route-matching regex body (already stripped of `^`/`$`) into one
 * or more contract-style path templates, e.g. `:param` for a `([^/]+)`
 * capture group and a Cartesian expansion for literal-alternation groups
 * such as `(cancel|retry|force-fail|archive)`. */
/** Split a regex body into `/`-delimited path segments. In these route
 * regexes, path-separator slashes are escaped (`\/`, required inside a
 * `/.../ ` literal) and are the real split points; a `/` appearing
 * unescaped inside a bracket expression (e.g. `[^/]`) is not a delimiter
 * and the bracket is kept atomic. */
const splitRegexPath = (body: string): string[] => {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (char === '\\' && i + 1 < body.length && body[i + 1] === '/') {
      segments.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (char === '\\' && i + 1 < body.length) {
      current += char + body[i + 1];
      i += 1;
      continue;
    }
    if (char === '[') {
      const close = body.indexOf(']', i);
      if (close === -1) {
        throw new Error(
          `route-inventory: unterminated character class in "${body}".`,
        );
      }
      current += body.slice(i, close + 1);
      i = close;
      continue;
    }
    if (char === '/') {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
};

const templatesFromRegexBody = (body: string): string[] => {
  const withoutAnchors = body.replace(/^\^/, '').replace(/\$$/, '');
  const segments = splitRegexPath(withoutAnchors);

  let combinations: string[][] = [[]];
  for (const segment of segments) {
    const groupMatch = /^\(([^()]*)\)$/.exec(segment);
    if (!groupMatch) {
      combinations = combinations.map((combo) => [...combo, segment]);
      continue;
    }
    const inner = groupMatch[1]!;
    if (inner === '[^/]+') {
      combinations = combinations.map((combo) => [...combo, ':param']);
      continue;
    }
    const alternationMatch = /^[\w-]+(?:\|[\w-]+)+$/.exec(inner);
    if (alternationMatch) {
      const options = inner.split('|');
      combinations = combinations.flatMap((combo) =>
        options.map((option) => [...combo, option]),
      );
      continue;
    }
    throw new Error(
      `route-inventory: unrecognized capture group "${segment}" in path regex "${body}". ` +
        'Teach templatesFromRegexBody about this shape or the drift check will silently miss it.',
    );
  }
  return combinations.map((combo) => combo.join('/'));
};

const extractMatchVars = (source: string): Map<string, string[]> => {
  const vars = new Map<string, string[]>();
  for (const match of source.matchAll(matchVarPattern)) {
    const [, name, regexBody] = match;
    vars.set(name!, templatesFromRegexBody(regexBody!));
  }
  return vars;
};

/** Find the substring of `text` starting at `openParenIndex` (the index of
 * an opening `(`) up to and including its matching closing `)`. */
const readBalanced = (
  text: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): { content: string; endIndex: number } => {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === openChar) depth += 1;
    else if (text[i] === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { content: text.slice(openIndex + 1, i), endIndex: i };
      }
    }
  }
  throw new Error(
    `route-inventory: unbalanced "${openChar}${closeChar}" starting at index ${openIndex}.`,
  );
};

const methodLiteralPattern = /request\.method\s*===\s*'([A-Z]+)'/g;
const methodNotEqualPattern = /request\.method\s*!==\s*'([A-Z]+)'/;
const literalPathPattern = /pathname\s*===\s*'([^']+)'/;
const identifierPattern = /\b[A-Za-z_]\w*\b/g;

const methodsIn = (text: string): string[] => [
  ...new Set([...text.matchAll(methodLiteralPattern)].map((m) => m[1]!)),
];

const negatedIdentifiers = (text: string): Set<string> => {
  const found = new Set<string>();
  const negatedPattern = /!\s*([A-Za-z_]\w*)\b/g;
  for (const match of text.matchAll(negatedPattern)) {
    found.add(match[1]!);
  }
  return found;
};

const extractRoutesFromSource = (
  source: string,
  matchVars: Map<string, string[]>,
): HandledRoute[] => {
  const routes: HandledRoute[] = [];
  const ifPattern = /\bif\s*\(/g;
  let ifMatch: RegExpExecArray | null;

  while ((ifMatch = ifPattern.exec(source))) {
    const openIndex = ifMatch.index + ifMatch[0].length - 1;
    const { content: header, endIndex } = readBalanced(
      source,
      openIndex,
      '(',
      ')',
    );

    const headerMethods = methodsIn(header);
    const literalPath = literalPathPattern.exec(header)?.[1];
    const methodNotEqual = methodNotEqualPattern.exec(header)?.[1];
    const negated = negatedIdentifiers(header);

    const headerIdentifiers = new Set(
      [...header.matchAll(identifierPattern)].map((m) => m[0]),
    );
    const referencedMatchVars = [...matchVars.keys()].filter((name) =>
      headerIdentifiers.has(name),
    );
    const positiveMatchVars = referencedMatchVars.filter(
      (name) => !negated.has(name),
    );
    const negatedMatchVars = referencedMatchVars.filter((name) =>
      negated.has(name),
    );

    // Shape 5: negated early-return guard, e.g.
    // `if (request.method !== 'DELETE' || !nameMatch) return null;`
    if (methodNotEqual && negatedMatchVars.length > 0) {
      for (const varName of negatedMatchVars) {
        for (const template of matchVars.get(varName)!) {
          routes.push({ method: methodNotEqual, path: template });
        }
      }
      continue;
    }

    // Shape 1: literal path.
    if (literalPath) {
      for (const method of headerMethods) {
        routes.push({ method, path: literalPath });
      }
      continue;
    }

    // Shapes 2-4: a known match-variable is referenced positively.
    if (positiveMatchVars.length > 0) {
      for (const varName of positiveMatchVars) {
        const templates = matchVars.get(varName)!;
        let methods = headerMethods;

        if (methods.length === 0) {
          // Shape 4: method decided in the block body, not the header.
          // Find the block body (only if the header is immediately
          // followed by `{`) and scan it for method comparisons.
          const afterHeader = source.slice(endIndex + 1);
          const braceOffset = afterHeader.search(/\S/);
          if (braceOffset >= 0 && afterHeader[braceOffset] === '{') {
            const blockOpenIndex = endIndex + 1 + braceOffset;
            const { content: body } = readBalanced(
              source,
              blockOpenIndex,
              '{',
              '}',
            );
            methods = methodsIn(body);
          }
        }

        for (const method of methods) {
          for (const template of templates) {
            routes.push({ method, path: template });
          }
        }
      }
    }
  }

  return routes;
};

/** Statically determine every `(method, path)` pair the API dispatches to a
 * handler for, by scanning the route-dispatch source files. Deduplicated. */
export const computeHandledRoutes = (): HandledRoute[] => {
  const seen = new Set<string>();
  const routes: HandledRoute[] = [];
  for (const { source } of readRouteSources()) {
    const matchVars = extractMatchVars(source);
    for (const route of extractRoutesFromSource(source, matchVars)) {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(route);
    }
  }
  routes.sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
  );
  return routes;
};
