/** Display form `XXXX-XXXX` for generated codes; legacy codes of another shape are shown as-is. Browser-safe. */
export function formatWorkshopCode(code: string): string {
  return /^[A-Z0-9]{8}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
