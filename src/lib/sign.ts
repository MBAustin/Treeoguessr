import crypto from "crypto";
import type { RoundOption } from "./inat";

// The answer for a round is sealed into an *encrypted* token (AES-256-GCM), not
// just signed. In the typed modes (hard/botanist) the correct name and the
// multiple-choice fallback options must stay hidden from the client until a
// lifeline is spent — a merely signed (base64-readable) token would leak them.
const key = crypto
  .createHash("sha256")
  .update(process.env.ROUND_SECRET || "dev-insecure-secret-change-me")
  .digest();

export interface AnswerPayload {
  taxonId: number;
  scientificName: string;
  commonName: string | null;
  options: RoundOption[];
}

export function sealAnswer(payload: AnswerPayload): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function openAnswer(token: string): AnswerPayload | null {
  try {
    const [ivB, tagB, encB] = token.split(".");
    if (!ivB || !tagB || !encB) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(encB, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(dec.toString("utf8")) as AnswerPayload;
  } catch {
    return null;
  }
}
