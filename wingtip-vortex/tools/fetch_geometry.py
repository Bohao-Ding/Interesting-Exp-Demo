"""Download the public NASA CRM-HL geometry; never substitutes invented CAD."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    'wing01.zip': 'https://www.nasa.gov/wp-content/uploads/2023/02/wing01.stp.zip',
    'geometry.xlsx': 'https://www.nasa.gov/wp-content/uploads/2025/06/CRM-HL_Geometry_25June2025.webv1_.xlsx',
}

def fetch(item):
    name, url = item
    target = ROOT / 'data' / name
    if not target.exists():
        target.write_bytes(urllib.request.urlopen(url, timeout=30).read())
    if name.endswith('.zip'):
        with zipfile.ZipFile(target) as archive:
            for info in archive.infolist():
                if info.filename.lower().endswith(('.stp', '.step')):
                    (ROOT / 'data' / Path(info.filename).name).write_bytes(archive.read(info))
    return name, target.stat().st_size

if __name__ == '__main__':
    for result in ThreadPoolExecutor(2).map(fetch, FILES.items()):
        print(result, flush=True)
