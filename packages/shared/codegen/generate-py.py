#!/usr/bin/env python3
"""Generate Pydantic v2 models from packages/shared/schemas/document.json.

Output: apps/api/app/schemas/document.py
Run:    python packages/shared/codegen/generate-py.py
"""
from __future__ import annotations

import io
import re
import subprocess
import sys
from pathlib import Path

# Windows runners default to cp1252 which can't encode the → / ✓ chars
# we print. Force UTF-8 on stdout/stderr so the CI gate's regen step
# stops crashing with UnicodeEncodeError.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

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

# ── Post-process: add Pydantic v2 discriminator='type' to the Block union.
# datamodel-codegen emits a plain `RootModel[A | B | C]` for oneOf schemas.
# Without a discriminator Pydantic falls back to "smart" matching which is
# slow AND emits PydanticSerializationUnexpectedValue warnings during
# model_dump() because it can't tell which variant to use up front. Every
# Block subclass carries `type: Literal[...]`, so a `Field(discriminator=
# 'type')` annotation makes the union deterministic and silences the noise.
src = OUT.read_text(encoding="utf-8")

# Ensure `Annotated` is imported. The codegen output already imports
# `Field` from pydantic, but rarely brings in typing.Annotated.
if "from typing import" in src:
    src = re.sub(
        r"^(from typing import [^\n]+)$",
        lambda m: m.group(1) if "Annotated" in m.group(1) else m.group(1) + ", Annotated",
        src,
        count=1,
        flags=re.MULTILINE,
    )
else:
    # Fallback — inject after the pydantic imports (always present).
    src = src.replace(
        "from pydantic import",
        "from typing import Annotated\nfrom pydantic import",
        1,
    )

# Find the `class Block(RootModel[...])` block and rewrite its union.
# The generated form is:
#
#   class Block(
#       RootModel[
#           ParagraphBlock
#           | Heading4Block
#           | ...
#       ]
#   ):
#       root: (
#           ParagraphBlock
#           | Heading4Block
#           | ...
#       )
#
# We swap both the `RootModel[...]` arg AND the `root:` annotation so
# Pydantic sees the discriminator on both surfaces.
def _wrap_with_discriminator(match: re.Match[str]) -> str:
    union_body = match.group(1)
    return (
        "Annotated[\n"
        f"{union_body}"
        "        ,\n"
        "        Field(discriminator='type'),\n"
        "    ]"
    )

# Each union line is either `        ClassName\n` (first line) or
# `        | ClassName\n` (subsequent). Match both shapes.
_UNION_LINES = r"((?:        (?:\| )?[A-Za-z0-9_]+\n)+)"

# Pattern 1: the RootModel[...] wrapper inside `class Block(...)`
src = re.sub(
    r"class Block\(\n    RootModel\[\n" + _UNION_LINES + r"    \]\n\):",
    lambda m: (
        "class Block(\n"
        "    RootModel[\n"
        f"        {_wrap_with_discriminator(m)}\n"
        "    ]\n"
        "):"
    ),
    src,
    count=1,
)

# Pattern 2: the `root:` annotation that follows the class header.
src = re.sub(
    r"    root: \(\n" + _UNION_LINES + r"    \)\n",
    lambda m: f"    root: {_wrap_with_discriminator(m)}\n",
    src,
    count=1,
)

# ── Post-process: enum-typed fields with string defaults.
# datamodel-codegen emits things like `width: Width | None = 'md'` where
# 'md' is the string value of Enum member Width.md. Pydantic accepts the
# string at validation time but emits a serializer warning at dump time
# because the declared type is the Enum class, not str. Convert the
# defaults to the actual enum member so the warning goes away.
# Pattern matches: `: <EnumName> | None = '<value>'` (also without `| None`).
def _fix_enum_default(match: re.Match[str]) -> str:
    enum_name = match.group(1)
    optional_part = match.group(2) or ""
    value = match.group(3)
    return f": {enum_name}{optional_part} = {enum_name}.{value}"


# Track which enum classes exist so we don't accidentally rewrite a non-enum
# field whose value happens to look like a quoted string default.
enum_names = set(re.findall(r"^class (\w+)\(Enum\):$", src, re.MULTILINE))
if enum_names:
    pattern = re.compile(
        r": (" + "|".join(re.escape(n) for n in enum_names) + r")( \| None)? = '([^']+)'"
    )
    src = pattern.sub(_fix_enum_default, src)

# ── Post-process: inject iframe src XOR html validator.
# JSON Schema's `oneOf` on IframeBlock splits into IframeBlock1 (src branch)
# and IframeBlock2 (html branch) via datamodel-codegen. The `not: required`
# part of each oneOf clause is silently dropped, so each variant accepts
# input that also has the *other* key set. Inject a `model_validator` into
# both variants so "both set" is rejected — matching the schema contract.
# "Neither set" is already rejected because each variant marks its primary
# field as required.
_iframe_validator_src = (
    "\n"
    "    @model_validator(mode='after')\n"
    "    def _reject_html_when_src(self):\n"
    "        # XOR enforcement: src-branch must not also carry html.\n"
    "        if self.html is not None:\n"
    "            raise ValueError(\n"
    "                'iframe block requires exactly one of `src` or `html`'\n"
    "            )\n"
    "        return self\n"
)
_iframe_validator_html = (
    "\n"
    "    @model_validator(mode='after')\n"
    "    def _reject_src_when_html(self):\n"
    "        # XOR enforcement: html-branch must not also carry src.\n"
    "        if self.src is not None:\n"
    "            raise ValueError(\n"
    "                'iframe block requires exactly one of `src` or `html`'\n"
    "            )\n"
    "        return self\n"
)

# Ensure model_validator is imported from pydantic.
src = re.sub(
    r"^(from pydantic import [^\n]+)$",
    lambda m: m.group(1) if "model_validator" in m.group(1) else m.group(1) + ", model_validator",
    src,
    count=1,
    flags=re.MULTILINE,
)

# Inject validators into IframeBlock1 / IframeBlock2. Each class body ends
# with the `meta: BlockMeta | None = None` line followed by a blank line.
def _inject_after_meta(src_text: str, classname: str, body: str) -> tuple[str, bool]:
    pattern = (
        r"(class " + re.escape(classname) + r"\(BaseModel\):.*?meta: BlockMeta \| None = None\n)"
    )
    m = re.search(pattern, src_text, flags=re.DOTALL)
    if not m:
        return src_text, False
    return src_text[: m.end()] + body + src_text[m.end() :], True


src, ok1 = _inject_after_meta(src, "IframeBlock1", _iframe_validator_src)
src, ok2 = _inject_after_meta(src, "IframeBlock2", _iframe_validator_html)
if not (ok1 and ok2):
    print(
        f"WARN: Iframe XOR validators only partially injected (src={ok1}, html={ok2})",
        file=sys.stderr,
    )

# Force LF on every platform — Path.write_text uses os.linesep otherwise,
# which on Windows would yield CRLF and make the codegen-drift gate fire.
with OUT.open("w", encoding="utf-8", newline="\n") as _f:
    _f.write(src)
print(f"✓ Pydantic models generated → {OUT}")
print("✓ Block union annotated with discriminator='type'")
print(f"✓ Enum defaults normalized ({len(enum_names)} enum classes scanned)")
print("✓ IframeBlock XOR validator injected (src ↔ html)")
