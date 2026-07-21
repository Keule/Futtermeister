from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Iterable
from xml.etree import ElementTree as ET


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_REL_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"


class WorkbookReadError(ValueError):
    pass


@dataclass(frozen=True)
class WorksheetData:
    name: str
    rows: list[list[Any]]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _column_index(cell_ref: str) -> int:
    match = re.match(r"([A-Z]+)", cell_ref.upper())
    if not match:
        return 0
    value = 0
    for char in match.group(1):
        value = value * 26 + (ord(char) - 64)
    return value - 1


def _parse_number(value: Any) -> float | int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip().replace("\u00a0", " ")
    if not text:
        return None
    text = text.replace(" ", "")
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    else:
        text = text.replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        raw = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    values: list[str] = []
    for si in root:
        if _local(si.tag) != "si":
            continue
        pieces: list[str] = []
        for node in si.iter():
            if _local(node.tag) == "t" and node.text is not None:
                pieces.append(node.text)
        values.append("".join(pieces))
    return values


def _sheet_targets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
    rel_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationships: dict[str, str] = {}
    for rel in rel_root:
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rel_id and target:
            relationships[rel_id] = target

    sheets: list[tuple[str, str]] = []
    for node in workbook_root.iter():
        if _local(node.tag) != "sheet":
            continue
        name = node.attrib.get("name", "Tabelle")
        rel_id = node.attrib.get(f"{{{NS_REL_DOC}}}id")
        if not rel_id or rel_id not in relationships:
            continue
        target = relationships[rel_id].lstrip("/")
        if not target.startswith("xl/"):
            target = str(PurePosixPath("xl") / target)
        sheets.append((name, target))
    return sheets


def _read_sheet(
    archive: zipfile.ZipFile,
    name: str,
    path: str,
    shared_strings: list[str],
) -> WorksheetData:
    root = ET.fromstring(archive.read(path))
    rows: list[list[Any]] = []
    for row_node in root.iter():
        if _local(row_node.tag) != "row":
            continue
        row_values: list[Any] = []
        for cell in row_node:
            if _local(cell.tag) != "c":
                continue
            ref = cell.attrib.get("r", "A1")
            index = _column_index(ref)
            while len(row_values) <= index:
                row_values.append(None)
            cell_type = cell.attrib.get("t")
            value_node = next((n for n in cell if _local(n.tag) == "v"), None)
            inline_node = next((n for n in cell if _local(n.tag) == "is"), None)
            value: Any = None
            if cell_type == "inlineStr" and inline_node is not None:
                value = "".join(
                    n.text or "" for n in inline_node.iter() if _local(n.tag) == "t"
                )
            elif value_node is not None:
                raw_value = value_node.text or ""
                if cell_type == "s":
                    try:
                        value = shared_strings[int(raw_value)]
                    except (ValueError, IndexError):
                        value = raw_value
                elif cell_type == "b":
                    value = raw_value == "1"
                elif cell_type in {"str", "e"}:
                    value = raw_value
                else:
                    value = _parse_number(raw_value)
                    if value is None:
                        value = raw_value
            row_values[index] = value
        while row_values and row_values[-1] is None:
            row_values.pop()
        rows.append(row_values)
    return WorksheetData(name=name, rows=rows)


def read_xlsx(content: bytes) -> list[WorksheetData]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise WorkbookReadError("Die Datei ist keine gültige XLSX-Arbeitsmappe.") from exc
    with archive:
        try:
            shared = _shared_strings(archive)
            targets = _sheet_targets(archive)
        except (KeyError, ET.ParseError) as exc:
            raise WorkbookReadError("Die XLSX-Struktur konnte nicht gelesen werden.") from exc
        sheets: list[WorksheetData] = []
        for name, path in targets:
            try:
                sheets.append(_read_sheet(archive, name, path, shared))
            except KeyError:
                continue
    if not sheets:
        raise WorkbookReadError("In der Arbeitsmappe wurde kein lesbares Tabellenblatt gefunden.")
    return sheets


