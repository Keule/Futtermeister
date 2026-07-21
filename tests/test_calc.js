const assert = require("assert");
const calc = require("../static/calc.js");

const result = calc.calculateMixture([
  { feed: { tm: 350, xp: 76, nxp: 132, rnb: -9, me: 10.98, nel: 6.64, udp: 25, ca: 2.7, p: 2.3 }, amountKg: 10, price: 0.05 },
  { feed: { tm: 860, xp: 127, nxp: 130, rnb: -1, me: 9.87, nel: 5.86, udp: 20, ca: 6.1, p: 3.0 }, amountKg: 5, price: 0.12 },
]);

assert(Math.abs(result.totals.dryKg - 7.8) < 1e-9);
assert(Math.abs(result.totals.xp - (3.5 * 76 + 4.3 * 127)) < 1e-9);
assert(Math.abs(result.totals.cost - 1.1) < 1e-9);
assert(result.totals.udp > 20 && result.totals.udp < 25);
console.log("Berechnung OK");
