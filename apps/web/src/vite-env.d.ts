/// <reference types="vite-plus/client" />

import type { DesktopBridge } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly VITE_HTTP_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_HOSTED_APP_URL: string;
  readonly VITE_HOSTED_APP_CHANNEL: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_CLERK_JWT_TEMPLATE: string;
  readonly VITE_CLERK_CLI_OAUTH_CLIENT_ID: string;
  readonly VITE_RELAY_OTLP_TRACES_URL: string;
  readonly VITE_RELAY_OTLP_TRACES_DATASET: string;
  readonly VITE_RELAY_OTLP_TRACES_TOKEN: string;
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  type C0CodeConnectionBridge = Pick<
    DesktopBridge,
    | "getConnectionCatalog"
    | "setConnectionCatalog"
    | "discoverSshHosts"
    | "resolveSshHost"
    | "ensureSshEnvironment"
    | "disconnectSshEnvironment"
    | "fetchSshEnvironmentDescriptor"
    | "bootstrapSshBearerSession"
    | "fetchSshSessionState"
    | "issueSshWebSocketTicket"
  >;

  interface Window {
    desktopBridge?: DesktopBridge;
    c0codeConnectionBridge?: C0CodeConnectionBridge;
    c0codeAccountsBridge?: {
      pickProjectLogo(): Promise<string | null>;
      syncAccounts(statuses: ReadonlyArray<{ instanceId: string; auth: string }>): Promise<{ count: number }>;
      openRouterStatus(): Promise<{ configured: boolean }>;
      saveOpenRouterKey(key: string | null): Promise<{ configured: boolean }>;
    };
  }
}
