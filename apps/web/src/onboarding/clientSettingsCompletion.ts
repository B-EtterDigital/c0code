import type { ClientSettings } from "@t3tools/contracts/settings";
import {
  CLIENT_SETTINGS_STORAGE_KEY,
  readBrowserClientSettings,
} from "../clientPersistenceStorage";
import { ensureLocalApi } from "../localApi";

/** A delayed read or preference write cannot undo completed setup. */
export function preserveOnboardingCompletion(
  settings: ClientSettings,
  known: ClientSettings | null,
): ClientSettings {
  return settings.onboardingCompletedAt || !known?.onboardingCompletedAt
    ? settings
    : { ...settings, onboardingCompletedAt: known.onboardingCompletedAt };
}

export function persistClientSettingsWithCompletion(settings: ClientSettings): Promise<void> {
  return ensureLocalApi().persistence.setClientSettings(
    preserveOnboardingCompletion(settings, readBrowserClientSettings()),
  );
}

function readSharedCompletion(): ClientSettings | null {
  try {
    return readBrowserClientSettings();
  } catch (error) {
    // Settings hydration owns retry/recovery. A cross-pane observer must not
    // crash the app before that recovery surface can mount.
    console.error("[c0x-t3-error] onboarding.sharedCompletion.read", String(error));
    return null;
  }
}

/** Only a newly saved completion closes setup in another pane. */
export function subscribeSharedOnboardingCompletion(
  listener: (settings: ClientSettings) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  let completedAt = readSharedCompletion()?.onboardingCompletedAt;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CLIENT_SETTINGS_STORAGE_KEY) return;
    const settings = readSharedCompletion();
    if (!settings?.onboardingCompletedAt || settings.onboardingCompletedAt === completedAt) return;
    completedAt = settings.onboardingCompletedAt;
    listener(settings);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
