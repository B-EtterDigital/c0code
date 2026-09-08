import { type ReactNode } from "react";
import { useC0xShellConfig } from "~/c0x/nativeShell";

import {
  RIGHT_PANEL_SHEET_CLASS_NAME,
  RIGHT_PANEL_SHEET_LAYER_CLASS_NAME,
} from "../rightPanelLayout";
import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  animationDurationMs: number;
  children: ReactNode;
  open: boolean;
  underFloatingPreview?: boolean;
  onClose: () => void;
}) {
  const shell = useC0xShellConfig();
  const nativeShell = shell.smarch !== null || shell.modules.length > 0;
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        transitionDurationMs={props.animationDurationMs}
        side="right"
        showCloseButton={false}
        keepMounted
        backdropClassName={`${nativeShell ? "bg-background/15 backdrop-blur-none" : ""} ${props.underFloatingPreview ? RIGHT_PANEL_SHEET_LAYER_CLASS_NAME : ""}`}
        {...(props.underFloatingPreview
          ? {
              viewportClassName: RIGHT_PANEL_SHEET_LAYER_CLASS_NAME,
            }
          : {})}
        className={`${RIGHT_PANEL_SHEET_CLASS_NAME} ${nativeShell ? "bg-background/80 backdrop-blur-md" : ""}`}
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
