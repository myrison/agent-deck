# Unified Storage Layer Architecture

## Git Workflow Note

**IMPORTANT**: This branch was created from `feature/activity-ribbon-polling` (PR #84), not from `main`.

### Why?
PR #84 contains refactors that are about to be merged. Branching from it avoids merge conflicts and ensures this work builds on those changes.

### Before Creating PR
Once PR #84 is merged to main, rebase this branch:
```bash
git fetch origin
git rebase origin/main
# Resolve any conflicts if needed
git push --force-with-lease origin feature/unified-storage-layer
```

### Starting Point
- **Parent branch**: `feature/activity-ribbon-polling`
- **Parent commit**: `ab8dda3` (test(desktop): fix ActivityRibbon and statusLabel test issues)
- **PR #84 status at branch time**: Open, targeting main

---

## Problem Statement

The desktop app (`cmd/agent-deck-desktop/tmux.go`) has its own storage implementation that duplicates the production-hardened `Storage` in `internal/session/storage.go`:

### Desktop's Duplicate Implementation (~150 lines)
- `sessionsJSON`, `instanceJSON`, `groupJSON` structs
- `loadSessionsData()` - reads sessions.json
- `saveSessionsData()` - writes sessions.json with atomic write
- `persistInstanceUpdates()` - applies field updates
- `schedulePersist()` / `flushPendingUpdates()` - debounced writes
- `instanceUpdate` struct for tracking changes

### Problems with Duplication
1. **Maintenance burden**: Changes to storage format require updates in two places
2. **Feature gap**: Desktop lacks TUI's backup rotation, fsync, validation
3. **Drift risk**: Struct definitions can diverge (already have minor differences)
4. **Bug duplication**: Fixes to one implementation may not reach the other

## Solution: StorageAdapter

Create a `StorageAdapter` in `internal/session/` that wraps the production `Storage` with desktop-specific features:

```
┌─────────────────────────────────────────────────────────────┐
│                      Desktop App                             │
│  TmuxManager                                                 │
│    └── StorageAdapter (new)                                  │
│          ├── ScheduleUpdate() ── debounced writes           │
│          ├── FlushPendingUpdates() ── immediate write       │
│          └── wraps Storage (existing)                        │
│                ├── LoadWithGroups()                          │
│                ├── SaveStorageData() (new internal method)   │
│                ├── Atomic writes + fsync                     │
│                ├── Backup rotation                           │
│                └── Validation                                │
└─────────────────────────────────────────────────────────────┘
```

## Architecture

### StorageAdapter (`internal/session/storage_adapter.go`)

```go
type StorageAdapter struct {
    storage         *Storage
    persistMu       sync.Mutex
    pendingUpdates  map[string]FieldUpdate
    persistTimer    *time.Timer
    persistDebounce time.Duration
}

type FieldUpdate struct {
    Status            *string
    WaitingSince      *time.Time
    ClearWaitingSince bool
    CustomLabel       *string
    LastAccessedAt    *time.Time
}
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `NewStorageAdapter(profile, debounce)` | Create adapter with debounce duration |
| `LoadInstanceData()` | Load raw InstanceData (no tmux reconstruction) |
| `SaveInstanceData(instances, groups)` | Save raw data (used for new sessions) |
| `ScheduleUpdate(id, update)` | Queue debounced field update |
| `FlushPendingUpdates()` | Force immediate write of pending updates |

### Data Flow

**Loading** (Desktop startup):
```
StorageAdapter.LoadInstanceData()
    └── Storage.loadFromFile()
        └── Return []*InstanceData, []*GroupData
            └── Desktop converts to []SessionInfo (adds git info, status detection)
```

**Debounced Updates** (Status polling):
```
StorageAdapter.ScheduleUpdate(id, {Status: "waiting"})
    └── Merge into pendingUpdates map
    └── Reset debounce timer (500ms)
    └── Timer fires → FlushPendingUpdates()
        └── Storage.SaveStorageData() (atomic write)
```

**Immediate Writes** (Session creation):
```
StorageAdapter.SaveInstanceData(instances, groups)
    └── Storage.SaveStorageData() (atomic write with backups)
```

## Changes Required

### `internal/session/storage.go`
Add internal helper to share atomic write logic:
```go
// saveStorageData writes StorageData directly (used by StorageAdapter)
func (s *Storage) saveStorageData(data *StorageData) error
```

### `internal/session/storage_adapter.go` (NEW)
~200 lines implementing the adapter pattern with debounced writes.

### `cmd/agent-deck-desktop/tmux.go`
**Remove** (~150 lines):
- `sessionsJSON`, `instanceJSON`, `groupJSON` structs
- `loadSessionsData()`, `saveSessionsData()`
- `persistInstanceUpdates()`, `schedulePersist()`, `flushPendingUpdates()`
- `instanceUpdate` struct
- `fileMu`, `persistMu`, `pendingUpdates`, `persistTimer` fields

**Add** (~50 lines):
- `adapter *session.StorageAdapter` field
- Conversion helpers between `InstanceData` and `SessionInfo`

## Testing Strategy

### Unit Tests (`internal/session/storage_adapter_test.go`)
- `TestStorageAdapterDebouncedUpdates` - verify coalescing
- `TestStorageAdapterMergeFieldUpdates` - verify field merge logic
- `TestStorageAdapterConcurrentAccess` - verify thread safety

### Integration Tests (`cmd/agent-deck-desktop/tmux_storage_test.go`)
- `TestTmuxManagerUsesStorageAdapter` - verify desktop uses adapter
- `TestTmuxManagerDebouncedStatusUpdates` - verify debounce behavior

### Manual Testing
1. Run TUI and desktop simultaneously
2. Create session in desktop, verify TUI sees it
3. Modify session in TUI, verify desktop sees it
4. Rapid status changes coalesce (check logs for single write)

## Backward Compatibility

- **sessions.json format**: Unchanged
- **TUI behavior**: Unchanged (still uses Storage directly)
- **Desktop behavior**: Functionally identical, just uses shared code

## Rollback Plan

If issues arise, desktop can revert to direct file I/O by:
1. Revert tmux.go changes
2. Remove StorageAdapter (or keep for future use)
3. No data migration needed (format unchanged)
