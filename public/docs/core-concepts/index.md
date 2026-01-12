---
title: Core Concepts
description: Understanding the fundamental concepts behind Pulsar Engine
category: core-concepts
position: 2
icon: BookOpen
lastUpdated: '2026-01-12'
tags:
  - core
  - concepts
  - fundamentals
  - overview
related:
  - core-concepts/architecture
  - core-concepts/plugin-system
  - core-concepts/type-system
---

# Core Concepts

Welcome to the heart of Pulsar Engine. If you're going to build something with Pulsar—or just understand how it works—you need to grasp these fundamental concepts. This isn't a feature list or a marketing pitch. These are the ideas that shape every line of code in the engine.

## What You'll Learn

This section covers the architectural decisions and systems that make Pulsar what it is. Each concept builds on the others, so while you can jump around, reading in order will give you the clearest picture.

We'll explore:

- **[Architecture](./architecture)** - How Pulsar is structured and why
- **[Plugin System](./plugin-system)** - Extending the editor with dynamic libraries
- **[Type System](./type-system)** - Strong typing for game data
- **[UI Framework](./ui-framework)** - GPUI and how the editor interface works
- **[Rendering Pipeline](./rendering-pipeline)** - From scene to pixels
- **[Entity-Component-System](./entity-component-system)** - Game object architecture

## Why These Concepts Matter

Game engines are complex beasts. They're not just single programs—they're platforms for building interactive experiences. Understanding the core concepts gives you:

**Mental models for debugging** - When something goes wrong, you'll know which system to look at and why it might be failing.

**Design intuition** - You'll understand what Pulsar makes easy and what it makes hard, so you can work with the engine instead of fighting it.

**Extension capability** - Want to add features? You'll know where they fit in the architecture and how to integrate them properly.

**Performance insight** - Understanding the systems helps you write code that works with Pulsar's optimizations instead of accidentally defeating them.

## Starting Points

If you're completely new to Pulsar, start with **[Architecture](./architecture)**. It gives you the big-picture view of how everything connects.

If you're coming from another engine and want to understand what's different, check out **[Plugin System](./plugin-system)** and **[Type System](./type-system)**. These are two areas where Pulsar diverges significantly from Unity, Unreal, or Godot.

If you're ready to build something, the **[UI Framework](./ui-framework)** guide will teach you how to create editor tools, while **[Entity-Component-System](./entity-component-system)** covers game object architecture.

## A Note on Learning Curves

Pulsar doesn't hide complexity—it organizes it. Some of these concepts require effort to understand, especially if you're new to systems programming or Rust. That's intentional. We're building tools for people who want to understand what's happening under the hood.

If a concept seems dense, that's okay. Take your time. Work through the examples. Build small experiments. The investment pays off when you realize you're solving problems that would be opaque mysteries in other engines.

## Philosophy Behind the Concepts

Before diving into specifics, let's talk about the principles that guide Pulsar's design:

### No Magic

When something happens in Pulsar, there's explicit code making it happen. No hidden conventions. No "it just works" without explanation. This makes the learning curve steeper initially, but you'll never wonder "wait, how does that actually work?"

### Modularity Through Boundaries

Systems have clear interfaces. The plugin system doesn't know about the rendering pipeline. The ECS doesn't know about the editor UI. This separation lets you understand one piece without understanding all of them.

### Type Safety Everywhere

Rust enforces correctness at compile time. Pulsar extends this philosophy with its own type database for game data. If your code compiles and passes type checks, entire categories of bugs are impossible.

### Explicit Over Implicit

Implicit behavior leads to surprising edge cases. Pulsar prefers being explicit even when it's more verbose. You write `entity.add_component(Transform::new())` instead of magically getting a Transform when you access it.

### Performance by Design, Not by Accident

The architecture is designed around performance from the beginning. Cache-friendly data layouts. Parallel system execution. GPU-accelerated UI. You don't have to work around the engine to get good performance—it's the default path.

## How Systems Interact

One of the trickiest parts of understanding any engine is figuring out how the pieces communicate. In Pulsar:

**The editor and the game are separate** - Your game code runs in its own process. The editor observes and controls it but doesn't share memory. This is why the editor stays responsive even when your game crashes.

**Plugins extend the editor, not the game** - When you write a plugin, you're adding capabilities to the development environment. Game logic goes in game code, not plugins.

**The type system bridges code and data** - Rust types defined in your game code become inspectable metadata that the editor can understand and validate.

**ECS is for runtime, not tools** - The entity-component-system is how your game organizes objects at runtime. The editor uses different patterns (GPUI entities and models) for UI state.

## Common Questions

**"Do I need to understand all of this to use Pulsar?"**

No. You can build simple projects by following tutorials and examples. But understanding these concepts unlocks Pulsar's full power and helps you solve novel problems.

**"Is Pulsar harder to learn than Unity/Unreal/Godot?"**

Different, not necessarily harder. If you're used to drag-and-drop visual editors, yes, Pulsar will feel more programming-centric. If you're comfortable with code and want to understand systems, Pulsar might feel clearer.

**"Why is everything in Rust? Can I use other languages?"**

The engine is Rust-native. This gives us memory safety, performance, and fearless concurrency. Scripting language support is planned but not implemented yet. For now, it's Rust all the way down.

**"What if I find a concept confusing?"**

Ask questions! The Discord community is active and helpful. The core developers hang out there and love talking about the architecture. There are no stupid questions—the engine is experimental and many concepts are novel.

## Where to Go from Here

Ready to dive in? Here's a suggested path:

1. **[Architecture](./architecture)** - Get the lay of the land
2. **[Plugin System](./plugin-system)** - Understand extensibility
3. **[Type System](./type-system)** - Learn how data works
4. **[UI Framework](./ui-framework)** - Build editor tools
5. **[ECS](./entity-component-system)** - Structure game logic
6. **[Rendering Pipeline](./rendering-pipeline)** - Visualize your game

Or jump to whatever interests you most. Each doc is written to stand alone while linking to related concepts.

## Contributing to These Docs

Found an error? Want to add an example? These docs are open source and contributions are welcome. Check the repo for guidelines on how to contribute.

## Experimental Notice

Remember: Pulsar is experimental. These concepts are stable, but implementations are evolving. Some features described here might not be fully implemented yet. We're building in public and documenting as we go.

That said, the core ideas are solid. Understanding these concepts will serve you well even as specific APIs change.

---

Let's explore what makes Pulsar tick. Choose a concept above and dive in.
position: 2
