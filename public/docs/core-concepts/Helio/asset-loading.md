---
title: Asset Loading and Material Workflows
description: Importing FBX, glTF, OBJ, and USD assets into Helio with workflow-aware material conversion
category: experiments
lastUpdated: '2026-03-18'
tags: [asset-loading, fbx, gltf, obj, usd, materials, uv-flip, specular, ior]
related:
  - core-concepts/experiments/Helio
  - core-concepts/experiments/Helio/getting-started
  - core-concepts/experiments/Helio/materials
position: 6.5
icon: Package
---

# Asset Loading and Material Workflows

Helio's renderer core stays deliberately small: it knows how to consume `PackedVertex`, `Material`,
`SceneLight`, and the persistent scene APIs, but it does not hard-code any single authoring format.
The new `helio-asset-compat` crate fills that gap. It uses SolidRS loaders to ingest real-world
scene files, then converts them into CPU-side Helio structures without forcing you to write a
bespoke importer for every DCC export path.

This page covers the import surface area that changed recently: supported formats, UV flipping,
external texture resolution, per-primitive mesh splitting, and the workflow-aware material mapping
that now preserves authored specular/IOR data instead of collapsing everything into metallic /
roughness.

---

## Entry Points

`helio-asset-compat` exposes four main loading functions:

```rust
pub fn load_scene_file<P: AsRef<Path>>(path: P) -> Result<ConvertedScene>;
pub fn load_scene_file_with_config<P: AsRef<Path>>(
    path: P,
    config: LoadConfig,
) -> Result<ConvertedScene>;

pub fn load_scene_bytes(
    bytes: &[u8],
    format_id: &str,
    base_dir: Option<&Path>,
) -> Result<ConvertedScene>;
pub fn load_scene_bytes_with_config(
    bytes: &[u8],
    format_id: &str,
    base_dir: Option<&Path>,
    config: LoadConfig,
) -> Result<ConvertedScene>;
```

The file-based entry points detect the format from the extension and register SolidRS loaders for:

- **FBX**
- **glTF 2.0**
- **OBJ**
- **USD** (`.usda`, `.usdc`, `.usdz`)

The byte-based entry points are for embedded assets such as `include_bytes!()` bundles or custom
archive formats. In that path you supply a `format_id` yourself and may optionally provide a
`base_dir` for relative texture lookups.

---

## What `ConvertedScene` Contains

Loading does **not** upload anything to the GPU automatically. Instead, the crate returns a
CPU-side `ConvertedScene`:

```rust
pub struct ConvertedScene {
    pub name: String,
    pub meshes: Vec<ConvertedMesh>,
    pub materials: Vec<Material>,
    pub lights: Vec<SceneLight>,
    pub cameras: Vec<CameraData>,
}

pub struct ConvertedMesh {
    pub name: String,
    pub vertices: Vec<PackedVertex>,
    pub indices: Vec<u32>,
    pub material_index: Option<usize>,
}
```

This separation is intentional. It keeps loading, scene inspection, and GPU upload as distinct
steps so tools can validate or transform imported data before it reaches the renderer.

---

## Handing a Converted Scene to the Renderer

The normal Helio renderer APIs remain the upload boundary:

```rust
use glam::Mat4;
use helio_asset_compat::load_scene_file;

let converted = load_scene_file("assets/prop.fbx")?;

let gpu_materials: Vec<_> = converted
    .materials
    .iter()
    .map(|material| renderer.create_material(material))
    .collect();

for mesh in &converted.meshes {
    let gpu_mesh = renderer.create_mesh(&mesh.vertices, &mesh.indices);
    let material = mesh
        .material_index
        .and_then(|index| gpu_materials.get(index));
    renderer.add_object(&gpu_mesh, material, Mat4::IDENTITY);
}

for light in &converted.lights {
    renderer.add_light(*light);
}
```

The important design point is that imported meshes and imported materials are **not special** once
converted. They flow through the exact same `create_mesh`, `create_material`, and `add_object`
paths as hand-authored Helio content.

---

## Relative Textures and Embedded Assets

