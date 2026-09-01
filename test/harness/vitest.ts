// Minimal stand-in for vitest: describe/it/expect over the matchers this
// repo's suites actually use. Written because neither this container nor the
// device VM can install @rollup/rollup-linux-arm64-gnu, so vitest itself will
// not start — and a suite that cannot run is a suite that is not protecting
// anything.
type Fn = () => unknown | Promise<unknown>;

export const state = { pass: 0, fail: 0, failures: [] as string[] };
const stack: string[] = [];
const queue: { name: string; fn: Fn }[] = [];
const hooks = { before: [] as Fn[], after: [] as Fn[], beforeAll: [] as Fn[] };

export function describe(name: string, fn: () => void) {
  stack.push(name);
  const saved = { ...hooks, before: [...hooks.before], after: [...hooks.after], beforeAll: [...hooks.beforeAll] };
  fn();
  hooks.before = saved.before; hooks.after = saved.after; hooks.beforeAll = saved.beforeAll;
  stack.pop();
}
describe.each = (rows: unknown[]) => (name: string, fn: (...a: unknown[]) => void) => {
  for (const r of rows) describe(name, () => fn(...(Array.isArray(r) ? r : [r])));
};

export function it(name: string, fn: Fn) {
  queue.push({ name: [...stack, name].join(" › "), fn });
}
it.each = (rows: unknown[]) => (name: string, fn: (...a: unknown[]) => unknown) => {
  for (const r of rows) {
    const args = Array.isArray(r) ? r : [r];
    it(name.replace(/%[sdiop]/g, () => String(args.shift())), () => fn(...(Array.isArray(r) ? r : [r])));
  }
};
export const test = it;

export const beforeEach = (fn: Fn) => hooks.before.push(fn);
export const afterEach = (fn: Fn) => hooks.after.push(fn);
export const beforeAll = (fn: Fn) => hooks.beforeAll.push(fn);
export const afterAll = (fn: Fn) => hooks.after.push(fn);

const envStubs: Record<string, string | undefined> = {};
export const vi = {
  stubEnv(k: string, v: string) {
    if (!(k in envStubs)) envStubs[k] = process.env[k];
    process.env[k] = v;
  },
  unstubAllEnvs() {
    for (const [k, v] of Object.entries(envStubs)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      delete envStubs[k];
    }
  },
  resetModules() {},
  fn: () => { throw new Error("vi.fn is not supported by this harness"); },
  mock: () => { throw new Error("vi.mock is not supported by this harness"); },
  mocked: () => { throw new Error("vi.mocked is not supported by this harness"); },
};

function show(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
function subset(a: unknown, b: unknown): boolean {
  if (typeof b !== "object" || b === null) return deepEqual(a, b);
  if (typeof a !== "object" || a === null) return false;
  return Object.keys(b as object).every((k) =>
    subset((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}
function fail(msg: string): never { throw new Error(msg); }

function matchers(got: unknown, no: boolean) {
  const ok = (cond: boolean, msg: string) => {
    if (cond === no) fail((no ? "not " : "") + msg + `\n         received ${show(got)}`);
  };
  return {
    toBe: (e: unknown) => ok(Object.is(got, e), `expected ${show(e)}`),
    toEqual: (e: unknown) => ok(deepEqual(got, e), `expected ${show(e)}`),
    toMatchObject: (e: unknown) => ok(subset(got, e), `expected to match ${show(e)}`),
    toBeNull: () => ok(got === null, "expected null"),
    toBeUndefined: () => ok(got === undefined, "expected undefined"),
    toBeDefined: () => ok(got !== undefined, "expected defined"),
    toBeTruthy: () => ok(!!got, "expected truthy"),
    toBeFalsy: () => ok(!got, "expected falsy"),
    toBeTypeOf: (e: string) => ok(typeof got === e, `expected typeof ${e}`),
    toHaveLength: (n: number) => ok((got as { length: number })?.length === n, `expected length ${n}`),
    toContain: (e: unknown) =>
      ok(
        typeof got === "string"
          ? got.includes(String(e))
          : Array.isArray(got) && got.some((x) => deepEqual(x, e)),
        `expected to contain ${show(e)}`
      ),
    toMatch: (re: RegExp | string) =>
      ok(typeof re === "string" ? String(got).includes(re) : re.test(String(got)), `expected to match ${re}`),
    toBeGreaterThan: (n: number) => ok((got as number) > n, `expected > ${n}`),
    toBeGreaterThanOrEqual: (n: number) => ok((got as number) >= n, `expected >= ${n}`),
    toBeLessThan: (n: number) => ok((got as number) < n, `expected < ${n}`),
    toBeLessThanOrEqual: (n: number) => ok((got as number) <= n, `expected <= ${n}`),
    toThrow: (e?: unknown) => {
      let threw = false, message = "";
      try { (got as () => void)(); } catch (err) { threw = true; message = (err as Error).message; }
      ok(threw && (e === undefined || message.includes(String(e))), `expected to throw ${e ?? ""}`);
    },
  };
}

export function expect(got: unknown) {
  const base = matchers(got, false) as Record<string, unknown>;
  base.not = matchers(got, true);
  // `rejects` and `resolves` settle the promise first, then hand the value (or
  // the thrown error) to the ordinary matchers — so every matcher above works
  // on an async assertion too.
  const settled = async (wantRejection: boolean) => {
    let value: unknown, threw = false;
    try { value = await (got as Promise<unknown>); } catch (err) { threw = true; value = err; }
    if (threw !== wantRejection) {
      fail(wantRejection ? "expected the promise to reject" : `expected the promise to resolve, it threw ${show(value)}`);
    }
    return value;
  };
  const async_ = (wantRejection: boolean) =>
    new Proxy({}, {
      get: (_t, key: string) => async (...args: unknown[]) => {
        const value = await settled(wantRejection);
        if (key === "toThrow") {
          const message = (value as Error)?.message ?? String(value);
          const want = args[0];
          const hit =
            want === undefined
              ? true
              : want instanceof RegExp
                ? want.test(message)
                : message.includes(String(want));
          if (!hit) fail(`expected rejection matching ${want}, got ${show(message)}`);
          return;
        }
        (matchers(value, false) as unknown as Record<string, (...a: unknown[]) => void>)[key](...args);
      },
    });
  base.rejects = async_(true);
  base.resolves = async_(false);
  return base as ReturnType<typeof matchers> & {
    not: ReturnType<typeof matchers>;
    rejects: { toThrow: (e?: unknown) => Promise<void> };
    resolves: { toBe: (e: unknown) => Promise<void> };
  };
}

export async function drain(label: string) {
  for (const h of hooks.beforeAll) await h();
  for (const q of queue) {
    try {
      for (const h of hooks.before) await h();
      await q.fn();
      for (const h of hooks.after) await h();
      state.pass++;
    } catch (e) {
      state.fail++;
      state.failures.push(`${label} :: ${q.name}\n       ${(e as Error).message}`);
    }
  }
  queue.length = 0;
  hooks.before.length = 0; hooks.after.length = 0; hooks.beforeAll.length = 0;
}
