import { useWanLaiAuth } from "../context/WanLaiAuth";
import { Button } from "./ui";

const NO_ENTITLEMENT_HINT =
  "当前账号未开通推理套餐，点击开通后即可使用万来 AI 编程助手";

export function AuthStatusBadge() {
  const {
    status,
    payload,
    banner,
    chatBlockReason,
    onLogin,
    onLogout,
    onPurchase,
  } = useWanLaiAuth();

  const label = payload.user?.emailMasked ?? payload.user?.displayName;

  return (
    <div className="border-vsc-input-border flex flex-shrink-0 flex-col gap-1 border-0 border-b border-solid px-3 py-1.5">
      <div className="flex flex-row items-center justify-between gap-2">
        {status === "loggedOut" && (
          <>
            <span className="text-description text-xs">未登录</span>
            <Button variant="primary" size="sm" onClick={onLogin}>
              登录万来账号
            </Button>
          </>
        )}

        {status === "loggingIn" && (
          <span className="text-description text-xs">正在登录…</span>
        )}

        {status === "loggedIn" && (
          <>
            <span className="text-foreground truncate text-xs" title={label}>
              {label}
            </span>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              退出
            </Button>
          </>
        )}

        {status === "loggedInNoEntitlement" && (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-foreground truncate text-xs" title={label}>
                {label}
              </span>
              <span className="text-warning text-2xs">未开通套餐</span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              <Button variant="primary" size="sm" onClick={onPurchase}>
                开通套餐
              </Button>
              <Button variant="ghost" size="sm" onClick={onLogout}>
                退出
              </Button>
            </div>
          </>
        )}
      </div>

      {status === "loggedInNoEntitlement" && (
        <p className="text-description text-2xs m-0 leading-snug">
          {NO_ENTITLEMENT_HINT}
        </p>
      )}

      {/* Persistent reason when chat is blocked — does not replace history */}
      {chatBlockReason && status !== "loggedInNoEntitlement" && (
        <p className="text-description text-2xs m-0 leading-snug">
          {chatBlockReason}
        </p>
      )}

      {banner && (
        <p
          className={`text-2xs m-0 leading-snug ${
            banner.kind === "error" ? "text-error" : "text-description"
          }`}
        >
          {banner.message}
        </p>
      )}
    </div>
  );
}