def read_csv(content: bytes) -> list[WorksheetData]:
    text = None
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise WorkbookReadError("Die CSV-Datei konnte nicht dekodiert werden.")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t,")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"
    rows = [row for row in csv.reader(io.StringIO(text), dialect)]
    return [WorksheetData(name="CSV", rows=rows)]


def normalize_header(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    text = re.sub(r"\[[^]]*]", "", text)
    text = text.replace("/", " ").replace("_", " ").replace("-", " ")
    return re.sub(r"[^a-z0-9+%]+", "", text)


FIELD_ALIASES: dict[str, set[str]] = {
    "section": {"abschnitt", "kategorie", "bereich"},
    "group": {"gruppe", "futtermittelgruppe"},
    "number": {"nummer", "num", "nr", "futtermittelnummer"},
    "feed": {"futtermittel", "futter", "bezeichnung", "futtermittelbezeichnung"},
    "detail": {"auspraegung", "stadium", "detail", "variante"},
    "basis": {"bezugsbasis", "basis"},
    "tm": {"tm", "trockenmasse", "trockensubstanz", "ts"},
    "xf": {"xf", "rohfaser"},
    "andf": {"andf", "andfom", "ndf", "andfandfom"},
    "adf": {"adf", "adfom", "adfadfom"},
    "xp": {"xp", "rohprotein"},
    "nxp": {"nxp", "nutzbaresrohprotein"},
    "udp": {"udp", "unabgebautesfutterprotein"},
    "rnb": {"rnb", "ruminalenbilanz", "ruminalenstickstoffbilanz"},
    "nel": {"nel"},
    "me": {"me", "umsetzbareenergie"},
    "xsxz": {"xs+xz", "xsxz", "staerkezucker", "starkezucker"},
    "bxs": {"bxs", "bestaendigestaerke", "bestaendigestarke"},
    "xl": {"xl", "rohfett"},
    "ca": {"ca", "calcium"},
    "p": {"p", "phosphor"},
    "mg": {"mg", "magnesium"},
    "na": {"na", "natrium"},
    "k": {"k", "kalium"},
}

NUMERIC_FIELDS = {
    "tm", "xf", "andf", "adf", "xp", "nxp", "udp", "rnb", "nel", "me",
    "xsxz", "bxs", "xl", "ca", "p", "mg", "na", "k",
}

REQUIREMENT_ALIASES: dict[str, set[str]] = {
    "species": {"tiergruppe", "tierart", "gruppe", "rindergruppe"},
    "weightKg": {"gewicht", "gewichtkg", "lebendgewicht", "lebendgewichtkg", "lm", "lmkg"},
    "gainG": {"zunahme", "zunahmeg", "zunahmegd", "tageszunahme", "tageszunahmegd"},
    "dryKg": {"tmkg", "trockenmassekg", "trockenmasse", "futteraufnahmekg", "tmaufnahme"},
    "xf": {"xf", "rohfaser"},
    "andf": {"andf", "andfom", "ndf"},
    "xp": {"xp", "rohprotein", "eiweiss", "eiweis", "eiweissbedarf", "rohproteing"},
    "nxp": {"nxp", "nutzbaresrohprotein"},
    "rnb": {"rnb"},
    "nel": {"nel", "nelmj"},
    "me": {"me", "memj", "energie", "energiemj", "umsetzbareenergie"},
    "ca": {"ca", "calcium"},
    "p": {"p", "phosphor"},
    "mg": {"mg", "magnesium"},
    "na": {"na", "natrium"},
    "k": {"k", "kalium"},
}

REQUIREMENT_NUMERIC_FIELDS = {
    "weightKg", "gainG", "dryKg", "xf", "andf", "xp", "nxp", "rnb",
    "nel", "me", "ca", "p", "mg", "na", "k",
}


def _map_headers(row: list[Any]) -> dict[str, int]:
    normalized = [normalize_header(value) for value in row]
    mapping: dict[str, int] = {}
    for field, aliases in FIELD_ALIASES.items():
        normalized_aliases = {normalize_header(alias) for alias in aliases}
        for index, header in enumerate(normalized):
            if header in normalized_aliases:
                mapping[field] = index
                break
    return mapping


def _numbers_from_cell(value: Any) -> list[float | int]:
    if value is None or value == "":
        return []
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return [int(value) if float(value).is_integer() else value]
    text = str(value).replace("\u00a0", " ")
    values: list[float | int] = []
    for match in re.finditer(r"-?\d+(?:[.,]\d+)?", text):
        number = _parse_number(match.group(0))
        if number is not None:
            values.append(number)
    return values


def _first_number(value: Any) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value) if 1000 <= int(value) <= 9999 else None
    match = re.match(r"\s*(\d{4})\b", str(value or ""))
    if match:
        return int(match.group(1))
    return None


