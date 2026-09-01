/**
 * A stand-in for the `openai` package, so provider.ts loads in a container
 * that cannot install from the registry. The suites here never reach a
 * network call: they exercise the request shaping and the response parsing
 * around it. Any call that did reach this client would fail loudly rather
 * than quietly returning something plausible.
 */
export default class OpenAI {
  responses = {
    create: async () => {
      throw new Error("the openai stub was called: this test needs a real client");
    },
  };
  constructor(_options?: unknown) {}
}
