// b/util.js — helper that consumes computeTax
import { computeTax } from '../a/tax.js';

export function netIncome(gross) {
  return gross - computeTax(gross);
}
