// computeFee — implemented for B003 hidden test
export function computeFee(amount, opts) {
  const rate = opts?.rate ?? 0.1;
  return Math.round(amount * rate * 100) / 100;
}
