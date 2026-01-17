---
title: Rust Analyzer Integration
description: LSP integration for code analysis and diagnostics
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - lsp
  - rust-analyzer
  - diagnostics
  - code-analysis
related:
  - core-concepts/architecture
position: 7
icon: Code
---

# Rust Analyzer Integration

Pulsar integrates rust-analyzer (the Rust language server) to provide code intelligence features like diagnostics, code completion, and type information. This document covers how the integration works.

## What It Does

The rust-analyzer integration provides:
- Real-time error and warning diagnostics from the Rust compiler
- Code completion suggestions
- Go-to-definition and type information
- Quick fixes (code actions) for common issues

The implementation is in `crates/engine_backend/src/services/rust_analyzer_manager.rs`.

## RustAnalyzerManager

The `RustAnalyzerManager` type spawns and communicates with a rust-analyzer process via the Language Server Protocol (LSP).

```rust
pub struct RustAnalyzerManager {
    analyzer_path: PathBuf,
    workspace_root: Option<PathBuf>,
    process: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    status: AnalyzerStatus,
    initialized: bool,
    request_id: Arc<Mutex<i64>>,
    progress_rx: Option<Receiver<ProgressUpdate>>,
    pending_requests: Arc<Mutex<HashMap<i64, flume::Sender<serde_json::Value>>>>,
}
```

The manager tracks the rust-analyzer process, handles LSP communication, and emits events for status changes and diagnostics.

## Finding rust-analyzer

When the manager initializes, it searches for rust-analyzer in this order:

1. Via rustup: `rustup which rust-analyzer` (handles rustup component installs)
2. In PATH: looks for `rust-analyzer.exe` or `rust-analyzer`
3. In cargo bin: `$CARGO_HOME/bin/rust-analyzer.exe`
4. In user cargo: `~/.cargo/bin/rust-analyzer.exe`
5. In engine deps: checks a bundled version

If rust-analyzer isn't found anywhere, it attempts to install it automatically to the engine deps directory using `cargo install rust-analyzer`.

The search code is in `find_or_use_bundled_analyzer()` and handles the rustup proxy wrapper case where `rust-analyzer.exe` exists but the actual component isn't installed yet.

## Status Tracking

The manager tracks rust-analyzer state with `AnalyzerStatus`:

```rust
pub enum AnalyzerStatus {
    Idle,
    Starting,
    Indexing { progress: f32, message: String },
    Ready,
    Error(String),
    Stopped,
}
```

Status changes are emitted as events:

```rust
pub enum AnalyzerEvent {
    StatusChanged(AnalyzerStatus),
    IndexingProgress { progress: f32, message: String },
    Ready,
    Error(String),
    Diagnostics(Vec<Diagnostic>),
}
```

The UI can subscribe to these events to show loading indicators or display diagnostic counts.

## Starting the Process

When `start_with_workspace()` is called, the manager:

1. Checks if a process is already running (kills it if so)
2. Spawns rust-analyzer with stdin/stdout/stderr piped
3. Sends an LSP initialize request with workspace root
4. Starts background threads to monitor stdout, stderr, and process exit
5. Updates status to `Indexing`

The spawning happens on a background thread to avoid blocking the UI:

```rust
pub fn start_with_workspace(&mut self, workspace_root: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
    // Kill existing process if any
    self.stop();
    
    // Spawn on background thread
    cx.spawn_in(window, async move |manager, cx| {
        // ... spawning logic
    }).detach();
}
```

If the spawn fails (binary not found), it attempts to install rust-analyzer via `cargo install` and retries.

## LSP Communication

The manager communicates with rust-analyzer using the Language Server Protocol over stdin/stdout. LSP messages have this format:

```
Content-Length: 123\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize",...}
```

Sending a request:

```rust
fn send_request(method: &str, params: Value, stdin: Arc<Mutex<Option<ChildStdin>>>, request_id: Arc<Mutex<i64>>) -> Result<()> {
    let id = {
        let mut id = request_id.lock().unwrap();
        *id += 1;
        *id
    };
    
    let message = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });
    
    let content = serde_json::to_string(&message)?;
    let header = format!("Content-Length: {}\r\n\r\n", content.len());
    
    let mut stdin_lock = stdin.lock().unwrap();
    if let Some(ref mut stdin) = *stdin_lock {
        stdin.write_all(header.as_bytes())?;
        stdin.write_all(content.as_bytes())?;
        stdin.flush()?;
    }
    
    Ok(())
}
```

