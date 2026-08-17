import { createHash } from "node:crypto";
import os from "node:os";
import type { DeviceInfo } from "core/auth/types";

const PRODUCT_NAMESPACE = "wanlaiide";
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

export function getDeviceInfo(machineId: string): DeviceInfo {
  const id = createHash("sha256")
    .update(`${PRODUCT_NAMESPACE}:${machineId}`)
    .digest("base64url")
    .slice(0, 32);
  return {
    id,
    name: os.hostname().replace(CONTROL_CHARS, "").slice(0, 64),
    os: `${os.type()} ${os.release()}`.replace(CONTROL_CHARS, "").slice(0, 128),
    arch: os.arch(),
  };
}
