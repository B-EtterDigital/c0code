/**
 * C0X patch: lucide lookups for module descriptors. The shell names icons as
 * strings so a module set change never needs a client rebuild; unknown names
 * fall back to a neutral glyph.
 */
import {
  Boxes,
  FileText,
  Camera,
  Globe,
  MessageSquare,
  Mic,
  PackageOpen,
  Timer,
  type LucideIcon,
} from "lucide-react";

const C0X_MODULE_ICONS: Record<string, LucideIcon> = {
  'file-text': FileText,
  boxes: Boxes,
  camera: Camera,
  globe: Globe,
  "message-square": MessageSquare,
  mic: Mic,
  "package-open": PackageOpen,
  timer: Timer,
};

export function c0xModuleIcon(name: string | undefined): LucideIcon {
  return (name ? C0X_MODULE_ICONS[name] : undefined) ?? Boxes;
}
