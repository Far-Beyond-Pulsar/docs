---
title: Experimental Features
description: Cutting-edge technologies and experimental subsystems in Pulsar
category: core-concepts/experiments
lastUpdated: '2026-02-08'
tags:
  - experiments
  - rendering
  - advanced
position: 1
icon: Flask
---

The experiments section documents features and subsystems that are production-quality but still evolving. These implementations are stable enough for real use but may have API changes as they mature based on feedback and real-world usage patterns.

## What Qualifies as Experimental

Experimental features meet several criteria. They're functionally complete with comprehensive documentation and test coverage. They work in production but haven't been battle-tested across diverse projects yet. The API is thoughtfully designed but may change based on usage patterns we discover. Performance characteristics are understood and documented, though optimization continues.

This differs from "core" features which have stable APIs frozen for backward compatibility. Experimental features give us room to iterate on designs while still providing real value to developers building with Pulsar.

> [!NOTE]
> "Experimental" means the API may evolve—not that the code is buggy or incomplete. These are high-quality implementations still finding their final form.

## Current Experiments

### Helio Rendering Engine

Helio is a modular GPU rendering engine built on blade-graphics. Rather than monolithic renderers where all features are baked in, Helio uses a feature system where lighting, shadows, materials, and post-processing are independent modules. Features can be enabled, disabled, or swapped at runtime without recompiling the engine.

The system achieves zero runtime overhead through compile-time shader composition. When features are enabled, their shader code is injected into strategic points in a base template, producing a unified shader that runs as fast as hand-written code. The composition happens during initialization and when toggling features—not every frame.

See the [Helio documentation](./Helio/) for comprehensive guides covering the entire rendering stack from vertex formats to real-world application integration.

## Using Experimental Features

Experimental features are safe to use in Pulsar projects with some awareness. Check the documentation for API stability notes—some parts may be stable while others are marked as evolving. Follow the GitHub repository and Discord for announcements about API changes. Test thoroughly when updating Pulsar versions, as experimental APIs may have breaking changes between releases.

The upside is early access to powerful capabilities while they're still being refined. Your feedback helps shape these features—reporting issues, sharing use cases, and proposing API improvements all contribute to moving features from experimental to stable.

> [!TIP]
> Treat experimental features like you would any third-party library—understand the stability guarantees and stay informed about updates. The main difference is these are developed alongside Pulsar itself.

## Future Experiments

As new rendering techniques and engine systems reach maturity, they'll be documented here following the same comprehensive style. Future experiments might include compute-based rendering pipelines, advanced post-processing effects, procedural generation systems, or extended ray tracing capabilities.

The experiments section grows as Pulsar explores new approaches to game engine architecture and rendering technology.
