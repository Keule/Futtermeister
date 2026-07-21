from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from xlsx_reader import WorkbookReadError, extract_feeds, extract_requirements, read_csv, read_xlsx


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SAMPLE_FILE = BASE_DIR / "sample_data" / "Futtermittelnaehrstofftabelle.xlsx"
REQUIREMENTS_SAMPLE_FILE = BASE_DIR / "sample_data" / "Sollwerte_Rinder.xlsx"
MAX_UPLOAD_BYTES = 15 * 1024 * 1024

app = FastAPI(
    title="Futtermischungs-Rechner",
    description="Lokaler Rations- und Futtermischungsrechner mit XLSX-Import.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sample")
def sample() -> FileResponse:
    return FileResponse(
        SAMPLE_FILE,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="Futtermittelnaehrstofftabelle.xlsx",
    )


@app.get("/requirements/sample")
def requirements_sample() -> FileResponse:
    return FileResponse(
        REQUIREMENTS_SAMPLE_FILE,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="Sollwerte_Rinder.xlsx",
    )


@app.post("/api/upload")
async def upload(file: Annotated[UploadFile, File(...)]) -> JSONResponse:
    filename = file.filename or ""
    suffix = Path(filename).suffix.lower()
    if suffix not in {".xlsx", ".csv"}:
        raise HTTPException(status_code=415, detail="Unterstützt werden .xlsx und .csv. Alte .xls-Dateien bitte zuerst als .xlsx speichern.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Die Datei ist größer als 15 MB.")
    try:
        sheets = read_xlsx(content) if suffix == ".xlsx" else read_csv(content)
        result = extract_feeds(sheets)
    except WorkbookReadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JSONResponse({
        "filename": filename,
        "sheet": result["sheet"],
        "header_row": result["header_row"],
        "columns": result["columns"],
        "count": len(result["feeds"]),
        "feeds": result["feeds"],
    })


@app.post("/api/requirements/upload")
async def upload_requirements(file: Annotated[UploadFile, File(...)]) -> JSONResponse:
    filename = file.filename or ""
    suffix = Path(filename).suffix.lower()
    if suffix not in {".xlsx", ".csv"}:
        raise HTTPException(status_code=415, detail="Unterstützt werden .xlsx und .csv.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Die Datei ist größer als 15 MB.")
    try:
        sheets = read_xlsx(content) if suffix == ".xlsx" else read_csv(content)
        result = extract_requirements(sheets)
    except WorkbookReadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JSONResponse({
        "filename": filename,
        "sheet": result["sheet"],
        "header_row": result["header_row"],
        "columns": result["columns"],
        "count": len(result["requirements"]),
        "requirements": result["requirements"],
    })


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=False,
    )
