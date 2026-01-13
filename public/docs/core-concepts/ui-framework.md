---
title: UI Framework (GPUI)
description: Deep dive into Pulsar's GPU-accelerated UI framework
category: core-concepts
lastUpdated: '2026-01-12'
tags:
  - ui
  - gpui
  - rendering
  - views
  - components
related:
  - core-concepts/architecture
  - core-concepts/rendering-pipeline
  - guides/creating-plugins
position: 3
icon: LayoutTemplate
---

# UI Framework (GPUI)

GPUI is Zed's custom UI framework, and it's unlike anything you've probably worked with before. It's not React, it's not immediate mode, and it's definitely not a traditional retained-mode GUI toolkit. Instead, GPUI is a hybrid approach that combines the best ideas from modern UI frameworks with the performance requirements of a professional game engine editor.

Let me explain why we built it this way, how it works, and—most importantly—how you actually use it to build editor interfaces.

## Why GPUI Exists

You might be wondering: why build a custom UI framework when mature options like egui, Iced, or even web technologies exist? The answer comes down to our specific requirements:

**GPU acceleration isn't optional** - Editor UIs need to render smoothly at 60+ FPS while updating constantly. Project trees with thousands of files, code editors with syntax highlighting, property panels with live updates—all of this needs to be fast. GPUI renders everything using the GPU, which means complex UIs stay fluid even under heavy load.

**Rust-native integration** - We need tight integration with Pulsar's Rust codebase. No FFI boundaries, no serialization overhead, no impedance mismatch. GPUI is Rust all the way down, which means zero-cost abstractions and compile-time safety.

**Plugin accessibility** - Plugins need full access to the UI toolkit. Not a restricted subset, not a second-class API—the same powerful primitives the editor itself uses. GPUI makes this possible because it's designed as a library, not a framework.

**Predictable performance** - We can't tolerate frame drops or layout thrashing. GPUI's architecture ensures that UI updates are efficient and predictable, with explicit control over what recomputes when data changes.

## Core Concepts

GPUI introduces several key concepts that work together to create performant, maintainable UIs. Let's break them down one at a time.

### Entities

Everything in GPUI starts with entities. An entity is just an ID—a lightweight handle that refers to some piece of state managed by the framework. Think of it like a database primary key, except for UI components.

```rust
// An entity is just a type-safe ID
struct EditorEntity(EntityId);

// Entities are cheap to copy and pass around
let editor1 = EditorEntity(EntityId::new());
let editor2 = editor1; // This is fine, just copying an ID
```

Why use entities instead of direct references or smart pointers? Several reasons:

**Stable identity** - An entity ID never changes, even if the underlying data moves in memory. This makes them perfect for building relationships between UI components.

**Weak references by default** - When you hold an entity ID, you're not keeping anything alive. The component can be destroyed, and you'll find out when you try to use the ID. This prevents reference cycles and makes cleanup straightforward.

**Type-safe lookups** - Each entity type is distinct, so you can't accidentally pass a `PanelEntity` where a `WindowEntity` is expected. The type system enforces correctness.

Here's a more realistic example from the editor:

```rust
// Define an entity type for project trees
#[derive(Clone, Copy)]
pub struct ProjectTreeEntity(EntityId);

// Use it in your state
pub struct WorkspaceState {
    left_sidebar: Option<ProjectTreeEntity>,
    right_sidebar: Option<PropertyPanelEntity>,
    active_editor: Option<EditorEntity>,
}

// Entities make relationships explicit and type-safe
impl WorkspaceState {
    pub fn open_file_in_active_editor(&mut self, cx: &mut Context) {
        if let Some(editor) = self.active_editor {
            // Look up the actual editor component using the entity ID
            if let Some(editor_ref) = cx.entity_mut(editor) {
                editor_ref.load_file("assets/level.ron");
            }
        }
    }
}
```

### Views

Views are the visual building blocks of your UI. A view knows how to render itself and respond to user interaction. Every visible element—buttons, text labels, editor panels, tree views—is implemented as a view.

But here's what makes GPUI views different from traditional UI components: they're explicitly composed through a builder pattern, and they're designed to be stateless during rendering.

```rust
pub struct ButtonView {
    label: String,
    enabled: bool,
    on_click: Option<Box<dyn Fn(&mut Context)>>,
}

impl View for ButtonView {
    fn render(&self, cx: &mut RenderContext) -> Element {
        div()
            .padding(8)
            .border_radius(4)
            .background(if self.enabled { 
                Color::PRIMARY 
            } else { 
                Color::DISABLED 
            })
            .on_click(cx, |cx| {
                if let Some(handler) = &self.on_click {
                    handler(cx);
                }
            })
            .child(text(&self.label))
    }
}
```