def _text_without_leading_number(value: Any) -> str:
    text = str(value or "").strip()
    return re.sub(r"^\d{4}\s*", "", text).strip()


def _cell(row: list[Any], index: int | None) -> Any:
    return row[index] if index is not None and index < len(row) else None


def _split_multiline_rows(row: list[Any]) -> list[list[Any]]:
    line_counts = [
        len(str(value).splitlines())
        for value in row
        if isinstance(value, str) and len(str(value).splitlines()) > 1
    ]
    if not line_counts:
        return [row]
    count = min(line_counts)
    expanded: list[list[Any]] = []
    for line_index in range(count):
        logical_row: list[Any] = []
        for value in row:
            if isinstance(value, str) and len(value.splitlines()) >= count and len(value.splitlines()) % count == 0:
                lines = value.splitlines()
                chunk_size = len(lines) // count
                logical_row.append(" ".join(lines[line_index * chunk_size:(line_index + 1) * chunk_size]).strip())
            elif isinstance(value, str) and count == 2 and len(value.splitlines()) == 3:
                lines = value.splitlines()
                logical_row.append((lines[0] if line_index == 0 else " ".join(lines[1:])).strip())
            else:
                logical_row.append(value)
        expanded.append(logical_row)
    return expanded


def _header_positions(row: list[Any]) -> dict[str, int]:
    positions: dict[str, int] = {}
    for index, value in enumerate(row):
        header = normalize_header(value)
        if not header:
            continue
        if header.startswith("num"):
            positions["number"] = index
            if "futtermittel" in header:
                positions["feed"] = index
        elif header == "futtermittel":
            positions["feed"] = index
        elif header == "tm":
            positions["tm"] = index
        elif header == "xf":
            positions["xf"] = index
        elif header.startswith("andf"):
            positions["andf_group"] = index
        elif header == "xp":
            positions["xp"] = index
        elif header.startswith("nxp"):
            positions["protein_group"] = index
        elif header == "nel":
            positions["nel"] = index
        elif header == "me" or header.startswith("mexsxz"):
            positions["me"] = index
        elif header.startswith("xs+xz") or header.startswith("xsxz"):
            positions["carb_group"] = index
        elif header == "xl":
            positions["xl"] = index
        elif header.startswith("ca"):
            positions["ca"] = index
        elif header == "p":
            positions["p"] = index
        elif header == "mg":
            positions["mg"] = index
        elif header == "na":
            positions["na"] = index
        elif header == "k":
            positions["k"] = index
    if positions.get("feed") == positions.get("number"):
        positions["feed"] = 2
    return positions


def _next_position(positions: dict[str, int], after: int, fallback: int) -> int:
    later = [value for value in positions.values() if value > after]
    return min(later) if later else fallback


def _values_between(row: list[Any], start: int | None, stop: int) -> list[float | int]:
    if start is None:
        return []
    values: list[float | int] = []
    for index in range(start, min(stop, len(row))):
        values.extend(_numbers_from_cell(row[index]))
    return values


