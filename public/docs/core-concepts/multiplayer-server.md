---
title: Multiplayer Server
description: Real-time collaborative editing server architecture
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - multiplayer
  - networking
  - server
  - collaboration
related:
  - core-concepts/architecture
position: 8
icon: Users
---

# Multiplayer Server

Pulsar includes a production-grade multiplayer server for real-time collaborative editing. The server handles session management, peer coordination, and traffic relay. The implementation is in `crates/multiuser_server/`.

## What It Provides

The multiuser server offers several services:

- **Session Management** - Create and join collaborative editing sessions
- **WebSocket Signaling** - Real-time peer coordination and messaging
- **QUIC Relay** - High-performance encrypted relay for peer-to-peer traffic
- **NAT Traversal** - UDP hole punching coordinator for direct connections
- **Authentication** - JWT-based auth with role management (Host/Guest)
- **Bandwidth Control** - Per-session rate limiting and monitoring
- **Health Checks** - Kubernetes-ready liveness/readiness probes
- **Metrics** - Prometheus metrics for observability

## Server Architecture

The server runs multiple independent services:

- **HTTP Server** (port 8080) - REST API and WebSocket signaling via Axum
- **QUIC Relay** (port 8443) - Encrypted relay for peer traffic via Quinn
- **UDP Punch** (port 7000) - NAT traversal coordination
- **Metrics** (port 9090) - Prometheus metrics endpoint

Each service runs in its own task and can be configured independently.

## Session Management

Sessions are managed by the `SessionStore` type in `session.rs`.

```rust
pub struct Session {
    pub id: String,
    pub host_id: String,
    pub participants: Vec<ParticipantInfo>,
    pub created_at: u64,
    pub expires_at: u64,
    pub session_key: Vec<u8>,
    pub metadata: serde_json::Value,
}

pub struct ParticipantInfo {
    pub peer_id: String,
    pub role: Role,
    pub joined_at: u64,
    pub last_seen: u64,
}
```

Sessions have a time-to-live (TTL) configured via `session_ttl` in the config. When a session expires, it's automatically removed by the garbage collector.

Creating a session:

```rust
// Generate random session ID
let session = sessions.create_session(
    host_id,
    metadata
)?;

// Or use a specific ID
let session = sessions.create_session_with_id(
    "my-session-id".to_string(),
    host_id,
    metadata
)?;
```

Joining a session:

```rust
let updated_session = sessions.join_session(
    session_id,
    peer_id,
    Role::Guest
)?;
```

The session key (32 random bytes) is generated when the session is created. Participants use this for end-to-end encryption of relay traffic.

## HTTP API

The server exposes a REST API via Axum. Routes are defined in `http_server.rs`:

```rust
Router::new()
    // Health and metrics
    .route("/health", get(health_check))
    .route("/health/liveness", get(liveness_check))
    .route("/health/readiness", get(readiness_check))
    .route("/metrics", get(metrics_handler))
    // Session management
    .route("/v1/sessions", post(create_session))
    .route("/v1/sessions/:id/join", post(join_session))
    .route("/v1/sessions/:id/close", post(close_session))
    .route("/v1/sessions/:id", get(get_session))
    // WebSocket signaling
    .route("/v1/signaling", get(websocket_handler))
    .route("/ws", get(websocket_handler))
```

The `/ws` endpoint upgrades to WebSocket for real-time signaling between peers.

### Creating a Session

```http
POST /v1/sessions
Content-Type: application/json

{
  "host_id": "peer-abc-123",
  "metadata": {
    "project": "MyGame",
    "version": "1.0"
  }
}
```

Response:

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "join_token": "jwt-token-here",
  "expires_at": 1705449600
}
```

### Joining a Session

```http
POST /v1/sessions/{session_id}/join
Content-Type: application/json

{
  "join_token": "jwt-token-here",
  "peer_id": "peer-def-456"
}
```

Response:

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "peer_id": "peer-def-456",
  "role": "Guest",
  "participant_count": 2
}
```

## WebSocket Signaling

The WebSocket endpoint at `/ws` handles signaling messages between peers. Located in `rendezvous.rs`.

The `RendezvousCoordinator` manages WebSocket connections and routes signaling messages:

```rust
pub struct RendezvousCoordinator {
    connections: Arc<DashMap<String, PeerConnection>>,
    config: Config,
}

struct PeerConnection {
    peer_id: String,
    session_id: String,
    sender: mpsc::UnboundedSender<SignalMessage>,
}
```

When a peer connects via WebSocket, it registers with a session. The coordinator then routes signaling messages (SDP offers/answers, ICE candidates) between peers in the same session.

Message format:

```json
{
  "type": "signal",
  "from": "peer-abc-123",
  "to": "peer-def-456",
  "session_id": "550e8400-...",
  "signal": {
    "type": "offer",
    "sdp": "..."
  }
}
```

The signaling is used for WebRTC connection establishment. After peers exchange SDP and ICE candidates, they can establish a direct P2P connection (or fall back to the relay).

## QUIC Relay

The QUIC relay in `relay.rs` provides a TURN-like service for relaying traffic when direct P2P connections fail.

```rust
pub struct RelayServer {
    config: Config,
    endpoint: Arc<Endpoint>,
    sessions: Arc<DashMap<String, Arc<RelaySession>>>,
    connections: Arc<DashMap<String, Arc<PooledConnection>>>,
    bandwidth_accounts: Arc<DashMap<String, Arc<BandwidthAccount>>>,
}
```

The relay uses Quinn (async QUIC implementation) and supports:

