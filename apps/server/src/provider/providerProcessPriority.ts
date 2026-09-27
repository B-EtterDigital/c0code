// The Claude SDK requires a synchronous Node ChildProcess from this callback.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";

/** The UI server stays interactive; its provider children yield CPU under load. */
export const applyProviderProcessPriority = (pid: number | undefined) =>
  Effect.suspend(() => {
    if (process.env.C0CODE_PROVIDER_PRIORITY !== "background" || pid === undefined) {
      return Effect.void;
    }
    return Effect.try(() => {
      const current = NodeOS.getPriority(pid);
      NodeOS.setPriority(pid, Math.max(current, NodeOS.constants.priority.PRIORITY_BELOW_NORMAL));
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not lower provider process priority", { pid, cause: error }),
      ),
    );
  });

export const spawnClaudeProviderProcess = (
  options: Parameters<NonNullable<Options["spawnClaudeCodeProcess"]>>[0],
) => {
  const child = NodeChildProcess.spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  // Custom SDK spawners own stderr; drain it and retain CLI diagnostics.
  child.stderr.pipe(process.stderr, { end: false });
  Effect.runSync(applyProviderProcessPriority(child.pid));
  return child;
};
