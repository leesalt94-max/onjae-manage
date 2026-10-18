import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "./env";

// AES-256-GCM. 저장 형식: v1.<iv base64>.<tag base64>.<암호문 base64>
const VERSION = "v1";

function loadKey(keyB64?: string): Buffer {
  const key = Buffer.from(keyB64 ?? requireEnv("ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY 는 32바이트(base64)여야 합니다. npm run gen-key 로 만드세요.");
  return key;
}

export function encrypt(plain: string, keyB64?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(keyB64), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(payload: string, keyB64?: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error("암호문 형식이 올바르지 않습니다.");
  }
  const decipher = createDecipheriv("aes-256-gcm", loadKey(keyB64), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
