import { useAtomValue } from "@effect/atom-react";
import { ProviderDriverKind, ProviderInstanceId, type EnvironmentId, type ServerProvider } from "@t3tools/contracts";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState, type ReactNode } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { usePrimaryEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { getDriverOption } from "../settings/providerDriverMeta";

export function OnboardingAccounts({ environmentId, machineLabel, renderTerminal }: {
  environmentId: EnvironmentId;
  machineLabel: string;
  renderTerminal: (provider: ServerProvider, onClose: () => void) => ReactNode;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? [];
  const primary = usePrimaryEnvironment();
  const local = primary?.environmentId === environmentId && Boolean(window.c0codeAccountsBridge);
  const save = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const [driver, setDriver] = useState("codex");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [shared, setShared] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const effectiveAccounts = { ...settings.providerInstances };
  for (const provider of providers) {
    if (effectiveAccounts[provider.instanceId] || !["codex", "claudeAgent", "opencode"].includes(provider.driver)) continue;
    const config = (settings.providers as Record<string, unknown>)[provider.driver];
    effectiveAccounts[provider.instanceId] = { driver: provider.driver, displayName: provider.displayName,
      enabled: provider.enabled, config: config ?? {} };
  }
  const accounts = Object.entries(effectiveAccounts).filter(([, instance]) => ["codex", "claudeAgent", "opencode"].includes(instance.driver));
  const statusKey = providers.map((provider) => `${provider.instanceId}:${provider.auth.status}`).join("|");
  const settingsKey = JSON.stringify(accounts);
  useEffect(() => {
    if (!local || providers.length === 0) return;
    let active = true;
    setShared(false);
    void window.c0codeAccountsBridge!.syncAccounts(providers.map((provider) => ({ instanceId: provider.instanceId, auth: provider.auth.status }))).then(() => {
      if (active) { setShared(true); setError(""); }
    }).catch((cause) => {
      console.error("[c0x-t3-error] onboarding.shareAccounts", String(cause));
      if (active) setError("Could not share these accounts with C0VIBE. Retry after the computer reconnects.");
    });
    return () => { active = false; };
  }, [local, settingsKey, statusKey]);
  useEffect(() => {
    if (!local) return;
    void window.c0codeAccountsBridge!.openRouterStatus().then((result) => setKeySaved(result.configured)).catch((cause) => {
      console.error("[c0x-t3-error] onboarding.openRouterStatus", String(cause));
      setError("Could not check the saved OpenRouter key.");
    });
  }, [local]);
  const add = async () => {
    if (!label.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const id = ProviderInstanceId.make(`${driver}_${randomUUID().replaceAll("-", "").slice(0, 12)}`);
      const homePath = driver === "codex" ? `~/.codex/accounts/${id}` : `~/.claude/accounts/${id}`;
      const result = await save({ environmentId, input: { patch: { providerInstances: {
        ...settings.providerInstances,
        [id]: { driver: ProviderDriverKind.make(driver), displayName: label.trim(), enabled: true,
          config: driver === "opencode" ? {} : { homePath } },
      } } } });
      if (result._tag !== "Success") { if (!isAtomCommandInterrupted(result)) throw squashAtomCommandFailure(result); return; }
      setLabel(""); setOpen((current) => new Set([...current, id]));
      await refresh({ environmentId, input: {} });
    } catch (cause) {
      console.error("[c0x-t3-error] onboarding.addAccount", String(cause));
      setError(cause instanceof Error ? cause.message : "Could not add the account.");
    } finally { setSaving(false); }
  };
  const saveKey = async (reuse = false) => {
    if ((!reuse && !apiKey.trim()) || keySaving) return;
    setKeySaving(true); setError("");
    try {
      const result = await window.c0codeAccountsBridge!.saveOpenRouterKey(reuse ? null : apiKey);
      setKeySaved(result.configured); setApiKey("");
      const id = ProviderInstanceId.make("opencode");
      const enabled = await save({ environmentId, input: { patch: { providerInstances: {
        ...settings.providerInstances,
        [id]: { ...settings.providerInstances[id], driver: ProviderDriverKind.make("opencode"), enabled: true },
      }, providers: { opencode: { enabled: true } } } } });
      if (enabled._tag !== "Success" && !isAtomCommandInterrupted(enabled)) throw squashAtomCommandFailure(enabled);
      await refresh({ environmentId, input: {} });
    } catch (cause) {
      console.error("[c0x-t3-error] onboarding.saveOpenRouter", String(cause));
      setError("Could not save OpenRouter. Check the key and try again.");
    } finally { setKeySaving(false); }
  };
  return <section className="space-y-3" aria-label={`Accounts on ${machineLabel}`}>
    <h3 className="text-sm font-medium">{machineLabel}</h3>
    {local ? <p className="text-xs text-muted-foreground" role="status">{shared ? "Available to all C0VIBE features that use your CLI accounts." : "Sharing accounts with C0VIBE…"}</p> : <p className="text-xs text-muted-foreground">These accounts run on {machineLabel}. Their credentials stay on that computer.</p>}
    {accounts.map(([id, account]) => {
      const provider = providers.find((value) => value.instanceId === id);
      return <div key={id} className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{account.displayName || getDriverOption(account.driver)?.label || id}</p><p className="text-xs text-muted-foreground">{getDriverOption(account.driver)?.label} · {provider?.auth.status === "authenticated" ? "Signed in" : provider?.installed === false ? "Needs installation" : "Sign in to connect"}</p></div>
          <Button size="xs" variant="outline" disabled={!provider} onClick={() => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}>{open.has(id) ? "Hide setup" : provider?.auth.status === "authenticated" ? "Manage login" : provider?.installed === false ? "Install" : "Sign in"}</Button>
        </div>
        {open.has(id) && provider ? renderTerminal(provider, () => { setOpen((current) => { const next = new Set(current); next.delete(id); return next; }); void refresh({ environmentId, input: {} }); }) : null}
      </div>;
    })}
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void add(); }}>
      <select aria-label="Account provider" className="rounded-md border border-border bg-background px-2 text-sm" value={driver} disabled={saving} onChange={(event) => setDriver(event.target.value)}><option value="codex">Codex</option><option value="claudeAgent">Claude Code</option></select>
      <Input aria-label="Account name" placeholder="Account name, e.g. Work" value={label} disabled={saving} onChange={(event) => setLabel(event.target.value)} className="min-w-32 flex-1" />
      <Button type="submit" disabled={saving || !label.trim()}>{saving ? "Adding…" : "Add account"}</Button>
    </form>
    <p className="text-xs text-muted-foreground">You can leave several sign-in panels open. Each Claude or Codex account has its own login folder.</p>
    {local ? <div className="space-y-2 rounded-lg border border-border p-3"><h4 className="text-sm font-medium">OpenRouter for OpenCode CLI</h4><p className="text-xs text-muted-foreground">{keySaved ? "An OpenRouter key is available. Use it across C0VIBE, or replace it below." : "Add your OpenRouter API key once for OpenCode and C0VIBE’s other AI features."}</p>{keySaved ? <Button size="sm" variant="outline" disabled={keySaving} onClick={() => void saveKey(true)}>Use saved key</Button> : null}<div className="flex gap-2"><Input aria-label="OpenRouter API key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="OpenRouter API key" disabled={keySaving} /><Button disabled={!apiKey.trim() || keySaving} onClick={() => void saveKey()}>{keySaving ? "Saving…" : "Connect OpenRouter"}</Button></div></div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}
