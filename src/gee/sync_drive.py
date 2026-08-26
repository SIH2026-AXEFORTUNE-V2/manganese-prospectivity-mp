"""Pull finished Earth Engine exports from Google Drive into data/raw/gee/.

Earth Engine writes exports to Drive, not to disk. This downloads them.

Reuses the Earth Engine OAuth credentials, which already carry the Drive scope, so
there is no second sign-in.

    python -m src.gee.sync_drive --list      # see what is there
    python -m src.gee.sync_drive             # download anything missing
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

import ee.oauth as oauth

from src.config import ROOT, cfg, out_dir


def drive_service():
    """Drive client built from the stored Earth Engine credentials."""
    path = Path(oauth.get_credentials_path())
    if not path.exists():
        raise RuntimeError(
            f"No Earth Engine credentials at {path}.\n"
            "Run: python -m src.gee.auth --authenticate"
        )
    info = json.loads(path.read_text(encoding="utf-8"))
    creds = Credentials(
        token=None,
        refresh_token=info["refresh_token"],
        client_id=info["client_id"],
        client_secret=info["client_secret"],
        token_uri=oauth.TOKEN_URI,
        scopes=oauth.SCOPES,
    )
    creds.refresh(Request())
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def find_folder(service, name: str) -> str | None:
    q = (
        f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    res = service.files().list(q=q, fields="files(id, name)", pageSize=10).execute()
    files = res.get("files", [])
    return files[0]["id"] if files else None


def list_exports(service, folder_id: str) -> list[dict]:
    files, token = [], None
    while True:
        res = (
            service.files()
            .list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, size, mimeType, modifiedTime)",
                pageSize=200,
                pageToken=token,
            )
            .execute()
        )
        files.extend(res.get("files", []))
        token = res.get("nextPageToken")
        if not token:
            break

    # Drive permits duplicate filenames, and re-exporting a task ADDS a file rather
    # than replacing it. Without this, a re-export leaves two same-named files and the
    # download order decides which one wins - silently keeping the stale copy, which
    # is exactly how an all-NaN terrain raster survived a "successful" re-export.
    newest: dict[str, dict] = {}
    for f in files:
        prior = newest.get(f["name"])
        if prior is None or f.get("modifiedTime", "") > prior.get("modifiedTime", ""):
            newest[f["name"]] = f

    shadowed = len(files) - len(newest)
    if shadowed:
        print(f"  note: {shadowed} older duplicate(s) in Drive ignored; keeping newest")

    return sorted(newest.values(), key=lambda f: f["name"])


def download(service, file_meta: dict, dest_dir: Path) -> Path | None:
    dest = dest_dir / file_meta["name"]
    size = int(file_meta.get("size", 0))

    if dest.exists() and dest.stat().st_size == size:
        print(f"  = {file_meta['name']}  (already present)")
        return dest

    request = service.files().get_media(fileId=file_meta["id"])
    buf = io.FileIO(dest, "wb")
    downloader = MediaIoBaseDownload(buf, request, chunksize=32 * 1024 * 1024)
    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            print(f"  . {file_meta['name']}  {pct}%", end="\r", flush=True)
    buf.close()
    mb = dest.stat().st_size / 1e6
    print(f"  + {file_meta['name']}  {mb:,.1f} MB          ")
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="list only, download nothing")
    parser.add_argument("--folder", help="override the Drive folder name")
    parser.add_argument("--match", help="only files whose name contains this")
    args = parser.parse_args()

    folder_name = args.folder or cfg()["gee"]["export"]["drive_folder"]
    service = drive_service()

    folder_id = find_folder(service, folder_name)
    if not folder_id:
        print(
            f"Drive folder {folder_name!r} not found.\n"
            "Either no export has finished yet, or the folder name in\n"
            "config/datasets.yaml (gee.export.drive_folder) does not match."
        )
        return 1

    files = list_exports(service, folder_id)
    if args.match:
        files = [f for f in files if args.match in f["name"]]

    if not files:
        print(f"Drive folder {folder_name!r} is empty.")
        return 0

    total = sum(int(f.get("size", 0)) for f in files)
    print(f"Drive folder {folder_name!r}: {len(files)} files, {total / 1e6:,.1f} MB total\n")

    if args.list:
        for f in files:
            print(f"  {f['name']:<60} {int(f.get('size', 0)) / 1e6:>9,.1f} MB")
        return 0

    dest_dir = out_dir("raw", "gee")
    for f in files:
        download(service, f, dest_dir)

    local = sorted(dest_dir.glob("*.tif"))
    print(f"\n{len(local)} GeoTIFFs in {dest_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
