---
title: Guides
description: Step-by-step tutorials for building with Pulsar Engine
category: guides
position: 4
icon: BookOpen
lastUpdated: '2026-01-12'
tags:
  - guides
  - tutorials
  - how-to
  - learning
related:
  - getting-started/index
  - core-concepts/index
---

# Guides

Welcome to the Pulsar guides section. This isn't a reference manual or a feature list—these are practical, step-by-step tutorials that teach you how to actually build things with Pulsar.

## What You'll Find Here

Each guide focuses on a specific task or concept and walks you through it from start to finish. We assume you've read the [Getting Started](../getting-started/index) docs and understand the [Core Concepts](../core-concepts/index), but we'll reference them when needed.

### Core Documentation

**[Architecture](../core-concepts/architecture)** - Complete overview of how Pulsar is built (required reading)

**[Plugin System](../core-concepts/plugin-system)** - Building editor plugins with dynamic libraries

**[Rendering System](../core-concepts/rendering-pipeline)** - How Bevy's renderer integrates with Pulsar

**[Type Database](../core-concepts/type-system)** - Type inspection and debugging tools

**[UI Framework](../core-concepts/ui-framework)** - GPUI for building editor interfaces

### Getting Started

**[Installation](../getting-started/installation/windows)** - Set up your development environment

**[Quick Start](../getting-started/quick-start)** - Tour of the editor interface

**[First Project](../getting-started/first-project)** - Create and run your first Pulsar project

### Guides (In Development)

The following practical guides are currently being rewritten to match the actual Pulsar codebase:

- **Creating Editor Plugins** - Build custom file type editors
- **Physics Integration** - Using Rapier3D for game physics
- **Material System** - Working with Bevy's PBR materials
- **Asset Management** - Meshes, textures, and asset loading

## How to Use These Guides

### If You're Learning Pulsar

Start with **Creating Plugins**. Even if you don't plan to write plugins immediately, it's the best introduction to how Pulsar's editor works. You'll touch the type system, GPUI, the file system, and editor integration—all fundamental skills.

Then move to **Working with Assets** to understand how game content flows through Pulsar. This is essential before building actual game features.

**Physics Basics** and **Creating Materials** can be done in either order, depending on whether you want gameplay or visuals first.

### If You're Experienced with Game Engines

You can jump directly to the guide that matches your immediate need. Each guide is self-contained with links to relevant concepts.

That said, **Creating Plugins** is worth reading even for experienced developers because Pulsar's plugin system is unique. It's not like Unity's C# scripts or Unreal's Blueprints.

### If You're Coming from Another Engine

Look for the "Coming from..." sections in each guide. They compare Pulsar's approach to Unity, Unreal, or Godot patterns you might know.

## Learning Philosophy

These guides follow a few principles:

**Build Real Things** - Every guide produces working code. No toy examples or contrived demos. You'll build things you might actually use.

**Explain the Why** - Understanding *why* Pulsar works a certain way helps you solve novel problems. We'll explain the reasoning behind design decisions.

**Show Mistakes** - You'll see common errors and how to fix them. Learning what doesn't work is as important as learning what does.

**Incremental Complexity** - Each guide starts simple and builds up. Early sections establish fundamentals; later sections tackle advanced topics.

## What You Need

Before starting any guide, make sure you have:

- **Pulsar installed and running** - See [Installation](../getting-started/installation)
- **Basic Rust knowledge** - You don't need to be an expert, but understanding ownership, borrowing, and traits is essential
- **A code editor** - VS Code with rust-analyzer is recommended
- **Patience** - Some concepts take time to understand, especially if you're new to systems programming

## Guide Structure

Each guide follows a consistent format:

**Introduction** - What you'll build and why it matters

**Prerequisites** - What you need to know before starting

**Step-by-Step Instructions** - The actual tutorial with code examples

**Common Problems** - Debugging tips for typical issues

**Next Steps** - What to learn after completing the guide

**Further Reading** - Links to related documentation

## Code Style

Code in these guides follows Pulsar's conventions:
- Idiomatic Rust style
- Descriptive variable names
- Comments explaining non-obvious logic
- Error handling with `Result` types

You can copy-paste examples and they should work. If something doesn't work, it's a bug in the guide—please report it!

