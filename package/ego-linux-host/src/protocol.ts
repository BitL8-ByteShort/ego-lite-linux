export const PROTOCOL_VERSION = 1;
export type ProfileId = string;
export type TaskId = number;
export type BrowserGeneration = string;
export type TaskLease = {
  taskId: number;
  agentId: string;
  clientId: string;
  capability: string;
  epoch: number;
  generation: string;
};
export type RpcRequest = {
  version: 1;
  id: number;
  method: string;
  args: unknown[];
  context?: TaskLease;
};
export type RpcResponse = {
  id: number;
  result?: unknown;
  error?: { message: string; error_code: string };
};