def _extract_pdf_layout_feeds(sheet: WorksheetData) -> tuple[list[dict[str, Any]], int | None]:
    feeds: list[dict[str, Any]] = []
    mapping: dict[str, int] | None = None
    first_header_row: int | None = None
    current_group = ""
    current_section = ""
    previous_number: int | None = None
    previous_feed = ""

    for row_index, physical_row in enumerate(sheet.rows):
        expanded_rows = _split_multiline_rows(physical_row)
        if len(expanded_rows) > 1 and not any(_first_number(_cell(expanded_rows[0], col)) for col in (0, 1)):
            expanded_rows = [physical_row]
        for row in expanded_rows:
            row_text = " ".join(str(value) for value in row if value not in (None, ""))
            normalized_row = normalize_header(row_text)
            if "gehaltswertederfuttermittel" in normalized_row:
                continue
            if "num" in normalized_row and "futtermittel" in normalized_row and "tm" in normalized_row:
                mapping = _header_positions(row)
                if first_header_row is None:
                    first_header_row = row_index + 1
                continue
            if mapping is None:
                continue

            number_col = mapping.get("number", 0)
            feed_col = mapping.get("feed", 2)
            number = _first_number(_cell(row, number_col))
            feed_text = _text_without_leading_number(_cell(row, feed_col))
            if not number and number_col != 0:
                number = _first_number(_cell(row, 0))
            if not number and number_col != 1:
                number = _first_number(_cell(row, 1))

            tm_col = mapping.get("tm")
            tm = _parse_number(_cell(row, tm_col))
            continuation_variant = False

            if number is None and not continuation_variant:
                if feed_text and not any(_parse_number(_cell(row, col)) is not None for col in mapping.values()):
                    current_group = feed_text
                section_text = str(_cell(row, 0) or "").strip()
                if re.match(r"^\d+(?:\.\d+)?\s+", section_text):
                    current_section = section_text
                    current_group = ""
                continue

            source_row = row_index + 1
            detail = ""
            if continuation_variant:
                number = previous_number
                feed_name = previous_feed or feed_text
                detail = feed_text
            elif current_group:
                feed_name = current_group
                detail = feed_text
            else:
                feed_name = feed_text or _text_without_leading_number(_cell(row, number_col))

            if tm is None and row_index + 1 < len(sheet.rows):
                next_row = sheet.rows[row_index + 1]
                has_next_number = any(_first_number(_cell(next_row, col)) for col in (0, 1, number_col))
                next_feed = _text_without_leading_number(_cell(next_row, feed_col))
                next_tm = _parse_number(_cell(next_row, tm_col))
                if not has_next_number and next_tm is not None:
                    tm = next_tm
                    if next_feed:
                        detail = next_feed if not detail else f"{detail} {next_feed}"
            if tm is None:
                continue

            item: dict[str, Any] = {
                "id": f"{number}|{feed_name}|{detail}|{source_row}",
                "number": number,
                "feed": feed_name,
                "detail": detail,
                "group": current_group,
                "section": current_section,
                "basis": "Trockenmasse",
                "source_row": source_row,
            }

            for field in ("tm", "xf", "xp", "nel", "me", "xl", "ca", "p", "mg", "na", "k"):
                item[field] = _parse_number(_cell(row, mapping.get(field)))
            item["tm"] = tm

            andf_start = mapping.get("andf_group")
            andf_values = _values_between(row, andf_start, _next_position(mapping, andf_start or 0, len(row)))
            item["andf"] = andf_values[0] if len(andf_values) > 0 else None
            item["adf"] = andf_values[1] if len(andf_values) > 1 else None

            protein_start = mapping.get("protein_group")
            protein_values = _values_between(row, protein_start, mapping.get("nel", len(row)))
            item["nxp"] = protein_values[0] if len(protein_values) > 0 else None
            item["udp"] = protein_values[1] if len(protein_values) > 2 else None
            item["rnb"] = protein_values[-1] if len(protein_values) > 1 else None

            carb_start = mapping.get("carb_group")
            carb_stop = min((mapping.get(key, len(row)) for key in ("xl", "ca") if mapping.get(key) is not None), default=len(row))
            carb_values = _values_between(row, carb_start, carb_stop)
            item["xsxz"] = carb_values[0] if len(carb_values) > 0 else None
            item["bxs"] = carb_values[1] if len(carb_values) > 2 else None
            item["xl"] = item.get("xl") or (carb_values[-1] if len(carb_values) > 1 else None)

            feeds.append(item)
            previous_number = number
            previous_feed = feed_name

    return feeds, first_header_row