## Getting Help

Stuck on a guide? Here's how to get unstuck:

**Check the code repository** - Full example projects for each guide are in the `examples/` directory of the Pulsar repo.

**Search the docs** - Use the site search to find related concepts or API documentation.

**Ask in Discord** - The community is helpful and active. Include:
  - Which guide you're following
  - What step you're on
  - The error message or unexpected behavior
  - What you've already tried

**File an issue** - If you think the guide has an error, open a GitHub issue with specifics.

## Beyond the Guides

Once you've completed these guides, you'll be ready for:

**[API Reference](../api-reference/index)** - Detailed documentation for all APIs

**[Core Concepts](../core-concepts/index)** - Deep dives into architectural decisions

**Example Projects** - Full games and tools built with Pulsar

**Community Projects** - See what others have built

## Contributing Guides

Want to write a guide? We'd love that! Here's what makes a good guide:

- **Focused scope** - One topic, covered thoroughly
- **Working code** - Readers should end with something functional
- **Real explanations** - Don't just list steps; explain why each step matters
- **Common pitfalls** - Mention mistakes you made while learning
- **Clean examples** - Code should be clear, not clever

See the [Contributing Guidelines](https://github.com/Far-Beyond-Pulsar/Pulsar-Native/blob/main/CONTRIBUTING.md) for details.

## Guide Roadmap

Upcoming guides (not yet written):

- **Multiplayer Basics** - Networking with Horizon integration
- **Audio System** - Spatial audio and sound design
- **AI and Pathfinding** - NPC behavior and navigation
- **UI Development** - In-game UI with GPUI
- **Animation System** - Skeletal animation and blending
- **Performance Profiling** - Finding and fixing bottlenecks
- **Deployment** - Building and shipping your game

Vote for priority in the Discord #documentation channel!

## Real-World Examples

Each guide references real code from:

**Example Projects** - Simple games demonstrating concepts

**Built-in Plugins** - Editor plugins like the script editor or material editor

**Pulsar Itself** - The engine's own codebase

Learning by reading real code is often more effective than contrived examples.

## Experimental Features

Some guides cover features still in development. These are clearly marked with warnings. You can follow along to understand the architecture, but the APIs might change before release.

## Assumed Knowledge

These guides assume you understand:

- Basic Rust syntax and ownership
- Command-line usage (cargo, terminal)
- General game engine concepts (entities, components, rendering)
- Version control with Git (helpful but not required)

If you're completely new to Rust, work through [The Rust Book](https://doc.rust-lang.org/book/) first. Game engine development is challenging enough without also learning a new language simultaneously.

## Your First Guide

Ready to start? We recommend [Creating Plugins](./creating-plugins) as your first guide. It's comprehensive without being overwhelming, and the skills transfer to everything else you'll build with Pulsar.

If you're eager to see visuals, [Creating Materials](./creating-materials) might be more motivating. Follow your curiosity—you'll learn best when you're excited about what you're building.

## Learning Path Suggestions

**For tool developers:**
1. Creating Plugins
2. Working with Assets
3. (Build your tool!)

**For gameplay programmers:**
1. Working with Assets
2. Physics Basics
3. Creating Materials
4. (Build your game mechanics!)

**For graphics programmers:**
1. Creating Materials
2. Working with Assets
3. (Explore the rendering pipeline!)

**For generalists:**
1. Creating Plugins
2. Working with Assets
3. Physics Basics
4. Creating Materials
5. (Build whatever interests you!)

No matter your path, you'll eventually touch all these topics. Start where your interest is highest.

## Philosophy: Learning by Doing

Pulsar is a systems-oriented engine. The best way to understand systems is to build with them. Reading documentation gives you a map; building things gives you experience navigating the territory.

Don't just read these guides—type out the code, make mistakes, fix them, experiment with variations. That's where real learning happens.

## Staying Updated

Pulsar is experimental and evolving. When guides are updated:
- The `lastUpdated` date changes
- Major changes are noted at the top
- Old versions remain available in Git history

Subscribe to the [GitHub releases](https://github.com/Far-Beyond-Pulsar/Pulsar-Native/releases) to know when significant documentation updates occur.

---

Choose a guide and dive in. The best way to learn Pulsar is to build with it.
position: 4
