#!/usr/bin/env python3
"""Portable local skill-contract validation and tests; no model or network calls."""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
try:
    import yaml
except ImportError:
    raise SystemExit("Missing PyYAML. Install scripts/requirements-skills.txt in your Python environment, then rerun verify:skills.")

class UniqueLoader(yaml.SafeLoader):
    pass

def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError(f"duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result
UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)

def load_yaml(text):
    return yaml.load(text, Loader=UniqueLoader)

def check(root):
    root = Path(root).resolve(); suite = root / ".agents/skills"
    skills = {}
    for path in sorted(suite.glob("*/SKILL.md")):
        text = path.read_text()
        match = re.match(r"\A---\n(.*?)\n---(?:\n|$)", text, re.S)
        if not match:
            raise ValueError(f"{path}: missing YAML frontmatter")
        meta = load_yaml(match[1])
        if not isinstance(meta, dict):
            raise ValueError(f"{path}: metadata must be a mapping")
        allowed = {"name", "description", "license", "allowed-tools", "metadata"}
        if set(meta) - allowed:
            raise ValueError(f"{path}: unsupported metadata keys {set(meta) - allowed}")
        name = meta.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > 64 or name != path.parent.name:
            raise ValueError(f"{path}: invalid or mismatched name")
        desc = meta.get("description")
        if not isinstance(desc, str) or not desc.strip() or len(desc) > 1024 or any(c in desc for c in "<>"):
            raise ValueError(f"{path}: invalid description")
        if name in skills:
            raise ValueError(f"duplicate skill: {name}")
        skills[name] = path
        policy_path = path.parent / "agents/openai.yaml"
        if policy_path.exists():
            config = load_yaml(policy_path.read_text())
            if not isinstance(config, dict):
                raise ValueError(f"{policy_path}: expected mapping")
            policy = config.get("policy", {})
            if not isinstance(policy, dict) or ("allow_implicit_invocation" in policy and type(policy["allow_implicit_invocation"]) is not bool):
                raise ValueError(f"{policy_path}: invocation policy must be a boolean")
            for key in ("icon_small", "icon_large"):
                icon = config.get("interface", {}).get(key)
                if icon and not (path.parent / icon).is_file():
                    raise ValueError(f"{policy_path}: missing {key}")
    if not skills:
        raise ValueError("no skills discovered")
    links = 0
    for path in suite.rglob("*.md"):
        text = re.sub(r"(?ms)^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1\s*$", "", path.read_text())
        targets = re.findall(r"\]\(([^)\n]+)\)", text)
        targets += re.findall(r"(?m)^\s*\[[^\]]+\]:\s*(\S+)", text)
        for target in targets:
            target = target.strip().split(' "', 1)[0].strip('<>'); target = target.split('#', 1)[0]
            if not target or re.match(r"[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                continue
            if not (path.parent / target).exists():
                raise ValueError(f"{path}: broken local link {target}")
            links += 1
    catalog = json.loads((suite / "suite.json").read_text())
    if catalog.get("version") != 1 or not isinstance(catalog.get("aliases"), dict):
        raise ValueError("invalid suite registry")
    aliases = catalog["aliases"]
    for alias, canonical in aliases.items():
        if alias not in skills or canonical not in skills or canonical in aliases:
            raise ValueError(f"invalid alias target: {alias} -> {canonical}")
        config = load_yaml((skills[alias].parent / "agents/openai.yaml").read_text())
        if config.get("policy", {}).get("allow_implicit_invocation") is not False:
            raise ValueError(f"alias must be explicit-only: {alias}")
        target = (skills[alias].parent / f"../{canonical}/SKILL.md").resolve()
        if f"../{canonical}/SKILL.md" not in skills[alias].read_text() or not target.exists():
            raise ValueError(f"alias does not route to canonical skill: {alias}")
    cases = json.loads((suite / "evals/cases.json").read_text())
    ids = set()
    for case in cases:
        if not isinstance(case.get("id"), str) or case['id'] in ids or not case.get("prompt") or not case.get("context"):
            raise ValueError("invalid/duplicate evaluation case")
        ids.add(case['id'])
        expect = case.get("expect", {})
        if not expect.get("primary_skill") or any(name not in skills for name in expect['primary_skill']):
            raise ValueError(f"{case['id']}: expected skill is missing")
        if not case.get("manual_review"):
            raise ValueError(f"{case['id']}: missing behavioral rubric")
    if not ids:
        raise ValueError("no evaluation cases")
    return {"skills": len(skills), "aliases": len(aliases), "links": links, "evaluation_cases": len(ids)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.root)), flush=True)
        if not args.metadata_only:
            for relative in (".agents/skills/gt-ui-review/tests", ".agents/skills/evals/tests"):
                subprocess.run([sys.executable, "-B", "-m", "unittest", "discover", "-s", str(args.root / relative), "-v"], check=True)
    except (ValueError, OSError, KeyError, yaml.YAMLError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Skill verification failed: {error}")

if __name__ == "__main__":
    main()
