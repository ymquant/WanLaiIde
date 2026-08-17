import type { LoggerPort } from "../ports/loggerPort.js";

export const SENSITIVE_KEYS = [
  "access_token",
  "refresh_token",
  "raw_key",
  "code_verifier",
  "password",
  "authorization",
  "api_key",
  "id_token",
  "code",
] as const;

const SENSITIVE_KEY_SET = new Set<string>(
  SENSITIVE_KEYS.map((k) => k.toLowerCase()),
);

/** Layer 1: field-name match — key=value / "key": "value" / key: value.
 *  Word-boundary before the key so `code` does not match inside `status_code`. */
const FIELD_NAME_RE = new RegExp(
  `(?<![A-Za-z0-9_])("?(?:${SENSITIVE_KEYS.join("|")})"?)\\s*([:=])\\s*("?)([^\\s"',}\\]]+)("?)`,
  "gi",
);

/** Layer 2: Bearer token fallback */
const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

/** Layer 3: JWT fallback (eyJ...) */
const JWT_RE = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g;

/** Layer 4: sk- API key fallback */
const SK_RE = /\bsk-[A-Za-z0-9_-]+/g;

export function sanitizeText(input: string): string {
  let out = input;
  out = out.replace(FIELD_NAME_RE, (_m, key, sep, q1, _val, q2) => {
    return `${key}${sep}${q1 ?? ""}***${q2 ?? ""}`;
  });
  out = out.replace(BEARER_RE, "Bearer ***");
  out = out.replace(JWT_RE, "***");
  out = out.replace(SK_RE, "***");
  return out;
}

function sanitizeMeta(
  meta?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_SET.has(key.toLowerCase())) {
      result[key] = "***";
      continue;
    }
    if (typeof value === "string") {
      result[key] = sanitizeText(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeMeta(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class SanitizedLogger implements LoggerPort {
  constructor(private readonly delegate: LoggerPort) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.delegate.info(sanitizeText(message), sanitizeMeta(meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.delegate.warn(sanitizeText(message), sanitizeMeta(meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.delegate.error(sanitizeText(message), sanitizeMeta(meta));
  }
}
