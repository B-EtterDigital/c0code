import {
  EnvironmentId,
  type ProjectListEntriesResult,
  ProjectReadFileError,
  type ProjectReadFileResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const projectMocks = vi.hoisted(() => ({
  listEntries: vi.fn(),
  optimisticFile: vi.fn(),
  readFile: vi.fn(),
}));

const atomHooks = vi.hoisted(() => ({
  registry: null as {
    get(atom: object): unknown;
    refresh(atom: object): void;
  } | null,
}));

const reactHooks = vi.hoisted(() => {
  let cursor = 0;
  let refs: Array<{ current: unknown }> = [];
  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      cursor = 0;
      refs = [];
    },
    useCallback<A>(callback: A): A {
      nextIndex();
      return callback;
    },
    useEffect(effect: () => void): void {
      nextIndex();
      effect();
    },
    useRef<A>(initialValue: A): { current: A } {
      const index = nextIndex();
      refs[index] ??= { current: initialValue };
      return refs[index] as { current: A };
    },
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomRefresh: (atom: object) => () => {
    atomHooks.registry?.refresh(atom);
  },
  useAtomValue: (atom: object) => atomHooks.registry?.get(atom),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: reactHooks.useCallback,
    useEffect: reactHooks.useEffect,
    useRef: reactHooks.useRef,
  };
});

vi.mock("~/state/projects", () => ({
  projectEnvironment: projectMocks,
}));

vi.mock("~/state/queries", () => ({
  useProjectPathSearch: vi.fn(),
}));

import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useProjectEntriesQuery, useProjectFileQuery } from "./projectFilesQueryState";

const environmentId = EnvironmentId.make("environment-1");

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function file(contents: string): ProjectReadFileResult {
  return {
    relativePath: "src/preview.ts",
    contents,
    byteLength: contents.length,
    truncated: false,
  };
}

