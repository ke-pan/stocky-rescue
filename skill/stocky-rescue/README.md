# Stocky Rescue Agent Skill

Version `0.1.0` helps Codex and Claude Code choose a safe Stocky rescue path and verify a local
Stocky Rescue archive without asking for an API key or raw merchant data in chat.

Review `SKILL.md` and `scripts/inspect_archive.py` before installing. The Skill never silently
downloads or runs the exporter. It pins the separately published exporter release `v0.1.0` and its
full SHA-256 checksum.

## Install for Codex

Clone or download the public repository yourself, inspect it, then copy the Skill to either scope:

```bash
# User scope
mkdir -p ~/.agents/skills
cp -R skill/stocky-rescue ~/.agents/skills/stocky-rescue

# Project scope (run from your project root)
mkdir -p .agents/skills
cp -R /path/to/stocky-rescue/skill/stocky-rescue .agents/skills/stocky-rescue
```

Start a new Codex task and invoke it with `$stocky-rescue` or ask for help rescuing Stocky data.

## Install for Claude Code

Copy the same reviewed folder to either Claude Code scope:

```bash
# User scope
mkdir -p ~/.claude/skills
cp -R skill/stocky-rescue ~/.claude/skills/stocky-rescue

# Project scope (run from your project root)
mkdir -p .claude/skills
cp -R /path/to/stocky-rescue/skill/stocky-rescue .claude/skills/stocky-rescue
```

Invoke it with `/stocky-rescue` or ask Claude Code to use the Stocky Rescue Skill.

## Test the local inspector

The script uses only Python's standard library and never extracts archive members:

```bash
python3 scripts/inspect_archive.py --help
python3 -m unittest discover -s tests
```

The public repository's test suite also covers complete and incomplete archives, malicious paths,
unknown fields, missing credentials, expired access, and post-shutdown routing.

## Uninstall

Delete only the copied `stocky-rescue` folder from the scope where you installed it:

```bash
rm -rf ~/.agents/skills/stocky-rescue
rm -rf ~/.claude/skills/stocky-rescue
```

For a project installation, remove `.agents/skills/stocky-rescue` or
`.claude/skills/stocky-rescue`. Uninstalling the Skill does not delete merchant archives.

Licensed under the MIT License. Canonical Guide:
<https://shelftally.com/blog/stocky-data-rescue-guide/>.
