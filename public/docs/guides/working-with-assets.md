---
title: "Working with Assets"
description: "Complete asset pipeline guide covering importing meshes, textures, and audio, AssetHandle system, hot-reloading, organization strategies, and custom asset types"
category: "guides"
order: 4
lastUpdated: "2026-01-12"
tags: ["assets", "pipeline", "import", "hot-reload", "textures", "meshes", "audio"]
related: ["rendering-pipeline", "creating-materials", "project-structure"]
---

# Working with Assets

This comprehensive guide teaches you everything about Pulsar's asset pipeline. You'll learn how to import and manage meshes, textures, audio files, implement hot-reloading, organize assets effectively, and create custom asset types.

## What You'll Learn

By the end of this tutorial, you'll understand:
- Asset pipeline architecture
- Importing various asset types (meshes, textures, audio)
- AssetHandle system and lifetime management
- Hot-reloading implementation
- Asset organization best practices
- Custom asset type creation
- Performance optimization strategies

## Prerequisites

- Understanding of Rust ownership and lifetimes
- Basic knowledge of file I/O
- Familiarity with common asset formats
- Experience with Pulsar's ECS system

## Part 1: Asset Pipeline Overview

### Architecture

Pulsar's asset pipeline consists of several layers:

```rust
use std::path::{Path, PathBuf};
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

/// Core asset system architecture
pub struct AssetServer {
    /// Root directory for assets
    asset_root: PathBuf,
    
    /// Asset storage by type
    meshes: Arc<RwLock<HashMap<AssetId, Arc<Mesh>>>>,
    textures: Arc<RwLock<HashMap<AssetId, Arc<Texture>>>>,
    materials: Arc<RwLock<HashMap<AssetId, Arc<Material>>>>,
    audio: Arc<RwLock<HashMap<AssetId, Arc<AudioClip>>>>,
    
    /// Asset metadata cache
    metadata: Arc<RwLock<HashMap<AssetId, AssetMetadata>>>,
    
    /// Loading queue
    load_queue: Arc<RwLock<Vec<AssetLoadRequest>>>,
    
    /// Hot-reload watcher
    watcher: Option<AssetWatcher>,
}

/// Unique identifier for assets
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AssetId(pub u64);

impl AssetId {
    pub fn new() -> Self {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hash, Hasher};
        
        let mut hasher = RandomState::new().build_hasher();
        std::time::SystemTime::now().hash(&mut hasher);
        Self(hasher.finish())
    }
    
    pub fn from_path(path: &Path) -> Self {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hash, Hasher};
        
        let mut hasher = RandomState::new().build_hasher();
        path.hash(&mut hasher);
        Self(hasher.finish())
    }
}

/// Asset metadata stored alongside assets
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetMetadata {
    pub id: AssetId,
    pub path: PathBuf,
    pub asset_type: AssetType,
    pub file_size: u64,
    pub last_modified: SystemTime,
    pub dependencies: Vec<AssetId>,
    pub import_settings: ImportSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AssetType {
    Mesh,
    Texture,
    Material,
    Audio,
    Shader,
    Scene,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSettings {
    pub mesh: MeshImportSettings,
    pub texture: TextureImportSettings,
    pub audio: AudioImportSettings,
}
```

### Asset Handle System

```rust
use std::marker::PhantomData;

/// Type-safe handle to an asset
#[derive(Debug, Clone)]
pub struct AssetHandle<T> {
    id: AssetId,
    generation: u32,
    _phantom: PhantomData<T>,
}

impl<T> AssetHandle<T> {
    pub fn new(id: AssetId) -> Self {
        Self {
            id,
            generation: 0,
            _phantom: PhantomData,
        }
    }
    
    pub fn id(&self) -> AssetId {
        self.id
    }
    
    pub fn is_valid(&self, asset_server: &AssetServer) -> bool {
        asset_server.contains(self.id)
    }
}

impl<T> PartialEq for AssetHandle<T> {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id && self.generation == other.generation
    }
}

impl<T> Eq for AssetHandle<T> {}

impl<T> std::hash::Hash for AssetHandle<T> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
        self.generation.hash(state);
    }
}

// Convenience type aliases
pub type MeshHandle = AssetHandle<Mesh>;
pub type TextureHandle = AssetHandle<Texture>;
pub type MaterialHandle = AssetHandle<Material>;
pub type AudioHandle = AssetHandle<AudioClip>;
```

