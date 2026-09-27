import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

interface Entry<E> {
  error?: E;
  attempt: number;
  retryAt: number;
  healthy: boolean;
  generation: number;
  readonly mutex: Semaphore.Semaphore;
}

/** Provider errors retain the typed CLI failure as their cause. */
export function isGitHubAuthenticationFailure(error: unknown): boolean {
  const seen = new Set<object>();
  while (typeof error === "object" && error !== null && !seen.has(error)) {
    if ("_tag" in error && error._tag === "GitHubCliAuthenticationError") return true;
    seen.add(error);
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}

export function githubAuthenticationScope(input: {
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly authenticationHost?: string;
}): string {
  const flag = (name: string) => {
    const index = input.args.indexOf(name);
    return index < 0 ? undefined : input.args[index + 1];
  };
  const repository = flag("--repo") ?? flag("-R");
  const host =
    input.authenticationHost ??
    flag("--hostname") ??
    (repository && URL.canParse(repository)
      ? new URL(repository).hostname
      : repository && repository.split("/").length >= 3
        ? repository.split("/")[0]
        : undefined) ??
    process.env.GH_HOST;
  if (host) return (URL.canParse(host) ? new URL(host).hostname : host).toLowerCase();
  // An implicit CLI target can be an enterprise remote. Do not let its login
  // failure block a different host merely because both commands omitted --repo.
  return `workspace:${input.cwd}`;
}

/** Serialize authentication probes; authenticated requests keep their concurrency. */
export function makeGitHubAuthenticationBackoff<E>(isAuthenticationError: (error: E) => boolean) {
  const entries = new Map<string, Entry<E>>();
  return {
    protect: <A>(host: string, effect: Effect.Effect<A, E>, bypass = false) =>
      Effect.suspend(() => {
        let entry = entries.get(host);
        if (entry === undefined) {
          // Bound metadata even if a client visits many unrelated workspaces.
          if (entries.size >= 512) {
            const oldest = entries.keys().next().value;
            if (oldest !== undefined) entries.delete(oldest);
          }
          entry = {
            attempt: 0,
            retryAt: 0,
            healthy: false,
            generation: 0,
            mutex: Semaphore.makeUnsafe(1),
          };
          entries.set(host, entry);
        }
        const state = entry;
        const run = Effect.suspend(() => {
          const generation = state.generation;
          return effect.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                // An older in-flight request cannot erase a newer authentication failure.
                if (generation !== state.generation) return;
                state.error = undefined;
                state.attempt = 0;
                state.retryAt = 0;
                state.healthy = true;
              }),
            ),
            Effect.tapError((error) =>
              Effect.gen(function* () {
                if (!isAuthenticationError(error) || generation !== state.generation) return;
                const now = yield* Clock.currentTimeMillis;
                if (generation !== state.generation) return;
                const first = state.attempt === 0;
                state.generation += 1;
                state.attempt += 1;
                state.error = error;
                state.healthy = false;
                state.retryAt =
                  now + Math.min(30_000 * 2 ** Math.min(state.attempt - 1, 6), 1_800_000);
                if (first)
                  yield* Effect.logWarning("Connect GitHub to resume pull request updates", {
                    host,
                  });
              }),
            ),
          );
        });
        if (state.healthy && !bypass) return run;
        return state.mutex
          .withPermit(
            Effect.gen(function* () {
              if (state.healthy && !bypass) return run;
              const now = yield* Clock.currentTimeMillis;
              if (!bypass && state.error !== undefined && now < state.retryAt) {
                return Effect.fail(state.error);
              }
              const result = yield* run;
              return Effect.succeed(result);
            }),
          )
          .pipe(Effect.flatten);
      }),
  };
}
