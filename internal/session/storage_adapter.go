package session

import (
	"log"
	"sync"
	"time"
)

// FieldUpdate represents a partial update to an instance's fields.
// Only non-nil fields will be applied when the update is flushed.
type FieldUpdate struct {
	Status            *string    // New status value
	WaitingSince      *time.Time // When session entered waiting status
	ClearWaitingSince bool       // Set to true to clear WaitingSince
	CustomLabel       *string    // New custom label (empty string to remove)
	LastAccessedAt    *time.Time // When session was last accessed
	ClaudeSessionID   *string    // Discovered Claude session ID (from lazy detection)
}

// StorageAdapter wraps Storage with desktop-specific features like debounced writes.
// It works directly with InstanceData/GroupData (no tmux reconstruction) which is
// appropriate for the desktop app that handles tmux separately.
//
// Thread-safe: all operations are protected by appropriate mutexes.
type StorageAdapter struct {
	storage *Storage

	// Debounced persistence to coalesce rapid updates
	persistMu       sync.Mutex
	pendingUpdates  map[string]FieldUpdate
	persistTimer    *time.Timer
	persistDebounce time.Duration
}

// NewStorageAdapter creates a new StorageAdapter wrapping the given Storage.
// The debounce duration controls how long to wait before flushing pending updates.
// A typical value is 500ms which coalesces rapid status changes into single writes.
func NewStorageAdapter(storage *Storage, debounce time.Duration) *StorageAdapter {
	return &StorageAdapter{
		storage:         storage,
		pendingUpdates:  make(map[string]FieldUpdate),
		persistDebounce: debounce,
	}
}

// NewStorageAdapterWithProfile creates a StorageAdapter for a specific profile.
// This is a convenience constructor that creates the underlying Storage.
func NewStorageAdapterWithProfile(profile string, debounce time.Duration) (*StorageAdapter, error) {
	storage, err := NewStorageWithProfile(profile)
	if err != nil {
		return nil, err
	}
	return NewStorageAdapter(storage, debounce), nil
}

// Storage returns the underlying Storage instance.
// Useful when callers need direct access to Storage methods.
func (a *StorageAdapter) Storage() *Storage {
	return a.storage
}

// LoadStorageData reads raw StorageData from disk.
// Returns empty data (not nil) if file doesn't exist.
func (a *StorageAdapter) LoadStorageData() (*StorageData, error) {
	return a.storage.LoadStorageData()
}

// SaveStorageData writes StorageData to disk immediately (not debounced).
// Use this for full saves (e.g., creating/deleting sessions).
// For partial field updates, use ScheduleUpdate instead.
func (a *StorageAdapter) SaveStorageData(data *StorageData) error {
	return a.storage.SaveStorageData(data)
}

// ScheduleUpdate queues a field update for debounced persistence.
// Multiple updates to the same instance within the debounce window are merged.
// The update will be written to disk after the debounce duration elapses.
//
// This is ideal for status polling where many rapid updates would otherwise
// cause excessive disk writes and potential write amplification.
func (a *StorageAdapter) ScheduleUpdate(instanceID string, update FieldUpdate) {
	a.persistMu.Lock()
	defer a.persistMu.Unlock()

	// Merge with existing pending update
	if existing, ok := a.pendingUpdates[instanceID]; ok {
		// Prefer non-nil values from new update
		if update.Status != nil {
			existing.Status = update.Status
		}
		if update.WaitingSince != nil {
			existing.WaitingSince = update.WaitingSince
			existing.ClearWaitingSince = false // Setting a value overrides clear
		}
		if update.ClearWaitingSince {
			existing.ClearWaitingSince = true
			existing.WaitingSince = nil // Clear overrides any pending set
		}
		if update.CustomLabel != nil {
			existing.CustomLabel = update.CustomLabel
		}
		if update.LastAccessedAt != nil {
			existing.LastAccessedAt = update.LastAccessedAt
		}
		if update.ClaudeSessionID != nil {
			existing.ClaudeSessionID = update.ClaudeSessionID
		}
		a.pendingUpdates[instanceID] = existing
	} else {
		a.pendingUpdates[instanceID] = update
	}

	// Reset or start the debounce timer
	if a.persistTimer != nil {
		a.persistTimer.Stop()
	}
	a.persistTimer = time.AfterFunc(a.persistDebounce, func() {
		a.FlushPendingUpdates()
	})
}

// FlushPendingUpdates writes all pending updates to disk immediately.
// Call this when you need updates persisted before the debounce timer fires
// (e.g., before app shutdown).
func (a *StorageAdapter) FlushPendingUpdates() {
	a.persistMu.Lock()
	if len(a.pendingUpdates) == 0 {
		a.persistMu.Unlock()
		return
	}
	// Swap out pending updates so we don't hold persistMu during file I/O
	updates := a.pendingUpdates
	a.pendingUpdates = make(map[string]FieldUpdate)
	if a.persistTimer != nil {
		a.persistTimer.Stop()
		a.persistTimer = nil
	}
	a.persistMu.Unlock()

	// Apply updates to storage
	a.applyUpdates(updates)
}

// applyUpdates loads current data, applies field updates, and saves.
func (a *StorageAdapter) applyUpdates(updates map[string]FieldUpdate) {
	data, err := a.storage.LoadStorageData()
	if err != nil {
		log.Printf("[storage-adapter] Failed to load data for update: %v", err)
		return
	}

	modified := false
	for i := range data.Instances {
		inst := data.Instances[i]
		update, ok := updates[inst.ID]
		if !ok {
			continue
		}

		if update.Status != nil && Status(*update.Status) != inst.Status {
			log.Printf("[storage-adapter] %s: status %s -> %s", inst.ID, inst.Status, *update.Status)
			inst.Status = Status(*update.Status)
			modified = true
		}
		if update.WaitingSince != nil {
			log.Printf("[storage-adapter] %s: setting waitingSince to %v", inst.ID, *update.WaitingSince)
			inst.WaitingSince = *update.WaitingSince
			modified = true
		}
		if update.ClearWaitingSince && !inst.WaitingSince.IsZero() {
			log.Printf("[storage-adapter] %s: clearing waitingSince", inst.ID)
			inst.WaitingSince = time.Time{}
			modified = true
		}
		if update.CustomLabel != nil {
			inst.CustomLabel = *update.CustomLabel
			modified = true
		}
		if update.LastAccessedAt != nil {
			inst.LastAccessedAt = *update.LastAccessedAt
			modified = true
		}
		if update.ClaudeSessionID != nil && *update.ClaudeSessionID != inst.ClaudeSessionID {
			log.Printf("[storage-adapter] %s: discovered ClaudeSessionID %s", inst.ID, *update.ClaudeSessionID)
			inst.ClaudeSessionID = *update.ClaudeSessionID
			modified = true
		}
	}

	if modified {
		if err := a.storage.SaveStorageData(data); err != nil {
			log.Printf("[storage-adapter] Failed to save updates: %v", err)
		}
	}
}

// HasPendingUpdates returns true if there are updates waiting to be flushed.
// Useful for testing and shutdown logic.
func (a *StorageAdapter) HasPendingUpdates() bool {
	a.persistMu.Lock()
	defer a.persistMu.Unlock()
	return len(a.pendingUpdates) > 0
}

// PendingUpdateCount returns the number of instances with pending updates.
// Useful for testing and debugging.
func (a *StorageAdapter) PendingUpdateCount() int {
	a.persistMu.Lock()
	defer a.persistMu.Unlock()
	return len(a.pendingUpdates)
}