def _score_mapping(mapping: dict[str, int]) -> int:
    score = 0
    score += 8 if "feed" in mapping else 0
    score += 6 if "tm" in mapping else 0
    score += sum(1 for key in NUMERIC_FIELDS if key in mapping)
    score += 2 if "basis" in mapping else 0
    return score


def find_data_sheet(sheets: Iterable[WorksheetData]) -> tuple[WorksheetData, int, dict[str, int]]:
    candidates: list[tuple[int, int, WorksheetData, dict[str, int]]] = []
    for sheet in sheets:
        name_bonus = 8 if normalize_header(sheet.name) in {"allefuttermittel", "naehrstoffdaten", "futtermittel"} else 0
        for row_index, row in enumerate(sheet.rows[:40]):
            mapping = _map_headers(row)
            score = _score_mapping(mapping) + name_bonus
            if "feed" in mapping and "tm" in mapping and score >= 18:
                candidates.append((score, -row_index, sheet, mapping))
    if not candidates:
        raise WorkbookReadError(
            "Keine passende Kopfzeile gefunden. Erforderlich sind mindestens „Futtermittel“ und „TM [g]“ sowie Nährstoffspalten."
        )
    _, negative_row, sheet, mapping = max(candidates, key=lambda item: (item[0], item[1]))
    return sheet, -negative_row, mapping


def extract_feeds(sheets: list[WorksheetData]) -> dict[str, Any]:
    for sheet in sheets:
        if max((len(row) for row in sheet.rows), default=0) >= 40:
            pdf_feeds, first_header_row = _extract_pdf_layout_feeds(sheet)
            if len(pdf_feeds) >= 200:
                pdf_feeds.sort(key=lambda item: (
                    str(item.get("section") or ""),
                    str(item.get("group") or ""),
                    str(item.get("feed") or ""),
                    str(item.get("detail") or ""),
                ))
                return {
                    "sheet": sheet.name,
                    "header_row": first_header_row or 1,
                    "columns": sorted(NUMERIC_FIELDS | {"number", "feed", "detail", "basis", "section", "group"}),
                    "feeds": pdf_feeds,
                }

    sheet, header_row, mapping = find_data_sheet(sheets)
    feeds: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for row_number, row in enumerate(sheet.rows[header_row + 1 :], start=header_row + 2):
        def cell(field: str) -> Any:
            index = mapping.get(field)
            return row[index] if index is not None and index < len(row) else None

        feed_name = str(cell("feed") or "").strip()
        if not feed_name:
            continue
        basis = str(cell("basis") or "").strip()
        if basis and "trocken" not in basis.lower() and basis.lower() not in {"tm", "ts"}:
            continue

        number = cell("number")
        detail = str(cell("detail") or "").strip()
        group = str(cell("group") or "").strip()
        section = str(cell("section") or "").strip()
        identity = f"{number}|{feed_name}|{detail}|{row_number}"
        if identity in seen_ids:
            continue
        seen_ids.add(identity)

        item: dict[str, Any] = {
            "id": identity,
            "number": number,
            "feed": feed_name,
            "detail": detail,
            "group": group,
            "section": section,
            "basis": basis or "Trockenmasse",
            "source_row": row_number,
        }
        for field in NUMERIC_FIELDS:
            item[field] = _parse_number(cell(field))
        if item.get("tm") is None:
            continue
        feeds.append(item)

    if not feeds:
        raise WorkbookReadError("Die Tabelle enthält keine verwertbaren Futtermittelzeilen mit Trockenmassewert.")

    feeds.sort(key=lambda item: (
        str(item.get("section") or ""),
        str(item.get("group") or ""),
        str(item.get("feed") or ""),
        str(item.get("detail") or ""),
    ))
    return {
        "sheet": sheet.name,
        "header_row": header_row + 1,
        "columns": sorted(mapping.keys()),
        "feeds": feeds,
    }


