---
title: Creating Materials and Shaders
description: >-
  Complete shader writing tutorial covering WGSL syntax, material properties,
  PBR rendering, texture sampling, lighting, and hot-reload workflow
category: guides
lastUpdated: '2026-01-12'
tags:
  - materials
  - shaders
  - wgsl
  - rendering
  - pbr
  - graphics
related:
  - rendering-pipeline
  - asset-system
  - graphics-basics
position: 2
icon: Sparkles
---

# Creating Materials and Shaders

This comprehensive guide teaches you how to create custom materials and shaders for Pulsar using WGSL (WebGPU Shading Language). You'll learn everything from basic shader structure to advanced PBR materials with hot-reloading support.

## What You'll Learn

By the end of this tutorial, you'll understand:
- WGSL syntax and shader structure
- Material property systems
- Texture sampling and filtering
- Physically-Based Rendering (PBR)
- Lighting calculations
- Hot-reload workflow for rapid iteration
- Performance optimization techniques

## Prerequisites

- Basic understanding of 3D graphics concepts
- Familiarity with vectors and matrices
- Knowledge of Pulsar's asset system
- WGSL basics (we'll cover this)

## Part 1: WGSL Fundamentals

### Shader Structure

WGSL shaders consist of entry points (vertex, fragment, compute) and supporting functions. Here's the basic structure:

```wgsl
// Vertex shader input from mesh
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) tangent: vec4<f32>,
};

// Vertex shader output / Fragment shader input
struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) tangent: vec3<f32>,
    @location(4) bitangent: vec3<f32>,
};

// Uniform buffer for transformation matrices
struct CameraUniform {
    view_proj: mat4x4<f32>,
    view: mat4x4<f32>,
    projection: mat4x4<f32>,
    camera_position: vec3<f32>,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniform;

// Vertex shader entry point
@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.world_position = input.position;
    output.clip_position = camera.view_proj * vec4<f32>(input.position, 1.0);
    output.world_normal = input.normal;
    output.uv = input.uv;
    output.tangent = input.tangent.xyz;
    
    // Calculate bitangent
    output.bitangent = cross(input.normal, input.tangent.xyz) * input.tangent.w;
    
    return output;
}

// Fragment shader entry point
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Simple output for now
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
```

### WGSL Data Types

```wgsl
// Scalars
let float_val: f32 = 1.0;
let int_val: i32 = 42;
let uint_val: u32 = 100u;
let bool_val: bool = true;

// Vectors
let vec2_val: vec2<f32> = vec2<f32>(1.0, 2.0);
let vec3_val: vec3<f32> = vec3<f32>(1.0, 2.0, 3.0);
let vec4_val: vec4<f32> = vec4<f32>(1.0, 2.0, 3.0, 4.0);

// Matrices
let mat3_val: mat3x3<f32> = mat3x3<f32>(
    1.0, 0.0, 0.0,
    0.0, 1.0, 0.0,
    0.0, 0.0, 1.0
);

let mat4_val: mat4x4<f32> = mat4x4<f32>(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0
);
```

### Built-in Functions

```wgsl
// Common math functions
let a = abs(-5.0);                    // Absolute value
let b = sin(3.14159);                  // Sine
let c = cos(3.14159);                  // Cosine
let d = pow(2.0, 3.0);                // Power
let e = sqrt(16.0);                    // Square root
let f = min(5.0, 10.0);               // Minimum
let g = max(5.0, 10.0);               // Maximum
let h = clamp(5.0, 0.0, 10.0);        // Clamp to range

// Vector operations
let v1 = vec3<f32>(1.0, 2.0, 3.0);
let v2 = vec3<f32>(4.0, 5.0, 6.0);
let dot_product = dot(v1, v2);
let cross_product = cross(v1, v2);
let length_val = length(v1);
let normalized = normalize(v1);
let mixed = mix(v1, v2, 0.5);         // Linear interpolation

// Matrix operations
let m1 = mat4x4<f32>();
let m2 = mat4x4<f32>();
let mult = m1 * m2;
let transposed = transpose(m1);
```

## Part 2: Material System Integration

### Creating a Material Definition

In Pulsar, materials are defined in Rust and linked to shaders:

```rust
use pulsar_render::{Material, MaterialDescriptor, UniformBuffer};
use wgpu::{ShaderModule, BindGroupLayout};

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct CustomMaterialUniforms {
    pub base_color: [f32; 4],
    pub metallic: f32,
    pub roughness: f32,
    pub emissive: [f32; 3],
    pub _padding: f32,
}

pub struct CustomMaterial {
    pub uniforms: CustomMaterialUniforms,
    pub albedo_texture: Option<TextureHandle>,
    pub normal_texture: Option<TextureHandle>,
    pub metallic_roughness_texture: Option<TextureHandle>,
    pub emissive_texture: Option<TextureHandle>,
}

impl Material for CustomMaterial {
    fn descriptor(&self) -> MaterialDescriptor {
        MaterialDescriptor {
            shader: "shaders/custom_material.wgsl",
            blend_mode: BlendMode::Opaque,
            double_sided: false,
            depth_write: true,
            depth_test: true,
        }
    }

    fn bind_group_layout(&self, device: &wgpu::Device) -> BindGroupLayout {
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Custom Material Layout"),
            entries: &[
                // Uniform buffer
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Albedo texture
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Sampler
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        })
    }
}
```

### Shader for Custom Material

Create `shaders/custom_material.wgsl`:

```wgsl
// Material uniforms
struct MaterialUniforms {
    base_color: vec4<f32>,
    metallic: f32,
    roughness: f32,
    emissive: vec3<f32>,
};

@group(1) @binding(0)
var<uniform> material: MaterialUniforms;

@group(1) @binding(1)
var albedo_texture: texture_2d<f32>;

@group(1) @binding(2)
var texture_sampler: sampler;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample albedo texture
    let albedo = textureSample(albedo_texture, texture_sampler, input.uv);
    
    // Multiply by material color
    let base_color = albedo * material.base_color;
    
    return base_color;
}
```

## Part 3: Texture Sampling

### Basic Texture Sampling

```wgsl
// Standard texture sampling
let color = textureSample(my_texture, my_sampler, uv);

// Sample with explicit LOD
let color_lod = textureSampleLevel(my_texture, my_sampler, uv, 0.0);

// Sample with gradient (for custom mipmap calculation)
let ddx = dpdx(uv);
let ddy = dpdy(uv);
let color_grad = textureSampleGrad(my_texture, my_sampler, uv, ddx, ddy);

// Texture array sampling
let color_array = textureSample(texture_array, my_sampler, uv, layer_index);
```

### Advanced Texture Techniques

```wgsl
// Triplanar mapping for terrain
fn triplanar_sample(
    texture: texture_2d<f32>,
    samp: sampler,
    world_pos: vec3<f32>,
    world_normal: vec3<f32>,
    scale: f32
) -> vec4<f32> {
    // Sample from three planes
    let x_axis = textureSample(texture, samp, world_pos.yz * scale);
    let y_axis = textureSample(texture, samp, world_pos.xz * scale);
    let z_axis = textureSample(texture, samp, world_pos.xy * scale);
    
    // Blend based on normal
    let blend = abs(world_normal);
    blend = blend / (blend.x + blend.y + blend.z);
    
    return x_axis * blend.x + y_axis * blend.y + z_axis * blend.z;
}

// Parallax occlusion mapping
fn parallax_occlusion_mapping(
    height_texture: texture_2d<f32>,
    samp: sampler,
    uv: vec2<f32>,
    view_dir: vec3<f32>,
    height_scale: f32
) -> vec2<f32> {
    let num_layers = 32.0;
    let layer_depth = 1.0 / num_layers;
    var current_layer_depth = 0.0;
    
    let P = view_dir.xy * height_scale;
    let delta_uv = P / num_layers;
    
    var current_uv = uv;
    var current_depth_value = textureSample(height_texture, samp, current_uv).r;
    
    // Raymarch through height field
    for (var i = 0; i < 32; i++) {
        if (current_layer_depth >= current_depth_value) {
            break;
        }
        current_uv -= delta_uv;
        current_depth_value = textureSample(height_texture, samp, current_uv).r;
        current_layer_depth += layer_depth;
    }
    
    return current_uv;
}
```

### Normal Mapping

```wgsl
// Extract normal from normal map and transform to world space
fn apply_normal_map(
    normal_texture: texture_2d<f32>,
    samp: sampler,
    uv: vec2<f32>,
    world_normal: vec3<f32>,
    tangent: vec3<f32>,
    bitangent: vec3<f32>
) -> vec3<f32> {
    // Sample normal map (stored in tangent space)
    let tangent_normal = textureSample(normal_texture, samp, uv).xyz;
    
    // Convert from [0,1] to [-1,1]
    let tangent_normal_normalized = tangent_normal * 2.0 - 1.0;
    
    // Create TBN matrix
    let tbn = mat3x3<f32>(
        normalize(tangent),
        normalize(bitangent),
        normalize(world_normal)
    );
    
    // Transform to world space
    return normalize(tbn * tangent_normal_normalized);
}
```

## Part 4: Physically-Based Rendering (PBR)

### PBR Theory

PBR simulates light interaction with surfaces based on physical properties:
- **Albedo**: Base color of the surface
- **Metallic**: Whether surface is metal (1.0) or dielectric (0.0)
- **Roughness**: Surface microsurface detail (0.0 = smooth, 1.0 = rough)
- **Emissive**: Light emitted by the surface
- **Ambient Occlusion**: Shadowing in crevices

### Complete PBR Shader

```wgsl
const PI: f32 = 3.14159265359;

// Fresnel-Schlick approximation
fn fresnel_schlick(cos_theta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(1.0 - cos_theta, 5.0);
}

// GGX/Trowbridge-Reitz normal distribution function
fn distribution_ggx(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;
    
    let num = a2;
    var denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    
    return num / denom;
}

// Schlick-GGX geometry function
fn geometry_schlick_ggx(NdotV: f32, roughness: f32) -> f32 {
    let r = (roughness + 1.0);
    let k = (r * r) / 8.0;
    
    let num = NdotV;
    let denom = NdotV * (1.0 - k) + k;
    
    return num / denom;
}

// Smith's method for geometry obstruction
fn geometry_smith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx2 = geometry_schlick_ggx(NdotV, roughness);
    let ggx1 = geometry_schlick_ggx(NdotL, roughness);
    
    return ggx1 * ggx2;
}

// Main PBR lighting calculation
fn calculate_pbr(
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32,
    N: vec3<f32>,
    V: vec3<f32>,
    L: vec3<f32>,
    radiance: vec3<f32>
) -> vec3<f32> {
    let H = normalize(V + L);
    
    // Calculate F0 (surface reflection at zero incidence)
    var F0 = vec3<f32>(0.04);
    F0 = mix(F0, albedo, metallic);
    
    // Cook-Torrance BRDF
    let NDF = distribution_ggx(N, H, roughness);
    let G = geometry_smith(N, V, L, roughness);
    let F = fresnel_schlick(max(dot(H, V), 0.0), F0);
    
    let kS = F;
    var kD = vec3<f32>(1.0) - kS;
    kD *= 1.0 - metallic;
    
    let numerator = NDF * G * F;
    let denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
    let specular = numerator / denominator;
    
    let NdotL = max(dot(N, L), 0.0);
    return (kD * albedo / PI + specular) * radiance * NdotL;
}

// Light structure
struct PointLight {
    position: vec3<f32>,
    color: vec3<f32>,
    intensity: f32,
};

@group(2) @binding(0)
var<uniform> lights: array<PointLight, 4>;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample material textures
    let albedo_sample = textureSample(albedo_texture, texture_sampler, input.uv);
    let albedo = albedo_sample.rgb * material.base_color.rgb;
    
    let normal = apply_normal_map(
        normal_texture,
        texture_sampler,
        input.uv,
        input.world_normal,
        input.tangent,
        input.bitangent
    );
    
    let metallic_roughness = textureSample(
        metallic_roughness_texture,
        texture_sampler,
        input.uv
    );
    let metallic = metallic_roughness.b * material.metallic;
    let roughness = metallic_roughness.g * material.roughness;
    
    // Calculate view direction
    let V = normalize(camera.camera_position - input.world_position);
    
    // Accumulate lighting
    var Lo = vec3<f32>(0.0);
    
    for (var i = 0u; i < 4u; i++) {
        let light = lights[i];
        let L = normalize(light.position - input.world_position);
        let distance = length(light.position - input.world_position);
        let attenuation = 1.0 / (distance * distance);
        let radiance = light.color * light.intensity * attenuation;
        
        Lo += calculate_pbr(albedo, metallic, roughness, normal, V, L, radiance);
    }
    
    // Ambient lighting
    let ambient = vec3<f32>(0.03) * albedo;
    var color = ambient + Lo;
    
    // HDR tonemapping
    color = color / (color + vec3<f32>(1.0));
    
    // Gamma correction
    color = pow(color, vec3<f32>(1.0 / 2.2));
    
    // Add emissive
    color += material.emissive;
    
    return vec4<f32>(color, 1.0);
}
```

## Part 5: Advanced Lighting

### Directional Lights

```wgsl
struct DirectionalLight {
    direction: vec3<f32>,
    color: vec3<f32>,
    intensity: f32,
};

fn calculate_directional_light(
    light: DirectionalLight,
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32,
    N: vec3<f32>,
    V: vec3<f32>
) -> vec3<f32> {
    let L = normalize(-light.direction);
    let radiance = light.color * light.intensity;
    
    return calculate_pbr(albedo, metallic, roughness, N, V, L, radiance);
}
```

### Spotlights

```wgsl
struct SpotLight {
    position: vec3<f32>,
    direction: vec3<f32>,
    color: vec3<f32>,
    intensity: f32,
    inner_cone_angle: f32,
    outer_cone_angle: f32,
};

fn calculate_spotlight(
    light: SpotLight,
    world_pos: vec3<f32>,
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32,
    N: vec3<f32>,
    V: vec3<f32>
) -> vec3<f32> {
    let L = normalize(light.position - world_pos);
    let distance = length(light.position - world_pos);
    
    // Calculate spotlight cone
    let theta = dot(L, normalize(-light.direction));
    let epsilon = light.inner_cone_angle - light.outer_cone_angle;
    let intensity = clamp((theta - light.outer_cone_angle) / epsilon, 0.0, 1.0);
    
    let attenuation = 1.0 / (distance * distance);
    let radiance = light.color * light.intensity * attenuation * intensity;
    
    return calculate_pbr(albedo, metallic, roughness, N, V, L, radiance);
}
```

### Image-Based Lighting (IBL)

```wgsl
@group(3) @binding(0)
var irradiance_map: texture_cube<f32>;

@group(3) @binding(1)
var prefiltered_map: texture_cube<f32>;

@group(3) @binding(2)
var brdf_lut: texture_2d<f32>;

@group(3) @binding(3)
var env_sampler: sampler;

fn calculate_ibl(
    N: vec3<f32>,
    V: vec3<f32>,
    F0: vec3<f32>,
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32
) -> vec3<f32> {
    let R = reflect(-V, N);
    
    // Sample irradiance map for diffuse
    let irradiance = textureSample(irradiance_map, env_sampler, N).rgb;
    
    // Sample prefiltered environment map for specular
    let prefilteredColor = textureSampleLevel(
        prefiltered_map,
        env_sampler,
        R,
        roughness * 4.0
    ).rgb;
    
    // Sample BRDF integration map
    let NdotV = max(dot(N, V), 0.0);
    let brdf = textureSample(
        brdf_lut,
        env_sampler,
        vec2<f32>(NdotV, roughness)
    ).rg;
    
    let F = fresnel_schlick(NdotV, F0);
    
    let kS = F;
    var kD = vec3<f32>(1.0) - kS;
    kD *= 1.0 - metallic;
    
    let diffuse = irradiance * albedo;
    let specular = prefilteredColor * (F * brdf.x + brdf.y);
    
    return kD * diffuse + specular;
}
```

## Part 6: Hot-Reload System

### Setting Up Hot-Reload

Implement a shader hot-reload system for rapid iteration:

```rust
use notify::{Watcher, RecursiveMode, watcher};
use std::sync::mpsc::channel;
use std::time::Duration;

pub struct ShaderHotReload {
    watcher: notify::RecommendedWatcher,
    shader_paths: HashMap<String, PathBuf>,
    reload_queue: Arc<Mutex<Vec<String>>>,
}

impl ShaderHotReload {
    pub fn new() -> Result<Self> {
        let (tx, rx) = channel();
        let reload_queue = Arc::new(Mutex::new(Vec::new()));
        let queue_clone = reload_queue.clone();
        
        let mut watcher = watcher(tx, Duration::from_secs(1))?;
        watcher.watch("shaders/", RecursiveMode::Recursive)?;
        
        // Spawn thread to handle file changes
        std::thread::spawn(move || {
            loop {
                match rx.recv() {
                    Ok(event) => {
                        if let notify::DebouncedEvent::Write(path) = event {
                            if let Some(path_str) = path.to_str() {
                                if path_str.ends_with(".wgsl") {
                                    queue_clone.lock().unwrap().push(path_str.to_string());
                                    log::info!("Shader modified: {}", path_str);
                                }
                            }
                        }
                    }
                    Err(e) => log::error!("Watch error: {:?}", e),
                }
            }
        });
        
        Ok(Self {
            watcher,
            shader_paths: HashMap::new(),
            reload_queue,
        })
    }
    
    pub fn check_reloads(&mut self, renderer: &mut Renderer) -> Result<()> {
        let mut queue = self.reload_queue.lock().unwrap();
        
        for shader_path in queue.drain(..) {
            log::info!("Reloading shader: {}", shader_path);
            
            match self.reload_shader(&shader_path, renderer) {
                Ok(_) => log::info!("Shader reloaded successfully: {}", shader_path),
                Err(e) => log::error!("Failed to reload shader {}: {}", shader_path, e),
            }
        }
        
        Ok(())
    }
    
    fn reload_shader(&self, path: &str, renderer: &mut Renderer) -> Result<()> {
        // Read shader source
        let source = std::fs::read_to_string(path)?;
        
        // Compile shader
        let shader_module = renderer.device.create_shader_module(
            wgpu::ShaderModuleDescriptor {
                label: Some(path),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            }
        );
        
        // Update material pipelines
        renderer.update_shader(path, shader_module)?;
        
        Ok(())
    }
}
```

### Shader Error Reporting

```rust
fn validate_shader_compilation(
    device: &wgpu::Device,
    source: &str,
    path: &str
) -> Result<ShaderModule> {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(path),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    
    // In debug builds, validate shader compilation
    #[cfg(debug_assertions)]
    {
        // WGPU will panic on shader compilation errors
        // Catch and display nicely
        match std::panic::catch_unwind(|| {
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(path),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            })
        }) {
            Ok(module) => Ok(module),
            Err(e) => {
                let error_msg = format!("Shader compilation failed: {:?}", e);
                log::error!("{}", error_msg);
                Err(anyhow::anyhow!(error_msg))
            }
        }
    }
    
    #[cfg(not(debug_assertions))]
    Ok(module)
}
```

## Part 7: Performance Optimization

### Shader Optimization Tips

```wgsl
// BAD: Recalculating same value multiple times
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color1 = some_expensive_function(input.uv);
    let color2 = some_expensive_function(input.uv); // Recalculated!
    return (color1 + color2) * 0.5;
}

// GOOD: Calculate once and reuse
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = some_expensive_function(input.uv);
    return color;
}

// BAD: Branching in fragment shader
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (material.use_texture) {
        return textureSample(my_texture, my_sampler, input.uv);
    } else {
        return material.base_color;
    }
}

// GOOD: Use shader variants or mix
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let texture_color = textureSample(my_texture, my_sampler, input.uv);
    return mix(material.base_color, texture_color, material.texture_blend);
}
```

### Instance Optimization

```wgsl
// Per-instance data structure
struct InstanceData {
    model_matrix: mat4x4<f32>,
    color_tint: vec4<f32>,
};

@group(1) @binding(0)
var<storage, read> instances: array<InstanceData>;

@vertex
fn vs_main(
    input: VertexInput,
    @builtin(instance_index) instance_idx: u32
) -> VertexOutput {
    let instance = instances[instance_idx];
    
    var output: VertexOutput;
    let world_pos = instance.model_matrix * vec4<f32>(input.position, 1.0);
    output.clip_position = camera.view_proj * world_pos;
    output.world_position = world_pos.xyz;
    
    return output;
}
```

### LOD System Integration

```rust
pub struct LODMaterial {
    high_quality: MaterialHandle,
    medium_quality: MaterialHandle,
    low_quality: MaterialHandle,
}

impl LODMaterial {
    pub fn select_lod(&self, distance: f32) -> MaterialHandle {
        if distance < 50.0 {
            self.high_quality.clone()
        } else if distance < 200.0 {
            self.medium_quality.clone()
        } else {
            self.low_quality.clone()
        }
    }
}
```

## Part 8: Complete Material Example

### Toon Shader Material

```wgsl
// Toon/Cel-shaded material

struct ToonMaterialUniforms {
    base_color: vec4<f32>,
    shade_color: vec4<f32>,
    outline_thickness: f32,
    outline_color: vec4<f32>,
    shade_threshold: f32,
};

@group(1) @binding(0)
var<uniform> material: ToonMaterialUniforms;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let N = normalize(input.world_normal);
    let L = normalize(vec3<f32>(0.5, 1.0, 0.5)); // Main light direction
    let V = normalize(camera.camera_position - input.world_position);
    
    // Calculate lighting intensity
    let NdotL = dot(N, L);
    
    // Quantize lighting into discrete steps
    var intensity: f32;
    if (NdotL > material.shade_threshold) {
        intensity = 1.0;
    } else {
        intensity = 0.5;
    }
    
    // Mix base and shade colors
    let lit_color = mix(material.shade_color, material.base_color, intensity);
    
    // Rim lighting
    let rim = 1.0 - max(dot(V, N), 0.0);
    let rim_intensity = smoothstep(0.6, 1.0, rim);
    let rim_color = vec3<f32>(1.0) * rim_intensity;
    
    let final_color = lit_color.rgb + rim_color;
    
    return vec4<f32>(final_color, 1.0);
}

// Outline pass (render in separate pass with inverted normals)
@vertex
fn vs_outline(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Expand along normal for outline
    let expanded_pos = input.position + input.normal * material.outline_thickness;
    output.clip_position = camera.view_proj * vec4<f32>(expanded_pos, 1.0);
    
    return output;
}

@fragment
fn fs_outline(input: VertexOutput) -> @location(0) vec4<f32> {
    return material.outline_color;
}
```

## Part 9: Debugging Materials

### Visual Debugging

```wgsl
// Debug visualization modes
const DEBUG_MODE_NONE: u32 = 0u;
const DEBUG_MODE_NORMALS: u32 = 1u;
const DEBUG_MODE_UVS: u32 = 2u;
const DEBUG_MODE_TANGENTS: u32 = 3u;
const DEBUG_MODE_METALLIC: u32 = 4u;
const DEBUG_MODE_ROUGHNESS: u32 = 5u;

@group(0) @binding(1)
var<uniform> debug_mode: u32;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    switch (debug_mode) {
        case DEBUG_MODE_NORMALS: {
            let normal = normalize(input.world_normal);
            return vec4<f32>(normal * 0.5 + 0.5, 1.0);
        }
        case DEBUG_MODE_UVS: {
            return vec4<f32>(input.uv, 0.0, 1.0);
        }
        case DEBUG_MODE_TANGENTS: {
            let tangent = normalize(input.tangent);
            return vec4<f32>(tangent * 0.5 + 0.5, 1.0);
        }
        case DEBUG_MODE_METALLIC: {
            let metallic = material.metallic;
            return vec4<f32>(metallic, metallic, metallic, 1.0);
        }
        case DEBUG_MODE_ROUGHNESS: {
            let roughness = material.roughness;
            return vec4<f32>(roughness, roughness, roughness, 1.0);
        }
        default: {
            // Normal rendering
            return calculate_lighting(input);
        }
    }
}
```

### Performance Profiling

```rust
use std::time::Instant;

pub struct ShaderProfiler {
    frame_times: VecDeque<Duration>,
    material_times: HashMap<String, Duration>,
}

impl ShaderProfiler {
    pub fn begin_material(&mut self, name: &str) {
        // Use GPU timestamp queries
        let timestamp = self.device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some(&format!("{}_timestamp", name)),
            ty: wgpu::QueryType::Timestamp,
            count: 2,
        });
    }
    
    pub fn profile_material_render(
        &mut self,
        material_name: &str,
        render_fn: impl FnOnce()
    ) {
        let start = Instant::now();
        render_fn();
        let elapsed = start.elapsed();
        
        self.material_times.insert(material_name.to_string(), elapsed);
    }
    
    pub fn print_stats(&self) {
        println!("Material Render Times:");
        for (name, time) in &self.material_times {
            println!("  {}: {:.2}ms", name, time.as_secs_f32() * 1000.0);
        }
    }
}
```

## Common Issues and Solutions

### Issue: Shader Compilation Fails

**Symptoms:** Black screen or error messages

**Solutions:**
1. Check WGSL syntax carefully
2. Ensure all bindings are declared
3. Verify struct alignment (use padding)
4. Check that array sizes match
5. Enable validation layers:

```rust
let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
    backends: wgpu::Backends::all(),
    dx12_shader_compiler: Default::default(),
    flags: wgpu::InstanceFlags::validation(),
});
```

### Issue: Lighting Looks Wrong

**Symptoms:** Too dark, too bright, or incorrect reflections

**Solutions:**
1. Verify normal vectors are normalized
2. Check tangent space calculations
3. Ensure light intensities are reasonable
4. Validate PBR parameters (metallic 0-1, roughness 0-1)
5. Add debug visualization

### Issue: Textures Not Sampling

**Symptoms:** Pink/magenta surfaces or solid colors

**Solutions:**
1. Verify texture binding group matches shader
2. Check sampler configuration
3. Ensure UVs are in valid range
4. Verify texture format matches shader expectations

## Conclusion

You now have a comprehensive understanding of material and shader creation in Pulsar! You've learned:

- WGSL syntax and structure
- Material property systems
- Texture sampling techniques
- Complete PBR implementation
- Advanced lighting
- Hot-reload workflow
- Performance optimization
- Debugging techniques

### Next Steps

1. Experiment with custom shader effects
2. Create material presets library
3. Implement compute shader effects
4. Build shader graph system
5. Optimize for mobile/web targets

### Resources

- [WGSL Specification](https://www.w3.org/TR/WGSL/)
- [PBR Theory](https://learnopengl.com/PBR/Theory)
- [Pulsar Rendering Docs](https://docs.pulsar-edit.dev/rendering)
- [Shader Examples Repository](https://github.com/pulsar-edit/shaders)

Happy shader coding!
