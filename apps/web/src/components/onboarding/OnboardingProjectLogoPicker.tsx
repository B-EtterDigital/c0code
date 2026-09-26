import { ThreadId, type EnvironmentId, type ProjectIconOverride } from "@t3tools/contracts";
import { createContext, useContext, useEffect, useState } from "react";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";
import { useAssetUrlState } from "../../assets/assetUrls";
import { usePrimaryEnvironment } from "../../state/environments";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectFaviconPickerDialog } from "../settings/ProjectFaviconPickerDialog";
import { ProjectIconPickerDialog } from "../settings/ProjectIconPickerDialog";
import { Button } from "../ui/button";

export type OnboardingProjectLogo = {
  faviconPath: string | null;
  projectIcon: ProjectIconOverride | null;
};
export const OnboardingProjectLogos = createContext<{
  logos: Readonly<Record<string, OnboardingProjectLogo>>;
  setLogo: (key: string, logo: OnboardingProjectLogo) => void;
}>({ logos: {}, setLogo: () => {} });

/** Preview the chosen real file before a canonical project exists. The favicon
 * endpoint reads saved project settings and must not cache an unsaved choice. */
function ChosenImage({
  environmentId,
  cwd,
  imagePath,
  title,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  imagePath: string;
  title: string;
}) {
  const absolutePath =
    imagePath.startsWith("/") || isWindowsAbsolutePath(imagePath)
      ? imagePath
      : `${cwd.replace(/[\\/]+$/, "")}/${imagePath}`;
  // Absolute media resources authorize the file directly; no thread is created.
  const asset = useAssetUrlState(environmentId, {
    _tag: "media-file",
    threadId: ThreadId.make("project-logo-preview"),
    path: absolutePath,
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (asset._tag === "Failure")
      console.error("[c0x-t3-error] onboarding.logoPreview", "Could not load the selected image.");
  }, [absolutePath, asset._tag]);
  if (asset._tag === "Failure" || failed)
    return (
      <span role="alert" className="text-destructive">
        Image unavailable
      </span>
    );
  return asset._tag === "Success" ? (
    <img
      src={asset.url}
      alt={`${title} project logo`}
      className="size-6 rounded object-contain"
      onError={() => {
        console.error(
          "[c0x-t3-error] onboarding.logoPreview",
          "The selected file could not be decoded as an image.",
        );
        setFailed(true);
      }}
    />
  ) : (
    <span role="status" className="text-muted-foreground">
      Loading image…
    </span>
  );
}

export function OnboardingProjectLogoPicker({
  candidate,
}: {
  candidate: { key: string; environmentId: EnvironmentId; title: string; path: string };
}) {
  const { logos, setLogo } = useContext(OnboardingProjectLogos);
  const [open, setOpen] = useState<"image" | "icon" | null>(null);
  const [error, setError] = useState("");
  const primary = usePrimaryEnvironment();
  const choice = logos[candidate.key] ?? { faviconPath: null, projectIcon: null };
  const local = primary?.environmentId === candidate.environmentId && window.c0codeAccountsBridge;
  return (
    <div
      className="ml-8 flex flex-wrap items-center gap-2 pb-2 text-xs"
      aria-label={`Logo for ${candidate.title}`}
    >
      {choice.faviconPath ? (
        <ChosenImage
          environmentId={candidate.environmentId}
          cwd={candidate.path}
          imagePath={choice.faviconPath}
          title={candidate.title}
        />
      ) : (
        <ProjectFavicon
          className="size-6"
          project={{
            environmentId: candidate.environmentId,
            workspaceRoot: candidate.path,
            title: candidate.title,
            ...choice,
          }}
        />
      )}
      <span className="text-muted-foreground">Project logo</span>
      {local ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setError("");
            void local
              .pickProjectLogo()
              .then((path) => {
                if (path) setLogo(candidate.key, { faviconPath: path, projectIcon: null });
              })
              .catch((cause) => {
                console.error("[c0x-t3-error] onboarding.pickProjectLogo", String(cause));
                setError("Could not open the image picker.");
              });
          }}
        >
          Browse image
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" onClick={() => setOpen("image")}>
        Image in project
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setOpen("icon")}>
        Icon or emoji
      </Button>
      {choice.faviconPath || choice.projectIcon ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setLogo(candidate.key, { faviconPath: null, projectIcon: null })}
        >
          Reset
        </Button>
      ) : null}
      {error ? (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      ) : null}
      {open === "image" ? (
        <ProjectFaviconPickerDialog
          open
          cwd={candidate.path}
          environmentId={candidate.environmentId}
          projectName={candidate.title}
          onOpenChange={(value) => {
            if (!value) setOpen(null);
          }}
          onSelect={(path) => {
            setLogo(candidate.key, { faviconPath: path, projectIcon: null });
            setOpen(null);
          }}
        />
      ) : null}
      {open === "icon" ? (
        <ProjectIconPickerDialog
          open
          current={choice.projectIcon}
          onOpenChange={(value) => {
            if (!value) setOpen(null);
          }}
          onSelect={(projectIcon) => setLogo(candidate.key, { faviconPath: null, projectIcon })}
        />
      ) : null}
    </div>
  );
}
