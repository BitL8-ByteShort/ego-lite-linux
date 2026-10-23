import { lstat, copyFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
export class DownloadRouter {
  private armed = new Map<
    string,
    { taskId: number; clientId: string; epoch: number; directory: string }
  >();
  private active = new Map<string, any>();
  private modeQueue = Promise.resolve();
  private syncMode() {
    const active = this.armed.size > 0 || this.active.size > 0;
    this.modeQueue = this.modeQueue.then(async () => {
      await this.modeChange(active);
    });
    return this.modeQueue;
  }
  constructor(
    private root: string,
    private valid: (owner: any) => boolean,
    private deliver: (owner: any, event: any) => void,
    private modeChange: (active: boolean) => Promise<unknown> = async () => {},
  ) {}
  async arm(targetId: string, owner: any, directory?: string) {
    if (!directory) {
      this.armed.delete(targetId);
      await this.syncMode();
      return;
    }
    if (
      dirname(directory) !== tmpdir() ||
      !basename(directory).startsWith("ego-browser-download-")
    )
      throw new Error("Download path must be a private SDK staging directory");
    const s = await lstat(directory);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid?.() ||
      s.mode & 0o077
    )
      throw new Error("Download staging directory must be private and owned");
    if (!this.valid(owner)) throw new Error("Task download ownership expired");
    this.armed.set(targetId, { ...owner, directory });
    await this.syncMode();
  }
  revoke(taskId: number) {
    for (const [id, v] of this.armed)
      if (v.taskId === taskId) this.armed.delete(id);
    for (const [id, v] of this.active)
      if (v.taskId === taskId) this.active.delete(id);
    void this.syncMode().catch(() => {});
  }
  disconnect(clientId: string) {
    for (const [id, v] of this.armed)
      if (v.clientId === clientId) this.armed.delete(id);
    for (const [id, v] of this.active)
      if (v.clientId === clientId) this.active.delete(id);
    void this.syncMode().catch(() => {});
  }
  async event(e: any, targetForFrame: (id: string) => string | undefined) {
    if (e.method === "Browser.downloadWillBegin") {
      const targetId = targetForFrame(e.params.frameId);
      const owner = targetId && this.armed.get(targetId);
      if (!owner || !this.valid(owner)) return;
      const item = {
        ...owner,
        targetId,
        guid: e.params.guid,
        filename: basename(e.params.suggestedFilename || "download"),
      };
      this.active.set(item.guid, item);
      this.deliver(item, {
        method: "Page.downloadWillBegin",
        params: e.params,
      });
    }
    if (e.method === "Browser.downloadProgress") {
      const item = this.active.get(e.params.guid);
      if (!item || !this.valid(item)) return;
      if (e.params.state === "completed") {
        if (typeof e.params.filePath !== "string")
          throw new Error(
            "Chromium did not report the completed download path",
          );
        const original = await lstat(e.params.filePath);
        if (
          !original.isFile() ||
          original.isSymbolicLink() ||
          original.uid !== process.getuid?.()
        )
          throw new Error("Completed download must be an owned regular file");
        const temporary = join(item.directory, item.filename + ".crdownload");
        await copyFile(e.params.filePath, temporary);
        if (!this.valid(item)) {
          await unlink(temporary).catch(() => {});
          return;
        }
        await rename(temporary, join(item.directory, item.filename));
        // Only remove the proven task download, never an unrelated replacement.
        const current = await lstat(e.params.filePath);
        if (
          current.dev === original.dev &&
          current.ino === original.ino &&
          current.size === original.size
        )
          await unlink(e.params.filePath);
      }
      this.deliver(item, { method: "Page.downloadProgress", params: e.params });
      if (e.params.state === "completed" || e.params.state === "canceled") {
        this.active.delete(e.params.guid);
        await this.syncMode();
      }
    }
  }
  owns(guid: string, taskId: number) {
    return this.active.get(guid)?.taskId === taskId;
  }
}
