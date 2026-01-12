# Documentation Frontmatter Guide

All documentation markdown files support the following frontmatter fields:

## Required Fields

```yaml
---
title: "Page Title"           # Display title in navigation and page header
description: "Short summary"  # Used in meta tags and search
category: "category-slug"     # Must match parent directory name
---
```

## Ordering & Organization

```yaml
position: 1                   # Numeric position for sorting (lower = earlier)
```

- Pages at the same level are sorted by `position`
- Lower numbers appear first
- If `position` is missing, defaults to 999 (appears last)
- Also accepts `order` for backwards compatibility

## Optional Fields

```yaml
icon: "IconName"              # Lucide icon name (e.g., "Rocket", "Book", "Code")
lastUpdated: "2026-01-12"     # ISO date string
tags: ["tag1", "tag2"]        # Array of tags for search/filtering
related: ["path/to/doc"]      # Related documentation paths
```

## Icons

Use any icon from [Lucide Icons](https://lucide.dev/icons/):
- `Rocket` - Getting started, launches
- `BookOpen` - Documentation, guides
- `Code` - API reference, code
- `Download` - Installation
- `Cpu` - Core systems
- `MonitorSmartphone` - Windows/cross-platform
- `Laptop` - Linux
- `Apple` - macOS
- `Map` - Guides, navigation

## Example: Complete Frontmatter

```yaml
---
title: "Windows Installation"
description: "Complete installation guide for Windows 10 and 11"
category: "installation"
position: 1
icon: "MonitorSmartphone"
lastUpdated: "2026-01-12"
tags: ["installation", "windows", "setup", "beginner"]
related: ["getting-started/quick-start", "core-concepts/architecture"]
---
```

## Auto-Generation

The `_meta.json` files are **auto-generated** from markdown frontmatter:

1. All markdown files in a directory are scanned
2. Frontmatter is extracted
3. Items are sorted by `position`
4. Navigation structure is built

**You only need to edit markdown files!** The meta files are generated automatically during build.

## Best Practices

1. **Always include** `title`, `description`, and `category`
2. **Use `position`** to control ordering (start at 0 or 1)
3. **Add icons** to make navigation more visual
4. **Keep descriptions short** - they appear in search results
5. **Use related links** to connect related documentation
6. **Update `lastUpdated`** when making significant changes
