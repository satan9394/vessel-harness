// hidden test — runner-side only; NOT injected into the agent's workspace during the run
import assert from 'node:assert';
import { computeFee } from '../src/fee.js';

assert.strictEqual(computeFee(1000, { rate: 0.1 }), 100);
assert.strictEqual(computeFee(250, { rate: 0.05 }), 12.5);
assert.strictEqual(computeFee(200, {}), 20); // default rate 0.1
assert.strictEqual(computeFee(0, { rate: 0.99 }), 0);

console.log('HIDDEN TEST: ALL PASS');