- Connection pooling for efficiency
- Bandwidth accounting per session
- Automatic cleanup of idle connections
- End-to-end encryption (relay doesn't decrypt payloads)

Relay frame structure:

```rust
pub struct RelayFrame {
    pub session_id: String,
    pub from_peer_id: String,
    pub to_peer_id: String,
    pub encrypted_payload: Bytes,
    pub seq: u64,
}
```

Peers send encrypted frames to the relay, which forwards them to the destination peer. The relay only sees encrypted payloads - the session key is used for E2E encryption on the client side.

Bandwidth tracking:

```rust
struct BandwidthAccount {
    session_id: String,
    bytes_sent: AtomicU64,
    bytes_received: AtomicU64,
    start_time: Instant,
    last_updated: Mutex<Instant>,
}
```

Each session has a bandwidth account that tracks total bytes sent/received and calculates current bandwidth. This is used for rate limiting and metrics.

## NAT Traversal

The UDP hole punching coordinator in `nat.rs` helps peers establish direct connections through NATs.

The coordinator tracks peer endpoints and facilitates simultaneous UDP sends to establish a connection:

1. Both peers send UDP packets to each other's public endpoint
2. The NATs see outgoing traffic and create mappings
3. Incoming packets can then traverse the NAT
4. Direct P2P connection established

This works for many NAT types (Cone NAT, Symmetric NAT with port prediction).

## Authentication

The `AuthService` in `auth.rs` handles JWT-based authentication:

```rust
pub struct AuthService {
    secret: Vec<u8>,
}

pub enum Role {
    Host,
    Guest,
}
```

Creating a join token:

```rust
let token = auth.create_join_token(session_id, Role::Guest)?;
```

Validating a token:

```rust
let claims = auth.validate_token(&token)?;
// claims contains session_id and role
```

The JWT secret is loaded from config. Tokens have an expiration time to prevent reuse.

## Metrics

Prometheus metrics are tracked in `metrics.rs` using the `prometheus` crate:

```rust
pub struct Metrics {
    pub sessions_total: IntCounterVec,
    pub sessions_active: IntGauge,
    pub participants_total: IntCounterVec,
    pub relay_bytes_total: IntCounterVec,
    pub relay_frames_total: IntCounterVec,
    pub websocket_connections: IntGauge,
    pub http_requests_total: IntCounterVec,
}
```

Metrics are exposed at `/metrics` in Prometheus format and `/metrics/json` as JSON.

Example metrics:

```
sessions_total{host="peer-abc"} 15
sessions_active 3
relay_bytes_total{session="550e8400-..."} 1048576
websocket_connections 6
```

## Health Checks

The `HealthChecker` in `health.rs` provides Kubernetes-compatible health endpoints:

- `/health` - Overall health status
- `/health/liveness` - Liveness probe (is the server running?)
- `/health/readiness` - Readiness probe (is the server ready to accept traffic?)

Health status includes:

```json
{
  "status": "healthy",
  "timestamp": 1705449600,
  "services": {
    "http": "up",
    "relay": "up",
    "sessions": "up"
  }
}
```

## Configuration

The server is configured via `Config` in `config.rs`:

```rust
pub struct Config {
    pub http_bind: SocketAddr,
    pub quic_bind: SocketAddr,
    pub udp_bind: SocketAddr,
    pub session_ttl: Duration,
    pub max_bandwidth_per_session: u64,
    pub jwt_secret: String,
    pub tls_cert_path: Option<PathBuf>,
    pub tls_key_path: Option<PathBuf>,
}
```

Configuration can be loaded from environment variables or command-line arguments.

## CRDT Support

The server includes CRDT (Conflict-free Replicated Data Type) implementations in `crdt/`:

- **ORSet** - Observed-Remove Set for managing sets of items
- **RGASeq** - Replicated Growable Array for text editing

These can be used by clients to build collaborative editing features with eventual consistency.

## Persistence

The `PersistenceLayer` in `persistence.rs` provides optional PostgreSQL + S3 storage for session snapshots:

```rust
pub struct PersistenceLayer {
    db_pool: Option<PgPool>,
    s3_client: Option<S3Client>,
    config: Config,
}
```

Sessions can be persisted to the database, and large payloads (like full document snapshots) can be stored in S3.

## Running the Server

Start with default configuration:

```bash
cargo run --bin pulsar-multiedit
```

With custom settings:

```bash
cargo run --bin pulsar-multiedit -- \
  --http-bind 0.0.0.0:8080 \
  --quic-bind 0.0.0.0:8443 \
  --log-level debug
```

The server starts all services and listens for connections. Health checks are immediately available, metrics start tracking, and sessions can be created via the REST API.

## Client Integration

Clients connect to the server in this sequence:

1. Create session via `POST /v1/sessions` (or join existing via `POST /v1/sessions/:id/join`)
2. Connect WebSocket to `/ws` for signaling
3. Exchange SDP/ICE candidates with other peers via WebSocket
4. Attempt direct P2P connection via WebRTC
5. Fall back to QUIC relay if P2P fails
6. Send encrypted data through chosen transport

The relay is transparent to clients - they just send frames and the relay forwards them.

## Limitations

Current implementation:
- Single server deployment (no clustering/federation)
- No horizontal scaling (uses in-memory session store)
- Persistence layer is optional and not fully integrated
- CRDT implementations are basic (no advanced merge strategies)

For production deployment with high availability, you'd need to add:
- Redis or distributed cache for session state
- Load balancing across multiple relay servers
- Database replication
- Session migration on server failure