def _map_requirement_headers(row: list[Any]) -> dict[str, int]:
    normalized = [normalize_header(value) for value in row]
    mapping: dict[str, int] = {}
    for field, aliases in REQUIREMENT_ALIASES.items():
        normalized_aliases = {normalize_header(alias) for alias in aliases}
        for index, header in enumerate(normalized):
            header_variants = {
                header,
                re.sub(r"(kg|gd|g|mj)$", "", header),
            }
            if header_variants & normalized_aliases:
                mapping[field] = index
                break
    return mapping


def _score_requirement_mapping(mapping: dict[str, int]) -> int:
    score = 0
    score += 10 if "species" in mapping else 0
    score += 8 if "weightKg" in mapping else 0
    score += 4 if "gainG" in mapping else 0
    score += 4 if "me" in mapping or "nel" in mapping else 0
    score += 4 if "xp" in mapping or "nxp" in mapping else 0
    score += sum(1 for key in REQUIREMENT_NUMERIC_FIELDS if key in mapping)
    return score


def find_requirement_sheet(sheets: Iterable[WorksheetData]) -> tuple[WorksheetData, int, dict[str, int]]:
    candidates: list[tuple[int, int, WorksheetData, dict[str, int]]] = []
    for sheet in sheets:
        for row_index, row in enumerate(sheet.rows[:50]):
            mapping = _map_requirement_headers(row)
            score = _score_requirement_mapping(mapping)
            if "species" in mapping and "weightKg" in mapping and score >= 20:
                candidates.append((score, -row_index, sheet, mapping))
    if not candidates:
        raise WorkbookReadError(
            "Keine passende Sollwert-Kopfzeile gefunden. Erforderlich sind mindestens "
            "Tiergruppe, Gewicht und Nährstoffspalten wie ME/NEL, XP oder Ca/P."
        )
    _, negative_row, sheet, mapping = max(candidates, key=lambda item: (item[0], item[1]))
    return sheet, -negative_row, mapping


def extract_requirements(sheets: list[WorksheetData]) -> dict[str, Any]:
    sheet, header_row, mapping = find_requirement_sheet(sheets)
    requirements: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for row_number, row in enumerate(sheet.rows[header_row + 1 :], start=header_row + 2):
        species = str(_cell(row, mapping.get("species")) or "").strip()
        if not species:
            continue
        weight = _parse_number(_cell(row, mapping.get("weightKg")))
        if weight is None:
            continue
        gain = _parse_number(_cell(row, mapping.get("gainG")))
        item: dict[str, Any] = {
            "id": f"{species}|{weight}|{gain if gain is not None else ''}|{row_number}",
            "species": species,
            "weightKg": weight,
            "gainG": gain,
            "source_row": row_number,
        }
        for field in REQUIREMENT_NUMERIC_FIELDS - {"weightKg", "gainG"}:
            item[field] = _parse_number(_cell(row, mapping.get(field)))

        if not any(item.get(field) is not None for field in REQUIREMENT_NUMERIC_FIELDS - {"weightKg", "gainG"}):
            continue
        if item["id"] in seen_ids:
            continue
        seen_ids.add(item["id"])
        requirements.append(item)

    if not requirements:
        raise WorkbookReadError("Die Sollwerttabelle enthält keine verwertbaren Zeilen.")

    requirements.sort(key=lambda item: (
        normalize_header(item.get("species")),
        item.get("weightKg") or 0,
        item.get("gainG") or 0,
    ))
    return {
        "sheet": sheet.name,
        "header_row": header_row + 1,
        "columns": sorted(mapping.keys()),
        "requirements": requirements,
    }
