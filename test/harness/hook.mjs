import { register } from "node:module";

// Registered with `node --import ./test/harness/hook.mjs`, before any test is
// loaded, so the resolver below is in place when the first import runs.
register("./resolver.mjs", import.meta.url);