Notice a few things about this example:

**Declarative structure** - We describe what the UI should look like, not how to draw it. GPUI figures out the actual rendering.

**Method chaining** - The builder pattern makes view construction readable and fluent. You can see the structure at a glance.

**Conditional styling** - The background color changes based on state, but this is just a simple if expression. No special templating language needed.

**Event handlers** - The `on_click` handler is attached declaratively, and it receives the context needed to mutate state.

### Contexts

Contexts are how GPUI manages state and side effects. Every operation that reads or modifies UI state goes through a context. There are several types, each with specific capabilities:

**RenderContext** - Used during the render pass. You can read state and build the view tree, but you can't modify anything. This ensures rendering is pure and predictable.

**EventContext** - Used when handling user input. You can modify state, trigger actions, and schedule UI updates. This is where mutations happen.

**LayoutContext** - Used during layout computation. You can query dimensions and positions, but not modify the view tree. This keeps layout stable.

Here's how contexts enable safe state management:

```rust
pub struct FileTreeView {
    entity: FileTreeEntity,
}

impl View for FileTreeView {
    fn render(&self, cx: &mut RenderContext) -> Element {
        // During rendering, we can only read state
        let state = cx.entity(self.entity).unwrap();
        
        div()
            .flex_column()
            .children(state.files.iter().map(|file| {
                div()
                    .padding(4)
                    .on_click(cx, {
                        let file_path = file.path.clone();
                        move |event_cx| {
                            // Event handlers get an EventContext,
                            // which allows mutations
                            event_cx.open_editor(file_path.clone());
                        }
                    })
                    .child(text(&file.name))
            }))
    }
}
```

The context types prevent entire classes of bugs:

- You can't accidentally mutate state during rendering (which would invalidate the render pass)
- You can't trigger layout during event handling (which would cause recursive updates)
- You can't render during layout computation (which would create circular dependencies)

The Rust type system enforces these rules at compile time. If your code compiles, the context usage is correct.

### The Render Loop

Understanding GPUI's render loop helps you write efficient UIs. Here's what happens every frame:

**1. Event Processing**

```rust
// User clicks a button
button.on_click(|cx| {
    // Modify state
    cx.entity_mut(editor).set_selection(10..20);
    
    // Mark entities as dirty
    cx.notify(editor); // This editor needs to re-render
});
```

Events are processed in order, and each handler can modify state and mark entities as needing updates.

**2. Update Passes**

```rust
// For each dirty entity, call its update method
impl Entity for EditorEntity {
    fn update(&mut self, cx: &mut Context) {
        // Recompute derived state
        self.visible_lines = self.compute_visible_range();
        
        // Request layout if needed
        if self.size_changed {
            cx.request_layout(self.entity());
        }
    }
}
```

Updates happen in dependency order—if entity A depends on entity B's state, B updates first.

**3. Layout Computation**

```rust
// GPUI computes layout using flexbox
div()
    .flex_row()
    .width(Percent(100))
    .children(vec![
        // Left sidebar: fixed width
        div().width(Pixels(250)),
        
        // Main content: fills remaining space
        div().flex_grow(1.0),
        
        // Right sidebar: fixed width
        div().width(Pixels(300)),
    ])
```

Layout is computed once per frame using a flexbox-like algorithm. This is similar to CSS flexbox, so the mental model should be familiar.

**4. Rendering**

```rust
// Views render themselves into a command buffer
fn render(&self, cx: &mut RenderContext) -> Element {
    // This builds a tree of rendering commands
    div()
        .background(Color::BACKGROUND)
        .child(text("Hello, world!"))
        // -> Converted to GPU draw calls
}
```

The render tree is converted to GPU commands and submitted to the graphics API. This all happens on the GPU, which is why GPUI can render complex UIs smoothly.

## Layout System

GPUI's layout system is inspired by CSS flexbox but simplified and optimized for editor UIs. Let's look at how it works in practice.

### Box Model

Every element has a box model with padding, border, and margin:

```rust
div()
    .margin(Pixels(10))        // Space outside the element
    .border(Pixels(2))         // Border around the content
    .padding(Pixels(8))        // Space inside the element
    .child(text("Content"))    // The actual content
```

This works exactly like CSS, but with explicit units. You can use:

- `Pixels(n)` - Absolute pixel values
- `Percent(n)` - Percentage of parent size
- `Auto` - Let the layout engine decide

### Flexbox Layout

The primary layout mode is flexbox:

