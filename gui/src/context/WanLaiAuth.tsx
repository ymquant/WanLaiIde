import type { AuthStatus, AuthStatusPayload } from "core/auth/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IdeMessengerContext } from "./IdeMessenger";
import { useWebviewListener } from "../hooks/useWebviewListener";

/** Why the user cannot send chat right now. Null when sending is allowed. */
export function getChatBlockReason(status: AuthStatus): string | null {
  switch (status) {
    case "loggedOut":
      return "当前未登录万来账号，无法发送消息。请先登录。退出登录不会清空当前对话记录。";
    case "loggingIn":
      return "正在登录万来账号，完成后即可继续对话。";
    case "loggedInNoEntitlement":
      return "当前账号未开通推理套餐，无法发送消息。请开通套餐后再试。对话记录会保留。";
    case "loggedIn":
      return null;
    default:
      return "账号状态异常，暂时无法发送消息。对话记录会保留。";
  }
}

type BannerKind = "error" | "info";

interface WanLaiAuthContextValue {
  payload: AuthStatusPayload;
  status: AuthStatus;
  /** Null when the user may send chat. */
  chatBlockReason: string | null;
  canSendChat: boolean;
  banner: { message: string; kind: BannerKind } | null;
  showBanner: (message: string, kind: BannerKind) => void;
  /** Emphasize why send is blocked (e.g. Enter while logged out). */
  notifyChatBlocked: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onPurchase: () => void;
}

const WanLaiAuthContext = createContext<WanLaiAuthContextValue | undefined>(
  undefined,
);

const BANNER_DISMISS_MS = 3000;
const PURCHASE_URL = "https://wanlai.ai/purchase";

const TEST_LOGGED_IN_PAYLOAD: AuthStatusPayload = {
  status: "loggedIn",
  user: { displayName: "Test User", emailMasked: "t***@example.com" },
  entitlement: { status: "active" },
};

export function WanLaiAuthProvider({ children }: { children: ReactNode }) {
  const ideMessenger = useContext(IdeMessengerContext);
  const [payload, setPayload] = useState<AuthStatusPayload>(() =>
    process.env.NODE_ENV === "test"
      ? TEST_LOGGED_IN_PAYLOAD
      : { status: "loggedOut" },
  );
  const [banner, setBanner] = useState<{
    message: string;
    kind: BannerKind;
  } | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBannerTimer = useCallback(() => {
    if (bannerTimer.current) {
      clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
  }, []);

  const showBanner = useCallback(
    (message: string, kind: BannerKind) => {
      clearBannerTimer();
      setBanner({ message, kind });
      bannerTimer.current = setTimeout(() => {
        setBanner(null);
        bannerTimer.current = null;
      }, BANNER_DISMISS_MS);
    },
    [clearBannerTimer],
  );

  useEffect(() => () => clearBannerTimer(), [clearBannerTimer]);

  const applyPayload = useCallback(
    (next: AuthStatusPayload) => {
      setPayload(next);
      // Never clear chat history here — only auth UI state.
      if (next.status === "loggedIn") {
        clearBannerTimer();
        setBanner(null);
      }
    },
    [clearBannerTimer],
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    void ideMessenger.request("auth:get_status", undefined).then((result) => {
      if (result.status === "success" && result.content) {
        applyPayload(result.content);
      }
    });
  }, [ideMessenger, applyPayload]);

  useWebviewListener(
    "auth:status",
    async (data) => {
      applyPayload(data);
    },
    [applyPayload],
  );

  useWebviewListener(
    "auth:login_failed",
    async (data) => {
      showBanner(data.message, data.reason === "cancelled" ? "info" : "error");
    },
    [showBanner],
  );

  useWebviewListener(
    "auth:login_required",
    async (data) => {
      showBanner(data.message, "error");
    },
    [showBanner],
  );

  const status = payload.status;
  const chatBlockReason = useMemo(() => getChatBlockReason(status), [status]);

  const notifyChatBlocked = useCallback(() => {
    // Reason is already shown persistently under the badge. Sending again
    // must not add a second copy of the same sentence.
  }, []);

  const value = useMemo<WanLaiAuthContextValue>(
    () => ({
      payload,
      status,
      chatBlockReason,
      canSendChat: chatBlockReason === null,
      banner,
      showBanner,
      notifyChatBlocked,
      onLogin: () => {
        clearBannerTimer();
        setBanner(null);
        ideMessenger.post("auth:login", undefined);
      },
      onLogout: () => {
        // Logout must not wipe the current conversation UI — only auth + models.
        ideMessenger.post("auth:logout", undefined);
      },
      onPurchase: () => {
        ideMessenger.post("openUrl", PURCHASE_URL);
      },
    }),
    [
      payload,
      status,
      chatBlockReason,
      banner,
      showBanner,
      notifyChatBlocked,
      ideMessenger,
      clearBannerTimer,
    ],
  );

  return (
    <WanLaiAuthContext.Provider value={value}>
      {children}
    </WanLaiAuthContext.Provider>
  );
}

export function useWanLaiAuth(): WanLaiAuthContextValue {
  const ctx = useContext(WanLaiAuthContext);
  if (!ctx) {
    throw new Error("useWanLaiAuth must be used within WanLaiAuthProvider");
  }
  return ctx;
}
