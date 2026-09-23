#!/usr/bin/env python3
"""AMO 用に、ビルドに必要な未変換ソースだけを ZIP にまとめます。"""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[2]
package = json.loads((root / 'package.json').read_text())
output = root / '.output' / f"{package['name']}-{package['version']}-sources.zip"
output.parent.mkdir(exist_ok=True)
files = [root / name for name in ('LICENSE', 'package.json', 'package-lock.json', 'tsconfig.json', 'wxt.config.ts', 'scripts/release/build-firefox.sh')]
for directory in ('src', 'entrypoints', 'public'):
    files.extend(p for p in (root / directory).rglob('*') if p.is_file())
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.write(root / 'docs/source-build.md', 'README.md')
    for file in sorted(files):
        archive.write(file, file.relative_to(root))
print(output)
