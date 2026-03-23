---
title: Helio Renderer
description: Production-grade, data-driven, physically-based real-time renderer built on wgpu — with a modular render graph, GPU-driven scene, and high-performance instancing
category: experiments
lastUpdated: '2026-03-23'
tags:
  - rendering
  - wgpu
  - pbr
  - render-graph
  - gpu-driven
  - scene
position: 0
icon: Layers
related:
  - core-concepts/Helio/scene
  - core-concepts/Helio/render-graph
  - core-concepts/Helio/gpu-driven-pipeline
  - core-concepts/Helio/passes
---

Helio is a modern renderer architecture core in the Pulsar engine. It is implemented in pure Rust on `wgpu` and designed around three fundamental principles:

1. explicit, data-driven pass orchestration (`RenderGraph`),
2. GPU-resident scene and indirect command generation (`Scene` + `GPU-Driven Pipeline`),
3. modular features and runtime toggleability with minimal CPU overhead.

The renderer is optimized for large dynamic scenes, wide platform support (Vulkan, Metal, DirectX12, WebGPU), and an extensible feature pipeline (shadows, GI, sky/atmosphere, post-process, SDF). It is the central experience for Helio docs.

## Architecture at a Glance

- `Renderer` owns:
  - `Scene` (mesh/material/object/light data, handles, and dirty-tracking)
  - `RenderGraph` (ordered render passes and inter-pass resource handoff)
  - `FeatureRegistry` (active effect modules, shader constants, pass registration)
  - GPU pools (`GpuBufferPool`, `PipelineCache`, `GpuScene`, `GpuLightScene`)

- Frame loop (per `renderer.render()`):
  1. **prepare**: `scene.flush()` (dirty upload, rebuild/optimize instance buffers), feature prepare, resource updates.
  2. **execute**: graph passes run in declared order, including shadow, sky LUT, depth prepass, GBuffer, deferred lighting, compositor.
  3. **present**: one command submission to queue.

- GPU-driven core:
  - `GpuInstanceData` (128 bytes, transform + bounds + mesh/material ids + flags)
  - compute cull + indirect draw generation
  - `multi_draw_indexed_indirect` for most of geometry work
  - persistent mode (O(1) add/remove) and optimized mode (`optimize_scene_layout()` for automated instancing)

## Helio target use cases

- Dynamic worlds with tens of thousands of objects
- Realtime PBR with cascaded shadows + deferred lighting + screen-space/post effects
- Editor-style scene manipulation (mass group ops, object, camera, light updates)
- Portability to desktop and web platforms

## Navigation (co-documents)

- [Scene API](./scene)
  - full scene ownership model
  - meshes, materials, objects, lights, groups, virtual geometry, camera
  - flush/dirty-tracking and handle semantics

- [The Render Graph](./render-graph)
  - pass ordering, FrameResources lifecycle (`publish`, `prepare`, `execute`)
  - default pass architecture and how to add custom passes

- [GPU-Driven Pipeline & Automatic Instancing](./gpu-driven-pipeline)
  - per-frame dispatch/indirect draw flow
  - O(1) CPU hot path and batch instancing algorithm
  - persistent vs optimized pipeline modes

- [Render Passes](./passes)
  - pass contracts (`RenderPass` trait, `PassContext`, resources)
  - built-in passes (shadow, G-buffer, lighting, post-processing)

## Quick Start

Use the APIs in `Scene` + `Renderer` as the primary integration points:

- `RendererConfig::new(...)`, `Renderer::new(...)` to set up.
- `scene.insert_mesh`, `scene.insert_material`, `scene.insert_object`, `scene.insert_light` to build content.
- `renderer.render(target_view, depth_view, camera)` each frame.

For full step-by-step code, see the related Helio content in the subpages above.

## Platform Support

| Platform | Backend | Notes |
|---|---|---|
| Windows | DirectX 12, Vulkan | Full feature set |
| Linux | Vulkan | Full feature set |
| macOS/iOS | Metal | Full feature set |
| Android | Vulkan | `aarch64-linux-android` |
| Browser | WebGPU | `wasm32-unknown-unknown` |

> [!NOTE]
> The `live-portal` feature is optional. It is only available on native targets and is disabled in WASM builds; calling `start_live_portal()` without the feature returns error.