### Asset Loading

```rust
use anyhow::Result;

pub enum AssetLoadRequest {
    Load {
        path: PathBuf,
        asset_type: AssetType,
    },
    Reload {
        id: AssetId,
    },
    Unload {
        id: AssetId,
    },
}

impl AssetServer {
    pub fn new(asset_root: impl Into<PathBuf>) -> Self {
        Self {
            asset_root: asset_root.into(),
            meshes: Arc::new(RwLock::new(HashMap::new())),
            textures: Arc::new(RwLock::new(HashMap::new())),
            materials: Arc::new(RwLock::new(HashMap::new())),
            audio: Arc::new(RwLock::new(HashMap::new())),
            metadata: Arc::new(RwLock::new(HashMap::new())),
            load_queue: Arc::new(RwLock::new(Vec::new())),
            watcher: None,
        }
    }
    
    /// Load an asset asynchronously
    pub fn load<T: Asset>(&self, path: impl AsRef<Path>) -> AssetHandle<T> {
        let path = self.asset_root.join(path.as_ref());
        let id = AssetId::from_path(&path);
        
        // Check if already loaded
        if self.contains(id) {
            return AssetHandle::new(id);
        }
        
        // Queue for loading
        self.load_queue.write().push(AssetLoadRequest::Load {
            path: path.clone(),
            asset_type: T::asset_type(),
        });
        
        AssetHandle::new(id)
    }
    
    /// Get asset if loaded
    pub fn get<T: Asset>(&self, handle: &AssetHandle<T>) -> Option<Arc<T>> {
        T::get_from_server(self, handle.id())
    }
    
    /// Process queued asset loads
    pub fn process_queue(&mut self) -> Result<()> {
        let mut queue = self.load_queue.write();
        let requests: Vec<_> = queue.drain(..).collect();
        drop(queue);
        
        for request in requests {
            match request {
                AssetLoadRequest::Load { path, asset_type } => {
                    self.load_asset_sync(&path, asset_type)?;
                }
                AssetLoadRequest::Reload { id } => {
                    if let Some(metadata) = self.metadata.read().get(&id) {
                        self.reload_asset(metadata)?;
                    }
                }
                AssetLoadRequest::Unload { id } => {
                    self.unload_asset(id)?;
                }
            }
        }
        
        Ok(())
    }
    
    fn load_asset_sync(&mut self, path: &Path, asset_type: AssetType) -> Result<AssetId> {
        let id = AssetId::from_path(path);
        
        // Load based on type
        match asset_type {
            AssetType::Mesh => {
                let mesh = Mesh::load(path)?;
                self.meshes.write().insert(id, Arc::new(mesh));
            }
            AssetType::Texture => {
                let texture = Texture::load(path)?;
                self.textures.write().insert(id, Arc::new(texture));
            }
            AssetType::Material => {
                let material = Material::load(path)?;
                self.materials.write().insert(id, Arc::new(material));
            }
            AssetType::Audio => {
                let audio = AudioClip::load(path)?;
                self.audio.write().insert(id, Arc::new(audio));
            }
            _ => {}
        }
        
        // Store metadata
        let metadata = AssetMetadata {
            id,
            path: path.to_path_buf(),
            asset_type,
            file_size: std::fs::metadata(path)?.len(),
            last_modified: std::fs::metadata(path)?.modified()?,
            dependencies: Vec::new(),
            import_settings: ImportSettings::default(),
        };
        
        self.metadata.write().insert(id, metadata);
        
        Ok(id)
    }
    
    fn contains(&self, id: AssetId) -> bool {
        self.metadata.read().contains_key(&id)
    }
}

/// Trait for asset types
pub trait Asset: Sized + 'static {
    fn asset_type() -> AssetType;
    fn load(path: &Path) -> Result<Self>;
    fn get_from_server(server: &AssetServer, id: AssetId) -> Option<Arc<Self>>;
}
```

## Part 2: Importing Meshes

### Mesh Data Structure

