import { resolveStorage, type StateStorage } from "../lib/storage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function equalComposerSnapshots(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equalComposerSnapshots(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.hasOwn(right, key) && equalComposerSnapshots(left[key], right[key]));
}

/** Apply this pane's changes to the latest snapshot, retaining other panes' edits. */
export function mergeComposerSnapshots(base: unknown, local: unknown, remote: unknown): unknown {
  if (equalComposerSnapshots(local, base)) return remote;
  if (equalComposerSnapshots(remote, base)) return local;
  // A stale pane may prune an empty draft while another pane is filling it.
  if (local === undefined && remote !== undefined) return remote;
  if (isRecord(local) && isRecord(remote) && (base === undefined || isRecord(base))) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeComposerSnapshots(base?.[key], local[key], remote[key]);
      if (value !== undefined) Object.defineProperty(result, key, {
        value, enumerable: true, configurable: true, writable: true,
      });
    }
    return result;
  }
  // Concurrent edits to the same scalar/attachment list use the last local write.
  return local;
}

/** The merge runs at the actual deferred flush, including beforeunload. */
export function createComposerStorage(storage: Partial<StateStorage> | null | undefined) {
  const baseStorage = resolveStorage(storage);
  let baseline: unknown;
  const parse = (raw: string | null) => raw === null ? undefined : JSON.parse(raw) as unknown;
  const read = (name: string) => {
    const raw = baseStorage.getItem(name);
    if (raw instanceof Promise) throw new Error("Composer persistence requires synchronous storage");
    return raw;
  };
  return {
    getItem(name: string) {
      const raw = read(name);
      baseline = parse(raw);
      return raw;
    },
    setItem(name: string, raw: string) {
      const local = parse(raw);
      const current = read(name);
      const remote = parse(current);
      const merged = mergeComposerSnapshots(baseline, local, remote);
      if (!equalComposerSnapshots(merged, remote)) {
        const encoded = equalComposerSnapshots(merged, local) ? raw : JSON.stringify(merged);
        if (encoded === undefined) throw new Error("Composer persistence received an empty snapshot");
        baseStorage.setItem(name, encoded);
      }
      // The in-memory store still represents local, not the merged disk snapshot.
      baseline = local;
    },
    removeItem(name: string) {
      baseStorage.removeItem(name);
      baseline = undefined;
    },
    receive(local: unknown, raw: string | null) {
      const remote = parse(raw);
      const merged = mergeComposerSnapshots(baseline, local, remote);
      baseline = remote;
      return merged;
    },
  };
}