function projectEntries(paths: readonly string[]): ProjectListEntriesResult {
  return {
    entries: paths.map((path) => ({ path, kind: "file" })),
    truncated: false,
  };
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("project query refresh", () => {
  beforeEach(() => {
    projectMocks.listEntries.mockReset();
    projectMocks.optimisticFile.mockReset();
    projectMocks.readFile.mockReset();
    reactHooks.reset();
  });

  it.each([
    {
      path: "docs",
      failure: "path_not_file" as const,
      folder: true,
      message: "folder",
      cause: undefined,
    },
    {
      path: "/home/test/Videos/byteplus-live-check",
      failure: "path_not_file" as const,
      folder: true,
      message: "folder",
      cause: undefined,
    },
    {
      path: "missing.txt",
      failure: "operation_failed" as const,
      folder: false,
      message: "could not be found",
      cause: new Error("workspace operation", {
        cause: Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
      }),
    },
    {
      path: "program.bin",
      failure: "binary_file" as const,
      folder: false,
      message: "binary file",
      cause: undefined,
    },
    {
      path: "../private",
      failure: "workspace_path_outside_root" as const,
      folder: false,
      message: "outside the allowed workspace root",
      cause: undefined,
    },
    {
      path: "private.txt",
      failure: "operation_failed" as const,
      folder: false,
      message: "Permission denied",
      cause: Object.assign(new Error("EACCES"), { code: "EACCES" }),
    },
  ])(
    "preserves the typed result for $path ($failure)",
    async ({ path, failure, folder, message, cause }) => {
      const error = new ProjectReadFileError({
        cwd: "/repo",
        relativePath: path,
        failure,
        cause,
        operation: "realpath-target",
        resolvedPath: path,
      });
      const codec = Schema.toCodecJson(ProjectReadFileError);
      const wireError = Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(error));
      const readAtom = Atom.make(Effect.fail(wireError));
      const registry = AtomRegistry.make();
      const unmount = registry.mount(readAtom);
      projectMocks.readFile.mockReturnValue(readAtom);
      projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
      atomHooks.registry = registry;
      try {
        await flushEffects();
        reactHooks.beginRender();
        const query = useProjectFileQuery(environmentId, "/repo", path);
        expect(query.isNotFile).toBe(folder);
        expect(query.failure).toBe(failure);
        expect(query.resolvedPath).toBe(path);
        expect(query.error).toContain(message);
        expect(query.error).not.toContain("Failed to read workspace file");
        expect(query.data).toBeNull();
      } finally {
        unmount();
        registry.dispose();
        atomHooks.registry = null;
      }
    },
  );

  it("replaces an in-flight initial read when a workspace mutation arrives", async () => {
    const requests: Array<ReturnType<typeof deferred<ProjectReadFileResult>>> = [];
    const readAtom = Atom.make(
      Effect.promise(() => {
        const request = deferred<ProjectReadFileResult>();
        requests.push(request);
        return request.promise;
      }),
    ).pipe(Atom.swr({ staleTime: 30_000, revalidateOnMount: true }));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;
    let renderedContents: string | null = null;

    const render = (mutationId: string | null) => {
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", "src/preview.ts");
      renderedContents = query.data?.contents ?? null;
      useWorkspaceMutationRefresh({
        mutationId,
        refresh: query.refresh,
        resourceKey: "file:environment-1:/repo:src/preview.ts",
      });
    };

    try {
      render(null);
      await flushEffects();
      expect(requests).toHaveLength(1);

      render("mutation-1");
      await flushEffects();
      expect(requests).toHaveLength(2);

      requests[1]!.resolve(file("fresh"));
      await flushEffects();
      render("mutation-1");
      expect(renderedContents).toBe("fresh");

      requests[0]!.resolve(file("stale"));
      await flushEffects();
      render("mutation-1");
      expect(renderedContents).toBe("fresh");
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });

  it("revalidates cached entries when a workspace mutation is observed after mounting", async () => {
    const requests: Array<ReturnType<typeof deferred<ProjectListEntriesResult>>> = [];
    const entriesAtom = Atom.make(
      Effect.promise(() => {
        const request = deferred<ProjectListEntriesResult>();
        requests.push(request);
        return request.promise;
      }),
    ).pipe(Atom.swr({ staleTime: 30_000, revalidateOnMount: true }));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(entriesAtom);
    projectMocks.listEntries.mockReturnValue(entriesAtom);
    atomHooks.registry = registry;
    let renderedPaths: readonly string[] = [];

    const render = (mutationId: string | null) => {
      reactHooks.beginRender();
      const query = useProjectEntriesQuery(environmentId, "/repo");
      renderedPaths = query.data?.entries.map((entry) => entry.path) ?? [];
      useWorkspaceMutationRefresh({
        mutationId,
        refresh: query.refresh,
        resourceKey: "files:environment-1:/repo",
      });
    };

    try {
      await flushEffects();
      expect(requests).toHaveLength(1);
      requests[0]!.resolve(projectEntries(["src/old.ts"]));
      await flushEffects();

      render("mutation-1");
      expect(renderedPaths).toEqual(["src/old.ts"]);
      await flushEffects();
      expect(requests).toHaveLength(2);

      requests[1]!.resolve(projectEntries(["src/new.ts"]));
      await flushEffects();
      render("mutation-1");
      expect(renderedPaths).toEqual(["src/new.ts"]);
      expect(requests).toHaveLength(2);
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });

  it("does not issue a file read for a disabled image preview", async () => {
    const requests: Array<ReturnType<typeof deferred<ProjectReadFileResult>>> = [];
    const readAtom = Atom.make(
      Effect.promise(() => {
        const request = deferred<ProjectReadFileResult>();
        requests.push(request);
        return request.promise;
      }),
    );
    const registry = AtomRegistry.make();
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", "preview.png", false);
      useWorkspaceMutationRefresh({
        enabled: false,
        mutationId: "mutation-1",
        refresh: query.refresh,
        resourceKey: "file:environment-1:/repo:preview.png",
      });
      await flushEffects();

      expect(projectMocks.readFile).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
    } finally {
      registry.dispose();
      atomHooks.registry = null;
    }
  });

  it("reports a directory named like an image as not a file", async () => {
    const readAtom = Atom.make(
      Effect.fail(
        new ProjectReadFileError({
          cwd: "/repo",
          relativePath: "assets.png",
          failure: "path_not_file",
        }),
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      await flushEffects();
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", "assets.png");
      expect(query.isNotFile).toBe(true);
      expect(query.data).toBeNull();
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });

  it("reports a directory read as not a file", async () => {
    const readAtom = Atom.make(
      Effect.fail(
        new ProjectReadFileError({
          cwd: "/repo",
          relativePath: ".agents/skills",
          failure: "path_not_file",
        }),
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      await flushEffects();
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", ".agents/skills");
      expect(query.isNotFile).toBe(true);
      expect(query.data).toBeNull();
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });
});