```rust
// Horizontal layout
div()
    .flex_row()
    .justify_content(JustifyContent::SpaceBetween)
    .align_items(AlignItems::Center)
    .children(vec![
        div().child(text("Left")),
        div().child(text("Middle")),
        div().child(text("Right")),
    ])

// Vertical layout
div()
    .flex_column()
    .gap(Pixels(8))  // Space between children
    .children(vec![
        div().height(Pixels(50)),
        div().flex_grow(1.0),  // Takes remaining space
        div().height(Pixels(50)),
    ])
```

Flexbox handles most layout needs without requiring absolute positioning or manual calculations.

### Absolute Positioning

Sometimes you need precise control:

```rust
div()
    .relative()  // Establish positioning context
    .child(
        div()
            .absolute()
            .top(Pixels(10))
            .right(Pixels(10))
            .child(text("Overlay"))
    )
```

Absolute positioning removes an element from the normal flow and positions it relative to its nearest positioned ancestor.

### Real Example: Editor Panel Layout

Here's how the main editor interface is laid out:

```rust
fn render_workspace(&self, cx: &mut RenderContext) -> Element {
    div()
        .size_full()  // Fill the window
        .flex_column()
        .children(vec![
            // Title bar: fixed height
            self.render_title_bar(cx)
                .height(Pixels(40)),
            
            // Main content: flexible
            div()
                .flex_grow(1.0)
                .flex_row()
                .children(vec![
                    // Left sidebar: resizable
                    self.render_left_sidebar(cx)
                        .width(Pixels(self.left_sidebar_width)),
                    
                    // Editor area: takes remaining space
                    self.render_editor_area(cx)
                        .flex_grow(1.0),
                    
                    // Right sidebar: resizable
                    self.render_right_sidebar(cx)
                        .width(Pixels(self.right_sidebar_width)),
                ]),
            
            // Status bar: fixed height
            self.render_status_bar(cx)
                .height(Pixels(30)),
        ])
}
```

This creates the classic IDE layout with very little code, and it automatically handles window resizing and panel adjustments.

## Styling System

GPUI's styling is explicit and type-safe. Instead of CSS classes or style sheets, you apply styles directly in code:

### Colors

```rust
// Define colors with type safety
const BACKGROUND: Color = Color::rgb(0x1e, 0x1e, 0x1e);
const FOREGROUND: Color = Color::rgb(0xd4, 0xd4, 0xd4);
const ACCENT: Color = Color::rgb(0x00, 0x7a, 0xcc);

div()
    .background(BACKGROUND)
    .color(FOREGROUND)
    .border_color(ACCENT)
```

Colors support RGB, RGBA, HSL, and HSLA formats. They're validated at compile time, so typos are caught immediately.

### Typography

```rust
text("Hello, world!")
    .font_size(Pixels(14))
    .font_weight(FontWeight::MEDIUM)
    .font_family("SF Pro Display")
    .line_height(Pixels(20))
```

Text styling is straightforward and supports all standard typography properties.

### Visual Effects

```rust
div()
    .border_radius(Pixels(4))       // Rounded corners
    .shadow(Shadow::default())       // Drop shadow
    .opacity(0.9)                    // Transparency
    .backdrop_blur(Pixels(10))       // Blur effect
```

Effects are GPU-accelerated, so they're fast even with many elements.

## Event System

GPUI's event system is straightforward: events flow from the window down through the view tree, and handlers can stop propagation.

### Mouse Events

```rust
div()
    .on_mouse_down(cx, |event, cx| {
        println!("Mouse button pressed at {:?}", event.position);
    })
    .on_mouse_up(cx, |event, cx| {
        println!("Mouse button released");
    })
    .on_mouse_move(cx, |event, cx| {
        println!("Mouse moved to {:?}", event.position);
    })
    .on_hover(cx, |is_hovering, cx| {
        if is_hovering {
            println!("Mouse entered");
        } else {
            println!("Mouse left");
        }
    })
```

### Keyboard Events

```rust
div()
    .on_key_down(cx, |event, cx| {
        if event.key == Key::Enter && event.modifiers.ctrl {
            // Handle Ctrl+Enter
            cx.dispatch_action(Action::Save);
            return true; // Stop propagation
        }
        false // Continue propagation
    })
```

### Click Events

```rust
button()
    .on_click(cx, |cx| {
        cx.notify(self.entity());
        cx.emit(Event::ButtonPressed);
    })
```

### Custom Events

You can define your own event types:

