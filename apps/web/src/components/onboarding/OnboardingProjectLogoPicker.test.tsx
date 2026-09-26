import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OnboardingProjectLogoPicker, OnboardingProjectLogos } from "./OnboardingProjectLogoPicker";

const { asset, canonicalFavicon } = vi.hoisted(() => ({
  asset: vi.fn(),
  canonicalFavicon: vi.fn(),
}));
vi.mock("../../assets/assetUrls", () => ({ useAssetUrlState: asset }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironment: () => null }));
vi.mock("../ProjectFavicon", () => ({ ProjectFavicon: canonicalFavicon }));
vi.mock("../settings/ProjectFaviconPickerDialog", () => ({
  ProjectFaviconPickerDialog: () => null,
}));
vi.mock("../settings/ProjectIconPickerDialog", () => ({ ProjectIconPickerDialog: () => null }));
vi.mock("../ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("project image choice before import", () => {
  it("previews the selected file without caching a favicon request for an unsaved project", async () => {
    asset.mockReturnValue({ _tag: "Success", url: "http://localhost/asset/signed-image" });
    canonicalFavicon.mockClear();
    await act(() => {
      renderer = create(
        <OnboardingProjectLogos.Provider
          value={{
            logos: { alpha: { faviconPath: "brand/logo.webp", projectIcon: null } },
            setLogo: vi.fn(),
          }}
        >
          <OnboardingProjectLogoPicker
            candidate={{
              key: "alpha",
              title: "Alpha",
              environmentId: EnvironmentId.make("local"),
              path: "/dev/Alpha",
            }}
          />
        </OnboardingProjectLogos.Provider>,
      );
    });
    expect(asset).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({ _tag: "media-file", path: "/dev/Alpha/brand/logo.webp" }),
    );
    expect(canonicalFavicon).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ alt: "Alpha project logo" }).props.src).toBe(
      "http://localhost/asset/signed-image",
    );
  });
});