The stdout monitor thread reads LSP messages and parses them. It handles three types:

1. **Responses** - matched to pending requests by ID
2. **Progress notifications** - `$/progress` messages with indexing status
3. **Diagnostic notifications** - `textDocument/publishDiagnostics` with errors/warnings

## Progress Monitoring

rust-analyzer sends progress updates as it indexes the workspace. The manager parses these `$/progress` notifications:

```rust
// From handle_lsp_message()
if method == "$/progress" {
    if let Some(params) = msg.get("params") {
        if let Some(value) = params.get("value") {
            if let Some(kind) = value.get("kind").and_then(|k| k.as_str()) {
                match kind {
                    "begin" => {
                        // Indexing started
                        let message = value.get("message").and_then(|m| m.as_str()).unwrap_or("Starting...");
                        progress_tx.send(ProgressUpdate::Progress { 
                            progress: 0.0, 
                            message: message.to_string() 
                        });
                    }
                    "report" => {
                        // Progress update
                        let percentage = value.get("percentage").and_then(|p| p.as_f64()).unwrap_or(0.0);
                        let message = value.get("message").and_then(|m| m.as_str()).unwrap_or("");
                        progress_tx.send(ProgressUpdate::Progress { 
                            progress: (percentage / 100.0) as f32,
                            message: message.to_string()
                        });
                    }
                    "end" => {
                        // Indexing complete
                        progress_tx.send(ProgressUpdate::Ready);
                    }
                }
            }
        }
    }
}
```

The UI receives these updates through `AnalyzerEvent::IndexingProgress` and can show a progress bar.

## Diagnostics

rust-analyzer sends diagnostics whenever files change or analysis completes. The manager parses `textDocument/publishDiagnostics` notifications:

```rust
// From handle_lsp_message()
if method == "textDocument/publishDiagnostics" {
    if let Some(params) = msg.get("params") {
        if let (Some(uri), Some(diagnostics_array)) = (
            params.get("uri").and_then(|u| u.as_str()),
            params.get("diagnostics").and_then(|d| d.as_array())
        ) {
            let mut diagnostics = Vec::new();
            
            for diag in diagnostics_array {
                // Parse each diagnostic
                let range = diag.get("range");
                let message = diag.get("message").and_then(|m| m.as_str());
                let severity = diag.get("severity").and_then(|s| s.as_u64());
                
                // Extract position
                let start = range.get("start");
                let line = start.get("line").and_then(|l| l.as_u64()).unwrap_or(0) as usize + 1;
                let column = start.get("character").and_then(|c| c.as_u64()).unwrap_or(0) as usize + 1;
                
                // Map severity (1=Error, 2=Warning, 3=Info, 4=Hint)
                let severity = match severity {
                    1 => DiagnosticSeverity::Error,
                    2 => DiagnosticSeverity::Warning,
                    3 => DiagnosticSeverity::Information,
                    4 => DiagnosticSeverity::Hint,
                    _ => DiagnosticSeverity::Information,
                };
                
                diagnostics.push(Diagnostic {
                    file_path: uri.trim_start_matches("file:///").replace("%20", " "),
                    line,
                    column,
                    severity,
                    message: message.to_string(),
                    code: diag.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
                    source: Some("rust-analyzer".to_string()),
                    code_actions: extract_code_actions(diag),
                    raw_lsp_diagnostic: Some(diag.clone()),
                });
            }
            
            progress_tx.send(ProgressUpdate::Diagnostics(diagnostics));
        }
    }
}
```

Diagnostics are sent to the UI via `AnalyzerEvent::Diagnostics(Vec<Diagnostic>)`.

## Code Actions (Quick Fixes)

rust-analyzer includes quick fixes in diagnostic data. The manager extracts these as `CodeAction` objects:

```rust
pub struct CodeAction {
    pub title: String,
    pub edits: Vec<TextEdit>,
}

pub struct TextEdit {
    pub file_path: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub new_text: String,
}
```

Code actions come from two places:

1. **diagnostic.data.fixes** - rust-analyzer's internal fix suggestions
2. **diagnostic.relatedInformation** - rustc's suggestions (like removing unused imports)

The extraction code looks for:
- `data.fixes[].edit.changes` - text edits per file
- `data.fixes[].edit.documentChanges` - alternative format
- `relatedInformation[].message` - messages like "remove the whole `use` item"
- `relatedInformation[].location.range` - range to delete

