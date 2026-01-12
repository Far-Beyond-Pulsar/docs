---
title: "Getting Started with Pulsar"
description: "Your introduction to the Pulsar game engine"
category: "getting-started"
position: 1
icon: "Home"
lastUpdated: "2026-01-12"
tags: ["introduction", "getting-started", "overview"]
---

# Getting Started with Pulsar

Welcome to Pulsar Engine! If you're here, you're probably curious about building games with a modern, Rust-based engine that challenges the status quo of how game engines should work.

## What is Pulsar?

Pulsar is an experimental game engine that takes a fresh look at game development tools from the ground up. Instead of copying what existing engines do, Pulsar asks "what if we built this differently?" at every level—from the editor interface to the plugin system to how the engine manages your project files.

Think of Pulsar as a game engine built by developers who got tired of fighting their tools. We're focusing on:

**Clear, intentional design** - Every system is built with a specific purpose and clear boundaries. No "it evolved that way" explanations here.

**Editor-first stability** - The editor should never crash, even when your game code does. Pulsar treats the editor as a first-class citizen, not an afterthought.

**Rust everywhere** - The entire engine, from the editor UI to game logic, is written in Rust. This means memory safety, fearless concurrency, and zero-cost abstractions throughout.

**Extensible from day one** - Pulsar's plugin system isn't bolted on—it's fundamental. Custom file types, custom editors, custom tools are all first-class citizens.

## Current Status: Early Days

Let's be completely transparent: **you probably can't ship a full game in Pulsar yet.** We're in active development, with core systems still being designed and implemented. If you're looking for a production-ready engine, you might want to check back in a few months.

However, if you're interested in:
- Seeing how a modern game engine gets built from scratch
- Contributing to fundamental design decisions  
- Learning Rust through game engine development
- Experimenting with new approaches to game tooling

Then Pulsar might be exactly what you're looking for.

## What Makes Pulsar Different?

### The UI is GPU-Accelerated from the Start

Pulsar uses GPUI, a GPU-accelerated UI framework, for its entire editor interface. This means the UI isn't an afterthought—it's smooth, responsive, and can handle complex visualizations without breaking a sweat.

### Plugins are Dynamic Libraries

Editor plugins aren't scripts or interpreted code—they're compiled Rust dynamic libraries loaded at runtime. This gives you native performance and full access to the editor API while still maintaining modularity.

### The Type System is Inspectable

Pulsar maintains a live type database of your project. This powers features like intelligent code completion, type inspection, and cross-referencing—but it's also available to plugins, meaning you can build tools that understand your project structure.

### Backend Services Run Separately

The Rust compiler, language server, and other heavy processes run as separate services that communicate with the editor. This means when your game code crashes, the editor stays responsive.

## Platform Support

::: warning
Currently, Pulsar primarily targets **Windows**. Cross-platform support for Linux and macOS is temporarily limited while we work through core architectural changes.
:::

We're actively working on restoring full cross-platform compatibility. Track the progress in our [GitHub discussions](https://github.com/orgs/Far-Beyond-Pulsar/discussions/17).

## What You'll Need

Before diving in, make sure you have:

- **Rust toolchain** - Pulsar is built with Rust, so you'll need `cargo` and friends installed
- **Windows 10 or newer** - For now, that's where development is focused
- **Basic Rust knowledge** - You don't need to be an expert, but understanding ownership and borrowing will help
- **Curiosity and patience** - This is an experimental engine, so expect rough edges

## Quick Links

- [Installation Guide](./installation/windows) - Get Pulsar running on your machine
- [Quick Start](./quick-start) - Run the engine and explore the editor
- [Core Architecture](../core-concepts/architecture) - Understand how Pulsar is structured
- [Plugin Development](../guides/creating-plugins) - Extend the editor with your own tools

## Community

Pulsar development happens in the open. The core developers are active and responsive:

- **Discord** - Join for real-time discussions and development updates
- **GitHub Discussions** - For longer-form design conversations
- **GitHub Issues** - For bug reports and feature requests

You're not just using Pulsar—if you want, you can help shape where it goes next.

## Next Steps

Ready to dive in? Start with the [installation guide](./installation/windows) to get Pulsar running on your system, then work through the [quick start](./quick-start) to familiarize yourself with the editor.

If you want to understand the big picture first, check out the [architecture overview](../core-concepts/architecture) to see how all the pieces fit together.
