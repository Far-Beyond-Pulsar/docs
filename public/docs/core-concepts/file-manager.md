---
title: File Manager
description: File browser and asset management UI
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - files
  - browser
  - assets
  - drag-drop
related:
  - core-concepts/engine-filesystem
  - core-concepts/plugin-system-impl
position: 15
icon: FolderOpen
---

# File Manager

The file manager provides a visual file browser for navigating projects, managing assets, and opening files in editors. It integrates with the plugin system to show file type icons and provide context menus. The implementation is in `ui-crates/ui_file_manager/`.

## Architecture

The file manager has several components:

- **FileManagerDrawer** - Main panel in the dock
- **FolderNode** - Tree structure representing directory hierarchy
- **FileOperations** - Backend for create/rename/delete operations
- **Drag and drop** - Support for moving files by dragging
- **Context menus** - Right-click actions for files and folders

## FileManagerDrawer

The main component:

```rust
pub struct FileManagerDrawer {
    project_path: Option<PathBuf>,
    folder_tree: Option<FolderNode>,
    selected_folder: Option<PathBuf>,
    selected_items: HashSet<PathBuf>,
    operations: FileOperations,
    drag_state: DragState,
    view_mode: ViewMode,
    sort_by: SortBy,
    sort_order: SortOrder,
    show_hidden_files: bool,
    renaming_item: Option<PathBuf>,
    registered_file_types: Vec<FileTypeDefinition>,
    search_query: String,
    clipboard: Option<(Vec<PathBuf>, bool)>,
}
```

This maintains the current directory, selection state, view preferences, and clipboard.

## Creating a File Manager

Create a new file manager panel:

```rust
let file_manager = cx.new(|cx| {
    FileManagerDrawer::new(Some(project_root), window, cx)
});
```

The project path is the root of the file tree. If None, no files are displayed.

## Folder Tree

The `FolderNode` represents a directory:

```rust
pub struct FolderNode {
    pub path: PathBuf,
    pub name: String,
    pub children: Vec<FolderNode>,
    pub is_expanded: bool,
    pub is_loaded: bool,
}
```

The tree is lazily loaded - children are only read when a folder is expanded.

Building a tree:

```rust
impl FolderNode {
    pub fn from_path(path: &Path) -> Option<Self> {
        if !path.is_dir() {
            return None;
        }
        
        let name = path.file_name()?.to_string_lossy().to_string();
        Some(FolderNode {
            path: path.to_path_buf(),
            name,
            children: Vec::new(),
            is_expanded: false,
            is_loaded: false,
        })
    }
}
```

## View Modes

The file manager supports two view modes:

```rust
pub enum ViewMode {
    Grid,  // Icon grid layout
    List,  // Detailed list layout
}
```

Grid mode shows file icons in a grid. List mode shows a table with name, size, and modification date.

## Sorting

Files can be sorted by various criteria:

```rust
pub enum SortBy {
    Name,
    Type,
    Size,
    Modified,
}

pub enum SortOrder {
    Ascending,
    Descending,
}
```

Clicking column headers in list mode changes the sort.

## Selection

The file manager tracks selected items:

```rust
selected_items: HashSet<PathBuf>
```

Multiple selection is supported with Ctrl+Click and Shift+Click. Selected items are highlighted.

## File Operations

The `FileOperations` type handles file system changes:

```rust
pub struct FileOperations {
    project_root: Option<PathBuf>,
}

impl FileOperations {
    pub fn create_file(&self, path: &Path) -> Result<()> {
        std::fs::write(path, "")?;
        Ok(())
    }
    
    pub fn create_folder(&self, path: &Path) -> Result<()> {
        std::fs::create_dir_all(path)?;
        Ok(())
    }
    
    pub fn rename(&self, from: &Path, to: &Path) -> Result<()> {
        std::fs::rename(from, to)?;
        Ok(())
    }
    
    pub fn delete(&self, path: &Path) -> Result<()> {
        if path.is_dir() {
            std::fs::remove_dir_all(path)?;
        } else {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}
```