```rust
#[derive(Debug, Clone)]
pub enum EditorEvent {
    SelectionChanged { from: usize, to: usize },
    ContentModified,
    FileSaved { path: PathBuf },
}

// Emit custom events
cx.emit(EditorEvent::SelectionChanged { from: 10, to: 20 });

// Subscribe to events from entities
cx.subscribe(editor_entity, |event, cx| {
    match event {
        EditorEvent::SelectionChanged { from, to } => {
            println!("Selection: {}..{}", from, to);
        }
        _ => {}
    }
});
```

## Integration with the Editor

GPUI isn't just a UI framework—it's deeply integrated with Pulsar's editor functionality. Let's look at some real patterns from the codebase.

### Editor Panels

Panels are a first-class concept in GPUI. They're dockable, resizable UI regions that contain views:

```rust
pub struct FileExplorerPanel {
    entity: PanelEntity,
    tree_view: ProjectTreeView,
    filter_text: String,
}

impl Panel for FileExplorerPanel {
    fn title(&self) -> String {
        "File Explorer".to_string()
    }
    
    fn icon(&self) -> Icon {
        Icon::Files
    }
    
    fn render(&self, cx: &mut RenderContext) -> Element {
        div()
            .flex_column()
            .children(vec![
                // Search box at top
                input()
                    .placeholder("Filter files...")
                    .value(&self.filter_text)
                    .on_change(cx, |text, cx| {
                        cx.update_filter(text);
                    }),
                
                // Tree view fills remaining space
                self.tree_view.render(cx)
                    .flex_grow(1.0),
            ])
    }
}
```

Panels can be opened, closed, moved between regions, and have their state persisted automatically.

### Context Menus

Context menus are handled through the menu system:

```rust
div()
    .on_right_click(cx, |event, cx| {
        cx.show_context_menu(
            event.position,
            vec![
                MenuItem::action("Open", Action::Open),
                MenuItem::action("Rename", Action::Rename),
                MenuItem::separator(),
                MenuItem::action("Delete", Action::Delete)
                    .danger(), // Red styling
            ],
        );
    })
```

Menus are styled consistently and support keyboard navigation automatically.

### Tooltips

Tooltips are simple to add:

```rust
button()
    .tooltip(cx, |cx| {
        div()
            .padding(8)
            .child(text("Click to save the current file"))
    })
```

GPUI handles positioning, delays, and hiding automatically.

## Performance Considerations

GPUI is designed for performance, but you still need to write efficient code. Here are the key patterns:

### Minimize Re-renders

Only mark entities as dirty when their visible state actually changes:

```rust
impl EditorEntity {
    pub fn insert_text(&mut self, pos: usize, text: &str, cx: &mut Context) {
        self.buffer.insert(pos, text);
        
        // Only notify if the visible region changed
        if self.is_visible(pos) {
            cx.notify(self.entity());
        }
    }
}
```

### Batch Updates

Group related changes together to avoid multiple layout passes:

```rust
cx.batch(|cx| {
    // Multiple changes, single layout pass
    cx.entity_mut(editor).set_selection(10..20);
    cx.entity_mut(editor).scroll_to_line(15);
    cx.entity_mut(editor).highlight_range(10..20);
});
```

### Virtualization

For large lists, only render visible items:

```rust
pub struct VirtualList {
    items: Vec<String>,
    scroll_offset: f32,
    item_height: f32,
}

impl View for VirtualList {
    fn render(&self, cx: &mut RenderContext) -> Element {
        let visible_count = (cx.viewport_height() / self.item_height).ceil() as usize;
        let start_index = (self.scroll_offset / self.item_height) as usize;
        let end_index = (start_index + visible_count).min(self.items.len());
        
        div()
            .height(Pixels(self.items.len() as f32 * self.item_height))
            .children(
                self.items[start_index..end_index]
                    .iter()
                    .enumerate()
                    .map(|(i, item)| {
                        let offset = (start_index + i) as f32 * self.item_height;
                        div()
                            .absolute()
                            .top(Pixels(offset))
                            .child(text(item))
                    })
            )
    }
}
```

This pattern allows smooth scrolling through millions of items.

## Conclusion

GPUI gives you the tools to build professional editor UIs with native performance and Rust's safety guarantees. The key concepts—entities, views, contexts, and events—work together to create a framework that's both powerful and predictable.

As you build with GPUI, remember:

- **Entities** provide stable identity and weak references
- **Views** describe what the UI looks like, not how to render it
- **Contexts** enforce safe state management through the type system
- **Events** flow predictably through the view hierarchy
- **Layout** uses familiar flexbox semantics
- **Styling** is explicit and type-safe

The learning curve exists, but once you internalize these patterns, building complex UIs becomes straightforward. And unlike traditional UI frameworks, you get native performance and full Rust integration for free.