The UI can display these as clickable actions that apply the text edits when selected.

## Completion Requests

The manager can send `textDocument/completion` requests to get code completion suggestions:

```rust
pub async fn request_completion(&self, file_path: &str, line: usize, column: usize) -> Result<Vec<CompletionItem>> {
    let (response_tx, response_rx) = flume::bounded(1);
    
    // Store pending request
    let request_id = self.send_completion_request_internal(file_path, line, column, response_tx)?;
    
    // Wait for response (with timeout)
    match response_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(response) => parse_completion_response(response),
        Err(_) => Err(anyhow!("Completion request timed out")),
    }
}
```

The pending request is stored in `pending_requests` map. When the stdout monitor receives a response with matching ID, it sends the result through the flume channel.

## Thread Architecture

The manager uses multiple threads:

1. **Main thread** - UI and event emission
2. **Spawn thread** - spawns rust-analyzer process (short-lived)
3. **Stdout monitor** - reads LSP messages from rust-analyzer
4. **Stderr monitor** - logs error output
5. **Exit monitor** - detects when rust-analyzer exits
6. **Initialize thread** - sends initialize request (short-lived)

This prevents blocking the UI while waiting for LSP responses or process I/O.

## Stopping

When `stop()` is called or the manager is dropped:

```rust
pub fn stop(&mut self) {
    if let Some(mut child) = self.process.lock().unwrap().take() {
        tracing::debug!("Stopping rust-analyzer process...");
        let _ = child.kill();
        let _ = child.wait();
    }
    
    self.status = AnalyzerStatus::Stopped;
    self.initialized = false;
}
```

This kills the process and cleans up state. The next `start_with_workspace()` call will spawn a fresh process.

## Error Handling

The manager handles several error cases:

- **Binary not found** - attempts `cargo install rust-analyzer`
- **Process crash** - emits `AnalyzerEvent::Error` and sets status to `Error`
- **Initialize failure** - retries or reports error
- **Stdout/stderr closed** - detects and reports via exit monitor

Errors are logged with tracing and emitted as events so the UI can display messages.

## Installation Fallback

If rust-analyzer isn't found, the manager tries to install it:

```rust
fn install_rust_analyzer_to_deps() -> Result<PathBuf> {
    tracing::debug!("Installing rust-analyzer to engine deps...");
    
    let deps_dir = get_engine_deps_dir();
    std::fs::create_dir_all(&deps_dir)?;
    
    // Run cargo install
    let output = Command::new("cargo")
        .args(&["install", "rust-analyzer", "--root", deps_dir.to_str().unwrap()])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!("cargo install failed"));
    }
    
    let installed_path = get_engine_deps_analyzer_path();
    if !installed_path.exists() {
        return Err(anyhow!("Binary not found after install"));
    }
    
    Ok(installed_path)
}
```

This runs `cargo install rust-analyzer --root <deps_dir>` to download and compile rust-analyzer, storing it in the engine's dependencies directory. On subsequent runs, the binary will be found in the search path.

## Usage Example

From the editor initialization code:

```rust
// Create the manager
let analyzer = cx.new(|cx| RustAnalyzerManager::new(window, cx));

// Subscribe to events
cx.subscribe(&analyzer, |this, _, event: &AnalyzerEvent, cx| {
    match event {
        AnalyzerEvent::StatusChanged(status) => {
            this.update_analyzer_status(status.clone());
        }
        AnalyzerEvent::Diagnostics(diagnostics) => {
            this.update_diagnostics(diagnostics.clone());
        }
        AnalyzerEvent::IndexingProgress { progress, message } => {
            this.show_progress(progress, message);
        }
        _ => {}
    }
}).detach();

// Start analyzing the workspace
analyzer.update(cx, |analyzer, cx| {
    analyzer.start_with_workspace(project_root, window, cx);
});
```

The UI receives events as rust-analyzer indexes files and reports diagnostics. Errors/warnings appear in the problems panel, and status shows in the statusbar.

## Limitations

The current implementation:
- Doesn't support multi-workspace projects (only one root)
- Completion is basic (no advanced filtering or ranking)
- No go-to-definition or hover support yet (LSP infrastructure exists)
- Diagnostic code actions are extracted but applying them requires editor integration

The LSP protocol support is partial - it implements the minimum needed for diagnostics and basic completion. Full LSP support would require handling more message types (hover, definition, references, etc.).
