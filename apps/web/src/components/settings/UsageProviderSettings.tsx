import { Link } from "@tanstack/react-router";
import type { EnvironmentId, UnifiedSettings } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Hub management follows the selected device and access rules of provider settings. */
export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly readOnly: boolean;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const settings = useEnvironmentSettings(environmentId);
  const [adding, setAdding] = useState(false);
  const entries = Object.entries(sources);

  return (
    <>
      <SettingsSection
        {...searchableSetting("usage-providers")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3" aria-hidden />
              Add hub
            </Button>
          ) : null
        }
      >
        <SettingsRow
          title="When an account reaches its limit"
          description="Automatic switching uses only enabled accounts that can preserve this conversation and have confirmed capacity."
          control={
            <select
              aria-label="Account switching on usage limit"
              disabled={readOnly}
              value={settings.usageLimitSwitch}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "ask" || value === "auto" || value === "off")
                  updateSettings({ usageLimitSwitch: value });
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="ask">Ask me</option>
              <option value="auto">Switch automatically</option>
              <option value="off">Off</option>
            </select>
          }
        />
        <SettingsRow
          title="Account usage and history"
          description="Quota readings, recorded work, and reset times across your accounts."
          control={
            <Link to="/usage" className="text-xs text-primary underline underline-offset-2">
              Open Usage
            </Link>
          }
        />
        {entries.length === 0 ? (
          <SettingsRow title="No usage providers configured." />
        ) : (
          entries.map(([id, source]) => {
            const label = source.label?.trim() || source.url;
            return (
              <SettingsRow
                key={id}
                title={label}
                description={
                  <span className="break-all">
                    CLI Proxy{source.enabled ? "" : " · Disabled"}
                    {label !== source.url ? ` · ${source.url}` : ""}
                  </span>
                }
                control={
                  !readOnly ? (
                    <RemoveUsageProviderButton
                      label={label}
                      onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                    />
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          open
          onOpenChange={setAdding}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
        />
      ) : null}
    </>
  );
}

/** Removing a hub deletes its stored management key, so it requires confirmation. */
function RemoveUsageProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The hub's management key is deleted from this server. Its accounts leave the Limits
              view; the hub itself is untouched. Add it again with the URL and key to bring them
              back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove hub
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
