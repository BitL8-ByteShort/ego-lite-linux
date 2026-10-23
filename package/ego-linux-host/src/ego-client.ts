import { invalid } from "./errors.js";
import type { TaskLease } from "./protocol.js";
import type { HostConnection } from "./transport.js";
export function createEgoAdapter(connection: HostConnection, hello: any) {
  let selected: number | undefined;
  const leases = new Map<number, TaskLease>();
  let onMessage: any, onError: any;
  const argsCheck = (
    args: any[],
    min: number,
    max: number,
    types: string[],
  ) => {
    if (
      args.length < min ||
      args.length > max ||
      args.some((a, i) => typeof a !== types[i])
    )
      invalid("Invalid native arguments");
  };
  const lease = async (id = selected) => {
    if (id === undefined)
      throw Object.assign(new Error("Task space not selected"), {
        error_code: "EGO_TASK_SPACE_NOT_SELECTED",
      });
    let l = leases.get(id);
    if (!l) {
      l = await connection.call("acquire", [id]);
      leases.set(id, l!);
    }
    return l!;
  };
  const invoke = async (
    method: string,
    args: any[],
    scoped = true,
    reject = false,
  ) => {
    const id = selected;
    try {
      return await connection.call(
        method,
        args,
        scoped ? await lease(id) : undefined,
      );
    } catch (e) {
      if (reject) throw e;
      return {
        error: (e as Error).message,
        error_code: (e as any).error_code || "EGO_OPERATION_FAILED",
      };
    }
  };
  const ego: any = {
    supportsSnapshotRootFrameId: true,
    getBrowserVersion: async (...args: any[]) => {
      argsCheck(args, 0, 0, []);
      return {
        currentVersion: `community-linux ${hello.version.product}`,
        updateAvailable: false,
      };
    },
    useTaskSpace(...args: any[]) {
      argsCheck(args, 1, 1, ["number"]);
      if (!Number.isSafeInteger(args[0])) invalid("Task ID must be an integer");
      selected = args[0];
      return selected;
    },
    listProfiles(...args: any[]) {
      argsCheck(args, 0, 0, []);
      return invoke("listProfiles", [], false);
    },
    listTaskSpaces(...args: any[]) {
      argsCheck(args, 0, 0, []);
      return invoke("listTaskSpaces", [], false);
    },
    createTaskSpace(...args: any[]) {
      argsCheck(args, 1, 2, ["string", "string"]);
      if (!args[0].trim()) invalid("Task name required");
      return invoke("createTaskSpace", args, false);
    },
    claimTaskSpace(...args: any[]) {
      argsCheck(args, 1, 2, ["number", "string"]);
      leases.delete(args[0]);
      return invoke("claimTaskSpace", args, false);
    },
    createTab(...args: any[]) {
      argsCheck(args, 1, 1, ["string"]);
      return invoke("createTab", args);
    },
    snapshot(...args: any[]) {
      if (
        args.length > 1 ||
        (args[0] !== undefined && (!args[0] || typeof args[0] !== "object"))
      )
        invalid("Snapshot options must be an object");
      return invoke("snapshot", args, true, true);
    },
    sendCDPMessage(...args: any[]) {
      argsCheck(args, 1, 1, ["string"]);
      const id = selected;
      let message: any;
      try {
        message = JSON.parse(args[0]);
      } catch {
        invalid("CDP message must be JSON");
      }
      void lease(id)
        .then((l) => connection.call("cdp", [message], l, 60000))
        .then(
          (result) =>
            setImmediate(() =>
              onMessage?.(
                JSON.stringify({
                  id: message.id,
                  result,
                  ...(message.sessionId
                    ? { sessionId: message.sessionId }
                    : {}),
                }),
              ),
            ),
          (error) =>
            setImmediate(() => {
              const protocolError = typeof error.code === "number";
              if (error.error_code && !protocolError)
                onError?.(error.message, error.error_code);
              else
                onMessage?.(
                  JSON.stringify({
                    id: message.id,
                    error: {
                      message: error.message,
                      code: protocolError ? error.code : -32000,
                    },
                    ...(message.sessionId
                      ? { sessionId: message.sessionId }
                      : {}),
                  }),
                );
            }),
        );
    },
  };
  for (const method of [
    "listTabs",
    "closeTaskSpace",
    "completeTaskSpace",
    "handOffTaskSpace",
    "checkTaskSpaceCompletion",
  ])
    ego[method] = (...args: any[]) => {
      argsCheck(args, 0, 0, []);
      const result = invoke(method, args);
      if (method !== "listTabs") leases.delete(selected!);
      return result;
    };
  ego.takeOverTaskSpace = (...args: any[]) => {
    argsCheck(args, 0, 0, []);
    const id = selected;
    leases.delete(id!);
    return invoke("takeOver", [id], false);
  };
  ego.setAgentTaskState = (...args: any[]) => {
    argsCheck(args, 1, 1, ["string"]);
    return invoke("setAgentTaskState", args);
  };
  ego.animationHighlightMouseToPosition = (...args: any[]) => {
    argsCheck(args, 2, 2, ["number", "number"]);
    return invoke("animationHighlightMouseToPosition", args);
  };
  Object.defineProperties(ego, {
    onCDPMessage: {
      get: () => onMessage,
      set: (v) => (onMessage = typeof v === "function" ? v : undefined),
    },
    onSendCDPMessageError: {
      get: () => onError,
      set: (v) => (onError = typeof v === "function" ? v : undefined),
    },
  });
  connection.onEvent = ({ event, context }) => {
    const l = leases.get(context?.taskId);
    if (
      !l ||
      l.epoch !== context.epoch ||
      l.generation !== context.generation ||
      l.capability !== context.capability
    )
      return;
    setImmediate(() => onMessage?.(JSON.stringify(event)));
  };
  return ego;
}
