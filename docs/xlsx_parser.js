(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WorkbookParser = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const numericFields = new Set([
    "tm", "xf", "andf", "adf", "xp", "nxp", "udp", "rnb", "nel", "me",
    "xsxz", "bxs", "xl", "ca", "p", "mg", "na", "k"
  ]);

  const requirementNumericFields = new Set([
    "weightKg", "gainG", "dryKg", "xf", "andf", "xp", "nxp", "rnb",
    "nel", "me", "ca", "p", "mg", "na", "k"
  ]);

  const fieldAliases = {
    section: ["abschnitt", "kategorie", "bereich"],
    group: ["gruppe", "futtermittelgruppe"],
    number: ["nummer", "num", "nr", "futtermittelnummer"],
    feed: ["futtermittel", "futter", "bezeichnung", "futtermittelbezeichnung"],
    detail: ["auspraegung", "stadium", "detail", "variante"],
    basis: ["bezugsbasis", "basis"],
    tm: ["tm", "trockenmasse", "trockensubstanz", "ts"],
    xf: ["xf", "rohfaser"],
    andf: ["andf", "andfom", "ndf", "andfandfom"],
    adf: ["adf", "adfom", "adfadfom"],
    xp: ["xp", "rohprotein"],
    nxp: ["nxp", "nutzbaresrohprotein"],
    udp: ["udp", "unabgebautesfutterprotein"],
    rnb: ["rnb", "ruminalenbilanz", "ruminalenstickstoffbilanz"],
    nel: ["nel"],
    me: ["me", "umsetzbareenergie"],
    xsxz: ["xs+xz", "xsxz", "staerkezucker", "starkezucker"],
    bxs: ["bxs", "bestaendigestaerke", "bestaendigestarke"],
    xl: ["xl", "rohfett"],
    ca: ["ca", "calcium"],
    p: ["p", "phosphor"],
    mg: ["mg", "magnesium"],
    na: ["na", "natrium"],
    k: ["k", "kalium"],
  };

  const requirementAliases = {
    species: ["tiergruppe", "tierart", "gruppe", "rindergruppe"],
    weightKg: ["gewicht", "gewichtkg", "lebendgewicht", "lebendgewichtkg", "lm", "lmkg"],
    gainG: ["zunahme", "zunahmeg", "zunahmegd", "tageszunahme", "tageszunahmegd"],
    dryKg: ["tmkg", "trockenmassekg", "trockenmasse", "futteraufnahmekg", "tmaufnahme"],
    xf: ["xf", "rohfaser"],
    andf: ["andf", "andfom", "ndf"],
    xp: ["xp", "rohprotein", "eiweiss", "eiweis", "eiweissbedarf", "rohproteing"],
    nxp: ["nxp", "nutzbaresrohprotein"],
    rnb: ["rnb"],
    nel: ["nel", "nelmj"],
    me: ["me", "memj", "energie", "energiemj", "umsetzbareenergie"],
    ca: ["ca", "calcium"],
    p: ["p", "phosphor"],
    mg: ["mg", "magnesium"],
    na: ["na", "natrium"],
    k: ["k", "kalium"],
  };

  function parseNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    let text = String(value).trim().replace(/\u00a0/g, " ");
    if (!text) return null;
    text = text.replace(/\s/g, "");
    if (text.includes(",") && text.includes(".")) {
      text = text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
    } else {
      text = text.replace(",", ".");
    }
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return Number.isInteger(number) ? Math.trunc(number) : number;
  }

  function normalizeHeader(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/\[[^\]]*]/g, "")
      .replace(/[\/_-]/g, " ")
      .replace(/[^a-z0-9+%]+/g, "");
  }

  function cell(row, index) {
    return index !== undefined && index !== null && index < row.length ? row[index] : null;
  }

  function numbersFromCell(value) {
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "number" && Number.isFinite(value)) return [Number.isInteger(value) ? Math.trunc(value) : value];
    const matches = String(value).replace(/\u00a0/g, " ").match(/-?\d+(?:[.,]\d+)?/g) || [];
    return matches.map(parseNumber).filter((number) => number !== null);
  }

  function firstNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const number = Math.trunc(value);
      return number >= 1000 && number <= 9999 ? number : null;
    }
    const match = String(value ?? "").match(/^\s*(\d{4})\b/);
    return match ? Number(match[1]) : null;
  }

  function textWithoutLeadingNumber(value) {
    return String(value ?? "").trim().replace(/^\d{4}\s*/, "").trim();
  }

  function splitMultilineRows(row) {
    const lineCounts = row
      .filter((value) => typeof value === "string" && value.split(/\r?\n/).length > 1)
      .map((value) => value.split(/\r?\n/).length);
    if (!lineCounts.length) return [row];
    const count = Math.min(...lineCounts);
    const rows = [];
    for (let lineIndex = 0; lineIndex < count; lineIndex += 1) {
      rows.push(row.map((value) => {
        if (typeof value !== "string") return value;
        const lines = value.split(/\r?\n/);
        if (lines.length >= count && lines.length % count === 0) {
          const chunkSize = lines.length / count;
          return lines.slice(lineIndex * chunkSize, (lineIndex + 1) * chunkSize).join(" ").trim();
        }
        if (count === 2 && lines.length === 3) {
          return (lineIndex === 0 ? lines[0] : lines.slice(1).join(" ")).trim();
        }
        return value;
      }));
    }
    return rows;
  }

  function mapHeaders(row) {
    const normalized = row.map(normalizeHeader);
    const mapping = {};
    for (const [field, aliases] of Object.entries(fieldAliases)) {
      const normalizedAliases = new Set(aliases.map(normalizeHeader));
      const index = normalized.findIndex((header) => normalizedAliases.has(header));
      if (index >= 0) mapping[field] = index;
    }
    return mapping;
  }

  function scoreMapping(mapping) {
    let score = 0;
    if ("feed" in mapping) score += 8;
    if ("tm" in mapping) score += 6;
    for (const key of numericFields) if (key in mapping) score += 1;
    if ("basis" in mapping) score += 2;
    return score;
  }

  function headerPositions(row) {
    const positions = {};
    row.forEach((value, index) => {
      const header = normalizeHeader(value);
      if (!header) return;
      if (header.startsWith("num")) {
        positions.number = index;
        if (header.includes("futtermittel")) positions.feed = index;
      } else if (header === "futtermittel") positions.feed = index;
      else if (header === "tm") positions.tm = index;
      else if (header === "xf") positions.xf = index;
      else if (header.startsWith("andf")) positions.andf_group = index;
      else if (header === "xp") positions.xp = index;
      else if (header.startsWith("nxp")) positions.protein_group = index;
      else if (header === "nel") positions.nel = index;
      else if (header === "me" || header.startsWith("mexsxz")) positions.me = index;
      else if (header.startsWith("xs+xz") || header.startsWith("xsxz")) positions.carb_group = index;
      else if (header === "xl") positions.xl = index;
      else if (header.startsWith("ca")) positions.ca = index;
      else if (header === "p") positions.p = index;
      else if (header === "mg") positions.mg = index;
      else if (header === "na") positions.na = index;
      else if (header === "k") positions.k = index;
    });
    if (positions.feed === positions.number) positions.feed = 2;
    return positions;
  }

  function nextPosition(positions, after, fallback) {
    const later = Object.values(positions).filter((value) => value > after);
    return later.length ? Math.min(...later) : fallback;
  }

  function valuesBetween(row, start, stop) {
    if (start === undefined || start === null) return [];
    const values = [];
    for (let index = start; index < Math.min(stop, row.length); index += 1) {
      values.push(...numbersFromCell(row[index]));
    }
    return values;
  }

  function extractPdfLayoutFeeds(sheet) {
    const feeds = [];
    let mapping = null;
    let firstHeaderRow = null;
    let currentGroup = "";
    let currentSection = "";
    let previousNumber = null;
    let previousFeed = "";

    sheet.rows.forEach((physicalRow, rowIndex) => {
      let expandedRows = splitMultilineRows(physicalRow);
      if (expandedRows.length > 1 && ![0, 1].some((column) => firstNumber(cell(expandedRows[0], column)))) {
        expandedRows = [physicalRow];
      }
      expandedRows.forEach((row) => {
        const rowText = row.filter((value) => value !== null && value !== undefined && value !== "").join(" ");
        const normalizedRow = normalizeHeader(rowText);
        if (normalizedRow.includes("gehaltswertederfuttermittel")) return;
        if (normalizedRow.includes("num") && normalizedRow.includes("futtermittel") && normalizedRow.includes("tm")) {
          mapping = headerPositions(row);
          if (firstHeaderRow === null) firstHeaderRow = rowIndex + 1;
          return;
        }
        if (!mapping) return;

        const numberColumn = mapping.number ?? 0;
        const feedColumn = mapping.feed ?? 2;
        let number = firstNumber(cell(row, numberColumn));
        const feedText = textWithoutLeadingNumber(cell(row, feedColumn));
        if (!number && numberColumn !== 0) number = firstNumber(cell(row, 0));
        if (!number && numberColumn !== 1) number = firstNumber(cell(row, 1));

        const tmColumn = mapping.tm;
        let tm = parseNumber(cell(row, tmColumn));
        if (number === null) {
          const hasMappedNumber = Object.values(mapping).some((column) => parseNumber(cell(row, column)) !== null);
          if (feedText && !hasMappedNumber) currentGroup = feedText;
          const sectionText = String(cell(row, 0) ?? "").trim();
          if (/^\d+(?:\.\d+)?\s+/.test(sectionText)) {
            currentSection = sectionText;
            currentGroup = "";
          }
          return;
        }

        const sourceRow = rowIndex + 1;
        let detail = "";
        let feedName = "";
        if (currentGroup) {
          feedName = currentGroup;
          detail = feedText;
        } else {
          feedName = feedText || textWithoutLeadingNumber(cell(row, numberColumn));
        }

        if (tm === null && rowIndex + 1 < sheet.rows.length) {
          const nextRow = sheet.rows[rowIndex + 1];
          const hasNextNumber = [0, 1, numberColumn].some((column) => firstNumber(cell(nextRow, column)));
          const nextFeed = textWithoutLeadingNumber(cell(nextRow, feedColumn));
          const nextTm = parseNumber(cell(nextRow, tmColumn));
          if (!hasNextNumber && nextTm !== null) {
            tm = nextTm;
            if (nextFeed) detail = detail ? `${detail} ${nextFeed}` : nextFeed;
          }
        }
        if (tm === null) return;

        const item = {
          id: `${number}|${feedName}|${detail}|${sourceRow}`,
          number,
          feed: feedName,
          detail,
          group: currentGroup,
          section: currentSection,
          basis: "Trockenmasse",
          source_row: sourceRow,
        };

        for (const field of ["tm", "xf", "xp", "nel", "me", "xl", "ca", "p", "mg", "na", "k"]) {
          item[field] = parseNumber(cell(row, mapping[field]));
        }
        item.tm = tm;

        const andfValues = valuesBetween(row, mapping.andf_group, nextPosition(mapping, mapping.andf_group ?? 0, row.length));
        item.andf = andfValues.length > 0 ? andfValues[0] : null;
        item.adf = andfValues.length > 1 ? andfValues[1] : null;

        const proteinValues = valuesBetween(row, mapping.protein_group, mapping.nel ?? row.length);
        item.nxp = proteinValues.length > 0 ? proteinValues[0] : null;
        item.udp = proteinValues.length > 2 ? proteinValues[1] : null;
        item.rnb = proteinValues.length > 1 ? proteinValues[proteinValues.length - 1] : null;

        const carbStop = Math.min(...["xl", "ca"].map((key) => mapping[key]).filter((value) => value !== undefined), row.length);
        const carbValues = valuesBetween(row, mapping.carb_group, carbStop);
        item.xsxz = carbValues.length > 0 ? carbValues[0] : null;
        item.bxs = carbValues.length > 2 ? carbValues[1] : null;
        item.xl = item.xl ?? (carbValues.length > 1 ? carbValues[carbValues.length - 1] : null);

        feeds.push(item);
        previousNumber = number;
        previousFeed = feedName;
      });
    });
    return { feeds, firstHeaderRow };
  }

  function findDataSheet(sheets) {
    const candidates = [];
    for (const sheet of sheets) {
      const nameBonus = ["allefuttermittel", "naehrstoffdaten", "futtermittel"].includes(normalizeHeader(sheet.name)) ? 8 : 0;
      sheet.rows.slice(0, 40).forEach((row, rowIndex) => {
        const mapping = mapHeaders(row);
        const score = scoreMapping(mapping) + nameBonus;
        if ("feed" in mapping && "tm" in mapping && score >= 18) candidates.push({ score, rowIndex, sheet, mapping });
      });
    }
    if (!candidates.length) throw new Error("Keine passende Kopfzeile gefunden. Erforderlich sind mindestens Futtermittel und TM sowie Nährstoffspalten.");
    candidates.sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex);
    return candidates[0];
  }

  function extractFeeds(sheets) {
    for (const sheet of sheets) {
      const maxColumns = Math.max(0, ...sheet.rows.map((row) => row.length));
      if (maxColumns >= 40) {
        const { feeds, firstHeaderRow } = extractPdfLayoutFeeds(sheet);
        if (feeds.length >= 200) {
          feeds.sort((a, b) => `${a.section || ""}|${a.group || ""}|${a.feed || ""}|${a.detail || ""}`.localeCompare(`${b.section || ""}|${b.group || ""}|${b.feed || ""}|${b.detail || ""}`, "de", { numeric: true }));
          return {
            sheet: sheet.name,
            header_row: firstHeaderRow || 1,
            columns: [...numericFields, "number", "feed", "detail", "basis", "section", "group"].sort(),
            feeds,
          };
        }
      }
    }

    const { sheet, rowIndex, mapping } = findDataSheet(sheets);
    const feeds = [];
    const seen = new Set();
    sheet.rows.slice(rowIndex + 1).forEach((row, offset) => {
      const rowNumber = rowIndex + 2 + offset;
      const feedName = String(cell(row, mapping.feed) ?? "").trim();
      if (!feedName) return;
      const basis = String(cell(row, mapping.basis) ?? "").trim();
      const basisNorm = basis.toLowerCase();
      if (basis && !basisNorm.includes("trocken") && !["tm", "ts"].includes(basisNorm)) return;
      const number = cell(row, mapping.number);
      const detail = String(cell(row, mapping.detail) ?? "").trim();
      const identity = `${number}|${feedName}|${detail}|${rowNumber}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      const item = {
        id: identity,
        number,
        feed: feedName,
        detail,
        group: String(cell(row, mapping.group) ?? "").trim(),
        section: String(cell(row, mapping.section) ?? "").trim(),
        basis: basis || "Trockenmasse",
        source_row: rowNumber,
      };
      for (const field of numericFields) item[field] = parseNumber(cell(row, mapping[field]));
      if (item.tm !== null) feeds.push(item);
    });
    if (!feeds.length) throw new Error("Die Tabelle enthält keine verwertbaren Futtermittelzeilen mit Trockenmassewert.");
    feeds.sort((a, b) => `${a.section || ""}|${a.group || ""}|${a.feed || ""}|${a.detail || ""}`.localeCompare(`${b.section || ""}|${b.group || ""}|${b.feed || ""}|${b.detail || ""}`, "de", { numeric: true }));
    return { sheet: sheet.name, header_row: rowIndex + 1, columns: Object.keys(mapping).sort(), feeds };
  }

  function mapRequirementHeaders(row) {
    const normalized = row.map(normalizeHeader);
    const mapping = {};
    for (const [field, aliases] of Object.entries(requirementAliases)) {
      const normalizedAliases = new Set(aliases.map(normalizeHeader));
      const index = normalized.findIndex((header) => {
        const stripped = header.replace(/(kg|gd|g|mj)$/, "");
        return normalizedAliases.has(header) || normalizedAliases.has(stripped);
      });
      if (index >= 0) mapping[field] = index;
    }
    return mapping;
  }

  function scoreRequirementMapping(mapping) {
    let score = 0;
    if ("species" in mapping) score += 10;
    if ("weightKg" in mapping) score += 8;
    if ("gainG" in mapping) score += 4;
    if ("me" in mapping || "nel" in mapping) score += 4;
    if ("xp" in mapping || "nxp" in mapping) score += 4;
    for (const key of requirementNumericFields) if (key in mapping) score += 1;
    return score;
  }

  function findRequirementSheet(sheets) {
    const candidates = [];
    for (const sheet of sheets) {
      sheet.rows.slice(0, 50).forEach((row, rowIndex) => {
        const mapping = mapRequirementHeaders(row);
        const score = scoreRequirementMapping(mapping);
        if ("species" in mapping && "weightKg" in mapping && score >= 20) candidates.push({ score, rowIndex, sheet, mapping });
      });
    }
    if (!candidates.length) throw new Error("Keine passende Sollwert-Kopfzeile gefunden. Erforderlich sind mindestens Tiergruppe, Gewicht und Nährstoffspalten wie ME/NEL, XP oder Ca/P.");
    candidates.sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex);
    return candidates[0];
  }

  function extractRequirements(sheets) {
    const { sheet, rowIndex, mapping } = findRequirementSheet(sheets);
    const requirements = [];
    const seen = new Set();
    sheet.rows.slice(rowIndex + 1).forEach((row, offset) => {
      const rowNumber = rowIndex + 2 + offset;
      const species = String(cell(row, mapping.species) ?? "").trim();
      if (!species) return;
      const weight = parseNumber(cell(row, mapping.weightKg));
      if (weight === null) return;
      const gain = parseNumber(cell(row, mapping.gainG));
      const item = { id: `${species}|${weight}|${gain ?? ""}|${rowNumber}`, species, weightKg: weight, gainG: gain, source_row: rowNumber };
      for (const field of requirementNumericFields) {
        if (field !== "weightKg" && field !== "gainG") item[field] = parseNumber(cell(row, mapping[field]));
      }
      const hasNutrient = [...requirementNumericFields].some((field) => !["weightKg", "gainG"].includes(field) && item[field] !== null);
      if (!hasNutrient || seen.has(item.id)) return;
      seen.add(item.id);
      requirements.push(item);
    });
    if (!requirements.length) throw new Error("Die Sollwerttabelle enthält keine verwertbaren Zeilen.");
    requirements.sort((a, b) => `${normalizeHeader(a.species)}|${a.weightKg || 0}|${a.gainG || 0}`.localeCompare(`${normalizeHeader(b.species)}|${b.weightKg || 0}|${b.gainG || 0}`, "de", { numeric: true }));
    return { sheet: sheet.name, header_row: rowIndex + 1, columns: Object.keys(mapping).sort(), requirements };
  }

  function csvToRows(text) {
    const delimiter = (text.slice(0, 4096).match(/;/g) || []).length >= (text.slice(0, 4096).match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          value += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) {
        row.push(value);
        value = "";
      } else if (char === "\n") {
        row.push(value.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        value = "";
      } else value += char;
    }
    row.push(value.replace(/\r$/, ""));
    if (row.some((cellValue) => cellValue !== "")) rows.push(row);
    return rows;
  }

  async function readFile(file) {
    const suffix = file.name.split(".").pop().toLowerCase();
    if (suffix === "csv") {
      const text = await file.text();
      return [{ name: "CSV", rows: csvToRows(text) }];
    }
    if (suffix !== "xlsx") throw new Error("Unterstützt werden .xlsx und .csv. Alte .xls-Dateien bitte zuerst als .xlsx speichern.");
    if (!root.XLSX) throw new Error("Die Excel-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen oder SheetJS lokal einbinden.");
    const workbook = root.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    return workbook.SheetNames.map((name) => ({
      name,
      rows: root.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: true }),
    }));
  }

  return { readFile, extractFeeds, extractRequirements, parseNumber, normalizeHeader };
});
