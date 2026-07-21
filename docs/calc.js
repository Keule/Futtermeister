(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FeedCalc = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ADDITIVE_FIELDS = [
    "xf", "andf", "adf", "xp", "nxp", "rnb", "xsxz", "bxs", "xl",
    "ca", "p", "mg", "na", "k"
  ];
  const ENERGY_FIELDS = ["nel", "me"];

  function number(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
    const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function nullableNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = number(value, NaN);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function calculateMixture(components) {
    const totals = {
      freshKg: 0,
      dryKg: 0,
      cost: 0,
      udpProteinG: 0,
      xpForUdpG: 0,
    };
    for (const field of ADDITIVE_FIELDS) totals[field] = 0;
    for (const field of ENERGY_FIELDS) totals[field] = 0;

    const rows = components.map((component) => {
      const feed = component.feed || {};
      const values = { ...feed, ...(component.overrides || {}) };
      const freshKg = Math.max(0, number(component.amountKg));
      const tm = Math.max(0, number(values.tm));
      const dryKg = freshKg * tm / 1000;
      const price = Math.max(0, number(component.price));
      const row = { freshKg, dryKg, cost: freshKg * price, values };

      totals.freshKg += freshKg;
      totals.dryKg += dryKg;
      totals.cost += row.cost;

      for (const field of ADDITIVE_FIELDS) {
        const concentration = number(values[field]);
        row[field] = dryKg * concentration;
        totals[field] += row[field];
      }
      for (const field of ENERGY_FIELDS) {
        const concentration = number(values[field]);
        row[field] = dryKg * concentration;
        totals[field] += row[field];
      }
      const udp = number(values.udp);
      row.udpProteinG = row.xp * udp / 100;
      totals.udpProteinG += row.udpProteinG;
      totals.xpForUdpG += row.xp;
      row.udp = udp;
      return row;
    });

    totals.tmPercent = totals.freshKg > 0 ? totals.dryKg / totals.freshKg * 100 : 0;
    totals.udp = totals.xpForUdpG > 0 ? totals.udpProteinG / totals.xpForUdpG * 100 : 0;
    totals.caPRatio = totals.p > 0 ? totals.ca / totals.p : null;

    const perFresh = {};
    const perDry = {};
    for (const field of [...ADDITIVE_FIELDS, ...ENERGY_FIELDS]) {
      perFresh[field] = totals.freshKg > 0 ? totals[field] / totals.freshKg : 0;
      perDry[field] = totals.dryKg > 0 ? totals[field] / totals.dryKg : 0;
    }
    perFresh.cost = totals.freshKg > 0 ? totals.cost / totals.freshKg : 0;
    perDry.cost = totals.dryKg > 0 ? totals.cost / totals.dryKg : 0;
    perFresh.udp = totals.udp;
    perDry.udp = totals.udp;

    return { rows, totals, perFresh, perDry };
  }

  function targetStatus(actual, minValue, maxValue) {
    const min = nullableNumber(minValue);
    const max = nullableNumber(maxValue);
    if (min === null && max === null) return { code: "none", label: "nicht geprüft" };
    if (min !== null && actual < min) return { code: "low", label: "zu niedrig" };
    if (max !== null && actual > max) return { code: "high", label: "zu hoch" };
    return { code: "ok", label: "im Bereich" };
  }

  return { ADDITIVE_FIELDS, ENERGY_FIELDS, number, nullableNumber, calculateMixture, targetStatus };
});
