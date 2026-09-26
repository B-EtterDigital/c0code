import { useAtomValue } from "@effect/atom-react";
import type { DesktopSshEnvironmentTarget, EnvironmentId } from "@t3tools/contracts";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";
import { connectSshEnvironment } from "../../connection/onboarding";
import { desktopSshHostsStateAtom } from "../../state/desktopSshHosts";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function GuidedComputerConnection({ pairing, disabled, onBusyChange, onConnected }: {
  pairing: ReactNode;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onConnected: (id: EnvironmentId) => void;
}) {
  const bridge = window.c0codeConnectionBridge ?? window.desktopBridge;
  const [method, setMethod] = useState(bridge ? "ssh" : "pairing");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState("");
  const [error, setError] = useState("");
  const hosts = useAtomValue(desktopSshHostsStateAtom);
  const discovered = Option.getOrElse(AsyncResult.value(hosts), () => []);
  const connect = useAtomCommand(connectSshEnvironment, { reportFailure: false });
  const submit = async (saved?: DesktopSshEnvironmentTarget) => {
    if (disabled) return;
    setError("");
    onBusyChange(true);
    try {
      let target = saved;
      if (!target) {
        const value = host.trim();
        if (!value || /[\s\0]/.test(value)) throw new Error("Enter the computer’s SSH name or user@hostname.");
        const at = value.lastIndexOf("@");
        const hostname = at >= 0 ? value.slice(at + 1) : value;
        const user = username.trim() || (at >= 0 ? value.slice(0, at) : null);
        const portNumber = port.trim() ? Number(port) : null;
        if (portNumber !== null && (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535)) throw new Error("Enter a port between 1 and 65535.");
        const resolved = bridge ? await bridge.resolveSshHost(hostname) : null;
        target = { alias: hostname, hostname: resolved?.hostname || hostname, username: user || resolved?.username || null, port: portNumber ?? resolved?.port ?? null };
      }
      const result = await connect({ target, label: target.alias });
      if (result._tag === "Success") { onConnected(result.value); setHost(""); }
      else if (!isAtomCommandInterrupted(result)) throw squashAtomCommandFailure(result);
    } catch (cause) {
      console.error("[c0x-t3-error] onboarding.connectComputer", String(cause));
      setError(cause instanceof Error ? cause.message : "Could not connect. Check that the computer is online and SSH access is enabled.");
    } finally { onBusyChange(false); }
  };
  return <div className="space-y-3">
    <div className="flex gap-2" aria-label="Connection method">
      {bridge ? <Button size="sm" variant={method === "ssh" ? "default" : "outline"} disabled={disabled} onClick={() => setMethod("ssh")}>SSH · guided setup</Button> : null}
      <Button size="sm" variant={method === "pairing" ? "default" : "outline"} disabled={disabled} onClick={() => setMethod("pairing")}>Pairing link</Button>
    </div>
    {method === "pairing" ? pairing : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="text-sm text-muted-foreground">Choose a saved computer or enter its SSH name. C0CODE uses your existing SSH keys, prepares the remote workspace, and connects it automatically.</p>
      {discovered.length ? <div className="flex max-h-32 flex-wrap gap-2 overflow-auto" aria-label="Saved SSH computers">{discovered.map((target) => <Button key={`${target.alias}:${target.hostname}`} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void submit(target)}>{target.alias}</Button>)}</div> : null}
      <label className="block text-sm">Computer name<Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="my-server or user@hostname" disabled={disabled} autoCapitalize="none" autoCorrect="off" className="mt-1" /></label>
      <details><summary className="cursor-pointer text-xs text-muted-foreground">Different username or port</summary><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs">Username<Input value={username} onChange={(event) => setUsername(event.target.value)} disabled={disabled} placeholder="From SSH config" /></label><label className="text-xs">Port<Input value={port} onChange={(event) => setPort(event.target.value)} disabled={disabled} inputMode="numeric" placeholder="22" /></label></div></details>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={disabled || !host.trim()}>{disabled ? "Connecting and preparing…" : "Connect computer"}</Button>
    </form>}
  </div>;
}
