# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **kitaekatt.github.io** — the GitHub Pages site at `https://kitaekatt.github.io`.
It plays two deliberate roles:

- **Apex / vanity forwarder.** The root `index.html` intentionally redirects to the GitHub
  profile (`https://github.com/kitaekatt`). The **GitHub profile README is the front page /
  hub** — a rich GitHub profile reads as earned nerd-cred, which is the credibility-correct
  landing surface for this audience (vs. a bespoke "site designed to sell myself"). This
  redirect is a **deliberate decision, not a stopgap.**
- **Rich-content vault.** This site hosts the long-form HTML the profile links *out* to:
  case studies, interactive demos (`games/`), and published articles. These are the
  "the evidence lives here" payoff that the profile points down into.

Invert this (serve a full front page here instead of redirecting) **only** if the markdown
profile ever becomes too limiting. Until then: **profile = entry, github.io = depth.**

## Relationship to the Profile Repo

The GitHub profile (`~/Dev/kitaekatt`, `github.com/kitaekatt/kitaekatt`) is the front page
and the source of truth for profile content; its `README.md` defines what appears on
`github.com/kitaekatt`. This site does **not** mirror that README — it **complements** it by
hosting the rich content the README links to.

## Repository Structure

```
kitaekatt.github.io/
├── index.html                          # Apex redirect -> github.com/kitaekatt (intentional)
├── games/                              # Interactive demos (Archers vs Knights, matrix)
├── <article-slug>/index.html           # Published long-form articles (e.g. claude-code-information-hierarchy/)
├── articles/                           # Reserved for article content (currently a placeholder)
├── pastebin/                           # Archived diagrams / workflows
├── lib/                                # Shared JS utilities
└── CLAUDE.md                           # This file
```

## Authoring Guidelines

- Long-form content (case studies, articles, demos) lives here as static HTML/markdown and
  is **linked from the profile README**.
- This is a static site — no server-side code, no build step. GitHub Pages serves it
  automatically from the `main` branch.
- Keep `index.html` a redirect unless the deliberate decision above is revisited.

## Related Projects

**`kitaekatt`** (`~/Dev/kitaekatt`) — the GitHub profile repo and front page. `README.md`
there is the hub that links into this site's rich content.
