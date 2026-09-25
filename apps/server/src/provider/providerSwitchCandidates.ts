import {
  UsageLimitSourceError,
  type ProviderSwitchCandidate,
  type ProviderSwitchCandidatesInput,
} from "@t3tools/contracts";
import { rankProviderSwitchCandidates } from "@t3tools/shared/providerSwitch";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { ProviderRegistry } from "./Services/ProviderRegistry.ts";
import type { ProviderService } from "./Services/ProviderService.ts";
import type { ProviderSessionDirectory } from "./Services/ProviderSessionDirectory.ts";

export const makeProviderSwitchCandidates = (dependencies: {
  readonly registry: Pick<ProviderRegistry["Service"], "refresh" | "getProviders">;
  readonly service: Pick<ProviderService["Service"], "getInstanceInfo">;
  readonly directory: Pick<ProviderSessionDirectory["Service"], "getBinding">;
}) =>
  Effect.gen(function* () {
    const { registry, service, directory } = dependencies;
    const refresh = yield* Effect.cachedWithTTL(registry.refresh(), "60 seconds");
    return Effect.fn("provider.switchCandidates")(
      function* (input: ProviderSwitchCandidatesInput) {
        const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
        const sourceId = binding?.providerInstanceId ?? input.instanceId;
        const identity = yield* service.getInstanceInfo(sourceId, input.threadId);
        yield* refresh;
        // Runtime quota notifications may be newer than the cached refresh.
        const providers = yield* registry.getProviders;
        const candidates: ProviderSwitchCandidate[] = providers
          .filter(
            (provider) =>
              provider.instanceId !== input.instanceId &&
              provider.auth.status === "authenticated" &&
              provider.availability !== "unavailable",
          )
          .map((provider) => ({
            instanceId: provider.instanceId,
            driver: provider.driver,
            displayName: provider.displayName ?? provider.instanceId,
            enabled: provider.enabled,
            keepsConversation:
              provider.driver === identity.driverKind &&
              provider.continuation?.groupKey === identity.continuationIdentity.continuationKey,
            ...(provider.usageLimits ? { usageLimits: provider.usageLimits } : {}),
          }));
        return rankProviderSwitchCandidates(
          candidates,
          DateTime.toEpochMillis(yield* DateTime.now),
        );
      },
      Effect.tapError((cause) => Effect.logWarning("Account switch discovery failed", { cause })),
      Effect.mapError(
        () =>
          new UsageLimitSourceError({
            detail: "Could not check account switching options. Try refreshing again.",
          }),
      ),
    );
  });
