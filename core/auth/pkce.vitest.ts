import { describe, expect, it } from "vitest";
import { createOAuthAttempt, statesEqual } from "./pkce.js";

describe("pkce", () => {
  it("creates verifier of at least 43 chars and independent state", () => {
    const a = createOAuthAttempt();
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(a.state).not.toBe(a.codeVerifier);
    expect(a.codeChallenge).not.toBe(a.codeVerifier);
  });

  it("accepts matching state and rejects mismatch", () => {
    const a = createOAuthAttempt();
    expect(statesEqual(a.state, a.state)).toBe(true);
    expect(statesEqual(a.state, a.state + "x")).toBe(false);
  });
});