```rust
use nalgebra::{Vector2, Vector3, Vector4};

#[derive(Debug, Clone)]
pub struct Mesh {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub submeshes: Vec<SubMesh>,
    pub bounds: BoundingBox,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    pub tangent: [f32; 4],
    pub color: [f32; 4],
}

#[derive(Debug, Clone)]
pub struct SubMesh {
    pub index_start: u32,
    pub index_count: u32,
    pub material_index: usize,
}

#[derive(Debug, Clone)]
pub struct BoundingBox {
    pub min: Vector3<f32>,
    pub max: Vector3<f32>,
}

impl BoundingBox {
    pub fn from_vertices(vertices: &[Vertex]) -> Self {
        let mut min = Vector3::new(f32::MAX, f32::MAX, f32::MAX);
        let mut max = Vector3::new(f32::MIN, f32::MIN, f32::MIN);
        
        for vertex in vertices {
            let pos = Vector3::from(vertex.position);
            min = min.inf(&pos);
            max = max.sup(&pos);
        }
        
        Self { min, max }
    }
    
    pub fn center(&self) -> Vector3<f32> {
        (self.min + self.max) * 0.5
    }
    
    pub fn size(&self) -> Vector3<f32> {
        self.max - self.min
    }
}
```

### GLTF Import

