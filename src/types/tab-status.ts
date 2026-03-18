export type TabStatus =
  | "starting"
  | "running"
  | "idle"
  | "waiting"
  | "done-success"
  | "done-error";

export const IDLE_THRESHOLD_MS = 5000;

export function isTerminalAlive(status: TabStatus): boolean {
  return status === "starting" || status === "running" || status === "idle" || status === "waiting";
}

export function isDoneStatus(status: TabStatus): boolean {
  return status === "done-success" || status === "done-error";
}
