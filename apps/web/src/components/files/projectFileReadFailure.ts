import { ProjectReadFileError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const isProjectReadFileError = Schema.is(ProjectReadFileError);

/** Preserve the server's failure category and the underlying filesystem reason. */
export function projectFileReadErrorMessage(error: ProjectReadFileError): string {
  const path = error.resolvedPath ?? error.relativePath ?? "This path";
  switch (error.failure) {
    case "path_not_file":
      return `${path} is a folder or another non-file entry.`;
    case "binary_file":
      return `${path} is a binary file and cannot be previewed as text.`;
    case "workspace_path_outside_root":
      return `${path} is outside the allowed workspace root.`;
    case "resolved_path_outside_root":
      return `${path} resolves outside the allowed workspace root.`;
    case "operation_failed": {
      let cause: unknown = error.cause;
      for (let depth = 0; depth < 6 && cause !== null && typeof cause === "object"; depth += 1) {
        const node = cause as {
          code?: unknown;
          reason?: unknown;
          message?: unknown;
          cause?: unknown;
        };
        const reason =
          typeof node.reason === "object" && node.reason !== null && "_tag" in node.reason
            ? node.reason._tag
            : node.reason;
        if (
          node.code === "ENOENT" ||
          reason === "NotFound" ||
          (typeof node.message === "string" && /\bENOENT\b/.test(node.message))
        ) {
          return `${path} could not be found. It may have been moved or deleted.`;
        }
        if (
          node.code === "EACCES" ||
          node.code === "EPERM" ||
          reason === "PermissionDenied" ||
          (typeof node.message === "string" && /\b(?:EACCES|EPERM)\b/.test(node.message))
        ) {
          return `Permission denied while reading ${path}.`;
        }
        cause = node.cause;
      }
      return `The ${error.operation ?? "read"} operation failed for ${error.operationPath ?? path}.`;
    }
    default:
      return error.message;
  }
}
