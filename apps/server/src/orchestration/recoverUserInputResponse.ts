import {
  CommandId,
  EventId,
  UserInputRequestedPayload,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

type Response = Extract<
  OrchestrationEvent,
  { type: "thread.user-input-response-requested" }
>["payload"];

/** Only user questions can become messages. Approval callbacks never come here. */
export const recoverUserInputResponse = Effect.fn("recoverUserInputResponse")(function* (
  response: Response,
  snapshots: ProjectionSnapshotQuery["Service"],
  engine: OrchestrationEngineService["Service"],
) {
  const activity = yield* snapshots.getUserInputActivity(response);
  if (Option.isNone(activity)) return false;
  const request = activity.value;
  if (request.kind === "user-input.resolved") return true;
  if (request.kind !== "user-input.requested") return false;
  const payload = Schema.decodeUnknownOption(UserInputRequestedPayload)(request.payload);
  if (Option.isNone(payload)) return false;
  const answers: Record<string, string> = {};
  for (const question of payload.value.questions) {
    const answer = response.answers[question.id];
    if (typeof answer === "string") answers[question.id] = answer;
    else if (Array.isArray(answer) && answer.every((value) => typeof value === "string")) {
      answers[question.id] = answer.join("\n");
    } else return false;
  }
  const key = `recovered-input:${response.threadId}:${response.requestId}`;
  // If interrupted here, the durable question remains answerable as a message.
  // The existing message-response command commits its resolution and turn together.
  yield* engine.dispatch({
    type: "thread.activity.append",
    commandId: CommandId.make(`${key}:convert`),
    threadId: response.threadId,
    createdAt: response.createdAt,
    activity: {
      ...request,
      id: EventId.make(`${key}:request`),
      summary: "Agent restarted; answer continues the conversation",
      payload: { ...payload.value, requestId: response.requestId, responseMode: "message" },
      createdAt: response.createdAt,
    },
  });
  yield* engine.dispatch({
    type: "thread.user-input.respond",
    commandId: CommandId.make(`${key}:answer`),
    ...response,
    answers,
  });
  yield* Effect.logInfo("Recovered user input as a follow-up message", {
    threadId: response.threadId,
    requestId: response.requestId,
  });
  return true;
});
