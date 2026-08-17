import * as vscode from "vscode";

/** Notification that auto-dismisses when the progress completes (default 3s). */
export async function showTimedNotification(
  message: string,
  kind: "info" | "error" = "info",
  durationMs = 3000,
): Promise<void> {
  const title = kind === "error" ? `$(error) ${message}` : message;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    },
  );
}