```rust
use gltf::{Gltf, Document};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshImportSettings {
    pub generate_normals: bool,
    pub generate_tangents: bool,
    pub optimize: bool,
    pub scale: f32,
    pub flip_uvs: bool,
}

impl Default for MeshImportSettings {
    fn default() -> Self {
        Self {
            generate_normals: true,
            generate_tangents: true,
            optimize: true,
            scale: 1.0,
            flip_uvs: false,
        }
    }
}

impl Asset for Mesh {
    fn asset_type() -> AssetType {
        AssetType::Mesh
    }
    
    fn load(path: &Path) -> Result<Self> {
        let settings = MeshImportSettings::default();
        Self::load_with_settings(path, &settings)
    }
    
    fn get_from_server(server: &AssetServer, id: AssetId) -> Option<Arc<Self>> {
        server.meshes.read().get(&id).cloned()
    }
}

impl Mesh {
    pub fn load_with_settings(path: &Path, settings: &MeshImportSettings) -> Result<Self> {
        let extension = path.extension()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("Invalid file extension"))?;
        
        match extension.to_lowercase().as_str() {
            "gltf" | "glb" => Self::load_gltf(path, settings),
            "obj" => Self::load_obj(path, settings),
            "fbx" => Self::load_fbx(path, settings),
            _ => Err(anyhow::anyhow!("Unsupported mesh format: {}", extension)),
        }
    }
    
    fn load_gltf(path: &Path, settings: &MeshImportSettings) -> Result<Self> {
        let (document, buffers, _images) = gltf::import(path)?;
        
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        let mut submeshes = Vec::new();
        
        for mesh in document.meshes() {
            for primitive in mesh.primitives() {
                let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));
                
                let positions: Vec<[f32; 3]> = reader
                    .read_positions()
                    .ok_or_else(|| anyhow::anyhow!("Missing positions"))?
                    .collect();
                
                let normals: Vec<[f32; 3]> = if let Some(normals) = reader.read_normals() {
                    normals.collect()
                } else if settings.generate_normals {
                    vec![[0.0, 1.0, 0.0]; positions.len()]
                } else {
                    vec![[0.0, 1.0, 0.0]; positions.len()]
                };
                
                let uvs: Vec<[f32; 2]> = reader
                    .read_tex_coords(0)
                    .map(|uvs| uvs.into_f32().collect())
                    .unwrap_or_else(|| vec![[0.0, 0.0]; positions.len()]);
                
                let tangents: Vec<[f32; 4]> = if let Some(tangents) = reader.read_tangents() {
                    tangents.collect()
                } else if settings.generate_tangents {
                    Self::generate_tangents(&positions, &normals, &uvs)
                } else {
                    vec![[1.0, 0.0, 0.0, 1.0]; positions.len()]
                };
                
                let colors: Vec<[f32; 4]> = reader
                    .read_colors(0)
                    .map(|colors| colors.into_rgba_f32().collect())
                    .unwrap_or_else(|| vec![[1.0, 1.0, 1.0, 1.0]; positions.len()]);
                
                let start_index = vertices.len() as u32;
                
                for i in 0..positions.len() {
                    let mut position = positions[i];
                    let mut uv = uvs[i];
                    
                    // Apply scale
                    position[0] *= settings.scale;
                    position[1] *= settings.scale;
                    position[2] *= settings.scale;
                    
                    // Flip UVs if needed
                    if settings.flip_uvs {
                        uv[1] = 1.0 - uv[1];
                    }
                    
                    vertices.push(Vertex {
                        position,
                        normal: normals[i],
                        uv,
                        tangent: tangents[i],
                        color: colors[i],
                    });
                }
                
                let primitive_indices: Vec<u32> = reader
                    .read_indices()
                    .ok_or_else(|| anyhow::anyhow!("Missing indices"))?
                    .into_u32()
                    .collect();
                
                let index_start = indices.len() as u32;
                indices.extend(primitive_indices.iter().map(|i| i + start_index));
                
                submeshes.push(SubMesh {
                    index_start,
                    index_count: primitive_indices.len() as u32,
                    material_index: primitive.material().index().unwrap_or(0),
                });
            }
        }
        
        let bounds = BoundingBox::from_vertices(&vertices);
        
        let mut mesh = Self {
            vertices,
            indices,
            submeshes,
            bounds,
        };
        
        if settings.optimize {
            mesh.optimize();
        }
        
        Ok(mesh)
    }
    
    fn generate_tangents(
        positions: &[[f32; 3]],
        normals: &[[f32; 3]],
        uvs: &[[f32; 2]],
    ) -> Vec<[f32; 4]> {
        let mut tangents = vec![[0.0f32; 4]; positions.len()];
        
        // Simple tangent generation (simplified MikkTSpace)
        for i in 0..positions.len() {
            let normal = Vector3::from(normals[i]);
            
            // Use arbitrary tangent perpendicular to normal
            let tangent = if normal.y.abs() < 0.999 {
                Vector3::y().cross(&normal)
            } else {
                Vector3::x().cross(&normal)
            };
            
            let tangent = tangent.normalize();
            tangents[i] = [tangent.x, tangent.y, tangent.z, 1.0];
        }
        
        tangents
    }
    
    fn optimize(&mut self) {
        // Implement mesh optimization
        // - Remove duplicate vertices
        // - Optimize triangle order for cache
        // - Generate LODs
        
        use std::collections::HashMap;
        
        let mut vertex_map: HashMap<String, u32> = HashMap::new();
        let mut new_vertices = Vec::new();
        let mut new_indices = Vec::new();
        
        for &index in &self.indices {
            let vertex = self.vertices[index as usize];
            let key = format!("{:?}", vertex);
            
            let new_index = *vertex_map.entry(key).or_insert_with(|| {
                new_vertices.push(vertex);
                (new_vertices.len() - 1) as u32
            });
            
            new_indices.push(new_index);
        }
        
        self.vertices = new_vertices;
        self.indices = new_indices;
        
        log::info!("Optimized mesh: {} vertices, {} triangles", 
                   self.vertices.len(), 
                   self.indices.len() / 3);
    }
}

// OBJ loader
impl Mesh {
    fn load_obj(path: &Path, settings: &MeshImportSettings) -> Result<Self> {
        use tobj;
        
        let (models, _materials) = tobj::load_obj(
            path,
            &tobj::LoadOptions {
                single_index: true,
                triangulate: true,
                ..Default::default()
            },
        )?;
        
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        let mut submeshes = Vec::new();
        
        for model in models {
            let mesh = &model.mesh;
            let index_start = indices.len() as u32;
            
            // Convert to our vertex format
            for i in 0..mesh.positions.len() / 3 {
                let pos_idx = i * 3;
                let norm_idx = i * 3;
                let uv_idx = i * 2;
                
                let position = [
                    mesh.positions[pos_idx] * settings.scale,
                    mesh.positions[pos_idx + 1] * settings.scale,
                    mesh.positions[pos_idx + 2] * settings.scale,
                ];
                
                let normal = if !mesh.normals.is_empty() {
                    [
                        mesh.normals[norm_idx],
                        mesh.normals[norm_idx + 1],
                        mesh.normals[norm_idx + 2],
                    ]
                } else {
                    [0.0, 1.0, 0.0]
                };
                
                let uv = if !mesh.texcoords.is_empty() {
                    let mut uv = [
                        mesh.texcoords[uv_idx],
                        mesh.texcoords[uv_idx + 1],
                    ];
                    if settings.flip_uvs {
                        uv[1] = 1.0 - uv[1];
                    }
                    uv
                } else {
                    [0.0, 0.0]
                };
                
                vertices.push(Vertex {
                    position,
                    normal,
                    uv,
                    tangent: [1.0, 0.0, 0.0, 1.0],
                    color: [1.0, 1.0, 1.0, 1.0],
                });
            }
            
            indices.extend(mesh.indices.iter().map(|&i| i));
            
            submeshes.push(SubMesh {
                index_start,
                index_count: mesh.indices.len() as u32,
                material_index: mesh.material_id.unwrap_or(0),
            });
        }
        
        let bounds = BoundingBox::from_vertices(&vertices);
        
        Ok(Self {
            vertices,
            indices,
            submeshes,
            bounds,
        })
    }
    
    fn load_fbx(_path: &Path, _settings: &MeshImportSettings) -> Result<Self> {
        Err(anyhow::anyhow!("FBX import not yet implemented"))
    }
}
```

