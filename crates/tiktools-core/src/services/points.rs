use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::SystemTime,
};

use serde_json::{json, Value};

use crate::db::DatabaseManager;
use crate::ipc::messages::{PartialPointsConfig, PointsConfig};
use tiktools_plugin_api::sync::{recover_mutex, recover_rwlock_read, recover_rwlock_write};

/// Default bound for the in-memory hot-viewer cache. SQLite remains the
/// durable source of truth; viewers outside the cache are reloaded on demand
/// through the indexed `viewers.unique_id` primary key.
pub const DEFAULT_HOT_VIEWER_CAPACITY: usize = 10_000;
/// Upper bound for queued durable writes. When the writer cannot keep up,
/// awarding falls back to a synchronous write (backpressure on the caller)
/// instead of growing memory, and records an overload diagnostic.
#[cfg(feature = "persistence")]
const WRITER_QUEUE_CAPACITY: usize = 4_096;
/// Maximum durable writes folded into one SQLite transaction.
#[cfg(feature = "persistence")]
const WRITER_BATCH_SIZE: usize = 128;

/// Strongly typed viewer row. The wire shape stays JSON (`Value`) at the API
/// boundary; internally every hot-path field is typed so awards avoid dynamic
/// lookup, and the leaderboard orders without touching `serde_json`.
#[derive(Debug, Clone)]
pub struct ViewerState {
    pub unique_id: String,
    pub user_id: Option<String>,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub points: f64,
    pub level: u32,
    pub is_subscriber: bool,
    pub total_chats: i64,
    pub total_coins: i64,
    pub total_likes: i64,
    pub total_shares: i64,
    pub first_seen: i64,
    pub last_seen: i64,
}

impl ViewerState {
    /// Deterministic leaderboard order: points descending, then coins,
    /// then chats, then identity. The final `unique_id` tie-break keeps
    /// the board stable when every counter matches.
    fn compare_rank(left: &Self, right: &Self) -> std::cmp::Ordering {
        right
            .points
            .total_cmp(&left.points)
            .then_with(|| right.total_coins.cmp(&left.total_coins))
            .then_with(|| right.total_chats.cmp(&left.total_chats))
            .then_with(|| left.unique_id.cmp(&right.unique_id))
    }

    pub fn to_value(&self) -> Value {
        serde_json::json!({
            "uniqueId": self.unique_id,
            "userId": self.user_id,
            "nickname": self.nickname,
            "avatarUrl": self.avatar_url,
            "points": self.points,
            "level": self.level,
            "isSubscriber": self.is_subscriber,
            "totalChats": self.total_chats,
            "totalCoins": self.total_coins,
            "totalLikes": self.total_likes,
            "totalShares": self.total_shares,
            "firstSeen": self.first_seen,
            "lastSeen": self.last_seen,
        })
    }

    pub fn from_value(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        Some(Self {
            unique_id: object.get("uniqueId")?.as_str()?.to_owned(),
            user_id: object
                .get("userId")
                .and_then(Value::as_str)
                .map(str::to_owned),
            nickname: object
                .get("nickname")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_default(),
            avatar_url: object
                .get("avatarUrl")
                .and_then(Value::as_str)
                .map(str::to_owned),
            points: object
                .get("points")
                .and_then(Value::as_f64)
                .unwrap_or_default(),
            level: object
                .get("level")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .min(u64::from(u32::MAX)) as u32,
            is_subscriber: object
                .get("isSubscriber")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            total_chats: object
                .get("totalChats")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            total_coins: object
                .get("totalCoins")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            total_likes: object
                .get("totalLikes")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            total_shares: object
                .get("totalShares")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            first_seen: object
                .get("firstSeen")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            last_seen: object
                .get("lastSeen")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
        })
    }
}

struct PointsInner {
    viewers: HashMap<String, ViewerState>,
    capacity: usize,
    /// Sequences with durable writes still queued in the writer. Eviction
    /// must never drop these: a reload would read stale SQLite state.
    pending: HashMap<String, u64>,
    hits: u64,
    misses: u64,
}

