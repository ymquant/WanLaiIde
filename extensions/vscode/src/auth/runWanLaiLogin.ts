import * as vscode from "vscode";
import type { AuthModule } from "./createAuthModule";
import { OAuthCallbackServer } from "./oauthServer";
import { showTimedNotification } from "./showTimedNotification";

export type WanLaiLoginOutcome = "success" | "cancelled" | "failed";

export function isLoginCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === "LoginCancelled";
}

export async function runWanLaiLogin(
  authModule: AuthModule,
): Promise<{ outcome: WanLaiLoginOutcome; message?: string }> {
  try {
    await authModule.authService.login({
      openBrowser: async (url) => {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      },
      createCallbackServer: () => new OAuthCallbackServer(),
      redirectUriFactory: (port) => `http://127.0.0.1:${port}/callback`,
    });
    return { outcome: "success" };
  } catch (err) {
    if (isLoginCancelled(err)) {
      return { outcome: "cancelled", message: "已取消登录" };
    }
    return {
      outcome: "failed",
      message: `万来登录失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Show a 3s auto-dismissing notification for a login outcome. */
export async function notifyWanLaiLoginOutcome(
  result: { outcome: WanLaiLoginOutcome; message?: string },
): Promise<void> {
  if (result.outcome === "success") {
    await showTimedNotification("万来账号登录成功", "info", 3000);
    return;
  }
  if (result.outcome === "cancelled") {
    await showTimedNotification(result.message ?? "已取消登录", "info", 3000);
    return;
  }
  await showTimedNotification(
    result.message ?? "万来登录失败",
    "error",
    3000,
  );
}
