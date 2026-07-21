"use strict";

const nutrientMeta = {
  tm: { label: "TM", unit: "g/kg FM", decimals: 0 },
  xf: { label: "XF", unit: "g/kg TM", decimals: 0 },
  andf: { label: "aNDF / aNDFom", unit: "g/kg TM", decimals: 0 },
  adf: { label: "ADF / ADFom", unit: "g/kg TM", decimals: 0 },
  xp: { label: "XP", unit: "g/kg TM", decimals: 0 },
  nxp: { label: "nXP", unit: "g/kg TM", decimals: 0 },
  udp: { label: "UDP", unit: "%", decimals: 1 },
  rnb: { label: "RNB", unit: "g/kg TM", decimals: 1 },
  nel: { label: "NEL", unit: "MJ/kg TM", decimals: 2 },
  me: { label: "ME", unit: "MJ/kg TM", decimals: 2 },
  xsxz: { label: "XS+XZ", unit: "g/kg TM", decimals: 0 },
  bxs: { label: "bXS", unit: "g/kg TM", decimals: 0 },
  xl: { label: "XL", unit: "g/kg TM", decimals: 0 },
  ca: { label: "Ca", unit: "g/kg TM", decimals: 2 },
  p: { label: "P", unit: "g/kg TM", decimals: 2 },
  mg: { label: "Mg", unit: "g/kg TM", decimals: 2 },
  na: { label: "Na", unit: "g/kg TM", decimals: 2 },
  k: { label: "K", unit: "g/kg TM", decimals: 2 },
};

const resultRows = [
  ["xf", "Rohfaser (XF)", "g"],
  ["andf", "aNDF / aNDFom", "g"],
  ["adf", "ADF / ADFom", "g"],
  ["xp", "Rohprotein (XP)", "g"],
  ["nxp", "nutzbares Rohprotein (nXP)", "g"],
  ["udp", "UDP, XP-gewichtet", "%"],
  ["rnb", "RNB", "g"],
  ["nel", "Nettoenergie Laktation (NEL)", "MJ"],
  ["me", "Umsetzbare Energie (ME)", "MJ"],
  ["xsxz", "Stärke + Zucker (XS+XZ)", "g"],
  ["bxs", "beständige Stärke (bXS)", "g"],
  ["xl", "Rohfett (XL)", "g"],
  ["ca", "Calcium", "g"],
  ["p", "Phosphor", "g"],
  ["mg", "Magnesium", "g"],
  ["na", "Natrium", "g"],
  ["k", "Kalium", "g"],
  ["cost", "Futterkosten", "currency"],
];

const targetDefinitions = [
  { key: "dryKg", label: "Trockenmasse", unit: "kg", decimals: 2 },
  { key: "andf", label: "aNDF", unit: "g", decimals: 0 },
  { key: "xf", label: "XF", unit: "g", decimals: 0 },
  { key: "me", label: "ME", unit: "MJ", decimals: 2 },
  { key: "nel", label: "NEL", unit: "MJ", decimals: 2 },
  { key: "xp", label: "XP", unit: "g", decimals: 0 },
  { key: "nxp", label: "nXP", unit: "g", decimals: 0 },
  { key: "rnb", label: "RNB", unit: "g", decimals: 1 },
  { key: "ca", label: "Ca", unit: "g", decimals: 1 },
  { key: "p", label: "P", unit: "g", decimals: 1 },
  { key: "mg", label: "Mg", unit: "g", decimals: 1 },
  { key: "na", label: "Na", unit: "g", decimals: 1 },
  { key: "k", label: "K", unit: "g", decimals: 1 },
];

const state = {
  source: null,
  feeds: [],
  requirements: [],
  requirementSource: null,
  selectedRequirement: null,
  components: [],
  targets: Object.fromEntries(targetDefinitions.map((item) => [item.key, { min: "", max: "" }])),
  editingIndex: null,
};

const el = (id) => document.getElementById(id);
const componentBody = el("componentBody");
const uploadStatus = el("uploadStatus");
const workspace = el("workspace");
const analysisDialog = el("analysisDialog");
const analysisFields = el("analysisFields");
const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

