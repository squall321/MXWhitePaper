#!/usr/bin/env python3
"""Generate Pydantic v2 models from packages/shared/schemas/document.json.

Output: apps/api/app/schemas/document.py
Run:    python packages/shared/codegen/generate-py.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "packages" / "shared" / "schemas" / "document.json"
OUT = ROOT / "apps" / "api" / "app" / "schemas" / "document.py"

OUT.parent.mkdir(parents=True, exist_ok=True)

# datamodel-code-generator must be installed (apps/api dev deps)
cmd = [
    "datamodel-codegen",
    "--input", str(SCHEMA),
    "--input-file-type", "jsonschema",
    "--output", str(OUT),
    "--output-model-type", "pydantic_v2.BaseModel",
    "--target-python-version", "3.12",
    "--use-schema-description",
    "--use-field-description",
    "--snake-case-field",
    "--use-standard-collections",
    "--use-union-operator",
    "--disable-timestamp",
    "--use-default",
    "--field-constraints",
]

print(f"→ {' '.join(cmd)}")
try:
    subprocess.run(cmd, check=True)
except FileNotFoundError:
    sys.exit(
        "ERROR: datamodel-codegen not found.\n"
        "Install with:  pip install datamodel-code-generator\n"
        "Or in container:  docker compose exec api uv add --dev datamodel-code-generator"
    )
print(f"✓ Pydantic models generated → {OUT}")
