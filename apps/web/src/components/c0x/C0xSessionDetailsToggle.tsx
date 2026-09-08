import { SlidersHorizontalIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle } from "../ui/toggle";
import { C0xSessionPanel } from "./C0xSessionPanel";

export function C0xSessionDetailsToggle(props: ComponentProps<typeof C0xSessionPanel>) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <Toggle pressed={open} aria-label="Toggle session details" title="Session details"
          variant="ghost" size="sm" className="shrink-0 [-webkit-app-region:no-drag]">
          <SlidersHorizontalIcon className="size-4" />
        </Toggle>
      } />
      <PopoverPopup align="end" side="bottom" sideOffset={12}
        className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl"
        viewportClassName="p-0 [--viewport-inline-padding:0px]">
        <div className="max-h-[min(38rem,75vh)] overflow-y-auto">
          <C0xSessionPanel {...props} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