function format(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "–";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  }[char]));
}

function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function setStatus(message, type = "neutral") {
  uploadStatus.className = `status ${type}`;
  uploadStatus.textContent = message;
}

function setRequirementStatus(message, type = "neutral") {
  const status = el("requirementStatus");
  status.className = `status ${type}`;
  status.textContent = message;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function feedLabel(feed) {
  const prefix = feed.number !== null && feed.number !== undefined ? `${feed.number} · ` : "";
  return `${prefix}${feed.feed}`;
}

function requirementLabel(item) {
  if (!item) return "kein Datensatz";
  const gain = item.gainG !== null && item.gainG !== undefined ? `, ${format(item.gainG, 0)} g/Tag` : "";
  return `${item.species}, ${format(item.weightKg, 0)} kg${gain}`;
}

function renderAnimalGroups() {
  const select = el("animalGroup");
  const current = select.value;
  const groups = [...new Set(state.requirements.map((item) => item.species).filter(Boolean))]
    .sort((a, b) => collator.compare(a, b));
  select.innerHTML = '<option value="">manuell</option>' + groups.map((group) => (
    `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`
  )).join("");
  if (groups.includes(current)) select.value = current;
  else if (groups.length && !current) {
    const preferred = groups.find((group) => normalizeText(group).startsWith("bullen")) || groups[0];
    select.value = preferred;
  }
}

function findRequirementMatch() {
  const species = normalizeText(el("animalGroup").value);
  if (!species || !state.requirements.length) return null;
  const weight = FeedCalc.nullableNumber(el("animalWeight").value);
  const gain = FeedCalc.nullableNumber(el("gainTarget").value);
  const candidates = state.requirements.filter((item) => normalizeText(item.species) === species);
  if (!candidates.length) return null;
  return candidates
    .map((item) => {
      const weightScore = weight === null ? 0 : Math.abs(FeedCalc.number(item.weightKg) - weight);
      const gainScore = gain === null || item.gainG === null || item.gainG === undefined ? 0 : Math.abs(FeedCalc.number(item.gainG) - gain) / 10;
      return { item, score: weightScore + gainScore };
    })
    .sort((a, b) => a.score - b.score)[0].item;
}

function applyRequirementTargets(showMessage = false) {
  const match = findRequirementMatch();
  state.selectedRequirement = match;
  el("matchedRequirement").value = requirementLabel(match);
  if (!match) {
    if (showMessage) setRequirementStatus("Kein passender Sollwertdatensatz gefunden.", "error");
    renderTargets(FeedCalc.calculateMixture(calculationInput()));
    return;
  }
  for (const def of targetDefinitions) {
    const value = match[def.key];
    state.targets[def.key] = {
      min: value === null || value === undefined ? "" : String(value),
      max: "",
    };
  }
  if (showMessage) setRequirementStatus(`Sollwerte angewendet: ${requirementLabel(match)}.`, "success");
  recalculate();
}

function blankComponent() {
  return { feedId: "", amountKg: "", price: "", overrides: {} };
}

function addComponent(initial = null) {
  state.components.push(initial || blankComponent());
  renderComponents();
  recalculate();
}

function selectedFeed(component) {
  return state.feeds.find((feed) => feed.id === component.feedId) || null;
}

function effectiveValue(component, field) {
  if (Object.prototype.hasOwnProperty.call(component.overrides || {}, field)) {
    return component.overrides[field];
  }
  return selectedFeed(component)?.[field] ?? null;
}

function groupFeeds() {
  const grouped = new Map();
  for (const feed of state.feeds) {
    const group = feed.group || feed.section || "Weitere Futtermittel";
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(feed);
  }
  return [...grouped.entries()].sort((a, b) => collator.compare(a[0], b[0]));
}

function feedOptions(selectedId) {
  const groups = groupFeeds();
  let html = '<option value="">Futtermittel auswählen …</option>';
  for (const [group, feeds] of groups) {
    html += `<optgroup label="${escapeHtml(group)}">`;
    for (const feed of feeds) {
      html += `<option value="${escapeHtml(feed.id)}" ${feed.id === selectedId ? "selected" : ""}>${escapeHtml(feedLabel(feed))}</option>`;
    }
    html += "</optgroup>";
  }
  return html;
}

function renderComponents() {
  componentBody.innerHTML = "";
  state.components.forEach((component, index) => {
    const feed = selectedFeed(component);
    const tr = document.createElement("tr");
    tr.dataset.index = index;
    tr.innerHTML = `
      <td class="row-number">${index + 1}</td>
      <td>
        <select class="feed-select" aria-label="Futtermittel Zeile ${index + 1}">${feedOptions(component.feedId)}</select>
        <button type="button" class="analysis-link" ${feed ? "" : "disabled"}>Analysewerte</button>
      </td>
      <td><input class="amount-input numeric" type="number" min="0" step="0.01" value="${escapeHtml(component.amountKg)}"></td>
      <td><input class="tm-input numeric" type="number" min="0" step="1" value="${feed ? escapeHtml(effectiveValue(component, "tm") ?? "") : ""}" ${feed ? "" : "disabled"}></td>
      <td><input class="price-input numeric" type="number" min="0" step="0.01" value="${escapeHtml(component.price)}"></td>
      <td class="calc dry">0,00</td>
      <td class="calc xp">0</td>
      <td class="calc nxp">0</td>
      <td class="calc rnb">0,0</td>
      <td class="calc me">0,00</td>
      <td class="calc cost">0,00</td>
      <td><button type="button" class="delete-button" aria-label="Komponente löschen">×</button></td>
    `;
    componentBody.appendChild(tr);

    const feedSelect = tr.querySelector(".feed-select");
    const amountInput = tr.querySelector(".amount-input");
    const tmInput = tr.querySelector(".tm-input");
    const priceInput = tr.querySelector(".price-input");

    feedSelect.addEventListener("change", () => {
      component.feedId = feedSelect.value;
      component.overrides = {};
      renderComponents();
      recalculate();
    });
    amountInput.addEventListener("input", () => {
      component.amountKg = amountInput.value;
      recalculate();
    });
    tmInput.addEventListener("input", () => {
      component.overrides.tm = FeedCalc.nullableNumber(tmInput.value);
      recalculate();
    });
    priceInput.addEventListener("input", () => {
      component.price = priceInput.value;
      recalculate();
    });
    tr.querySelector(".analysis-link").addEventListener("click", () => openAnalysis(index));
    tr.querySelector(".delete-button").addEventListener("click", () => {
      state.components.splice(index, 1);
      if (!state.components.length) state.components.push(blankComponent());
      renderComponents();
      recalculate();
    });
  });
}

function calculationInput() {
  return state.components.map((component) => ({
    feed: selectedFeed(component),
    amountKg: component.amountKg,
    price: component.price,
    overrides: component.overrides,
  }));
}

function recalculate() {
  const result = FeedCalc.calculateMixture(calculationInput());
  renderRowCalculations(result.rows);
  renderKpis(result);
  renderResults(result);
  renderScale(result);
  renderTargets(result);
}

function renderRowCalculations(rows) {
  [...componentBody.querySelectorAll("tr")].forEach((tr, index) => {
    const row = rows[index];
    if (!row) return;
    tr.querySelector(".dry").textContent = format(row.dryKg, 2);
    tr.querySelector(".xp").textContent = format(row.xp, 0);
    tr.querySelector(".nxp").textContent = format(row.nxp, 0);
    tr.querySelector(".rnb").textContent = format(row.rnb, 1);
    tr.querySelector(".me").textContent = format(row.me, 2);
    tr.querySelector(".cost").textContent = format(row.cost, 2);
  });
}

function renderKpis(result) {
  const currency = el("currency").value || "€";
  const t = result.totals;
  const cards = [
    ["Frischmasse", format(t.freshKg, 2), "kg/Tier/Tag"],
    ["Trockenmasse", format(t.dryKg, 2), `kg · ${format(t.tmPercent, 1)} % TM`],
    ["ME", format(t.me, 2), "MJ/Tier/Tag"],
    ["Rohprotein", format(t.xp, 0), "g XP/Tier/Tag"],
    ["RNB", format(t.rnb, 1), "g/Tier/Tag"],
    ["Ca : P", t.caPRatio === null ? "–" : `${format(t.caPRatio, 2)} : 1`, "Verhältnis"],
    ["Kosten", `${format(t.cost, 2)} ${currency}`, "je Tier und Tag"],
  ];
  el("kpiGrid").innerHTML = cards.map(([label, value, note]) => `
    <div class="kpi-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>
  `).join("");
}

function resultValue(result, key, basis) {
  if (key === "cost") return basis === "total" ? result.totals.cost : result[basis].cost;
  if (key === "udp") return result.totals.udp;
  return basis === "total" ? result.totals[key] : result[basis][key];
}

function renderResults(result) {
  const currency = el("currency").value || "€";
  el("resultBody").innerHTML = resultRows.map(([key, label, unit]) => {
    const decimals = key === "cost" ? 2 : key === "udp" ? 1 : ["nel", "me"].includes(key) ? 2 : ["ca", "p", "mg", "na", "k", "rnb"].includes(key) ? 2 : 0;
    const suffix = unit === "currency" ? ` ${currency}` : ` ${unit}`;
    const perFreshSuffix = unit === "currency" ? ` ${currency}/kg FM` : key === "udp" ? " %" : ` ${unit}/kg FM`;
    const perDrySuffix = unit === "currency" ? ` ${currency}/kg TM` : key === "udp" ? " %" : ` ${unit}/kg TM`;
    return `<tr>
      <th>${label}</th>
      <td>${format(resultValue(result, key, "total"), decimals)}${suffix}</td>
      <td>${format(resultValue(result, key, "perFresh"), decimals)}${perFreshSuffix}</td>
      <td>${format(resultValue(result, key, "perDry"), decimals)}${perDrySuffix}</td>
    </tr>`;
  }).join("");
}

function renderScale(result) {
  const animals = Math.max(1, FeedCalc.number(el("animalCount").value, 1));
  const days = Math.max(1, FeedCalc.number(el("dayCount").value, 1));
  const factor = animals * days;
  const currency = el("currency").value || "€";
  const rows = [
    ["Berechnungsumfang", `${format(animals, 0)} Tiere × ${format(days, 0)} Tage`],
    ["Frischmasse gesamt", `${format(result.totals.freshKg * factor, 1)} kg`],
    ["Trockenmasse gesamt", `${format(result.totals.dryKg * factor, 1)} kg`],
    ["ME gesamt", `${format(result.totals.me * factor, 1)} MJ`],
    ["XP gesamt", `${format(result.totals.xp * factor / 1000, 1)} kg`],
    ["Kosten gesamt", `${format(result.totals.cost * factor, 2)} ${currency}`],
  ];
  el("scaleSummary").innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function actualTargetValue(result, key) {
  return result.totals[key] ?? 0;
}

function renderTargets(result) {
  const body = el("targetBody");
  body.innerHTML = targetDefinitions.map((def) => {
    const target = state.targets[def.key];
    const actual = actualTargetValue(result, def.key);
    const status = FeedCalc.targetStatus(actual, target.min, target.max);
    return `<tr data-target="${def.key}">
      <th>${def.label}<small>${def.unit}</small></th>
      <td><input class="target-min numeric" type="number" step="any" value="${escapeHtml(target.min)}"></td>
      <td><input class="target-max numeric" type="number" step="any" value="${escapeHtml(target.max)}"></td>
      <td>${format(actual, def.decimals)} ${def.unit}</td>
      <td><span class="target-status ${status.code}">${status.label}</span></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr").forEach((tr) => {
    const key = tr.dataset.target;
    tr.querySelector(".target-min").addEventListener("change", (event) => {
      state.targets[key].min = event.target.value;
      renderTargets(result);
    });
    tr.querySelector(".target-max").addEventListener("change", (event) => {
      state.targets[key].max = event.target.value;
      renderTargets(result);
    });
  });
}

function openAnalysis(index) {
  const component = state.components[index];
  const feed = selectedFeed(component);
  if (!feed) return;
  state.editingIndex = index;
  el("analysisTitle").textContent = feedLabel(feed);
  analysisFields.innerHTML = Object.entries(nutrientMeta).map(([key, meta]) => {
    const value = effectiveValue(component, key);
    return `<label>${meta.label}<span>${meta.unit}</span><input data-field="${key}" type="number" step="any" value="${value ?? ""}"></label>`;
  }).join("");
  analysisDialog.showModal();
}

function applyAnalysis() {
  if (state.editingIndex === null) return;
  const component = state.components[state.editingIndex];
  const feed = selectedFeed(component);
  if (!feed) return;
  const overrides = {};
  analysisFields.querySelectorAll("input[data-field]").forEach((input) => {
    const key = input.dataset.field;
    const value = FeedCalc.nullableNumber(input.value);
    const original = feed[key] ?? null;
    if (value !== original) overrides[key] = value;
  });
  component.overrides = overrides;
  analysisDialog.close();
  renderComponents();
  recalculate();
  showToast("Analysewerte übernommen.");
}

function restoreAnalysis() {
  if (state.editingIndex === null) return;
  const component = state.components[state.editingIndex];
  const feed = selectedFeed(component);
  if (!feed) return;
  component.overrides = {};
  analysisFields.querySelectorAll("input[data-field]").forEach((input) => {
    const key = input.dataset.field;
    input.value = feed[key] ?? "";
  });
}

async function uploadFile(file) {
  if (!file) return;
  setStatus("Datei wird eingelesen …", "loading");
  try {
    const sheets = await WorkbookParser.readFile(file);
    const result = WorkbookParser.extractFeeds(sheets);
    state.source = { filename: file.name, sheet: result.sheet, headerRow: result.header_row };
    state.feeds = result.feeds;
    state.components = [blankComponent(), blankComponent(), blankComponent()];
    workspace.classList.remove("hidden");
    setStatus(`${result.feeds.length} Futtermittel aus „${result.sheet}“ geladen. Kopfzeile: Zeile ${result.header_row}.`, "success");
    renderComponents();
    recalculate();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function uploadRequirementFile(file) {
  if (!file) return;
  setRequirementStatus("Sollwerttabelle wird eingelesen …", "loading");
  try {
    const sheets = await WorkbookParser.readFile(file);
    const result = WorkbookParser.extractRequirements(sheets);
    state.requirementSource = { filename: file.name, sheet: result.sheet, headerRow: result.header_row };
    state.requirements = result.requirements;
    renderAnimalGroups();
    applyRequirementTargets(false);
    setRequirementStatus(`${result.requirements.length} Sollwertdatensätze aus „${result.sheet}“ geladen.`, "success");
  } catch (error) {
    setRequirementStatus(error.message, "error");
  }
}

function recipePayload() {
  return {
    version: 1,
    source: state.source,
    requirementSource: state.requirementSource,
    animalGroup: el("animalGroup").value,
    animalWeight: el("animalWeight").value,
    gainTarget: el("gainTarget").value,
    sourceFingerprint: state.feeds.map((feed) => feed.id).join("|").slice(0, 1000),
    recipeName: el("recipeName").value,
    animalCount: el("animalCount").value,
    dayCount: el("dayCount").value,
    currency: el("currency").value,
    components: state.components,
    targets: state.targets,
  };
}

function saveRecipe() {
  localStorage.setItem("futtermischungsrechner.recipe", JSON.stringify(recipePayload()));
  showToast("Rezept im Browser gespeichert.");
}

function loadRecipe() {
  const raw = localStorage.getItem("futtermischungsrechner.recipe");
  if (!raw) {
    showToast("Kein gespeichertes Rezept vorhanden.");
    return;
  }
  try {
    const saved = JSON.parse(raw);
    const availableIds = new Set(state.feeds.map((feed) => feed.id));
    state.components = (saved.components || []).map((component) => ({
      ...component,
      feedId: availableIds.has(component.feedId) ? component.feedId : "",
    }));
    if (!state.components.length) state.components = [blankComponent()];
    state.targets = { ...state.targets, ...(saved.targets || {}) };
    el("recipeName").value = saved.recipeName || "Geladenes Rezept";
    el("animalCount").value = saved.animalCount || 1;
    el("dayCount").value = saved.dayCount || 1;
    el("currency").value = saved.currency || "€";
    el("animalGroup").value = saved.animalGroup || "";
    el("animalWeight").value = saved.animalWeight || 450;
    el("gainTarget").value = saved.gainTarget || 1350;
    applyRequirementTargets(false);
    renderComponents();
    recalculate();
    showToast("Rezept geladen. Nicht mehr vorhandene Futtermittel wurden geleert.");
  } catch {
    showToast("Gespeichertes Rezept ist beschädigt.");
  }
}

function csvEscape(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function exportCsv() {
  const result = FeedCalc.calculateMixture(calculationInput());
  const currency = el("currency").value || "€";
  const lines = [
    ["Rezept", el("recipeName").value],
    ["Quelle", state.source?.filename || ""],
    ["Sollwertquelle", state.requirementSource?.filename || ""],
    ["Tiergruppe", el("animalGroup").value || ""],
    ["Gewicht kg", el("animalWeight").value || ""],
    ["Zunahmeziel g/Tag", el("gainTarget").value || ""],
    ["Verwendeter Sollwert", requirementLabel(state.selectedRequirement)],
    [],
    ["Futtermittel", "kg FM/Tier/Tag", "TM g/kg FM", `Preis ${currency}/kg FM`, "TM kg", "XP g", "nXP g", "RNB g", "ME MJ", `Kosten ${currency}`],
  ];
  state.components.forEach((component, index) => {
    const feed = selectedFeed(component);
    if (!feed) return;
    const row = result.rows[index];
    lines.push([
      feedLabel(feed), row.freshKg, row.values.tm, FeedCalc.number(component.price), row.dryKg,
      row.xp, row.nxp, row.rnb, row.me, row.cost,
    ]);
  });
  lines.push([], ["Ergebnis", "Gesamtration", "je kg FM", "je kg TM"]);
  resultRows.forEach(([key, label]) => lines.push([
    label,
    resultValue(result, key, "total"),
    resultValue(result, key, "perFresh"),
    resultValue(result, key, "perDry"),
  ]));
  const csv = "\ufeff" + lines.map((line) => line.map((value) => csvEscape(String(value).replace(".", ","))).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${(el("recipeName").value || "Futtermischung").replace(/[^a-z0-9äöüß_-]+/gi, "_")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function resetRecipe() {
  state.components = [blankComponent(), blankComponent(), blankComponent()];
  state.targets = Object.fromEntries(targetDefinitions.map((item) => [item.key, { min: "", max: "" }]));
  el("recipeName").value = "Neue Futtermischung";
  el("animalCount").value = 1;
  el("dayCount").value = 1;
  el("currency").value = "€";
  el("animalGroup").value = "";
  el("animalWeight").value = 450;
  el("gainTarget").value = 1350;
  el("matchedRequirement").value = "kein Datensatz";
  renderComponents();
  recalculate();
}

el("fileInput").addEventListener("change", (event) => uploadFile(event.target.files[0]));
el("requirementFileInput").addEventListener("change", (event) => uploadRequirementFile(event.target.files[0]));
el("addRowButton").addEventListener("click", () => addComponent());
el("saveRecipeButton").addEventListener("click", saveRecipe);
el("loadRecipeButton").addEventListener("click", loadRecipe);
el("exportButton").addEventListener("click", exportCsv);
el("resetButton").addEventListener("click", resetRecipe);
el("applyAnalysisButton").addEventListener("click", applyAnalysis);
el("restoreAnalysisButton").addEventListener("click", restoreAnalysis);
["animalCount", "dayCount", "currency"].forEach((id) => el(id).addEventListener("input", recalculate));
["animalGroup", "animalWeight", "gainTarget"].forEach((id) => {
  el(id).addEventListener("input", () => applyRequirementTargets(false));
  el(id).addEventListener("change", () => applyRequirementTargets(true));
});
