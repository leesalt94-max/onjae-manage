import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../lib/crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("암호화한 값을 같은 키로 되돌린다", () => {
    const secret = "비밀번호 p@ss! 🔐";
    const enc = encrypt(secret, key);
    expect(enc).not.toContain(secret);
    expect(decrypt(enc, key)).toBe(secret);
  });

  it("같은 값도 매번 다른 암호문이 된다", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("다른 키나 변조된 암호문은 거부한다", () => {
    const enc = encrypt("hello", key);
    expect(() => decrypt(enc, randomBytes(32).toString("base64"))).toThrow();
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join("."), key)).toThrow();
  });

  it("32바이트가 아닌 키는 거부한다", () => {
    expect(() => encrypt("x", randomBytes(16).toString("base64"))).toThrow(/32바이트/);
  });
});