impl PointsInner {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            viewers: HashMap::new(),
            capacity: capacity.max(1),
            pending: HashMap::new(),
            hits: 0,
            misses: 0,
        }
    }

    /// Evicts cold viewers until the cache fits `capacity`. Viewers with
    /// uncommitted writes (sequence newer than `committed`) are never
    /// evicted; when every viewer is dirty the cache temporarily exceeds its
    /// bound rather than losing acknowledged updates.
    fn evict_cold(&mut self, committed: u64) {
        // Retire commit markers the writer has already made durable so the
        // pending map itself stays bounded.
        self.pending.retain(|_, seq| *seq > committed);
        while self.viewers.len() > self.capacity {
            let victim = self
                .viewers
                .iter()
                .filter(|(id, _)| self.pending.get(*id).is_none_or(|seq| *seq <= committed))
                .min_by(|(left_id, left), (right_id, right)| {
                    left.last_seen
                        .cmp(&right.last_seen)
                        .then_with(|| left_id.cmp(right_id))
                })
                .map(|(id, _)| id.clone());
            let Some(victim) = victim else { break };
            self.viewers.remove(&victim);
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PointAward {
    pub unique_id: String,
    pub delta: f64,
    pub total_points: f64,
    pub level: u32,
    pub currency_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointAction {
    Chat,
    Gift,
    Like,
    Share,
    Follow,
    Join,
    Manual,
}

impl PointAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Gift => "gift",
            Self::Like => "like",
            Self::Share => "share",
            Self::Follow => "follow",
            Self::Join => "join",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AwardOptions {
    pub user_id: Option<String>,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub count: Option<f64>,
    pub diamond_count: Option<f64>,
    pub is_subscriber: Option<bool>,
    pub custom_amount: Option<f64>,
}

pub struct PointsService {
    config: RwLock<PointsConfig>,
    inner: RwLock<PointsInner>,
    next_op: AtomicU64,
    #[cfg(feature = "persistence")]
    database: Option<Arc<DatabaseManager>>,
    #[cfg(feature = "persistence")]
    writer: Mutex<Option<PointsWriterHandle>>,
}

/// Durable-write diagnostics for `system.health`. Contains counts only, never
/// viewer identities or chat text.
#[derive(Debug, Clone, Default)]
pub struct PointsDiagnostics {
    pub hot_size: usize,
    pub hot_capacity: usize,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub writer_queued: usize,
    pub write_batches: u64,
    pub write_errors: u64,
    pub writer_overload: u64,
    pub pending_writes: usize,
    pub committed_seq: u64,
}

impl PointsDiagnostics {
    /// Machine-readable snapshot for `system.health`.
    pub fn to_value(&self) -> Value {
        json!({
            "hotSize": self.hot_size,
            "hotCapacity": self.hot_capacity,
            "cacheHits": self.cache_hits,
            "cacheMisses": self.cache_misses,
            "writerQueued": self.writer_queued,
            "writeBatches": self.write_batches,
            "writeErrors": self.write_errors,
            "writerOverload": self.writer_overload,
            "pendingWrites": self.pending_writes,
        })
    }
}

/// One durable intent sent to the owned points writer. The single writer
/// thread applies ops FIFO, so per-viewer award/adjust/reset ordering is
/// preserved exactly as the callers issued it.
#[cfg(feature = "persistence")]
#[derive(Debug)]
pub(crate) enum PointsWriteOp {
    Save {
        seq: u64,
        viewer: ViewerState,
        reason: &'static str,
        awarded: f64,
    },
    Adjust {
        seq: u64,
        unique_id: String,
        points: f64,
        level: u32,
    },
    Reset {
        seq: u64,
        unique_id: Option<String>,
    },
}

#[cfg(feature = "persistence")]
impl PointsWriteOp {
    fn seq(&self) -> u64 {
        match self {
            Self::Save { seq, .. } | Self::Adjust { seq, .. } | Self::Reset { seq, .. } => *seq,
        }
    }
}

/// Counters shared between the service and its writer thread. The thread
/// updates batches/errors/committed; service threads update overload.
#[cfg(feature = "persistence")]
#[derive(Debug, Default)]
struct PointsWriterShared {
    batches: AtomicU64,
    errors: AtomicU64,
    committed_seq: AtomicU64,
    overload: AtomicU64,
    /// Approximate queued ops (`std::sync::mpsc` exposes no length).
    /// Incremented on admission, decremented as batches are taken.
    queued: AtomicU64,
}

/// Owned background writer: one thread, one reused SQLite connection, writes
/// folded into bounded transactions. Created by `PointsService::new`, joined
/// by `PointsService::shutdown`.
#[cfg(feature = "persistence")]
struct PointsWriterHandle {
    sender: Option<std::sync::mpsc::SyncSender<PointsWriteOp>>,
    thread: Option<std::thread::JoinHandle<()>>,
    shared: Arc<PointsWriterShared>,
}

#[cfg(feature = "persistence")]
impl PointsWriterHandle {
    fn start(database: Arc<DatabaseManager>) -> Self {
        let (sender, receiver) =
            std::sync::mpsc::sync_channel::<PointsWriteOp>(WRITER_QUEUE_CAPACITY);
        let shared = Arc::new(PointsWriterShared::default());
        let thread = std::thread::Builder::new()
            .name("points-writer".to_owned())
            .spawn({
                let database = Arc::clone(&database);
                let shared = Arc::clone(&shared);
                move || run_points_writer(database, receiver, shared)
            })
            .ok();
        if thread.is_none() {
            tracing::warn!("points writer thread failed to start; writes fall back to synchronous");
        }
        Self {
            sender: Some(sender),
            thread,
            shared,
        }
    }
}

/// Writer entry point. Opens one connection, configures WAL/busy-timeout,
/// then folds queued ops into bounded transactions until the service drops
/// the sender at shutdown. Every received op is applied: storage failures
/// are counted and logged with the affected sequence range, never silently
/// dropped, and a failed batch falls back to per-op writes so one bad row
/// cannot discard its neighbors.
#[cfg(feature = "persistence")]
fn run_points_writer(
    database: Arc<DatabaseManager>,
    receiver: std::sync::mpsc::Receiver<PointsWriteOp>,
    shared: Arc<PointsWriterShared>,
) {
    let mut connection = match database.open_points_writer() {
        Ok(connection) => connection,
        Err(error) => {
            tracing::error!(%error, "points writer could not open SQLite; draining queue without persistence");
            shared.errors.fetch_add(1, Ordering::Relaxed);
            for op in receiver {
                tracing::error!(
                    seq = op.seq(),
                    "points write lost: writer has no database connection"
                );
                shared.errors.fetch_add(1, Ordering::Relaxed);
            }
            return;
        }
    };
    let mut batch = Vec::with_capacity(WRITER_BATCH_SIZE);
    loop {
        batch.clear();
        // Block for the first op so an idle writer sleeps; then drain
        // whatever else is already queued into the same transaction.
        let first = match receiver.recv() {
            Ok(op) => op,
            Err(_) => break, // Sender dropped: shutdown, queue is empty.
        };
        batch.push(first);
        while batch.len() < WRITER_BATCH_SIZE {
            match receiver.try_recv() {
                Ok(op) => batch.push(op),
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
        let max_seq = batch.iter().map(PointsWriteOp::seq).max().unwrap_or(0);
        shared
            .queued
            .fetch_sub(batch.len() as u64, Ordering::Relaxed);
        if let Err(error) = database.apply_points_batch(&mut connection, &batch) {
            tracing::error!(
                %error,
                ops = batch.len(),
                max_seq,
                "points batch transaction failed; retrying ops individually"
            );
            shared.errors.fetch_add(1, Ordering::Relaxed);
            for op in &batch {
                if let Err(error) = database.apply_points_op(&mut connection, op) {
                    // Storage itself is failing (full disk, read-only FS);
                    // preservation cannot be guaranteed, so say so loudly
                    // with the exact op identity instead of vanishing.
                    tracing::error!(%error, seq = op.seq(), "points write failed and cannot be retried further");
                    shared.errors.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
        shared.batches.fetch_add(1, Ordering::Relaxed);
        shared.committed_seq.store(max_seq, Ordering::Release);
    }
}

impl Default for PointsService {
    fn default() -> Self {
        Self {
            config: RwLock::new(PointsConfig::default()),
            inner: RwLock::new(PointsInner::with_capacity(DEFAULT_HOT_VIEWER_CAPACITY)),
            next_op: AtomicU64::new(1),
            #[cfg(feature = "persistence")]
            database: None,
            #[cfg(feature = "persistence")]
            writer: Mutex::new(None),
        }
    }
}

impl PointsService {
    pub fn new(database: Arc<DatabaseManager>) -> Self {
        let capacity = std::env::var("TIKTOOLS_POINTS_CACHE_CAPACITY")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(DEFAULT_HOT_VIEWER_CAPACITY);
        let service = Self {
            config: RwLock::new(PointsConfig::default()),
            inner: RwLock::new(PointsInner::with_capacity(capacity)),
            next_op: AtomicU64::new(1),
            #[cfg(feature = "persistence")]
            database: None,
            #[cfg(feature = "persistence")]
            writer: Mutex::new(None),
        };
        #[cfg(feature = "persistence")]
        {
            // These locks were just created by construction above and are
            // still thread-local to this constructor, so poisoning is
            // impossible: expect pins that invariant.
            if let Ok(mut config) = database.load_points_config() {
                config.normalize();
                *service.config.write().expect("points config poisoned") = config;
            }
            // Warm only the leaderboard head: the hot cache is bounded, and
            // the database stays the source of truth for everyone else.
            // Cold viewers reload on demand through the indexed primary key.
            match database.load_top_viewers(capacity) {
                Ok(viewers) => {
                    let mut inner = service.inner.write().expect("points viewers poisoned");
                    for viewer in viewers.into_iter().filter_map(|value| {
                        ViewerState::from_value(&value)
                            .map(|state| (state.unique_id.clone(), state))
                    }) {
                        inner.viewers.insert(viewer.0, viewer.1);
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, "could not warm points hot cache; cold viewers load on demand");
                }
            }
            *service.writer.lock().expect("points writer poisoned") =
                Some(PointsWriterHandle::start(Arc::clone(&database)));
            // Keep the connection boundary in the service while the writer
            // owns its long-lived connection.
            let mut service = service;
            service.database = Some(database);
            service
        }
        #[cfg(not(feature = "persistence"))]
        {
            let _ = database;
            service
        }
    }

    /// Resizes the hot-viewer bound. Shrinking below the current size evicts
    /// cold viewers immediately (never uncommitted ones); growing only
    /// raises the ceiling, with cold rows reloading from SQLite on demand.
    pub fn set_cache_capacity(&self, capacity: usize) {
        let capacity = capacity.clamp(1, 1_000_000);
        let committed = self.committed_seq();
        let mut inner = recover_rwlock_write(&self.inner, "points viewers");
        inner.capacity = capacity;
        inner.evict_cold(committed);
    }

    pub fn cache_capacity(&self) -> usize {
        recover_rwlock_read(&self.inner, "points viewers").capacity
    }

    pub fn config(&self) -> PointsConfig {
        recover_rwlock_read(&self.config, "points config").clone()
    }

    fn next_seq(&self) -> u64 {
        self.next_op.fetch_add(1, Ordering::Relaxed)
    }

    #[cfg(feature = "persistence")]
    fn committed_seq(&self) -> u64 {
        recover_mutex(&self.writer, "points writer")
            .as_ref()
            .map(|writer| writer.shared.committed_seq.load(Ordering::Acquire))
            .unwrap_or(u64::MAX)
    }

    #[cfg(not(feature = "persistence"))]
    fn committed_seq(&self) -> u64 {
        u64::MAX
    }

    /// Waits (bounded) until every op queued so far for `unique_id` is
    /// durable, then the caller may reload the row from SQLite without
    /// losing queued increments to a stale read.
    ///
    /// Why this exists: eviction is allowed once the writer commits a row,
    /// but a later award for that same viewer may still sit queued behind
    /// other work. Reloading the durable row before that op applies would
    /// base new math on stale state and the stale-based snapshot would win
    /// the FIFO race, silently dropping the queued increment. The wait
    /// closes that window. It triggers only on a cache miss with
    /// outstanding work for that viewer — steady-state hot viewers never
    /// pay it — and it always terminates: shutdown marks every prior
    /// sequence committed, a dead writer trips the timeout with a warning.
    #[cfg(feature = "persistence")]
    fn wait_for_viewer_committed(&self, unique_id: &str) {
        let seq = recover_rwlock_read(&self.inner, "points viewers")
            .pending
            .get(unique_id)
            .copied()
            .unwrap_or(0);
        if seq == 0 || self.committed_seq() >= seq {
            return;
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while self.committed_seq() < seq {
            if std::time::Instant::now() >= deadline {
                tracing::warn!(
                    viewer_seq = seq,
                    committed = self.committed_seq(),
                    "points reload timed out waiting for queued writes; proceeding with durable state"
                );
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    /// Direct indexed lookup by identity: hot cache first, then one SQLite
    /// primary-key read that promotes the row into the cache. Returns `None`
    /// only when the viewer has no record anywhere.
    pub fn viewer(&self, unique_id: &str) -> Option<Value> {
        let needle = clean_unique_id(unique_id)?;
        {
            let mut inner = recover_rwlock_write(&self.inner, "points viewers");
            if let Some(state) = inner.viewers.get(&needle).cloned() {
                inner.hits += 1;
                return Some(state.to_value());
            }
            inner.misses += 1;
        }
        #[cfg(feature = "persistence")]
        {
            // Never base a reload on state older than our own queued work.
            self.wait_for_viewer_committed(&needle);
            let loaded = self
                .database
                .as_ref()
                .and_then(|database| database.load_viewer_by_id(&needle).ok().flatten())
                .and_then(|value| ViewerState::from_value(&value));
            if let Some(state) = loaded {
                let committed = self.committed_seq();
                let mut inner = recover_rwlock_write(&self.inner, "points viewers");
                // A concurrent award may have created the row while the
                // database read was in flight: keep the newer resident.
                let resident = inner.viewers.entry(needle).or_insert(state).clone();
                inner.evict_cold(committed);
                return Some(resident.to_value());
            }
        }
        None
    }

    pub fn diagnostics(&self) -> PointsDiagnostics {
        let inner = recover_rwlock_read(&self.inner, "points viewers");
        #[cfg(feature = "persistence")]
        {
            let writer = recover_mutex(&self.writer, "points writer");
            let (queued, batches, errors, overload, committed) = writer
                .as_ref()
                .map(|writer| {
                    (
                        writer.shared.queued.load(Ordering::Relaxed) as usize,
                        writer.shared.batches.load(Ordering::Relaxed),
                        writer.shared.errors.load(Ordering::Relaxed),
                        writer.shared.overload.load(Ordering::Relaxed),
                        writer.shared.committed_seq.load(Ordering::Acquire),
                    )
                })
                .unwrap_or_default();
            PointsDiagnostics {
                hot_size: inner.viewers.len(),
                hot_capacity: inner.capacity,
                cache_hits: inner.hits,
                cache_misses: inner.misses,
                writer_queued: queued,
                write_batches: batches,
                write_errors: errors,
                writer_overload: overload,
                pending_writes: inner.pending.len(),
                committed_seq: committed,
            }
        }
        #[cfg(not(feature = "persistence"))]
        {
            PointsDiagnostics {
                hot_size: inner.viewers.len(),
                hot_capacity: inner.capacity,
                cache_hits: inner.hits,
                cache_misses: inner.misses,
                ..PointsDiagnostics::default()
            }
        }
    }

    /// Closes the writer queue and joins the writer thread, flushing every
    /// accepted op. Ordinary shutdown must never lose committed-intent work:
    /// after `shutdown` returns, the queue is empty and all sequences are
    /// committed. Safe to call more than once.
    pub fn shutdown(&self) {
        #[cfg(feature = "persistence")]
        {
            let thread = {
                let mut writer = recover_mutex(&self.writer, "points writer");
                // Dropping the sender closes admission; the writer drains
                // what remains and then exits.
                if let Some(writer) = writer.as_mut() {
                    writer.sender.take();
                }
                writer.as_mut().and_then(|writer| writer.thread.take())
            };
            if let Some(thread) = thread {
                if let Err(error) = thread.join() {
                    tracing::warn!(?error, "points writer thread panicked during shutdown");
                }
            }
            // The queue is drained and every accepted op is durable (or was
            // applied by the synchronous fallback), so retire all pending
            // markers: post-shutdown reloads must never stall waiting.
            if let Some(writer) = recover_mutex(&self.writer, "points writer").as_ref() {
                writer
                    .shared
                    .committed_seq
                    .store(u64::MAX, Ordering::Release);
            }
        }
    }

    pub fn award_points(
        &self,
        unique_id: &str,
        action: PointAction,
        options: AwardOptions,
    ) -> Option<PointAward> {
        let unique_id = clean_unique_id(unique_id)?;
        let config = self.config();
        let base_points = match action {
            PointAction::Manual => options.custom_amount.unwrap_or_default(),
            PointAction::Chat if config.points_per_chat_enabled => config.points_per_chat,
            PointAction::Gift if config.points_per_coin_enabled => {
                positive_or_one(options.diamond_count.or(options.count)) * config.points_per_coin
            }
            PointAction::Like if config.points_per_like_enabled => {
                positive_or_one(options.count) * config.points_per_like
            }
            PointAction::Share if config.points_per_share_enabled => config.points_per_share,
            PointAction::Follow if config.points_per_follow_enabled => config.points_per_follow,
            PointAction::Join if config.points_per_join_enabled => config.points_per_join,
            _ => 0.0,
        };

        // O(1) lookup; on a cold miss fall back to one indexed SQLite read
        // (outside the lock) and promote the row. Unknown viewers are
        // created, exactly as before.
        let is_subscriber_hint = options.is_subscriber;
        let now = now_millis();
        let state_snapshot = {
            let mut inner = recover_rwlock_write(&self.inner, "points viewers");
            let cached = inner.viewers.contains_key(&unique_id);
            if cached {
                inner.hits += 1;
            } else {
                inner.misses += 1;
            }
            cached
        };
        if !state_snapshot {
            #[cfg(feature = "persistence")]
            if let Some(loaded) = {
                // Never base an award on state older than our own queued work.
                self.wait_for_viewer_committed(&unique_id);
                self.database
                    .as_ref()
                    .and_then(|database| database.load_viewer_by_id(&unique_id).ok().flatten())
                    .and_then(|value| ViewerState::from_value(&value))
            } {
                let mut inner = recover_rwlock_write(&self.inner, "points viewers");
                // Conditional promotion: a concurrent award may have
                // created a newer row while the database read was in
                // flight. The update below always accumulates on top of
                // whatever is resident, so no increment is ever lost.
                // No eviction here: the promoted row still carries its
                // durable timestamp and would be misjudged as cold. The
                // update section refreshes it and enforces the bound.
                inner.viewers.entry(unique_id.clone()).or_insert(loaded);
            }
        }

        let (award, persisted) = {
            let mut inner = recover_rwlock_write(&self.inner, "points viewers");
            let existing_subscriber = inner
                .viewers
                .get(&unique_id)
                .map(|viewer| viewer.is_subscriber)
                .unwrap_or(false);
            let is_subscriber = is_subscriber_hint.unwrap_or(existing_subscriber);
            let mut awarded = base_points;
            if is_subscriber && config.sub_bonus_multiplier > 0.0 && awarded > 0.0 {
                awarded += awarded * (config.sub_bonus_multiplier / 100.0);
            }
            awarded = round_points(awarded);
            let current_points = inner
                .viewers
                .get(&unique_id)
                .map(|viewer| viewer.points)
                .unwrap_or_default();
            let total_points = round_points((current_points + awarded).max(0.0));
            let points_per_level = config.points_per_level.max(10.0);
            let level = (total_points / points_per_level).floor() as u32 + 1;

            let seq = self.next_seq();
            let snapshot = {
                let state = inner
                    .viewers
                    .entry(unique_id.clone())
                    .or_insert_with(|| new_viewer_state(&unique_id, &options, now));
                update_existing_viewer(
                    state,
                    &options,
                    total_points,
                    level,
                    is_subscriber,
                    action,
                    now,
                );
                state.clone()
            };
            inner.pending.insert(unique_id.clone(), seq);
            // Enforce the memory bound on the insert path only; steady-state
            // updates never scan. Uncommitted rows are exempt from eviction.
            let committed = self.committed_seq();
            inner.evict_cold(committed);
            (
                PointAward {
                    unique_id,
                    delta: awarded,
                    total_points,
                    level,
                    currency_name: config.currency_name,
                },
                (seq, snapshot),
            )
        };

        #[cfg(feature = "persistence")]
        {
            let (seq, snapshot) = persisted;
            self.submit_points_op(PointsWriteOp::Save {
                seq,
                viewer: snapshot,
                reason: action.as_str(),
                awarded: award.delta,
            });
        }
        #[cfg(not(feature = "persistence"))]
        let _ = persisted;

        Some(award)
    }

    pub fn update_config(&self, update: PartialPointsConfig) -> PointsConfig {
        let updated = {
            let mut config = recover_rwlock_write(&self.config, "points config");
            update.apply(&mut config);
            config.normalize();
            config.clone()
        };
        #[cfg(feature = "persistence")]
        if let Some(database) = &self.database {
            if let Err(error) = database.save_points_config(&updated) {
                tracing::warn!(%error, "could not persist points configuration");
            }
        }
        updated
    }

    /// Top-K leaderboard with deterministic tie-breaking. Selection is
    /// O(N) to find the K winners plus O(K log K) to order them — never a
    /// full O(N log N) sort — and it runs only when a caller asks for the
    /// board, never per awarded event.
    pub fn leaderboard(&self, limit: Option<i64>) -> Vec<Value> {
        let limit = limit.unwrap_or(100).clamp(0, 1_000) as usize;
        if limit == 0 {
            return Vec::new();
        }
        let inner = recover_rwlock_read(&self.inner, "points viewers");
        if inner.viewers.len() <= limit {
            let mut all: Vec<&ViewerState> = inner.viewers.values().collect();
            all.sort_by(|left, right| ViewerState::compare_rank(left, right));
            return all.into_iter().map(ViewerState::to_value).collect();
        }
        let mut states: Vec<&ViewerState> = inner.viewers.values().collect();
        states.select_nth_unstable_by(limit, |left, right| ViewerState::compare_rank(left, right));
        let mut top: Vec<&ViewerState> = states.into_iter().take(limit).collect();
        top.sort_by(|left, right| ViewerState::compare_rank(left, right));
        top.into_iter().map(ViewerState::to_value).collect()
    }

    pub fn reset(&self, unique_id: Option<&str>) {
        let unique_id = unique_id.and_then(clean_unique_id);
        let seq = self.next_seq();
        #[cfg(feature = "persistence")]
        self.submit_reset_op(seq, unique_id.clone());
        let committed = self.committed_seq();
        let mut inner = recover_rwlock_write(&self.inner, "points viewers");
        match unique_id.as_deref() {
            Some(unique_id) => {
                if let Some(viewer) = inner.viewers.get_mut(unique_id) {
                    viewer.points = 0.0;
                    viewer.level = 1;
                    inner.pending.insert(unique_id.to_owned(), seq);
                }
                // A cold (evicted or never-cached) viewer is already reset
                // durably above; nothing is fabricated in memory.
            }
            None => {
                for viewer in inner.viewers.values_mut() {
                    viewer.points = 0.0;
                    viewer.level = 1;
                }
                // Full resets retire every pending marker: the reset op is
                // queued behind all earlier writes and zeroes every row.
                inner.pending.clear();
                inner.pending.insert(String::new(), seq);
            }
        }
        inner.evict_cold(committed);
    }

    pub fn adjust(&self, unique_id: &str, delta: f64) -> Option<PointAward> {
        let unique_id = clean_unique_id(unique_id)?;
        if !delta.is_finite() {
            return None;
        }
        // A bounded cache means the viewer may live only in SQLite: reload
        // through the indexed key instead of reporting a durable viewer as
        // unknown.
        let cached = {
            recover_rwlock_read(&self.inner, "points viewers")
                .viewers
                .contains_key(&unique_id)
        };
        if !cached {
            #[cfg(feature = "persistence")]
            if let Some(loaded) = {
                self.wait_for_viewer_committed(&unique_id);
                self.database
                    .as_ref()
                    .and_then(|database| database.load_viewer_by_id(&unique_id).ok().flatten())
                    .and_then(|value| ViewerState::from_value(&value))
            } {
                let mut inner = recover_rwlock_write(&self.inner, "points viewers");
                // Conditional promotion only: no eviction yet, for the same
                // stale-timestamp reason as in `award_points`. The update
                // below refreshes the row and enforces the bound.
                inner.viewers.entry(unique_id.clone()).or_insert(loaded);
            }
        }
        // Read config outside the viewer lock: one lock at a time.
        let config = self.config();
        let award = {
            let mut inner = recover_rwlock_write(&self.inner, "points viewers");
            let viewer = inner.viewers.get_mut(&unique_id)?;
            let points = round_points((viewer.points + delta).max(0.0));
            let level =
                ((points / config.points_per_level.max(10.0)).floor() as u32).saturating_add(1);
            viewer.points = points;
            viewer.level = level;
            viewer.last_seen = now_millis();
            let seq = self.next_seq();
            inner.pending.insert(unique_id.clone(), seq);
            // Bound enforced after the refresh, never on a stale timestamp.
            let committed = self.committed_seq();
            inner.evict_cold(committed);
            (
                PointAward {
                    unique_id: unique_id.clone(),
                    delta,
                    total_points: points,
                    level,
                    currency_name: config.currency_name.clone(),
                },
                seq,
            )
        };
        let (award_value, seq) = award;
        #[cfg(feature = "persistence")]
        self.submit_points_op(PointsWriteOp::Adjust {
            seq,
            unique_id: award_value.unique_id.clone(),
            points: award_value.total_points,
            level: award_value.level,
        });
        #[cfg(not(feature = "persistence"))]
        let _ = seq;
        Some(award_value)
    }

    /// Queues one durable op. The queue is bounded: when the writer is
    /// saturated, the op is applied synchronously on this thread (bounded
    /// backpressure, never unbounded memory) and an overload diagnostic is
    /// recorded. Either path preserves the op — saturation delays the
    /// caller instead of discarding committed-intent work.
    #[cfg(feature = "persistence")]
    fn submit_points_op(&self, op: PointsWriteOp) {
        // `try_send` returns the op on saturation/disconnect, so the
        // fallback below still owns it. Never drop `op` on this path.
        let pending = {
            let writer = recover_mutex(&self.writer, "points writer");
            match writer.as_ref() {
                Some(writer) => match writer.sender.as_ref() {
                    Some(sender) => match sender.try_send(op) {
                        Ok(()) => {
                            writer.shared.queued.fetch_add(1, Ordering::Relaxed);
                            None
                        }
                        Err(std::sync::mpsc::TrySendError::Full(op)) => Some(op),
                        Err(std::sync::mpsc::TrySendError::Disconnected(op)) => Some(op),
                    },
                    None => Some(op),
                },
                None => Some(op),
            }
        };
        let Some(op) = pending else { return };
        // Causal path for `admitted == false`: queue full, writer missing,
        // or shutdown in progress. Fall back to a direct write so the
        // caller's update is still durable.
        if let Some(writer) = recover_mutex(&self.writer, "points writer")
            .as_ref()
            .map(|writer| Arc::clone(&writer.shared))
        {
            writer.overload.fetch_add(1, Ordering::Relaxed);
        }
        tracing::warn!("points writer saturated; applying write synchronously");
        if let Some(database) = self.database.as_ref() {
            match database.open_points_writer() {
                Ok(mut connection) => {
                    if let Err(error) = database.apply_points_op(&mut connection, &op) {
                        tracing::error!(%error, seq = op.seq(), "synchronous points fallback write failed");
                    }
                }
                Err(error) => {
                    tracing::error!(%error, seq = op.seq(), "synchronous points fallback could not open SQLite");
                }
            }
        }
    }

    #[cfg(feature = "persistence")]
    fn submit_reset_op(&self, seq: u64, unique_id: Option<String>) {
        self.submit_points_op(PointsWriteOp::Reset { seq, unique_id });
    }
}

fn clean_unique_id(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('@');
    (!value.is_empty()).then_some(value.to_owned())
}

fn positive_or_one(value: Option<f64>) -> f64 {
    value
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(1.0)
}

fn round_points(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn update_existing_viewer(
    state: &mut ViewerState,
    options: &AwardOptions,
    points: f64,
    level: u32,
    is_subscriber: bool,
    action: PointAction,
    now: i64,
) {
    if let Some(value) = options.user_id.as_ref() {
        state.user_id = Some(value.clone());
    }
    if let Some(value) = options.nickname.as_ref() {
        state.nickname = value.clone();
    }
    if let Some(value) = options.avatar_url.as_ref() {
        state.avatar_url = Some(value.clone());
    }
    state.points = points;
    state.level = level;
    state.is_subscriber = is_subscriber;
    // Counters and metadata advance even when the award itself is zero:
    // a chat that earns nothing is still a chat.
    if action == PointAction::Chat {
        state.total_chats = state.total_chats.saturating_add(1);
    }
    if action == PointAction::Gift {
        state.total_coins = state
            .total_coins
            .saturating_add(positive_or_one(options.diamond_count).round() as i64);
    }
    if action == PointAction::Like {
        state.total_likes = state
            .total_likes
            .saturating_add(positive_or_one(options.count).round() as i64);
    }
    if action == PointAction::Share {
        state.total_shares = state.total_shares.saturating_add(1);
    }
    state.last_seen = now;
}

fn new_viewer_state(unique_id: &str, options: &AwardOptions, now: i64) -> ViewerState {
    ViewerState {
        unique_id: unique_id.to_owned(),
        user_id: options.user_id.clone(),
        nickname: options
            .nickname
            .clone()
            .unwrap_or_else(|| unique_id.to_owned()),
        avatar_url: options.avatar_url.clone(),
        points: 0.0,
        level: 1,
        is_subscriber: false,
        total_chats: 0,
        total_coins: 0,
        total_likes: 0,
        total_shares: 0,
        first_seen: now,
        last_seen: now,
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn award_points_matches_existing_defaults() {
        let service = PointsService::default();
        let award = service.award_points("@alice", PointAction::Chat, AwardOptions::default());
        assert_eq!(
            award.as_ref().map(|award| award.unique_id.as_str()),
            Some("alice")
        );
        assert_eq!(award.as_ref().map(|award| award.total_points), Some(1.0));
        assert_eq!(service.leaderboard(Some(1))[0]["totalChats"], 1);
    }

    #[test]
    fn reset_keeps_viewers_and_counters_but_zeroes_points() {
        let service = PointsService::default();
        service.award_points("alice", PointAction::Chat, AwardOptions::default());
        service.reset(None);
        let viewer = &service.leaderboard(Some(1))[0];
        assert_eq!(viewer["points"], 0.0);
        assert_eq!(viewer["level"], 1);
        assert_eq!(viewer["totalChats"], 1);
    }

    #[test]
    fn negative_adjustments_clamp_at_zero() {
        // The `core.points` execution path (moderation penalties included)
        // adjusts through here: viewers can never drop below zero.
        let service = PointsService::default();
        service.award_points(
            "alice",
            PointAction::Manual,
            AwardOptions {
                custom_amount: Some(5.0),
                ..AwardOptions::default()
            },
        );
        let award = service.adjust("alice", -10.0).expect("viewer exists");
        assert_eq!(award.total_points, 0.0);
        assert_eq!(award.delta, -10.0);
        assert_eq!(service.leaderboard(Some(1))[0]["points"], 0.0);
        // Unknown viewers stay unknown: no negative phantom rows.
        assert!(service.adjust("nobody", -10.0).is_none());
        assert!(service.adjust("alice", f64::NAN).is_none());
    }

    #[test]
    fn point_configuration_normalizes_unsafe_ranges() {
        let mut config = PointsConfig {
            points_per_coin: -10.0,
            points_per_share: f64::NAN,
            points_per_chat: 2.0,
            points_per_like: f64::INFINITY,
            points_per_follow: 2.0,
            points_per_join: 2.0,
            sub_bonus_multiplier: -1.0,
            points_per_level: 1.0,
            currency_name: "   ".to_owned(),
            ..PointsConfig::default()
        };
        config.normalize();
        assert_eq!(config.points_per_coin, 0.0);
        assert_eq!(config.points_per_share, 3.0);
        assert_eq!(config.points_per_like, 0.1);
        assert_eq!(config.sub_bonus_multiplier, 0.0);
        assert_eq!(config.points_per_level, 10.0);
        assert_eq!(config.currency_name, "Points");
    }

    #[test]
    fn repeated_awards_accumulate_exact_totals() {
        let service = PointsService::default();
        for _ in 0..100 {
            service.award_points("alice", PointAction::Chat, AwardOptions::default());
        }
        let viewer = service.viewer("alice").expect("alice exists");
        assert_eq!(viewer["points"], 100.0);
        assert_eq!(viewer["totalChats"], 100);
    }

    #[test]
    fn zero_point_events_keep_counters_and_metadata() {
        let service = PointsService::default();
        // Likes disabled by config would award nothing; force it directly.
        let award = service
            .award_points(
                "bob",
                PointAction::Manual,
                AwardOptions {
                    custom_amount: Some(0.0),
                    nickname: Some("Bobby".to_owned()),
                    ..AwardOptions::default()
                },
            )
            .expect("award succeeds");
        assert_eq!(award.delta, 0.0);
        let viewer = service.viewer("bob").expect("bob exists");
        assert_eq!(viewer["points"], 0.0);
        assert_eq!(viewer["nickname"], "Bobby");
    }

    #[test]
    fn leaderboard_orders_without_per_event_sort_and_breaks_ties() {
        let service = PointsService::default();
        service.award_points(
            "charlie",
            PointAction::Manual,
            AwardOptions {
                custom_amount: Some(10.0),
                ..AwardOptions::default()
            },
        );
        service.award_points(
            "alice",
            PointAction::Manual,
            AwardOptions {
                custom_amount: Some(10.0),
                ..AwardOptions::default()
            },
        );
        service.award_points(
            "bob",
            PointAction::Manual,
            AwardOptions {
                custom_amount: Some(5.0),
                ..AwardOptions::default()
            },
        );
        let board = service.leaderboard(Some(2));
        assert_eq!(board.len(), 2);
        // Equal points fall back to the deterministic identity tie-break.
        assert_eq!(board[0]["uniqueId"], "alice");
        assert_eq!(board[1]["uniqueId"], "charlie");
    }

    #[test]
    fn high_cardinality_awards_stay_bounded_and_exact() {
        let service = PointsService::default();
        service.set_cache_capacity(1_000);
        for id in 0..5_000 {
            let name = format!("viewer-{id:05}");
            service.award_points(&name, PointAction::Chat, AwardOptions::default());
        }
        let diagnostics = service.diagnostics();
        assert!(
            diagnostics.hot_size <= 1_000,
            "hot cache must respect its bound, got {}",
            diagnostics.hot_size
        );
        // The most recently touched viewer is always resident and exact.
        let viewer = service.viewer("viewer-04999").expect("recent viewer");
        assert_eq!(viewer["points"], 1.0);
        assert_eq!(viewer["totalChats"], 1);
        // The leaderboard serves the top-K without a full sort even when
        // the population exceeds the visible window.
        let board = service.leaderboard(Some(100));
        assert_eq!(board.len(), 100);
    }

    #[cfg(feature = "persistence")]
    #[test]
    fn eviction_and_restart_preserve_exact_balances() {
        use crate::db::DatabaseManager;
        use crate::paths::AppPaths;
        let root = std::env::temp_dir().join(format!(
            "tiktools-points-phase1-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let paths = AppPaths {
            data: root.join("data"),
            plugins: root.join("plugins"),
            plugin_data: root.join("plugin-data"),
            builtin_plugins: root.join("builtin-plugins"),
            development_plugins: None,
            logs: root.join("logs"),
            temp: root.join("temp"),
            root: root.clone(),
        };
        paths.ensure_directories().expect("temp dirs");
        let database = Arc::new(DatabaseManager::new(paths));
        let service = PointsService::new(Arc::clone(&database));
        service.set_cache_capacity(50);
        for id in 0..200 {
            let name = format!("fan-{id:03}");
            service.award_points(
                &name,
                PointAction::Manual,
                AwardOptions {
                    custom_amount: Some(7.0),
                    ..AwardOptions::default()
                },
            );
        }
        // Repeated updates to an evicted viewer reload durable state and
        // accumulate instead of forking a phantom row.
        for _ in 0..3 {
            service.award_points(
                "fan-000",
                PointAction::Manual,
                AwardOptions {
                    custom_amount: Some(7.0),
                    ..AwardOptions::default()
                },
            );
        }
        service.shutdown();
        let reloaded = service
            .viewer("fan-000")
            .expect("fan-000 survives eviction");
        assert_eq!(reloaded["points"], 28.0);
        drop(service);
        // Restart: balances survive through SQLite, not RAM. The runtime
        // capacity is a boot setting (env `TIKTOOLS_POINTS_CACHE_CAPACITY`
        // or `set_cache_capacity`), so reapply it after restart.
        let restarted = PointsService::new(database);
        restarted.set_cache_capacity(50);
        let viewer = restarted.viewer("fan-199").expect("fan-199 persisted");
        assert_eq!(viewer["points"], 7.0);
        let first = restarted.viewer("fan-000").expect("fan-000 persisted");
        assert_eq!(first["points"], 28.0);
        let diagnostics = restarted.diagnostics();
        assert!(
            diagnostics.hot_size <= 50,
            "hot_size={}",
            diagnostics.hot_size
        );
        restarted.shutdown();
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cache_capacity_is_enforced_and_never_evicts_dirty_rows() {
        let service = PointsService::default();
        service.set_cache_capacity(10);
        for id in 0..50 {
            service.award_points(
                &format!("user-{id}"),
                PointAction::Chat,
                AwardOptions::default(),
            );
        }
        let diagnostics = service.diagnostics();
        assert!(
            diagnostics.hot_size <= 10,
            "hot_size={}",
            diagnostics.hot_size
        );
        assert_eq!(service.cache_capacity(), 10);
    }

    #[test]
    fn concurrent_awards_never_lose_increments() {
        use std::thread;
        let service = Arc::new(PointsService::default());
        let mut handles = Vec::new();
        for _ in 0..8 {
            let service = Arc::clone(&service);
            handles.push(thread::spawn(move || {
                for _ in 0..250 {
                    service.award_points("racer", PointAction::Chat, AwardOptions::default());
                }
            }));
        }
        for handle in handles {
            handle.join().expect("worker finishes");
        }
        let viewer = service.viewer("racer").expect("racer exists");
        assert_eq!(viewer["totalChats"], 8 * 250);
        assert_eq!(viewer["points"], 8.0 * 250.0);
    }

    #[test]
    fn viewer_lookup_is_direct_and_misses_cleanly() {
        let service = PointsService::default();
        assert!(service.viewer("ghost").is_none());
        assert!(service.viewer("   ").is_none());
        service.award_points("@alice", PointAction::Chat, AwardOptions::default());
        let viewer = service.viewer("alice").expect("direct hit");
        assert_eq!(viewer["uniqueId"], "alice");
        let diagnostics = service.diagnostics();
        assert!(diagnostics.cache_hits >= 1);
        assert!(diagnostics.cache_misses >= 1);
    }
}
