import { randomInt } from "node:crypto";

/** Business Rule 2: no 0/O, 1/I/L, so a code read aloud or typed from a slide is unambiguous. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export function generateWorkshopCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Trim, uppercase, drop dashes and whitespace: `k7qx-9mpa`, `K7QX 9MPA` and `K7QX9MPA` are the same code. */
export function normalizeWorkshopCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}
