from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from xlsx_reader import extract_feeds, extract_requirements, read_xlsx


def main() -> None:
    path = Path(__file__).resolve().parents[1] / "sample_data" / "Futtermittelnaehrstofftabelle.xlsx"
    result = extract_feeds(read_xlsx(path.read_bytes()))
    assert result["sheet"] in {"Alle Futtermittel", "Table 1"}
    assert len(result["feeds"]) == 227
    first = next(feed for feed in result["feeds"] if feed.get("number") == 1013)
    assert first["tm"] == 175
    assert first["xp"] == 228
    print(f"Parser OK: {len(result['feeds'])} Futtermittel")

    requirement_path = Path(__file__).resolve().parents[1] / "sample_data" / "Sollwerte_Rinder.xlsx"
    requirements = extract_requirements(read_xlsx(requirement_path.read_bytes()))
    assert len(requirements["requirements"]) >= 5
    bull = next(item for item in requirements["requirements"] if item["species"] == "Bullen" and item["weightKg"] == 450)
    assert bull["gainG"] == 1350
    assert bull["me"] == 101
    assert bull["xp"] == 1109
    assert bull["ca"] == 53
    print(f"Sollwertparser OK: {len(requirements['requirements'])} Datensätze")


if __name__ == "__main__":
    main()
