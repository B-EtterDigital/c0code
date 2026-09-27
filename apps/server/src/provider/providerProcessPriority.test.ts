import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import { it } from "@effect/vitest";
import { afterEach, expect, vi } from "vite-plus/test";
import {
  applyProviderProcessPriority,
  spawnClaudeProviderProcess,
} from "./providerProcessPriority.ts";

afterEach(() => vi.unstubAllEnvs());

it.effect.each(["background", ""])(
  "applies provider policy %s without changing the server or stdio",
  (policy) =>
    Effect.gen(function* () {
      vi.stubEnv("C0CODE_PROVIDER_PRIORITY", policy);
      const parentPriority = NodeOS.getPriority();
      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          const child = spawnClaudeProviderProcess({
            command: process.execPath,
            args: [
              "-e",
              "process.stdin.once('data', () => { console.log(require('node:os').getPriority()); process.exit(0); });",
            ],
            env: process.env,
            signal: new AbortController().signal,
          });
          let output = "";
          child.stdout.on("data", (chunk: Buffer) => {
            output += chunk.toString();
          });
          const exited = new Promise<void>((resolve, reject) => {
            child.once("close", () => resolve());
            child.once("error", reject);
          });
          return { child, exited, output: () => output };
        }),
        ({ child, exited, output }) =>
          Effect.gen(function* () {
            yield* applyProviderProcessPriority(child.pid);
            child.stdin.end("ready");
            yield* Effect.promise(() => exited);
            expect(Number(output())).toBe(
              policy === "background" ? Math.max(parentPriority, 10) : parentPriority,
            );
            expect(NodeOS.getPriority()).toBe(parentPriority);
          }),
        ({ child, exited }) =>
          Effect.promise(async () => {
            if (child.exitCode === null) child.kill();
            await exited;
          }),
      );
    }),
);
