---
title: "Quick Start Guide"
description: "Get the Pulsar editor running and explore your first project"
category: "getting-started"
order: 2
lastUpdated: "2026-01-12"
tags: ["tutorial", "quickstart", "beginner"]
related: ["getting-started/installation/windows", "core-concepts/architecture"]
---

# Quick Start Guide

Let's get Pulsar running and take a tour of the editor. This guide assumes you've already installed Rust and cloned the Pulsar repository.

## Running Pulsar for the First Time

Open your terminal in the Pulsar directory and run:

```bash
cargo run --release
```

::: info
The first build will take a while as Cargo compiles all dependencies. Subsequent runs will be much faster.
:::

If you're missing any required dependencies, Pulsar will detect this and guide you through installation before launching the editor.

## The Launcher

When Pulsar starts, you'll see the launcher screen. This is your project hub where you can:

- Open existing projects
- Create new projects
- Configure engine settings
- View recent projects

### Creating Your First Project

1. Click **"New Project"**
2. Choose a name for your project (e.g., "my-first-game")
3. Select a location on your file system
4. Choose a template (start with "Empty Project" for now)
5. Click **"Create"**

Pulsar will generate the project structure and open the editor.

## The Editor Interface

Once your project opens, you'll see the main editor interface. Let's explore the key areas:

### The Main Viewport

The center of the screen shows your scene viewport. This is where you'll see your game world and manipulate objects. For now, it's probably showing an empty scene with a grid.

**Navigation:**
- **Middle mouse + drag** - Pan the camera
- **Mouse wheel** - Zoom in/out
- **Right click + drag** - Rotate the camera
- **WASD** - Fly around (when in 3D mode)

### The File Manager

On the left side, you'll find the file manager. This shows your project's file structure:

```
my-first-game/
├── assets/       # Your game assets (models, textures, audio)
├── scenes/       # Scene files  
├── scripts/      # Game logic scripts
└── project.toml  # Project configuration
```

Click on any file to open it in an appropriate editor. Pulsar knows how to handle different file types and will load the right editor automatically.

### The Problems Panel

At the bottom of the screen is the problems panel. This shows diagnostics from Rust Analyzer and other tools:

- **Errors** - Code that won't compile
- **Warnings** - Potential issues that don't prevent compilation
- **Info** - Helpful suggestions and hints

Think of this as your continuous feedback loop—Pulsar is constantly analyzing your code and letting you know what needs attention.

### The Terminal

Next to the problems panel is an integrated terminal. You can use this to run Cargo commands, Git operations, or any other command-line tools you need without leaving the editor.

## Understanding Pulsar Projects

A Pulsar project is, at its core, a Rust workspace with some extra structure. Let's look at what Pulsar generates:

### project.toml

This is your project configuration file:

```toml
[project]
name = "my-first-game"
version = "0.1.0"
pulsar_version = "0.1.0"

[build]
target = "x86_64-pc-windows-msvc"

[plugins]
# Plugins your project uses go here
```

This file tells Pulsar how to build and run your project.

### The Cargo Workspace

Your project is a Cargo workspace, which means you can organize code into multiple crates if needed. The generated `Cargo.toml` looks something like:

```toml
[workspace]
members = [
    "game",
]

[workspace.dependencies]
pulsar_std = { version = "0.1.0" }
```

### The Game Crate

Inside the `game/` directory, you'll find your game's code. Start with `game/src/main.rs`:

```rust
use pulsar_std::prelude::*;

fn main() {
    println!("Hello from Pulsar!");
}
```

Simple, right? This is just a Rust program. Pulsar doesn't force you into any specific structure—you can organize your code however makes sense for your project.

## Running Your Game

To run your game, you have a few options:

### From the Editor

Click the **Play** button in the toolbar (or press **F5**). Pulsar will:
1. Compile your game code
2. Launch it in a separate process
3. Show any output in the terminal
4. Display any errors in the problems panel

### From the Terminal

In the integrated terminal (or any terminal in your project directory):

```bash
cargo run
```

This is just standard Cargo—Pulsar doesn't hide anything from you.

## Working with Assets

Let's add an asset to understand how that workflow works:

1. Find an image file (PNG, JPG, whatever) on your computer
2. Drag it into the `assets/` folder in the file manager
3. The file manager will update to show your new asset

Pulsar watches your file system for changes, so assets appear as soon as you add them—no manual refresh needed.

### Using Assets in Code

Once an asset is in your project, you can load it in your game code. The exact API for this is still evolving, but the concept is straightforward: Pulsar tracks your assets and makes them available at runtime.

## Exploring the Type Debugger

One unique feature of Pulsar is the type debugger. This tool lets you inspect the type information Pulsar has extracted from your project.

Open it from **View → Type Debugger** (or press **Ctrl+Shift+T**).

You'll see a tree view of all the types in your project:
- Structs
- Enums  
- Functions
- Traits
- Modules

Click on any type to see its definition, documentation, and relationships with other types. This is incredibly useful for understanding large codebases or exploring how different systems connect.

## Where to Go from Here

Now that you've got Pulsar running and understand the basics of the editor, you're ready to explore further:

**Learn the Architecture** - Read the [architecture overview](../core-concepts/architecture) to understand how Pulsar is structured. This will help you make sense of how the pieces fit together.

**Build a Plugin** - Try creating a simple [editor plugin](../guides/creating-plugins) to extend Pulsar with your own tools. This is a great way to learn the editor API.

**Explore the Code** - Pulsar is open source! Browse through the `crates/` directory to see how different systems are implemented. The code is well-commented and organized.

**Join the Community** - Hop into the Discord or GitHub Discussions to ask questions, share what you're working on, or just hang out with other Pulsar users.

## Common Questions

### Why isn't there a visual scene editor yet?

Pulsar is being built incrementally, starting with the foundational systems. A visual scene editor is planned, but the team is focused on getting the core architecture solid first. In the meantime, you'll be working more directly with code.

### Can I use Pulsar for 2D games?

Eventually, yes! Right now the focus is on the editor infrastructure and 3D systems, but 2D support is absolutely on the roadmap.

### What if I find a bug?

Great! File an issue on GitHub with details about what you were doing, what you expected to happen, and what actually happened. Include any relevant error messages or logs.

### Can I contribute to Pulsar?

Absolutely. Check out the [contributing guide](https://github.com/Far-Beyond-Pulsar/Pulsar-Native/blob/main/CONTRIBUTING.md) in the repository for information on how to get started.
