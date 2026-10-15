/**
 * Round-local record of task spaces the Agent still controls when the round
 * ends. The browser shows its Agent-control indicator until the task calls
 * finish() or handOff(); every round is a separate process, so the browser
 * cannot tell a task that continues next round from one the Agent abandoned.
 * The round-end notice asks the Agent to release control explicitly.
 */

const controlledSpaces = new Set<number>();

/** Record a TaskSpace handle that holds Agent control in this round. */
export function recordAgentControlledSpace(spaceId: number): void {
  controlledSpaces.add(spaceId);
}

/** Forget a space whose control returned to the user or whose task ended. */
export function releaseAgentControlledSpace(spaceId: number): void {
  controlledSpaces.delete(spaceId);
}

/** Format the round-end reminder, or return "" when no space needs one. */
export function consumeAgentControlNotice(): string {
  const ids = [...controlledSpaces].sort((a, b) => a - b);
  controlledSpaces.clear();
  if (ids.length === 0) return "";
  const spaces =
    ids.length === 1 ? `task space ${ids[0]}` : `task spaces ${ids.join(", ")}`;
  return (
    `[ego-browser:task] The Agent still controls ${spaces}, so the browser ` +
    "shows it as Agent-controlled. If the task is complete, call " +
    "task.finish({ keep }). If you are stopping for the user or an " +
    "unrecoverable error, call task.handOff(). Otherwise continue in the next round.\n"
  );
}

/** Clear round state. Real runs get a new process; tests can reuse one process. */
export function resetAgentControlledSpaces(): void {
  controlledSpaces.clear();
}
