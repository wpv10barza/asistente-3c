/** Normalize a Sheets value only to compare an expected value with a live readback. */
export function sheetValuesMatch(expected: unknown, actual: unknown): boolean {
  const left = String(expected ?? '').trim();
  const right = String(actual ?? '').trim();
  if (left === right) return true;
  const numeric = /^-?(?:\d+)(?:[.,]\d+)?$/;
  if (numeric.test(left) && numeric.test(right)) {
    return Number(left.replace(',', '.')) === Number(right.replace(',', '.'));
  }
  return false;
}

export function reportVerifiedCell(
  cell: string, field: string, before: unknown, actual: unknown,
) {
  const previous = String(before ?? '').trim();
  const observed = String(actual ?? '').trim();
  return {
    cell,
    field,
    before: previous,
    after: observed,
    changed: !sheetValuesMatch(previous, observed),
    verified: true,
  };
}
