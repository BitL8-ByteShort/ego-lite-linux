import { DownloadRouter } from "./downloads.js";
import { TaskRegistry, type TaskRecord } from "./task-registry.js";
import type { TaskLease } from "./protocol.js";
import { egoError, invalid } from "./errors.js";
import { assertMethod, validateEmbedded } from "./cdp-policy.js";
import { LinuxSnapshot } from "./snapshot-engine.js";
type Client = {
  id: string;
  agentId: string;
  send: (event: any) => void;
  closed: boolean;
  discovery: Set<number>;
};
type Session = {
  clientId: string;
  taskId: number;
  targetId: string;
  epoch: number;
  parent?: string;
  internal?: boolean;
  automationEnabled?: boolean;
};
export class LinuxHost {
  readonly registry: TaskRegistry;
  private clients = new Map<string, Client>();
  private targets = new Map<string, number>();
  private sessions = new Map<string, Session>();
  private active = new Map<number, string>();
  private infos = new Map<string, any>();
  private downloads = new Map<string, number>();
  private pendingCommands = new Map<number, Set<() => void>>();
  onChange: () => Promise<void> = async () => {};
  async createUserTask(name: string) {
    const task = this.registry.createUser(name, this.profileId);
    const target = await this.chrome.bridge.call("Target.createTarget", {
      url: "about:blank",
      background: true,
      newWindow: true,
    });
    this.targets.set(target.targetId, task.id);
    this.active.set(task.id, target.targetId);
    await this.onChange();
    return task;
  }
  async grantTask(id: number, agentId: string) {
    await this.pause(id);
    const task = this.registry.grant(id, agentId);
    await this.onChange();
    return task;
  }
  recordError(client: any, context: any, error: Error) {
    const task = this.registry.tasks.get(context?.taskId);
    if (task && task.agentId === client?.agentId) {
      task.lastError = error.message;
      void this.onChange().catch(() => {});
    }
  }
  private reservedTargets = new Set<string>();
  reserveTarget(targetId: string) {
    this.reservedTargets.add(targetId);
  }
  async inbox() {
    const { targetInfos = [] } =
      await this.chrome.bridge.call("Target.getTargets");
    return targetInfos
      .filter(
        (t: any) =>
          t.type === "page" &&
          !this.targets.has(t.targetId) &&
          !this.reservedTargets.has(t.targetId),
      )
      .map((t: any) => ({ targetId: t.targetId, title: t.title, url: t.url }));
  }
  async assignInbox(taskId: number, targetId: string) {
    this.registry.get(taskId);
    if (
      this.reservedTargets.has(targetId) ||
      (await this.inbox()).every((t: any) => t.targetId !== targetId)
    )
      throw new Error("Target is reserved or not in the user inbox");
    this.targets.set(targetId, taskId);
    this.active.set(taskId, targetId);
    await this.onChange();
    return { assigned: true };
  }

