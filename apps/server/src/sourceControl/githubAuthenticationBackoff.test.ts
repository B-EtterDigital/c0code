import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import {
  githubAuthenticationScope,
  isGitHubAuthenticationFailure,
  makeGitHubAuthenticationBackoff,
} from "./githubAuthenticationBackoff.ts";

it("shares a host pause across repositories and separates enterprise hosts", () => {
  assert.equal(
    githubAuthenticationScope({ cwd: "/one", args: ["pr", "list", "--repo", "github.com/a/b"] }),
    "github.com",
  );
  assert.equal(
    githubAuthenticationScope({ cwd: "/two", args: [], authenticationHost: "https://github.com" }),
    "github.com",
  );
  assert.equal(
    githubAuthenticationScope({ cwd: "/one", args: ["api", "--hostname", "code.example.org"] }),
    "code.example.org",
  );
  assert.equal(
    githubAuthenticationScope({
      cwd: "/one",
      args: ["pr", "view", "--repo", "https://code.example.org/a/b"],
    }),
    "code.example.org",
  );
});

it("recognizes wrapped authentication failures without hiding other failures", () => {
  assert.equal(
    isGitHubAuthenticationFailure({
      _tag: "SourceControlProviderError",
      cause: { _tag: "GitHubCliAuthenticationError" },
    }),
    true,
  );
  assert.equal(
    isGitHubAuthenticationFailure({
      _tag: "SourceControlProviderError",
      cause: new Error("network"),
    }),
    false,
  );
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  assert.equal(isGitHubAuthenticationFailure(cycle), false);
});

it.effect("coalesces failed auth probes, backs off, and allows an explicit auth check", () =>
  Effect.gen(function* () {
    const authError = new Error("unauthenticated");
    let calls = 0;
    const backoff = makeGitHubAuthenticationBackoff<Error>((error) => error === authError);
    const failed = Effect.suspend(() => {
      calls += 1;
      return Effect.fail(authError);
    });
    yield* Effect.all(
      Array.from({ length: 20 }, () => backoff.protect("github.com", failed).pipe(Effect.exit)),
      { concurrency: "unbounded" },
    );
    assert.equal(calls, 1);
    yield* TestClock.adjust("30 seconds");
    yield* backoff.protect("github.com", failed).pipe(Effect.exit);
    assert.equal(calls, 2);
    yield* TestClock.adjust("30 seconds");
    yield* backoff.protect("github.com", failed).pipe(Effect.exit);
    assert.equal(calls, 2);
    yield* backoff.protect("enterprise.example", failed).pipe(Effect.exit);
    assert.equal(calls, 3);
    yield* backoff.protect("github.com", Effect.void, true);
    yield* backoff.protect("github.com", failed).pipe(Effect.exit);
    assert.equal(calls, 4);
  }),
);

it.effect("does not pause transient failures or successful reads", () =>
  Effect.gen(function* () {
    let calls = 0;
    const backoff = makeGitHubAuthenticationBackoff<Error>(() => false);
    const failed = Effect.suspend(() => {
      calls += 1;
      return Effect.fail(new Error("network"));
    });
    yield* backoff.protect("github.com", failed).pipe(Effect.exit);
    yield* backoff.protect("github.com", failed).pipe(Effect.exit);
    assert.equal(calls, 2);
    assert.equal(yield* backoff.protect("github.com", Effect.succeed("ready")), "ready");
  }),
);

it.effect("keeps authenticated requests concurrent", () =>
  Effect.gen(function* () {
    const backoff = makeGitHubAuthenticationBackoff<Error>(() => false);
    const bothStarted = yield* Deferred.make<void>();
    let started = 0;
    const read = Effect.gen(function* () {
      started += 1;
      if (started === 2) yield* Deferred.succeed(bothStarted, undefined);
      yield* Deferred.await(bothStarted);
    });
    yield* backoff.protect("github.com", Effect.void);
    yield* Effect.all([backoff.protect("github.com", read), backoff.protect("github.com", read)], {
      concurrency: "unbounded",
    });
    assert.equal(started, 2);
  }),
);

it.effect("an older successful request cannot clear a newer authentication failure", () =>
  Effect.gen(function* () {
    const authError = new Error("unauthenticated");
    const backoff = makeGitHubAuthenticationBackoff<Error>((error) => error === authError);
    yield* backoff.protect("github.com", Effect.void);
    const started = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const oldRequest = yield* backoff
      .protect(
        "github.com",
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(finish);
        }),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* backoff.protect("github.com", Effect.fail(authError)).pipe(Effect.exit);
    yield* Deferred.succeed(finish, undefined);
    yield* Fiber.join(oldRequest);
    let retried = false;
    yield* backoff
      .protect(
        "github.com",
        Effect.sync(() => {
          retried = true;
        }),
      )
      .pipe(Effect.exit);
    assert.equal(retried, false);
  }),
);
