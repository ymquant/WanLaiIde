export type ApiSource = "rest" | "oauth" | "responses" | "chat";

export interface StructuredError {
  statusCode: number;
  reason?: string;
  message: string;
  source: ApiSource;
  credentialKind: "oauth" | "runtime" | "none";
  originalError?: unknown;
}

export type ErrorAction =
  | { type: "refresh_oauth_and_retry" }
  | { type: "recreate_runtime_key_and_retry" }
  | { type: "clear_and_relogin" }
  | { type: "keep_logged_in_no_entitlement" }
  | { type: "show_quota_exceeded"; reason: string }
  | { type: "rate_limit_backoff" }
  | { type: "retry_with_backoff" }
  | { type: "keep_status_show_error" }
  | { type: "show_to_user" };

const QUOTA_REASONS = new Set([
  "SOFTWARE_TOKEN_LIMIT_5H_EXCEEDED",
  "SOFTWARE_TOKEN_LIMIT_7D_EXCEEDED",
  "SOFTWARE_TOKEN_LIMIT_30D_EXCEEDED",
  "SOFTWARE_TOKEN_LIMIT_TOTAL_EXCEEDED",
  "SOFTWARE_TOKEN_LIMIT_DEEPSEEK_DAILY_EXCEEDED",
]);

const ENTITLEMENT_REASONS = new Set([
  "SOFTWARE_PRODUCT_NOT_ENTITLED",
  "SOFTWARE_OAUTH_NO_USABLE_GROUP",
]);

function credentialKindFor(
  source: ApiSource,
): StructuredError["credentialKind"] {
  if (source === "chat" || source === "responses") {
    return "runtime";
  }
  if (source === "oauth" || source === "rest") {
    return "oauth";
  }
  return "none";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function extractReason(
  source: ApiSource,
  body: Record<string, unknown>,
): string | undefined {
  const topReason = body.reason;
  if (typeof topReason === "string" && topReason.length > 0) {
    return topReason;
  }

  const error = asRecord(body.error);
  if (!error) {
    return undefined;
  }

  if (source === "responses") {
    const sub = error.sub_code;
    if (typeof sub === "string" && sub.length > 0) {
      return sub;
    }
  }

  if (source === "chat") {
    const code = error.code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  // Fallbacks across shapes
  if (typeof error.sub_code === "string" && error.sub_code.length > 0) {
    return error.sub_code;
  }
  if (typeof error.code === "string" && error.code.length > 0) {
    return error.code;
  }
  return undefined;
}

function extractMessage(body: Record<string, unknown> | undefined): string {
  if (!body) {
    return "Unknown error";
  }
  if (typeof body.message === "string" && body.message.length > 0) {
    return body.message;
  }
  const error = asRecord(body.error);
  if (error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  if (typeof body.error === "string" && body.error.length > 0) {
    return body.error;
  }
  return "Unknown error";
}

export function parseError(
  source: ApiSource,
  status: number,
  body: unknown,
): StructuredError {
  const record = asRecord(body);
  return {
    statusCode: status,
    reason: record ? extractReason(source, record) : undefined,
    message: extractMessage(record),
    source,
    credentialKind: credentialKindFor(source),
    originalError: body,
  };
}

export function getErrorAction(error: StructuredError): ErrorAction {
  const status = error.statusCode;
  if (status === 0 || status == null || Number.isNaN(status)) {
    return { type: "keep_status_show_error" };
  }

  const reason = error.reason;

  // Reason table first
  if (reason === "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID") {
    return { type: "clear_and_relogin" };
  }
  if (
    reason === "TOKEN_EXPIRED" ||
    reason === "SOFTWARE_OAUTH_ACCESS_TOKEN_INVALID"
  ) {
    if (error.credentialKind === "oauth") {
      return { type: "refresh_oauth_and_retry" };
    }
  }
  if (reason && ENTITLEMENT_REASONS.has(reason)) {
    return { type: "keep_logged_in_no_entitlement" };
  }
  if (reason && QUOTA_REASONS.has(reason)) {
    return { type: "show_quota_exceeded", reason };
  }

  // Then runtime 401 (unless entitlement / quota already handled)
  if (error.credentialKind === "runtime" && status === 401) {
    return { type: "recreate_runtime_key_and_retry" };
  }

  if (status === 429) {
    return { type: "rate_limit_backoff" };
  }
  if (status >= 500) {
    return { type: "retry_with_backoff" };
  }

  return { type: "show_to_user" };
}