These operations update the filesystem and trigger UI updates.

## Creating Assets

The file manager integrates with the plugin system to create typed assets:

```rust
actions!(file_manager, [CreateAsset]);

pub struct CreateAsset {
    pub display_name: String,
    pub extension: String,
    pub default_content: serde_json::Value,
}
```

Right-clicking a folder shows "New..." menu with registered file types from plugins.

## Renaming

Double-clicking a file enters rename mode:

```rust
fn start_rename(&mut self, path: &Path, cx: &mut Context<Self>) {
    self.renaming_item = Some(path.to_path_buf());
    
    // Set input to current name
    let name = path.file_name().unwrap().to_string_lossy();
    self.rename_input_state.update(cx, |input, cx| {
        input.set_text(&name, cx);
        input.select_all();
    });
    
    cx.focus(&self.rename_input_state);
}
```

Pressing Enter commits the rename, Escape cancels.

## Context Menus

Right-clicking shows context-sensitive menus:

```rust
fn render_context_menu(&self, path: &Path) -> PopupMenu {
    let mut menu = PopupMenu::new("file-context");
    
    if path.is_dir() {
        menu = menu
            .menu("New File", Box::new(CreateFile))
            .menu("New Folder", Box::new(CreateFolder))
            .separator();
    }
    
    menu = menu
        .menu("Rename", Box::new(Rename))
        .menu("Delete", Box::new(Delete))
        .separator()
        .menu("Copy Path", Box::new(CopyPath));
    
    menu
}
```

Actions are dispatched when menu items are clicked.

## Drag and Drop

Files can be dragged to move them:

```rust
pub enum DragState {
    None,
    Dragging { paths: Vec<PathBuf> },
    DragOver { target: PathBuf },
}
```

The drag state tracks what's being dragged and where it would drop:

1. Start drag on selected files
2. Hover over folders shows drop target highlight
3. Drop moves files to target folder

This works for both moving and copying (with modifier keys).

## Search

The file manager has folder search and file filtering:

```rust
search_query: String,           // Search folder names
file_filter_query: String,      // Filter files by name
```

Search is incremental - typing filters the tree in real-time.

## Hidden Files

Hidden files (starting with `.`) can be toggled:

```rust
show_hidden_files: bool
```

When false, dotfiles are filtered from the display.

## File Type Icons

File types registered through plugins provide icons:

```rust
registered_file_types: Vec<FileTypeDefinition>
```

The file manager looks up file extensions and displays the appropriate icon and color.

## Clipboard

The clipboard supports copy/cut/paste:

```rust
clipboard: Option<(Vec<PathBuf>, bool)>  // (paths, is_cut)
```

Cut files are shown dimmed. Pasting moves cut files or copies copied files.

## Integration with Editors

Double-clicking a file emits an event:

```rust
pub struct FileSelected {
    pub path: PathBuf,
}
```

The main application subscribes and opens the file in an editor:

```rust
cx.subscribe(&file_manager, |_, _, event: &FileSelected, cx| {
    let editor = plugin_manager.create_editor_for_file(&event.path, window, cx)?;
    workspace.add_editor(editor);
}).detach();
```

## Refreshing

The file tree can be refreshed to detect external changes:

```rust
fn refresh(&mut self, cx: &mut Context<Self>) {
    if let Some(path) = &self.project_path {
        self.folder_tree = FolderNode::from_path(path);
        cx.notify();
    }
}
```

This rescans the filesystem and rebuilds the tree.

## Performance

For large directories:
- Lazy loading (only load visible folders)
- Virtual scrolling (only render visible items)
- Debounced filtering (don't filter on every keystroke)

This keeps the UI responsive even with thousands of files.

## Limitations

Current implementation:
- No file watching (external changes not detected automatically)
- No undo for file operations
- No advanced search (regex, content search)
- No file previews/thumbnails
- No bulk operations UI

Future improvements:
- Integration with engine_fs file watchers
- Undo/redo stack for file operations
- Advanced search with filters
- Image/model previews
- Multi-select operations panel