When you call `load_scene_file("C:\\assets\\robot.fbx")`, Helio records the directory containing the
model file and resolves referenced textures relative to that directory. This matters for formats
like FBX, OBJ, and glTF that often store texture URIs separately from the mesh payload.

When you call `load_scene_bytes(...)`, no file path exists, so you should pass a `base_dir` if the
asset still refers to external images:

```rust
let scene = load_scene_bytes(
    include_bytes!("robot.fbx"),
    "fbx",
    Some(std::path::Path::new("assets\\robot")),
)?;
```

If the source format embeds image blobs directly, `helio-asset-compat` extracts those into
`TextureData` for you and no filesystem lookup is required.

---

## UV Coordinate Systems and `LoadConfig`

Different tools disagree about where `(0, 0)` sits in UV space. Helio's conversion layer handles
that with a small import-time config:

```rust
use helio_asset_compat::{load_scene_file_with_config, LoadConfig};

let config = LoadConfig::default().with_uv_flip(true);
let scene = load_scene_file_with_config("assets\\panel.obj", config)?;
```

`flip_uv_y = true` transforms every imported UV as `v -> 1.0 - v`. Use it when your source asset
was authored for a top-left convention and arrives upside down in Helio. Because the flip happens
during vertex conversion, the renderer and material system still operate in one consistent UV space
after import.

> [!TIP]
> If a texture looks vertically inverted, switch to `renderer.set_debug_mode(1)` first. The UV-as-color mode makes it obvious whether the issue is in the imported coordinates or in the texture content itself.

---

## One Primitive Becomes One `ConvertedMesh`

Many authoring formats allow a single logical mesh to contain multiple primitives or submeshes,
each with its own material. Helio now preserves that structure by converting **each primitive into
its own `ConvertedMesh`**.

That means:

- material boundaries survive import
- each `ConvertedMesh` has one `material_index`
- the renderer can create one `GpuMesh` / `GpuMaterial` pairing per primitive

This is preferable to merging everything into one index buffer because merged primitives would lose
their material assignment, forcing you to split them again later or issue incorrect draw calls.

---

## Workflow-Aware Material Conversion

The other major import change is that `helio-asset-compat` no longer treats every material as plain
metallic/roughness. The converter now inspects the authored data and chooses between Helio's two
canonical workflows:

- **`MaterialWorkflow::MetallicRoughness`** when the material uses the usual metallic + roughness factors
- **`MaterialWorkflow::SpecularIor`** when authored specular colour, specular weight, specular textures, or a non-default IOR are present

In practical terms, Helio preserves:

- `specular_color`
- `specular_weight`
- `ior`
- `specular_color_texture`
- `specular_weight_texture`

instead of flattening them into an approximate metallic value.

```rust
// Conceptually, imported materials end up equivalent to:
let material = Material::new().with_specular_ior_workflow(
    [0.9, 0.8, 0.7], // specular_color
    0.65,            // specular_weight
    1.33,            // ior
    0.18,            // roughness
);
```

This matters most for authored dielectrics such as glass, plastics, varnishes, and coatings, where
`ior` is the correct source of dielectric Fresnel and metallic/roughness would be an unnecessary
approximation.

---

## Texture Semantics During Import

The converter keeps Helio's material slot conventions intact:

- `base_color_texture` is imported as **sRGB**
- `normal_map` is imported as **linear**
- ORM data is packed into Helio's **R=AO / G=roughness / B=metallic** layout
- `emissive_texture` is imported as **sRGB**
- `specular_color_texture` is imported as **sRGB**
- `specular_weight_texture` is imported as **linear**, with the effective value sampled from alpha

Because the importer outputs ordinary `Material` values, the renderer still supplies the usual 1×1
fallback textures when any slot is absent.

---

## Current Limitations

The import path is already useful, but it is not a perfect mirror of every DCC feature yet.
Documented current limitations are:

- texture UV transforms are detected and logged, but not yet applied during conversion
- camera data is extracted for inspection, not auto-bound to the renderer camera
- animations and skins have placeholder types in the crate, but the conversion path is still focused on static scene import

These limitations are explicit rather than silent: the loader preserves what it can, and logs or
exposes the rest so your asset pipeline can make an informed decision.
