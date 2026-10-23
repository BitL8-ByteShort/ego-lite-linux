import { randomBytes } from "node:crypto";
import type { TaskLease } from "./protocol.js";
import { egoError } from "./errors.js";
export type TaskRecord = {
  id: number;
  taskId: string;
  name: string;
  profileId: string;
  agentId: string;
  ownership: "agent" | "user" | "agentDelegatedToUser";
  createdBy: "agent" | "user";
  state: string;
  epoch: number;
  hardPaused: boolean;
  completed: boolean;
  closed: boolean;
  lastError?: string;
};
export class TaskRegistry {
  tasks = new Map<number, TaskRecord>();
  private leases = new Map<number, TaskLease>();
  private next = 0;
  constructor(
    readonly generation: string,
    records: TaskRecord[] = [],
  ) {
    for (const record of records) {
      this.next = Math.max(this.next, record.id);
      this.tasks.set(record.id, {
        ...record,
        ownership: "user",
        hardPaused: true,
        epoch: record.epoch + 1,
      });
    }
  }
  create(name: string, profileId: string, agentId: string) {
    const id = ++this.next;
    const task: TaskRecord = {
      id,
      taskId: name,
      name,
      profileId,
      agentId,
      ownership: "agent",
      createdBy: "agent",
      state: "Ready",
      epoch: 0,
      hardPaused: false,
      completed: false,
      closed: false,
    };
    this.tasks.set(id, task);
    return task;
  }
  createUser(name: string, profileId: string) {
    if (typeof name !== "string" || !name.trim())
      throw new Error("Task name required");
    const task = this.create(name, profileId, "");
    task.createdBy = "user";
    task.ownership = "user";
    task.hardPaused = true;
    task.state = "Awaiting an agent";
    return task;
  }
  grant(id: number, agentId: string) {
    if (typeof agentId !== "string" || !agentId.trim() || agentId.length > 128)
      throw new Error("Enter the agent workflow identity");
    const task = this.get(id);
    this.leases.delete(id);
    task.agentId = agentId;
    task.hardPaused = false;
    task.ownership = "agent";
    task.completed = false;
    task.epoch++;
    task.state = "Ready";
    return task;
  }
  get(id: number) {
    const t = this.tasks.get(id);
    if (!t || t.closed)
      throw egoError("EGO_TASK_SPACE_NOT_FOUND", `Task space not found: ${id}`);
    return t;
  }
  acquire(id: number, agentId: string, clientId: string) {
    const t = this.get(id);
    if (t.agentId !== agentId)
      throw egoError(
        "EGO_TASK_SPACE_UNAVAILABLE",
        "Task belongs to another owner",
      );
    if (t.ownership !== "agent" || t.hardPaused)
      throw egoError("EGO_TASK_SPACE_USER_IN_CONTROL", "manual_takeover");
    const old = this.leases.get(id);
    if (old && old.clientId !== clientId)
      throw egoError("EGO_TASK_SPACE_UNAVAILABLE", "Task has an active lease");
    if (old) return old;
    const lease = {
      taskId: id,
      agentId,
      clientId,
      capability: randomBytes(32).toString("hex"),
      epoch: t.epoch,
      generation: this.generation,
    };
    this.leases.set(id, lease);
    return lease;
  }
  assert(lease: TaskLease) {
    const t = this.get(lease?.taskId);
    const actual = this.leases.get(t.id);
    if (t.ownership !== "agent" || t.hardPaused)
      throw egoError("EGO_TASK_SPACE_USER_IN_CONTROL", "manual_takeover");
    if (
      !actual ||
      lease.generation !== this.generation ||
      actual.capability !== lease.capability ||
      actual.clientId !== lease.clientId ||
      actual.agentId !== lease.agentId ||
      t.epoch !== lease.epoch
    )
      throw egoError("EGO_TASK_SPACE_INACTIVE", "Task lease or epoch expired");
    return t;
  }
  disconnect(clientId: string) {
    for (const [id, l] of this.leases)
      if (l.clientId === clientId) this.leases.delete(id);
  }
  revoke(id: number, reason: string) {
    const t = this.get(id);
    t.epoch++;
    t.ownership =
      reason === "handoff" || reason === "user-pause"
        ? "agentDelegatedToUser"
        : "user";
    t.hardPaused = reason === "user-pause" || t.hardPaused;
    t.completed = reason === "complete";
    t.closed = reason === "close";
    t.state = reason;
    this.leases.delete(id);
    return t;
  }
  takeOver(id: number, agentId: string, claim = false) {
    const t = this.get(id);
    if (t.agentId !== agentId)
      throw egoError(
        "EGO_TASK_SPACE_UNAVAILABLE",
        "Task belongs to another owner",
      );
    if (t.hardPaused)
      throw egoError(
        "EGO_TASK_SPACE_USER_IN_CONTROL",
        "Task is paused by user; Resume agent in Spaces",
      );
    if (t.completed && !claim)
      throw egoError(
        "EGO_TASK_SPACE_INACTIVE",
        "Completed task requires an explicit claim",
      );
    this.leases.delete(id);
    t.ownership = "agent";
    t.completed = false;
    t.epoch++;
    return t;
  }
  resume(id: number) {
    const t = this.get(id);
    this.leases.delete(id);
    t.hardPaused = false;
    t.ownership = "agent";
    t.completed = false;
    t.epoch++;
    t.state = "Ready";
    return t;
  }
}
