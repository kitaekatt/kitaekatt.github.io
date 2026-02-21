# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **kitaekatt.github.io** — the GitHub Pages site that renders at `https://kitaekatt.github.io`. It is responsible for:

- The front page, which mirrors the content of the GitHub profile README
- Published articles authored by Christina Norman

## Relationship to the Profile Repo

The GitHub profile (`~/Dev/kitaekatt`, `github.com/kitaekatt/kitaekatt`) is the **source of truth** for profile content. `README.md` in that repo defines what appears on `github.com/kitaekatt`.

This project must stay in sync with that README. When the profile README changes, the front page here should reflect those changes. How that sync is implemented is an architectural decision for this project (GitHub Action, manual update, etc.) — but the invariant is: **front page content = profile README content**.

## Repository Structure

```
kitaekatt.github.io/
├── index.html / index.md   # Front page (mirrors profile README)
├── articles/               # Published articles
└── CLAUDE.md               # This file
```

## Authoring Guidelines

- Articles live in `articles/` as HTML or markdown files
- The front page should match the profile README in content; styling may differ
- This is a static site — no server-side code
- GitHub Pages serves the site automatically from the `main` branch

## Related Projects

**`kitaekatt`** (`~/Dev/kitaekatt`) — The GitHub profile repo. `README.md` there is the canonical source for front page content.
