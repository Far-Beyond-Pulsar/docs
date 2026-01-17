---
title: Diagnostics System
description: Code diagnostics and quick fixes from LSP
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - diagnostics
  - lsp
  - errors
  - warnings
  - quick-fixes
related:
  - core-concepts/rust-analyzer-integration
position: 16
icon: AlertCircle
---

# Diagnostics System

The diagnostics system collects and displays code errors, warnings, and hints from language servers. It includes support for quick fixes (code actions) that can automatically fix issues. The implementation is in `crates/ui/src/diagnostics.rs`.

## What It Provides

The diagnostics system provides:
- Structured diagnostic data from LSP servers
- Severity levels (Error, Warning, Information, Hint)
- Quick fix actions with text edits
- Integration with rust-analyzer and other language servers

## Diagnostic Structure

A diagnostic represents a single issue in code:

```rust
pub struct Diagnostic {
    pub file_path: String,
    pub line: usize,
    pub column: usize,
    pub end_line: Option<usize>,
    pub end_column: Option<usize>,
    pub message: String,
    pub severity: DiagnosticSeverity,
    pub code: Option<String>,
    pub source: Option<String>,
    pub code_actions: Vec<CodeAction>,
    pub raw_lsp_diagnostic: Option<serde_json::Value>,
}
```

The file path, line, and column identify where the issue is. The message explains what's wrong.

## Severity Levels

Diagnostics are categorized by severity:

```rust
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}
```

Errors prevent compilation. Warnings are potential issues. Information provides context. Hints suggest improvements.

## Diagnostic Source

The `source` field identifies which tool produced the diagnostic:

```rust
source: Some("rust-analyzer".to_string())
```

This allows filtering diagnostics by source (e.g., show only rustc errors, hide clippy warnings).

## Diagnostic Codes

Many diagnostics have error codes:

```rust
code: Some("E0308".to_string())  // Rust error code
```

These can be looked up in documentation for more details.

## Diagnostic Range

Simple diagnostics have a single position:

```rust
line: 42,
column: 10,
end_line: None,
end_column: None,
```

Complex diagnostics have a range:

```rust
line: 42,
column: 10,
end_line: Some(42),
end_column: Some(25),
```

This highlights a span of code (like an entire expression).

## Code Actions (Quick Fixes)

Code actions provide automated fixes:

```rust
pub struct CodeAction {
    pub title: String,
    pub edits: Vec<TextEdit>,
}
```

The title describes what the fix does. The edits specify how to change the code.

## Text Edits

A text edit modifies a file:

```rust
pub struct TextEdit {
    pub file_path: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub new_text: String,
}
```

This replaces the text from (start_line, start_column) to (end_line, end_column) with `new_text`. Empty `new_text` means delete.

## Example: Unused Import

rust-analyzer reports unused imports:

```rust
Diagnostic {
    file_path: "/project/src/main.rs",
    line: 5,
    column: 5,
    end_line: Some(5),
    end_column: Some(15),
    message: "unused import: `std::io`",
    severity: DiagnosticSeverity::Warning,
    code: Some("unused_imports"),
    source: Some("rust-analyzer"),
    code_actions: vec![
        CodeAction {
            title: "Remove the whole `use` item".to_string(),
            edits: vec![
                TextEdit {
                    file_path: "/project/src/main.rs",
                    start_line: 5,
                    start_column: 1,
                    end_line: 5,
                    end_column: 16,
                    new_text: String::new(),  // Delete the line
                }
            ],
        }
    ],
    raw_lsp_diagnostic: Some(...),
}
```

The user can click "Remove the whole `use` item" to apply the fix.

## Applying Code Actions

To apply a code action:

1. Get the action from the diagnostic
2. For each edit in the action:
   - Open the file
   - Navigate to the edit range
   - Replace the text with new_text
3. Save the file

This can be automated or presented as a preview before applying.

## LSP Integration

Diagnostics come from LSP `textDocument/publishDiagnostics` notifications:

```rust
// rust-analyzer manager parses LSP notifications
if method == "textDocument/publishDiagnostics" {
    let diagnostics = parse_diagnostics(params);
    cx.emit(AnalyzerEvent::Diagnostics(diagnostics));
}
```

The diagnostic format matches LSP specification but uses 1-indexed lines/columns (LSP uses 0-indexed).

## Diagnostic Providers

Multiple sources can provide diagnostics:

- **rust-analyzer** - Rust compiler errors, clippy lints, type checking
- **rustc** - Direct compiler output
- **clippy** - Linting suggestions
- **Custom tools** - Any tool that outputs LSP diagnostics

Each has its own `source` field for identification.

## Collecting Diagnostics

A diagnostic manager aggregates diagnostics from all sources:

```rust
pub struct DiagnosticManager {
    diagnostics: HashMap<String, Vec<Diagnostic>>,  // file_path -> diagnostics
}

impl DiagnosticManager {
    pub fn update_diagnostics(&mut self, source: &str, diagnostics: Vec<Diagnostic>) {
        // Group by file
        for diagnostic in diagnostics {
            self.diagnostics
                .entry(diagnostic.file_path.clone())
                .or_default()
                .push(diagnostic);
        }
    }
    
    pub fn get_for_file(&self, file_path: &str) -> &[Diagnostic] {
        self.diagnostics.get(file_path).map(|v| v.as_slice()).unwrap_or(&[])
    }
    
    pub fn all_errors(&self) -> Vec<&Diagnostic> {
        self.diagnostics
            .values()
            .flatten()
            .filter(|d| d.severity == DiagnosticSeverity::Error)
            .collect()
    }
}
```

This allows querying diagnostics by file or severity.

## UI Display

Diagnostics are displayed in multiple places:

1. **Inline in editor** - Squiggly underlines at error locations
2. **Gutter icons** - Error/warning icons in the line number gutter
3. **Problems panel** - List of all diagnostics with jump-to-source
4. **Status bar** - Count of errors/warnings

Each uses the diagnostic data to render appropriately.

## Filtering

Users can filter diagnostics:

- By severity (hide hints, show only errors)
- By source (hide clippy, show only rustc)
- By file pattern (only show src/, hide tests/)

This reduces noise from less important diagnostics.

## Sorting

Diagnostics are typically sorted by:
1. Severity (errors first, then warnings, etc.)
2. File path (alphabetically)
3. Line number (top to bottom)

This makes it easy to find the most important issues.

## Diagnostic Lifecycle

Diagnostics are updated when:

1. File is opened (initial analysis)
2. File is edited (incremental analysis)
3. File is saved (full analysis)
4. Dependencies change (project-wide reanalysis)

Old diagnostics are cleared when new ones arrive for the same file.

## Performance

For large projects with many diagnostics:
- Virtual scrolling in problems panel (only render visible items)
- Debounced updates (batch multiple diagnostic events)
- Caching parsed diagnostics (avoid re-parsing)

This keeps the UI responsive even with thousands of diagnostics.

## Limitations

Current implementation:
- No diagnostic persistence (lost on restart)
- No diagnostic history (can't see past issues)
- Limited code action support (only simple text edits)
- No multi-file quick fixes

Future improvements:
- Persistent diagnostic storage
- Diagnostic diff/history view
- Complex code actions (add dependencies, create files)
- Workspace-wide quick fixes
