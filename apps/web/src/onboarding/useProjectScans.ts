import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useContext, useMemo } from "react";

import { agentSessionScan } from "../state/agentSessions";
import { formatEnvironmentQueryError } from "../state/query";

/** Subscribe to each selected computer without coupling their failures or refreshes. */
export function useProjectScans(
  environmentIds: readonly EnvironmentId[],
  roots: Readonly<Record<string, readonly string[]>>,
  depth: 1 | 2 | 3,
  includeHistory: boolean,
) {
  const registry = useContext(RegistryContext);
  const scansAtom = useMemo(
    () =>
      Atom.make((get) =>
        environmentIds.map((environmentId) => {
          const selectedRoots = roots[environmentId] ?? [];
          if (!selectedRoots.length)
            return { environmentId, data: null, error: null, isPending: false, refresh: () => {} };
          const atom = agentSessionScan({
            environmentId,
            input: { roots: selectedRoots, depth, includeHistory },
          });
          const result = get(atom);
          const data = Option.getOrNull(AsyncResult.value(result));
          return {
            environmentId,
            data: data
              ? {
                  ...data,
                  candidates: data.candidates.filter((candidate) =>
                    selectedRoots.some((root) => {
                      const base = root.replace(/[\\/]+$/, "");
                      return (
                        candidate.path === base ||
                        candidate.path.startsWith(`${base}/`) ||
                        candidate.path.startsWith(`${base}\\`)
                      );
                    }),
                  ),
                }
              : null,
            error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
            isPending: result.waiting || result._tag === "Initial",
            refresh: () => registry.refresh(atom),
          };
        }),
      ),
    [environmentIds, registry, roots, depth, includeHistory],
  );
  return useAtomValue(scansAtom);
}