  private frameTargets = new Map<string, string>();
  private downloadRouter?: DownloadRouter;
  initializeDownloads(
    root: string,
    modeChange?: (active: boolean) => Promise<unknown>,
  ) {
    this.downloadDirectory = root;
    this.downloadRouter = new DownloadRouter(
      root,
      (o) => {
        try {
          const c = this.clients.get(o.clientId);
          if (!c) return false;
          const lease = this.acquire(c, o.taskId);
          return lease.epoch === o.epoch;
        } catch {
          return false;
        }
      },
      (o, event) => {
        const c = this.clients.get(o.clientId);
        if (!c) return;
        for (const [sessionId, s] of this.sessions)
          if (
            s.clientId === c.id &&
            s.taskId === o.taskId &&
            s.targetId === o.targetId &&
            !s.internal &&
            s.epoch === o.epoch
          ) {
            c.send({
              event: { ...event, sessionId },
              context: this.acquire(c, o.taskId),
            });
          }
      },
      modeChange,
    );
  }
  constructor(
    readonly chrome: any,
    readonly profileId: string,
    records: TaskRecord[],
  ) {
    this.registry = new TaskRegistry(chrome.generation, records);
    chrome.bridge.onEvent = (e: any) => this.onEvent(e);
  }
  add(id: string, agentId: string, send: (event: any) => void): Client {
    const c = {
      id,
      agentId,
      send,
      closed: false,
      discovery: new Set<number>(),
    };
    this.clients.set(id, c);
    return c;
  }
  disconnect(c: Client) {
    c.closed = true;
    this.downloadRouter?.disconnect(c.id);
    this.clients.delete(c.id);
    this.registry.disconnect(c.id);
    for (const [id, s] of this.sessions)
      if (s.clientId === c.id) {
        this.sessions.delete(id);
        void this.chrome.bridge
          .call("Target.detachFromTarget", { sessionId: id })
          .catch(() => {});
      }
  }
  acquire(c: Client, id: number) {
    return this.registry.acquire(id, c.agentId, c.id);
  }
  private check(c: Client, l: TaskLease) {
    if (c.closed || l?.clientId !== c.id || l?.agentId !== c.agentId)
      throw egoError("EGO_TASK_SPACE_INACTIVE", "Wrong task client");
    return this.registry.assert(l);
  }
  private session(c: Client, l: TaskLease, id: string) {
    const s = this.sessions.get(id);
    if (
      !s ||
      s.clientId !== c.id ||
      s.taskId !== l.taskId ||
      s.epoch !== l.epoch
    )
      throw egoError(
        "EGO_CDP_SEND_FAILED",
        "Session does not belong to this task/client/epoch",
      );
    return s;
  }
  private target(l: TaskLease, id: string) {
    if (this.targets.get(id) !== l.taskId)
      throw egoError(
        "EGO_CDP_SEND_FAILED",
        "Target does not belong to this task",
      );
  }
  private onEvent(e: any) {
    if (e.method.startsWith("Browser.download")) {
      void this.downloadRouter
        ?.event(
          e,
          (id) =>
            this.frameTargets.get(id) ||
            (this.targets.has(id) ? id : undefined),
        )
        .catch(() => {});
      return;
    }
    // The router emits completion only after its staged file has been copied.
    // Raw Page events can arrive earlier and must not race that receipt.
    if (
      this.downloadRouter &&
      ["Page.downloadWillBegin", "Page.downloadProgress"].includes(e.method)
    )
      return;
    if (e.method === "Page.frameNavigated" && e.sessionId) {
      const s = this.sessions.get(e.sessionId);
      if (s) this.frameTargets.set(e.params.frame.id, s.targetId);
    }
    const info = e.params?.targetInfo;
    const id = info?.targetId || e.params?.targetId;
    if (info) this.infos.set(info.targetId, info);
    if (
      info?.openerId &&
      this.targets.has(info.openerId) &&
      info.type === "page"
    ) {
      const taskId = this.targets.get(info.openerId)!;
      try {
        const t = this.registry.get(taskId);
        if (t.ownership === "agent" && !t.hardPaused)
          this.targets.set(info.targetId, taskId);
      } catch {}
    }
    const parent = this.sessions.get(e.sessionId);
    if (
      e.method === "Target.attachedToTarget" &&
      parent &&
      ["iframe", "worker"].includes(info?.type)
    ) {
      this.targets.set(info.targetId, parent.taskId);
      this.sessions.set(e.params.sessionId, {
        ...parent,
        targetId: info.targetId,
        parent: e.sessionId,
        automationEnabled: true,
      });
    }
    if (e.sessionId) {
      const s = this.sessions.get(e.sessionId);
      if (!s || s.internal) return;
      if (
        e.method === "Runtime.consoleAPICalled" &&
        s.automationEnabled !== false
      )
        return;
      const c = this.clients.get(s.clientId);
      if (!c) return;
      try {
        const l = this.registry.acquire(s.taskId, c.agentId, c.id);
        this.check(c, l);
        if (l.epoch !== s.epoch) return;
        if (
          e.method === "Target.attachedToTarget" &&
          !this.sessions.has(e.params.sessionId)
        )
          return;
        if (e.method === "Page.downloadWillBegin")
          this.downloads.set(e.params.guid, s.taskId);
        c.send({ event: e, context: l });
      } catch {}
    } else if (
      [
        "Target.targetCreated",
        "Target.targetInfoChanged",
        "Target.targetDestroyed",
        "Target.detachedFromTarget",
      ].includes(e.method)
    ) {
      for (const c of this.clients.values()) {
        const tid =
          this.targets.get(id) ||
          this.sessions.get(e.params?.sessionId)?.taskId;
        if (tid === undefined || !c.discovery.has(tid)) continue;
        try {
          const l = this.registry.acquire(tid, c.agentId, c.id);
          this.check(c, l);
          c.send({ event: e, context: l });
        } catch {}
      }
    }
    if (e.method === "Target.targetDestroyed") {
      this.targets.delete(id);
      for (const [sid, s] of this.sessions)
        if (s.targetId === id) this.sessions.delete(sid);
    }
    if (e.method === "Target.detachedFromTarget")
      this.sessions.delete(e.params.sessionId);
  }
  private async targetsFor(id: number) {
    const { targetInfos = [] } =
      await this.chrome.bridge.call("Target.getTargets");
    for (const info of targetInfos) this.infos.set(info.targetId, info);
    return targetInfos.filter((t: any) => this.targets.get(t.targetId) === id);
  }
  private async discoverTaskFrames(
    c: Client,
    l: TaskLease,
    rootSessionId: string,
  ) {
    this.check(c, l);
    const root = this.session(c, l, rootSessionId);
    this.target(l, root.targetId);
    const { targetInfos = [] } =
      await this.chrome.bridge.call("Target.getTargets");
    this.check(c, l);
    const descendants = new Set<string>();
    const inspected = new Set<string>();
    const addTree = (tree: any) => {
      for (const child of tree?.childFrames ?? []) {
        if (typeof child?.frame?.id !== "string")
          throw egoError("EGO_SNAPSHOT_FAILED", "Invalid child frame topology");
        descendants.add(child.frame.id);
        addTree(child);
      }
    };
    const inspect = async (sid: string, targetId: string) => {
      this.check(c, l);
      this.session(c, l, sid);
      const { frameTree } = await this.chrome.bridge.call(
        "Page.getFrameTree",
        {},
        sid,
      );
      this.check(c, l);
      if (frameTree?.frame?.id !== targetId)
        throw egoError(
          "EGO_SNAPSHOT_FAILED",
          "Frame topology does not match the owned target",
        );
      inspected.add(sid);
      addTree(frameTree);
      this.check(c, l);
      await this.chrome.bridge.call("Accessibility.enable", {}, sid);
      this.check(c, l);
      const frameIds: string[] = [];
      const collect = (tree: any) => {
        frameIds.push(tree.frame.id);
        for (const child of tree.childFrames ?? []) collect(child);
      };
      collect(frameTree);
      for (const frameId of frameIds) {
        this.check(c, l);
        let nodes: any[];
        try {
          nodes =
            (
              await this.chrome.bridge.call(
                "Accessibility.getFullAXTree",
                { frameId },
                sid,
              )
            ).nodes ?? [];
        } catch (error) {
          this.check(c, l);
          if (
            frameId !== targetId &&
            targetInfos.some(
              (info: any) =>
                info.targetId === frameId && info.type === "iframe",
            )
          )
            continue;
          throw error;
        }
        this.check(c, l);
        for (const node of nodes) {
          if (
            !["Iframe", "IframePresentational"].includes(node.role?.value) ||
            !Number.isSafeInteger(node.backendDOMNodeId)
          )
            continue;
          this.check(c, l);
          const result = await this.chrome.bridge.call(
            "DOM.describeNode",
            { backendNodeId: node.backendDOMNodeId, depth: 0 },
            sid,
          );
          this.check(c, l);
          if (result.node?.backendNodeId !== node.backendDOMNodeId)
            throw egoError(
              "EGO_SNAPSHOT_FAILED",
              "Frame owner identity changed",
            );
          if (
            typeof result.node.frameId === "string" &&
            result.node.frameId !== frameId
          )
            descendants.add(result.node.frameId);
        }
      }
    };
    await inspect(rootSessionId, root.targetId);
    // A child renderer can contain further OOPIFs that the parent renderer does
    // not report. Extend only through current, owned sessions already proven by
    // the root's topology, never through browserContextId or an opener hint.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [sid, s] of this.sessions) {
        if (
          inspected.has(sid) ||
          s.clientId !== c.id ||
          s.taskId !== l.taskId ||
          s.epoch !== l.epoch ||
          !descendants.has(s.targetId) ||
          !targetInfos.some(
            (info: any) =>
              info.targetId === s.targetId && info.type === "iframe",
          )
        )
          continue;
        await inspect(sid, s.targetId);
        changed = true;
      }
    }
    const allowed = targetInfos.filter(
      (info: any) => info.type === "iframe" && descendants.has(info.targetId),
    );
    for (const info of allowed) {
      const owner = this.targets.get(info.targetId);
      if (owner !== undefined && owner !== l.taskId)
        throw egoError(
          "EGO_CDP_SEND_FAILED",
          "Frame target belongs to another task",
        );
      this.targets.set(info.targetId, l.taskId);
      this.infos.set(info.targetId, info);
    }
    return allowed;
  }
  private async create(c: Client, l: TaskLease, url: string) {
    this.check(c, l);
    if (typeof url !== "string") invalid("URL must be a string");
    const r = await this.chrome.bridge.call("Target.createTarget", {
      url,
      background: true,
      newWindow: true,
    });
    try {
      this.check(c, l);
    } catch (e) {
      await this.chrome.bridge
        .call("Target.closeTarget", { targetId: r.targetId })
        .catch(() => {});
      throw e;
    }
    this.targets.set(r.targetId, l.taskId);
    this.active.set(l.taskId, r.targetId);
    return r;
  }
  async pause(id: number, reason = "user-pause") {
    this.registry.revoke(id, reason);
    for (const reject of this.pendingCommands.get(id) ?? []) reject();
    this.downloadRouter?.revoke(id);
    const pending: any[] = [];
    for (const c of this.clients.values()) c.discovery.delete(id);
    for (const [sid, s] of this.sessions) {
      if (s.taskId !== id) continue;
      this.sessions.delete(sid);
      pending.push(
        (async () => {
          for (const method of [
            "Runtime.terminateExecution",
            "Fetch.disable",
            "Debugger.resume",
          ])
            await this.chrome.bridge.call(method, {}, sid, 400).catch(() => {});
          await this.chrome.bridge
            .call("Target.detachFromTarget", { sessionId: sid }, undefined, 800)
            .catch(() => {});
        })(),
      );
    }
    await Promise.all(pending);
    await this.onChange();
    return { acknowledged: true, inFlightWebsiteActionsMayHaveCompleted: true };
  }
  async resume(id: number) {
    this.registry.resume(id);
    await this.onChange();
    return {};
  }
  summaries() {
    return [...this.registry.tasks.values()]
      .filter((t) => !t.closed)
      .map((t) => ({
        ...t,
        recentTabTitles: [...this.infos.values()]
          .filter((i) => this.targets.get(i.targetId) === t.id)
          .map((i) => i.title)
          .slice(-5),
      }));
  }
  async reveal(id: number) {
    if (this.chrome.headless)
      throw egoError(
        "EGO_OPERATION_FAILED",
        "Reveal and human control need a headed Linux desktop",
      );
    const tabs = await this.targetsFor(id);
    const targetId = this.active.get(id) || tabs[0]?.targetId;
    if (targetId)
      await this.chrome.bridge.call("Target.activateTarget", { targetId });
    return {
      message: process.env.WAYLAND_DISPLAY
        ? "Select the browser window if your compositor refuses activation."
        : "Task revealed",
    };
  }
  async closeTask(id: number) {
    const tabs = await this.targetsFor(id);
    await this.pause(id, "close");
    await Promise.all(
      tabs.map((t: any) =>
        this.chrome.bridge
          .call("Target.closeTarget", { targetId: t.targetId })
          .catch(() => {}),
      ),
    );
    return `${id} task space closed.`;
  }
  private async cdp(c: Client, l: TaskLease, m: any) {
    this.check(c, l);
    const method = m?.method,
      p = m?.params || {},
      sid = m?.sessionId;
    let s: Session | undefined;
    if (sid) s = this.session(c, l, sid);
    if (typeof method !== "string") invalid("CDP method required");
    validateEmbedded(
      p,
      (id) => this.target(l, id),
      (id) => this.session(c, l, id),
    );
    const call = async (method: string, p: any = {}, sessionId?: string) => {
      this.check(c, l);
      let rejectRevoked!: () => void;
      const revoked = new Promise<never>((_, reject) => {
        rejectRevoked = () => {
          try {
            this.check(c, l);
          } catch (error) {
            reject(error);
            return;
          }
          reject(egoError("EGO_TASK_SPACE_INACTIVE", "Task command revoked"));
        };
      });
      let pending = this.pendingCommands.get(l.taskId);
      if (!pending) this.pendingCommands.set(l.taskId, (pending = new Set()));
      pending.add(rejectRevoked);
      try {
        // SDK requests carry their own deadlines/classification. Leave enough
        // room for those timers instead of racing the host's 15s timer. A hard
        // pause rejects the response immediately even when Chrome stays busy.
        const r = await Promise.race([
          this.chrome.bridge.call(method, p, sessionId, 60_000),
          revoked,
        ]);
        this.check(c, l);
        return r;
      } finally {
        pending.delete(rejectRevoked);
        if (!pending.size) this.pendingCommands.delete(l.taskId);
      }
    };
    if (method === "Browser.getVersion") return call(method);
    if (method === "Target.getTargets")
      return { targetInfos: await this.targetsFor(l.taskId) };
    if (method === "Target.setDiscoverTargets") {
      if (p.discover) c.discovery.add(l.taskId);
      else c.discovery.delete(l.taskId);
      return {};
    }
    if (method === "Target.createTarget")
      return this.create(c, l, p.url || "about:blank");
    if (
      [
        "Target.attachToTarget",
        "Target.getTargetInfo",
        "Target.closeTarget",
        "Target.activateTarget",
      ].includes(method)
    ) {
      const targetId = p.targetId || s?.targetId;
      this.target(l, targetId);
      if (method === "Target.activateTarget") {
        this.active.set(l.taskId, targetId);
        return {};
      }
      const r = await call(method, {
        targetId,
        ...(method === "Target.attachToTarget" ? { flatten: true } : {}),
      });
      if (method === "Target.attachToTarget") {
        this.sessions.set(r.sessionId, {
          clientId: c.id,
          taskId: l.taskId,
          targetId,
          epoch: l.epoch,
        });
        if (this.infos.get(targetId)?.type === "page") {
          try {
            // A popup can hide its opener and stall native input/rAF. DevTools
            // focus emulation keeps this task Page active without selecting a
            // tab/window or moving physical focus. Session detach removes it.
            await call(
              "Emulation.setFocusEmulationEnabled",
              { enabled: true },
              r.sessionId,
            );
          } catch (error) {
            this.sessions.delete(r.sessionId);
            await this.chrome.bridge
              .call(
                "Target.detachFromTarget",
                { sessionId: r.sessionId },
                undefined,
                800,
              )
              .catch(() => {});
            throw error;
          }
        }
      }
      return r;
    }
    if (method === "Target.detachFromTarget") {
      const detached = this.session(c, l, p.sessionId);
      if (sid && sid !== detached.parent)
        throw egoError(
          "EGO_CDP_SEND_FAILED",
          "Wrong parent session for detach",
        );
      const result = await call(
        method,
        { sessionId: p.sessionId },
        detached.parent,
      );
      this.sessions.delete(p.sessionId);
      return result;
    }
    if (method === "Browser.cancelDownload") {
      if (
        this.downloads.get(p.guid) !== l.taskId &&
        !this.downloadRouter?.owns(p.guid, l.taskId)
      )
        throw egoError("EGO_CDP_SEND_FAILED", "Foreign download");
      return call(method, { guid: p.guid });
    }
    if (!s)
      throw egoError("EGO_CDP_SEND_FAILED", "A task-owned session is required");
    if (method === "Target.setAutoAttach") {
      if (p.flatten !== true) invalid("Only flat sessions supported");
      return call(
        method,
        {
          autoAttach: !!p.autoAttach,
          waitForDebuggerOnStart: p.waitForDebuggerOnStart === true,
          flatten: true,
          filter: [
            { type: "iframe", exclude: false },
            { type: "worker", exclude: false },
            { exclude: true },
          ],
        },
        sid,
      );
    }
    // Coordinate shared-context download allowance while keeping destinations
    // and completed-file delivery scoped to the verified task.
    if (method === "Page.setDownloadBehavior") {
      if (!["allow", "default"].includes(p.behavior))
        invalid("Unsupported download behavior");
      await this.downloadRouter?.arm(
        s.targetId,
        { taskId: l.taskId, clientId: c.id, epoch: l.epoch },
        p.behavior === "allow" ? p.downloadPath : undefined,
      );
      return {};
    }
    // Compatibility only: host-side event filtering cannot reproduce the
    // proprietary browser's renderer-side anti-detection behavior.
    if (method === "egoAutomated.ping") return { result: "pong" };
    if (method === "egoAutomated.enable" || method === "egoAutomated.disable") {
      s.automationEnabled = method === "egoAutomated.enable";
      return {};
    }
    assertMethod(method);
    return call(method, p, sid);
  }
  downloadDirectory = "";
  async dispatch(
    c: Client,
    method: string,
    args: any[] = [],
    l?: TaskLease,
  ): Promise<any> {
    if (method === "listProfiles")
      return {
        profiles: [
          {
            id: this.profileId,
            name: this.profileId,
            isDefault: this.profileId === "default",
          },
        ],
      };
    if (method === "listTaskSpaces") return { taskSpaces: this.summaries() };
    if (method === "createTaskSpace") {
      if (typeof args[0] !== "string" || !args[0].trim())
        invalid("Task name required");
      if (args[1] && args[1] !== "default" && args[1] !== this.profileId)
        throw egoError("EGO_PROFILE_NOT_FOUND", "Profile not found");
      const t = this.registry.create(args[0], this.profileId, c.agentId);
      const lease = this.acquire(c, t.id);
      await this.create(c, lease, "about:blank");
      await this.onChange();
      return t;
    }
    if (method === "acquire") return this.acquire(c, args[0]);
    if (method === "claimTaskSpace" || method === "takeOver") {
      const id = method === "claimTaskSpace" ? args[0] : args[0];
      const t = this.registry.takeOver(
        id,
        c.agentId,
        method === "claimTaskSpace",
      );
      if (args[1]) t.name = t.taskId = args[1];
      await this.onChange();
      return t;
    }
    if (!l)
      throw egoError("EGO_TASK_SPACE_NOT_SELECTED", "Task space not selected");
    this.check(c, l);
    if (method === "cdp") return this.cdp(c, l, args[0]);
    if (method === "createTab") return this.create(c, l, args[0]);
    if (method === "listTabs") {
      const tabs = (await this.targetsFor(l.taskId)).filter(
        (t: any) => t.type === "page",
      );
      return {
        tabs: tabs.map((t: any, index: number) => ({
          ...t,
          index,
          active:
            t.targetId === (this.active.get(l.taskId) || tabs[0]?.targetId),
        })),
      };
    }
    if (method === "snapshot") {
      const tabs = await this.targetsFor(l.taskId);
      const targetId =
        this.active.get(l.taskId) ||
        tabs.find((t: any) => t.type === "page")?.targetId;
      if (!targetId)
        throw egoError("EGO_WEB_CONTENTS_UNAVAILABLE", "No task page");
      this.check(c, l);
      this.target(l, targetId);
      const { sessionId } = await this.chrome.bridge.call(
        "Target.attachToTarget",
        { targetId, flatten: true },
      );
      try {
        this.check(c, l);
      } catch (error) {
        await this.chrome.bridge
          .call("Target.detachFromTarget", { sessionId })
          .catch(() => {});
        throw error;
      }
      this.sessions.set(sessionId, {
        clientId: c.id,
        taskId: l.taskId,
        targetId,
        epoch: l.epoch,
        internal: true,
      });
      const snapshotSessions = new Set<string>([sessionId]);
      try {
        const snapshotCdp = async (m: string, p: any = {}, sid = sessionId) => {
          this.check(c, l);
          this.session(c, l, sid);
          if (!snapshotSessions.has(sid))
            throw egoError(
              "EGO_CDP_SEND_FAILED",
              "Session does not belong to this snapshot",
            );
          if (m === "Target.getTargets")
            return {
              targetInfos: await this.discoverTaskFrames(c, l, sessionId),
            };
          if (m === "Target.attachToTarget") {
            const frames = await this.discoverTaskFrames(c, l, sessionId);
            if (!frames.some((info: any) => info.targetId === p.targetId))
              throw egoError(
                "EGO_CDP_SEND_FAILED",
                "Frame target does not belong to this snapshot",
              );
            const result = await this.chrome.bridge.call(m, {
              targetId: p.targetId,
              flatten: true,
            });
            try {
              this.check(c, l);
            } catch (error) {
              await this.chrome.bridge
                .call("Target.detachFromTarget", {
                  sessionId: result.sessionId,
                })
                .catch(() => {});
              throw error;
            }
            this.sessions.set(result.sessionId, {
              clientId: c.id,
              taskId: l.taskId,
              targetId: p.targetId,
              epoch: l.epoch,
              parent: sid,
              internal: true,
            });
            snapshotSessions.add(result.sessionId);
            return result;
          }
          if (m === "Target.detachFromTarget") {
            if (p.sessionId === sessionId || !snapshotSessions.has(p.sessionId))
              throw egoError(
                "EGO_CDP_SEND_FAILED",
                "Cannot detach a session outside this snapshot",
              );
            this.session(c, l, p.sessionId);
            const result = await this.chrome.bridge.call(m, {
              sessionId: p.sessionId,
            });
            this.sessions.delete(p.sessionId);
            snapshotSessions.delete(p.sessionId);
            return result;
          }
          assertMethod(m);
          const result = await this.chrome.bridge.call(m, p, sid);
          this.check(c, l);
          return result;
        };
        return await new LinuxSnapshot(snapshotCdp, sessionId).snapshot(
          args[0],
        );
      } finally {
        for (const sid of [...snapshotSessions].reverse()) {
          this.sessions.delete(sid);
          await this.chrome.bridge
            .call("Target.detachFromTarget", { sessionId: sid })
            .catch(() => {});
        }
      }
    }
    if (method === "closeTaskSpace") return this.closeTask(l.taskId);
    if (method === "handOffTaskSpace" || method === "completeTaskSpace") {
      if (this.chrome.headless)
        throw egoError(
          "EGO_OPERATION_FAILED",
          "Human handoff requires a headed host; use EGO_LINUX_HEADLESS=0 with a display",
        );
      await this.pause(
        l.taskId,
        method === "completeTaskSpace" ? "complete" : "handoff",
      );
      await this.reveal(l.taskId);
      return `${l.taskId} handed off.`;
    }
    if (method === "setAgentTaskState") {
      this.registry.get(l.taskId).state = args[0];
      await this.onChange();
      return `${l.taskId} state updated.`;
    }
    if (method === "checkTaskSpaceCompletion") {
      if (this.chrome.headless)
        throw egoError(
          "EGO_OPERATION_FAILED",
          "Human handoff requires a headed host",
        );
      return {};
    }
    if (method === "animationHighlightMouseToPosition")
      throw egoError(
        "EGO_OPERATION_FAILED",
        "Linux host does not draw a physical pointer highlight",
      );
    invalid(`Unknown native method: ${method}`);
  }
}
