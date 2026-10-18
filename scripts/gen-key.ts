import { randomBytes } from "node:crypto";
import { authenticator } from "otplib";

if (process.argv[2] === "totp") {
  console.log(authenticator.generateSecret());
} else {
  console.log(randomBytes(32).toString("base64"));
}
