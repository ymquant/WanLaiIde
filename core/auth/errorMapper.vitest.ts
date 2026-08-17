import { describe, expect, it } from "vitest";
import { getErrorAction, parseError } from "./errorMapper.js";

describe("errorMapper", () => {
  it("maps SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID to clear_and_relogin", () => {
    const err = parseError("oauth", 401, {
      reason: "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID",
      message: "refresh invalid",
    });
    expect(getErrorAction(err)).toEqual({ type: "clear_and_relogin" });
  });

  it("maps TOKEN_EXPIRED with oauth credentialKind to refresh_oauth_and_retry", () => {
    const err = parseError("oauth", 401, {
      reason: "TOKEN_EXPIRED",
      message: "token expired",
    });
    expect(err.credentialKind).toBe("oauth");
    expect(getErrorAction(err)).toEqual({ type: "refresh_oauth_and_retry" });
  });

  it("maps chat 401 with runtime credentialKind to recreate_runtime_key_and_retry", () => {
    const err = parseError("chat", 401, {
      error: { code: "invalid_api_key", message: "bad key" },
    });
    expect(err.credentialKind).toBe("runtime");
    expect(getErrorAction(err)).toEqual({
      type: "recreate_runtime_key_and_retry",
    });
  });

  it("maps SOFTWARE_PRODUCT_NOT_ENTITLED to keep_logged_in_no_entitlement", () => {
    const err = parseError("responses", 403, {
      error: {
        type: "forbidden",
        code: "forbidden",
        sub_code: "SOFTWARE_PRODUCT_NOT_ENTITLED",
        message: "no entitlement",
      },
    });
    expect(getErrorAction(err)).toEqual({
      type: "keep_logged_in_no_entitlement",
    });
  });

  it("maps status 0 or missing status network error to keep_status_show_error", () => {
    const zero = parseError("oauth", 0, { message: "network down" });
    expect(getErrorAction(zero)).toEqual({ type: "keep_status_show_error" });

    const missing = getErrorAction({
      statusCode: undefined as unknown as number,
      message: "no status",
      source: "oauth",
      credentialKind: "oauth",
    });
    expect(missing).toEqual({ type: "keep_status_show_error" });
  });

  it("maps 500 to retry_with_backoff", () => {
    const err = parseError("rest", 500, { message: "server error" });
    expect(getErrorAction(err)).toEqual({ type: "retry_with_backoff" });
  });
});
