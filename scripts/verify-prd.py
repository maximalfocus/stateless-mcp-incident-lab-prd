#!/usr/bin/env python3
"""Deterministic structural gate for the Stateless MCP Incident Lab PRD repo."""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def text(name: str) -> str:
    path = ROOT / name
    if not path.is_file():
        fail(f"missing required file: {name}")
        return ""
    return path.read_text(encoding="utf-8")


def section(md: str, heading: str) -> str:
    match = re.search(rf"^## {re.escape(heading)}\s*$", md, re.MULTILINE)
    if not match:
        fail(f"missing section: ## {heading}")
        return ""
    start = match.end()
    end_match = re.search(r"^## ", md[start:], re.MULTILINE)
    return md[start : start + end_match.start() if end_match else len(md)]


def table_rows(body: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in body.splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells and all(re.fullmatch(r"[-:]+", cell) for cell in cells):
            continue
        rows.append(cells)
    return rows


prd = text("PRD.md")
plan = text("PLAN-001-stateless-core.md")
index = text("PLAN.md")
if (ROOT / "PROBLEM.md").exists():
    fail("retired peerreview control file present: PROBLEM.md")

for heading in [
    "Overview", "User model", "Domain and data model", "MCP surface",
    "CLI surface", "Business rules", "Non-functional requirements",
    "Out of scope", "Decision boundaries", "Sources",
]:
    if not re.search(rf"^##+ {re.escape(heading)}\s*$", prd, re.MULTILINE):
        fail(f"PRD missing required heading: {heading}")

for heading in [
    "Goal", "Approach", "Repo family", "Categories (core — language-neutral)",
    "Stack categories (tier-1, optional)", "Implementation order",
    "Risks and mitigations", "Open questions", "Out of scope / Non-goals",
    "Decision boundaries", "Non-functional requirements", "Technology choices",
]:
    if not re.search(rf"^## {re.escape(heading)}\s*$", plan, re.MULTILINE):
        fail(f"PLAN missing required heading: {heading}")

# Technology gate: seven required decisions, concrete values, no partially blank rows.
tech_rows = table_rows(section(plan, "Technology choices"))
if tech_rows:
    header, *data = tech_rows
    required = {
        "Database", "Runtime/language version", "Framework", "Deployment target",
        "Testing framework", "Auth provider", "Cache/queue",
    }
    found = {row[0] for row in data if row}
    if found != required:
        fail(f"technology rows differ: missing={sorted(required-found)} extra={sorted(found-required)}")
    for row in data:
        if len(row) != 3 or any(not cell for cell in row):
            fail(f"technology row has blank/wrong cell count: {row}")
        if re.search(r"\b(TBD|TODO|FIXME)\b|\?", " ".join(row), re.IGNORECASE):
            fail(f"technology row unresolved: {row}")

# Category cardinality and arithmetic are pinned independently of the artifact.
cat_rows = table_rows(section(plan, "Categories (core — language-neutral)"))
if cat_rows:
    _, *data = cat_rows
    if len(data) != 19:
        fail(f"expected 19 category rows, found {len(data)}")
    estimates: list[int] = []
    names: list[str] = []
    for row in data:
        if len(row) != 7:
            fail(f"category row has {len(row)} cells, expected 7: {row}")
            continue
        names.append(row[1].strip("`"))
        try:
            estimates.append(int(row[4]))
        except ValueError:
            fail(f"category estimate is not integer: {row[4]}")
    if len(names) != len(set(names)):
        fail("duplicate category name")
    if sum(estimates) != 197:
        fail(f"category estimates sum to {sum(estimates)}, expected 197")
    stated = re.search(r"Estimated total:\s*([0-9]+) golden tests", plan)
    if not stated or int(stated.group(1)) != 197:
        fail("stated estimated total missing or not 197")

# PLAN index must point to the active detail file exactly once.
if index.count("(PLAN-001-stateless-core.md)") != 1 or "| active |" not in index:
    fail("PLAN index does not contain one active PLAN-001 link")

# Approach includes chosen recommendation and at least two numbered alternatives.
approach = section(plan, "Approach")
if "**Recommendation:" not in approach:
    fail("approach does not name the recommendation")
if len(re.findall(r"^\d+\. \*\*", approach, re.MULTILINE)) < 2:
    fail("approach records fewer than two alternatives")

# Internal Markdown links resolve. External URLs and anchors are excluded.
link_re = re.compile(r"(?<!!)\[[^]]+\]\(([^)]+)\)")
for path in ROOT.rglob("*.md"):
    if path.is_relative_to(ROOT / "sources"):
        continue  # Immutable captures retain their origin-relative links verbatim.
    body = path.read_text(encoding="utf-8")
    if re.search(r"\[\[[^]]+\]\]", body):
        fail(f"wikilink is not GitHub-resolvable: {path.relative_to(ROOT)}")
    for target in link_re.findall(body):
        clean = target.split("#", 1)[0]
        if not clean or re.match(r"^[a-z][a-z0-9+.-]*:", clean, re.IGNORECASE):
            continue
        resolved = (path.parent / clean).resolve()
        try:
            resolved.relative_to(ROOT.resolve())
        except ValueError:
            fail(f"link escapes repo: {path.relative_to(ROOT)} -> {target}")
            continue
        if not resolved.exists():
            fail(f"broken link: {path.relative_to(ROOT)} -> {target}")

# Captured-source integrity, excluding the checksum file itself.
sums = ROOT / "sources" / "SHA256SUMS"
if not sums.is_file():
    fail("missing sources/SHA256SUMS")
else:
    for line in sums.read_text(encoding="utf-8").splitlines():
        expected, rel = line.split(maxsplit=1)
        rel = rel.lstrip("*")
        captured = ROOT / rel
        if not captured.is_file():
            fail(f"checksum target missing: {rel}")
            continue
        actual = hashlib.sha256(captured.read_bytes()).hexdigest()
        if actual != expected:
            fail(f"checksum mismatch: {rel}")

# Agent-wrapper leakage is never valid as a standalone line.
leak = re.compile(r"^\s*</(content|invoke|parameter)>\s*$", re.MULTILINE)
for path in ROOT.rglob("*"):
    if path.is_file() and path.suffix.lower() in {".md", ".json", ".yaml", ".yml"}:
        try:
            body = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if leak.search(body):
            fail(f"leaked agent wrapper tag: {path.relative_to(ROOT)}")

if errors:
    print("FAIL: PRD verification")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)
print("PASS: PRD verification (19 categories, 197 estimated tests, technology and links resolved)")
