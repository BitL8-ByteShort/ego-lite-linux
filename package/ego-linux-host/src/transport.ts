import { connect, type Socket } from "node:net";
import { egoError } from "./errors.js";
export const REQUEST_LIMIT = 1024 * 1024,
  RESPONSE_LIMIT = 32 * 1024 * 1024;
export function encodeFrame(value: unknown, limit = REQUEST_LIMIT): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > limit) throw new Error("RPC frame too large");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  constructor(private limit: number) {}
  push(chunk: Buffer): any[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: any[] = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size > this.limit) throw new Error("RPC frame too large");
      if (!size) throw new Error("Invalid JSON frame");
      if (this.buffer.length < size + 4) break;
      out.push(JSON.parse(this.buffer.subarray(4, size + 4).toString("utf8")));
      this.buffer = Buffer.from(this.buffer.subarray(size + 4));
    }
    return out;
  }
}
export class HostConnection {
  readonly socket: Socket;
  private id = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  onEvent: (event: any) => void = () => {};
  constructor(path: string) {
    this.socket = connect(path);
    const decoder = new FrameDecoder(RESPONSE_LIMIT);
    this.socket.on("data", (chunk) => {
      try {
        for (const msg of decoder.push(chunk)) {
          if (msg.event) {
            this.onEvent(msg);
            continue;
          }
          const call = this.pending.get(msg.id);
          if (!call) continue;
          this.pending.delete(msg.id);
          clearTimeout(call.timer);
          if (msg.error)
            call.reject(Object.assign(new Error(msg.error.message), msg.error));
          else call.resolve(msg.result);
        }
      } catch (e) {
        this.socket.destroy(e as Error);
      }
    });
    this.socket.on("error", () => this.fail());
    this.socket.on("close", () => this.fail());
  }
  async ready() {
    if (this.socket.connecting)
      await new Promise<void>((resolve, reject) => {
        this.socket.once("connect", resolve);
        this.socket.once("error", reject);
      });
    return this;
  }
  call(
    method: string,
    args: any[] = [],
    context?: any,
    timeoutMs = 60000,
  ): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          egoError("EGO_TASK_HOST_DISCONNECTED", `RPC ${method} timed out`),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.write(
          encodeFrame({ version: 1, id, method, args, context }),
          (e) => {
            if (e) this.fail();
          },
        );
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  private fail() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        egoError("EGO_TASK_HOST_DISCONNECTED", "Linux host connection closed"),
      );
    }
    this.pending.clear();
  }
  close() {
    this.socket.destroy();
    this.fail();
  }
}
