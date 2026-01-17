---
title: History System
description: Undo/redo functionality for state management
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - undo
  - redo
  - history
  - state
related:
  - core-concepts/ui-framework
position: 19
icon: History
---

# History System

The history system provides undo/redo functionality for managing state changes. It's used throughout Pulsar for text editing, blueprint modifications, and other reversible operations. The implementation is in `crates/ui/src/history.rs`.

## What It Provides

The history system provides:
- Undo/redo stack management
- Configurable history size limits
- Change grouping by time interval
- Unique history (no duplicate entries)
- Version tracking for changes

## HistoryItem Trait

Items stored in history must implement `HistoryItem`:

```rust
pub trait HistoryItem: Clone + PartialEq {
    fn version(&self) -> usize;
    fn set_version(&mut self, version: usize);
}
```

The version is used for grouping related changes.

## History Structure

The history manager:

```rust
pub struct History<I: HistoryItem> {
    undos: Vec<I>,
    redos: Vec<I>,
    last_changed_at: Instant,
    version: usize,
    ignore: bool,
    max_undo: usize,
    group_interval: Option<Duration>,
    unique: bool,
}
```

Undos are items that can be undone. Redos are items that can be redone (after undo).

## Creating History

Create a new history:

```rust
let mut history = History::new();
```

With configuration:

```rust
let mut history = History::new()
    .max_undo(500)                          // Keep last 500 changes
    .group_interval(Duration::from_millis(300))  // Group changes within 300ms
    .unique();                              // No duplicate entries
```

## Pushing Changes

Add a change to history:

```rust
history.push(item);
```

This:
1. Increments version if enough time passed
2. Removes oldest change if at max_undo limit
3. Optionally removes duplicates
4. Adds item to undo stack
5. Clears redo stack (can't redo after new change)

## Version Grouping

Changes are grouped by version:

```rust
// Fast typing - same version
history.push(state1);  // version 1
std::thread::sleep(Duration::from_millis(50));
history.push(state2);  // version 1 (within 300ms)

// Pause - new version
std::thread::sleep(Duration::from_millis(400));
history.push(state3);  // version 2
```

Undo undoes all changes in a version.

## Undoing

Undo the last change:

```rust
if let Some(item) = history.undo() {
    // Restore this state
}
```

Returns `None` if nothing to undo.

## Redoing

Redo the last undone change:

```rust
if let Some(item) = history.redo() {
    // Restore this state
}
```

Returns `None` if nothing to redo.

## Checking State

Check if undo/redo available:

```rust
if history.can_undo() {
    // Enable undo button
}

if history.can_redo() {
    // Enable redo button
}
```

## Clearing History

Clear all history:

```rust
history.clear();
```

This empties both undo and redo stacks.

## Ignore Mode

Temporarily disable history:

```rust
history.ignore = true;
// Make changes that won't be recorded
history.ignore = false;
```

Useful for programmatic changes that shouldn't be undoable.

## Example: Text Input

Text input uses history for undo/redo:

```rust
#[derive(Clone, PartialEq)]
struct InputState {
    text: String,
    cursor: usize,
    version: usize,
}

impl HistoryItem for InputState {
    fn version(&self) -> usize {
        self.version
    }
    
    fn set_version(&mut self, version: usize) {
        self.version = version;
    }
}

let mut history = History::new()
    .group_interval(Duration::from_millis(300));

// User types
history.push(InputState { text: "H".into(), cursor: 1, version: 0 });
history.push(InputState { text: "He".into(), cursor: 2, version: 0 });
history.push(InputState { text: "Hel".into(), cursor: 3, version: 0 });

// Pause, then continue
std::thread::sleep(Duration::from_millis(400));
history.push(InputState { text: "Hell".into(), cursor: 4, version: 0 });

// Undo undoes all changes in a version
let state = history.undo().unwrap();
assert_eq!(state.text, "Hel");  // Back to before pause
```

## Example: Blueprint Editor

Blueprint changes use history:

```rust
#[derive(Clone, PartialEq)]
struct BlueprintChange {
    snapshot: BlueprintAsset,
    version: usize,
}

impl HistoryItem for BlueprintChange {
    fn version(&self) -> usize {
        self.version
    }
    
    fn set_version(&mut self, version: usize) {
        self.version = version;
    }
}

let mut history = History::new()
    .max_undo(100);  // Blueprints are large, limit history

// User adds node
history.push(BlueprintChange {
    snapshot: blueprint.clone(),
    version: 0,
});

// User moves node
history.push(BlueprintChange {
    snapshot: blueprint.clone(),
    version: 0,
});

// Undo restores previous state
if let Some(change) = history.undo() {
    blueprint = change.snapshot;
}
```

## Unique History

With `unique()`, duplicates are removed:

```rust
let mut history = History::new().unique();

history.push(state1);
history.push(state2);
history.push(state1);  // Removes earlier state1

// Only state2 and state1 remain
```

This is useful for navigation history (don't revisit same state twice).

## Version Tracking

Get current version:

```rust
let version = history.version();
```

Versions increment when:
- Enough time passes (group_interval)
- First change in a new version

## Max Undo Limit

When history exceeds `max_undo`:

```rust
let mut history = History::new().max_undo(3);

history.push(state1);
history.push(state2);
history.push(state3);
history.push(state4);  // state1 is removed

assert_eq!(history.len(), 3);
```

Oldest changes are dropped.

## Integration with UI

UI components typically store history:

```rust
pub struct Input {
    text: String,
    cursor: usize,
    history: History<InputState>,
}

impl Input {
    fn handle_key(&mut self, key: &str) {
        if key == "ctrl+z" {
            if let Some(state) = self.history.undo() {
                self.text = state.text;
                self.cursor = state.cursor;
            }
        } else if key == "ctrl+y" {
            if let Some(state) = self.history.redo() {
                self.text = state.text;
                self.cursor = state.cursor;
            }
        } else {
            // Save state before change
            self.history.push(InputState {
                text: self.text.clone(),
                cursor: self.cursor,
                version: 0,
            });
            
            // Make change
            self.text.push_str(key);
            self.cursor += key.len();
        }
    }
}
```

## Performance Considerations

For large items:
- Use reference counting (Arc) to avoid cloning
- Implement incremental diffs instead of full snapshots
- Limit max_undo to reasonable size

For small items:
- Clone freely (cheap)
- Use higher max_undo limits

## Limitations

Current implementation:
- No branching (redo is lost after new change)
- No history persistence (lost on restart)
- No diff-based storage (stores full items)
- No history merging/squashing

Future improvements:
- Branching undo tree
- Persistent history across sessions
- Delta compression for large items
- History statistics and analysis