## Part 3: Importing Textures

### Texture Data Structure

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextureImportSettings {
    pub srgb: bool,
    pub generate_mipmaps: bool,
    pub compression: TextureCompression,
    pub filter_mode: FilterMode,
    pub wrap_mode: WrapMode,
    pub max_size: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TextureCompression {
    None,
    BC7,  // DXT5 alternative
    BC5,  // Normal maps
    BC4,  // Single channel
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum FilterMode {
    Nearest,
    Linear,
    Trilinear,
    Anisotropic(u8),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum WrapMode {
    Repeat,
    MirroredRepeat,
    ClampToEdge,
    ClampToBorder,
}

pub struct Texture {
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
    pub data: Vec<u8>,
    pub mip_levels: u32,
    pub gpu_texture: Option<wgpu::Texture>,
}

impl Asset for Texture {
    fn asset_type() -> AssetType {
        AssetType::Texture
    }
    
    fn load(path: &Path) -> Result<Self> {
        let settings = TextureImportSettings::default();
        Self::load_with_settings(path, &settings)
    }
    
    fn get_from_server(server: &AssetServer, id: AssetId) -> Option<Arc<Self>> {
        server.textures.read().get(&id).cloned()
    }
}

impl Texture {
    pub fn load_with_settings(path: &Path, settings: &TextureImportSettings) -> Result<Self> {
        use image::{ImageFormat, DynamicImage, GenericImageView};
        
        // Load image
        let img = image::open(path)?;
        
        // Resize if needed
        let img = if let Some(max_size) = settings.max_size {
            let (width, height) = img.dimensions();
            if width > max_size || height > max_size {
                img.resize(
                    max_size,
                    max_size,
                    image::imageops::FilterType::Lanczos3,
                )
            } else {
                img
            }
        } else {
            img
        };
        
        let (width, height) = img.dimensions();
        
        // Convert to RGBA
        let rgba = img.to_rgba8();
        let data = rgba.into_raw();
        
        // Calculate mip levels
        let mip_levels = if settings.generate_mipmaps {
            ((width.max(height) as f32).log2().floor() as u32) + 1
        } else {
            1
        };
        
        let format = if settings.srgb {
            wgpu::TextureFormat::Rgba8UnormSrgb
        } else {
            wgpu::TextureFormat::Rgba8Unorm
        };
        
        let mut texture = Self {
            width,
            height,
            format,
            data,
            mip_levels,
            gpu_texture: None,
        };
        
        if settings.generate_mipmaps {
            texture.generate_mipmaps();
        }
        
        Ok(texture)
    }
    
    fn generate_mipmaps(&mut self) {
        use image::{RgbaImage, imageops};
        
        let mut current_width = self.width;
        let mut current_height = self.height;
        let mut current_data = self.data.clone();
        
        for level in 1..self.mip_levels {
            current_width = (current_width / 2).max(1);
            current_height = (current_height / 2).max(1);
            
            let img = RgbaImage::from_raw(
                current_width * 2,
                current_height * 2,
                current_data,
            ).unwrap();
            
            let resized = imageops::resize(
                &img,
                current_width,
                current_height,
                imageops::FilterType::Lanczos3,
            );
            
            current_data = resized.into_raw();
            self.data.extend_from_slice(&current_data);
        }
    }
    
    pub fn upload_to_gpu(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) {
        let size = wgpu::Extent3d {
            width: self.width,
            height: self.height,
            depth_or_array_layers: 1,
        };
        
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Texture"),
            size,
            mip_level_count: self.mip_levels,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &self.data,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(4 * self.width),
                rows_per_image: Some(self.height),
            },
            size,
        );
        
        self.gpu_texture = Some(texture);
    }
}

impl Default for TextureImportSettings {
    fn default() -> Self {
        Self {
            srgb: true,
            generate_mipmaps: true,
            compression: TextureCompression::None,
            filter_mode: FilterMode::Trilinear,
            wrap_mode: WrapMode::Repeat,
            max_size: Some(2048),
        }
    }
}
```

## Part 4: Importing Audio

### Audio System

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioImportSettings {
    pub sample_rate: u32,
    pub channels: u16,
    pub compression: AudioCompression,
    pub streaming: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum AudioCompression {
    None,
    Vorbis,
    Opus,
}

pub struct AudioClip {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration: f32,
}

impl Asset for AudioClip {
    fn asset_type() -> AssetType {
        AssetType::Audio
    }
    
    fn load(path: &Path) -> Result<Self> {
        let settings = AudioImportSettings::default();
        Self::load_with_settings(path, &settings)
    }
    
    fn get_from_server(server: &AssetServer, id: AssetId) -> Option<Arc<Self>> {
        server.audio.read().get(&id).cloned()
    }
}

impl AudioClip {
    pub fn load_with_settings(path: &Path, settings: &AudioImportSettings) -> Result<Self> {
        let extension = path.extension()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("Invalid file extension"))?;
        
        match extension.to_lowercase().as_str() {
            "wav" => Self::load_wav(path, settings),
            "mp3" => Self::load_mp3(path, settings),
            "ogg" => Self::load_ogg(path, settings),
            _ => Err(anyhow::anyhow!("Unsupported audio format: {}", extension)),
        }
    }
    
    fn load_wav(path: &Path, settings: &AudioImportSettings) -> Result<Self> {
        use hound;
        
        let reader = hound::WavReader::open(path)?;
        let spec = reader.spec();
        
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => {
                reader.into_samples::<f32>()
                    .collect::<Result<Vec<_>, _>>()?
            }
            hound::SampleFormat::Int => {
                reader.into_samples::<i16>()
                    .map(|s| s.map(|s| s as f32 / i16::MAX as f32))
                    .collect::<Result<Vec<_>, _>>()?
            }
        };
        
        let duration = samples.len() as f32 / (spec.sample_rate * spec.channels as u32) as f32;
        
        Ok(Self {
            samples,
            sample_rate: spec.sample_rate,
            channels: spec.channels,
            duration,
        })
    }
    
    fn load_mp3(_path: &Path, _settings: &AudioImportSettings) -> Result<Self> {
        // Use minimp3 or similar
        Err(anyhow::anyhow!("MP3 import not yet implemented"))
    }
    
    fn load_ogg(path: &Path, settings: &AudioImportSettings) -> Result<Self> {
        use lewton::inside_ogg::OggStreamReader;
        
        let file = std::fs::File::open(path)?;
        let mut reader = OggStreamReader::new(file)?;
        
        let sample_rate = reader.ident_hdr.audio_sample_rate;
        let channels = reader.ident_hdr.audio_channels;
        
        let mut samples = Vec::new();
        
        while let Some(packet) = reader.read_dec_packet_generic::<Vec<Vec<f32>>>()? {
            // Interleave channels
            for i in 0..packet[0].len() {
                for channel in &packet {
                    samples.push(channel[i]);
                }
            }
        }
        
        let duration = samples.len() as f32 / (sample_rate * channels as u32) as f32;
        
        Ok(Self {
            samples,
            sample_rate,
            channels: channels as u16,
            duration,
        })
    }
}

impl Default for AudioImportSettings {
    fn default() -> Self {
        Self {
            sample_rate: 44100,
            channels: 2,
            compression: AudioCompression::Vorbis,
            streaming: false,
        }
    }
}
```

## Part 5: Hot-Reloading System

### File Watcher

```rust
use notify::{Watcher, RecursiveMode, DebouncedEvent};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

pub struct AssetWatcher {
    _watcher: notify::RecommendedWatcher,
    receiver: Receiver<DebouncedEvent>,
}

impl AssetWatcher {
    pub fn new(asset_root: &Path) -> Result<Self> {
        let (tx, receiver) = channel();
        
        let mut watcher = notify::watcher(tx, Duration::from_millis(500))?;
        watcher.watch(asset_root, RecursiveMode::Recursive)?;
        
        Ok(Self {
            _watcher: watcher,
            receiver,
        })
    }
    
    pub fn poll_events(&self) -> Vec<PathBuf> {
        let mut changed_files = Vec::new();
        
        while let Ok(event) = self.receiver.try_recv() {
            match event {
                DebouncedEvent::Write(path) |
                DebouncedEvent::Create(path) |
                DebouncedEvent::Rename(_, path) => {
                    changed_files.push(path);
                }
                _ => {}
            }
        }
        
        changed_files
    }
}

impl AssetServer {
    pub fn enable_hot_reload(&mut self) -> Result<()> {
        let watcher = AssetWatcher::new(&self.asset_root)?;
        self.watcher = Some(watcher);
        log::info!("Asset hot-reloading enabled");
        Ok(())
    }
    
    pub fn update_hot_reload(&mut self) -> Result<()> {
        if let Some(watcher) = &self.watcher {
            let changed_files = watcher.poll_events();
            
            for path in changed_files {
                if let Some(id) = self.find_asset_by_path(&path) {
                    log::info!("Reloading asset: {:?}", path);
                    self.reload_asset_by_id(id)?;
                }
            }
        }
        
        Ok(())
    }
    
    fn find_asset_by_path(&self, path: &Path) -> Option<AssetId> {
        let metadata = self.metadata.read();
        metadata.iter()
            .find(|(_, meta)| meta.path == path)
            .map(|(id, _)| *id)
    }
    
    fn reload_asset_by_id(&mut self, id: AssetId) -> Result<()> {
        let metadata = self.metadata.read().get(&id).cloned();
        
        if let Some(metadata) = metadata {
            self.reload_asset(&metadata)?;
        }
        
        Ok(())
    }
    
    fn reload_asset(&mut self, metadata: &AssetMetadata) -> Result<()> {
        match metadata.asset_type {
            AssetType::Mesh => {
                let mesh = Mesh::load(&metadata.path)?;
                self.meshes.write().insert(metadata.id, Arc::new(mesh));
            }
            AssetType::Texture => {
                let texture = Texture::load(&metadata.path)?;
                self.textures.write().insert(metadata.id, Arc::new(texture));
            }
            AssetType::Material => {
                let material = Material::load(&metadata.path)?;
                self.materials.write().insert(metadata.id, Arc::new(material));
            }
            AssetType::Audio => {
                let audio = AudioClip::load(&metadata.path)?;
                self.audio.write().insert(metadata.id, Arc::new(audio));
            }
            _ => {}
        }
        
        log::info!("Reloaded {:?}", metadata.path);
        Ok(())
    }
}
```

## Part 6: Asset Organization

### Directory Structure

```
assets/
├── meshes/
│   ├── characters/
│   │   ├── player.glb
│   │   └── enemy.glb
│   ├── props/
│   │   ├── crate.glb
│   │   └── barrel.glb
│   └── environment/
│       ├── building.glb
│       └── tree.glb
├── textures/
│   ├── characters/
│   │   ├── player_albedo.png
│   │   ├── player_normal.png
│   │   └── player_metallic_roughness.png
│   ├── environment/
│   │   └── grass.png
│   └── ui/
│       ├── button.png
│       └── icon.png
├── materials/
│   ├── character.mat
│   ├── environment.mat
│   └── pbr_default.mat
├── audio/
│   ├── music/
│   │   └── theme.ogg
│   ├── sfx/
│   │   ├── footstep.wav
│   │   └── explosion.wav
│   └── voice/
│       └── dialogue.ogg
└── shaders/
    ├── pbr.wgsl
    └── custom.wgsl
```

### Asset Database

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AssetDatabase {
    pub assets: HashMap<AssetId, AssetEntry>,
    pub collections: HashMap<String, AssetCollection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetEntry {
    pub id: AssetId,
    pub path: PathBuf,
    pub asset_type: AssetType,
    pub tags: Vec<String>,
    pub dependencies: Vec<AssetId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetCollection {
    pub name: String,
    pub assets: Vec<AssetId>,
}

impl AssetDatabase {
    pub fn scan_directory(root: &Path) -> Result<Self> {
        let mut database = Self {
            assets: HashMap::new(),
            collections: HashMap::new(),
        };
        
        database.scan_recursive(root, root)?;
        database.save(root.join("asset_database.json"))?;
        
        Ok(database)
    }
    
    fn scan_recursive(&mut self, root: &Path, current: &Path) -> Result<()> {
        for entry in std::fs::read_dir(current)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                self.scan_recursive(root, &path)?;
            } else {
                if let Some(asset_type) = Self::determine_asset_type(&path) {
                    let id = AssetId::from_path(&path);
                    let relative_path = path.strip_prefix(root)?.to_path_buf();
                    
                    self.assets.insert(id, AssetEntry {
                        id,
                        path: relative_path,
                        asset_type,
                        tags: Vec::new(),
                        dependencies: Vec::new(),
                    });
                }
            }
        }
        
        Ok(())
    }
    
    fn determine_asset_type(path: &Path) -> Option<AssetType> {
        let ext = path.extension()?.to_str()?;
        
        match ext.to_lowercase().as_str() {
            "gltf" | "glb" | "obj" | "fbx" => Some(AssetType::Mesh),
            "png" | "jpg" | "jpeg" | "tga" | "bmp" => Some(AssetType::Texture),
            "mat" => Some(AssetType::Material),
            "wav" | "mp3" | "ogg" => Some(AssetType::Audio),
            "wgsl" | "glsl" => Some(AssetType::Shader),
            _ => None,
        }
    }
    
    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }
    
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let json = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&json)?)
    }
}
```

## Part 7: Custom Asset Types

### Creating a Custom Asset

```rust
// Example: Level asset type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Level {
    pub name: String,
    pub entities: Vec<EntityData>,
    pub lighting: LightingSettings,
    pub physics: PhysicsSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityData {
    pub name: String,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub scale: [f32; 3],
    pub mesh: Option<AssetId>,
    pub material: Option<AssetId>,
    pub components: Vec<ComponentData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ComponentData {
    RigidBody { mass: f32, kinematic: bool },
    Light { color: [f32; 3], intensity: f32 },
    Script { script_name: String, parameters: HashMap<String, serde_json::Value> },
}

impl Asset for Level {
    fn asset_type() -> AssetType {
        AssetType::Custom("Level".to_string())
    }
    
    fn load(path: &Path) -> Result<Self> {
        let json = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&json)?)
    }
    
    fn get_from_server(server: &AssetServer, id: AssetId) -> Option<Arc<Self>> {
        // Custom storage required
        None
    }
}

impl Level {
    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }
}
```

## Conclusion

You now have a complete understanding of Pulsar's asset pipeline! You've learned:

- Asset system architecture
- AssetHandle system for safe references
- Importing meshes from GLTF/OBJ
- Texture loading with mipmaps
- Audio clip importing
- Hot-reload implementation
- Asset organization strategies
- Custom asset type creation

### Next Steps

1. Implement asset streaming for large worlds
2. Add asset compression pipeline
3. Create asset preview generation
4. Build asset browser UI
5. Optimize loading performance

### Resources

- [Asset Pipeline Docs](https://docs.pulsar-edit.dev/assets)
- [GLTF Specification](https://www.khronos.org/gltf/)
- [Texture Optimization Guide](https://docs.pulsar-edit.dev/textures)
- [Audio System API](https://docs.pulsar-edit.dev/audio)

Happy asset management!
