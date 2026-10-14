/** GS1 check digit validation for EAN-8, UPC-A (12), EAN-13 and GTIN-14. */

export type BarcodeCheck =
  | { valid: true; digits: string }
  | { valid: false; reason: "length" | "checksum"; digits: string; expectedCheckDigit?: number };

export function gs1CheckDigit(bodyDigits: string): number {
  let sum = 0;
  // Weights 3,1,3,1 ... starting from the digit right before the check digit.
  for (let i = bodyDigits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(bodyDigits[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
}

export function validateBarcode(input: string): BarcodeCheck {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) {
    return { valid: false, reason: "length", digits };
  }
  const expected = gs1CheckDigit(digits.slice(0, -1));
  if (expected !== Number(digits[digits.length - 1])) {
    return { valid: false, reason: "checksum", digits, expectedCheckDigit: expected };
  }
  return { valid: true, digits };
}
