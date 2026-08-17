import type { AuthService } from "core/auth/authService";
import type { AuthStatusPayload } from "core/auth/types";

/** Build Webview-safe auth status (no token / uuid / raw email). */
export function buildAuthStatusPayload(
  authService: AuthService,
): AuthStatusPayload {
  const status = authService.getStatus();
  const user = authService.getPublicUserInfo() ?? undefined;
  const profile = authService.getUserProfile();
  const entitlement =
    profile?.entitlementStatus != null
      ? { status: profile.entitlementStatus }
      : undefined;

  return { status, user, entitlement };
}
