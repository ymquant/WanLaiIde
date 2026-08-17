import { describe, expect, it } from "vitest";
import type { LoggerPort } from "../ports/loggerPort.js";
import { SanitizedLogger } from "./sanitizedLogger.js";

class MemoryLogger implements LoggerPort {
  messages: string[] = [];

  info(message: string): void {
    this.messages.push(message);
  }
  warn(message: string): void {
    this.messages.push(message);
  }
  error(message: string): void {
    this.messages.push(message);
  }
}

describe("SanitizedLogger", () => {
  it("redacts access_token, Bearer JWT, sk- keys, and code_verifier; leaves normal text", () => {
    const mem = new MemoryLogger();
    const log = new SanitizedLogger(mem);

    log.info("got access_token=eyJhbGciOiJIUzI1NiJ9.payload.sig ok");
    log.info("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def");
    log.info("runtime key sk-abc123xyz");
    log.info('code_verifier="abcDEF0123456789_verifier"');
    log.info("login succeeded for user");
    log.info("status_code=401");

    expect(mem.messages[0]).toContain("***");
    expect(mem.messages[0]).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(mem.messages[1]).toContain("***");
    expect(mem.messages[1]).not.toMatch(/Bearer\s+eyJ/);
    expect(mem.messages[2]).toContain("***");
    expect(mem.messages[2]).not.toContain("sk-abc123xyz");
    expect(mem.messages[3]).toContain("***");
    expect(mem.messages[3]).not.toContain("abcDEF0123456789_verifier");
    expect(mem.messages[4]).toBe("login succeeded for user");
    expect(mem.messages[5]).toBe("status_code=401");
  });
});
