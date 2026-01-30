//go:build !windows

package session

import (
	"fmt"
	"os"
	"syscall"
)

// fileLock provides cross-process file locking using flock (Unix only).
// This prevents race conditions when multiple agent-deck processes
// (e.g., parallel spawn-worker.sh calls) read/modify/write sessions.json.
type fileLock struct {
	path string
}

// lockHandle represents an acquired lock that must be released.
type lockHandle struct {
	file *os.File
}

// newFileLock creates a new file lock for the given path.
// The lock file will be created at path + ".lock".
func newFileLock(path string) *fileLock {
	return &fileLock{
		path: path + ".lock",
	}
}

// Lock acquires an exclusive lock on the file.
// Blocks until the lock is acquired.
// Returns a lockHandle that must be used to release the lock.
func (l *fileLock) Lock() (*lockHandle, error) {
	// Open or create the lock file
	f, err := os.OpenFile(l.path, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, fmt.Errorf("failed to open lock file: %w", err)
	}

	// Acquire exclusive lock (blocks until available)
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("failed to acquire lock: %w", err)
	}

	return &lockHandle{file: f}, nil
}

// Unlock releases the lock.
func (h *lockHandle) Unlock() error {
	if h == nil || h.file == nil {
		return nil
	}

	// Release the lock
	if err := syscall.Flock(int(h.file.Fd()), syscall.LOCK_UN); err != nil {
		_ = h.file.Close()
		h.file = nil
		return fmt.Errorf("failed to release lock: %w", err)
	}

	// Close the file
	if err := h.file.Close(); err != nil {
		h.file = nil
		return fmt.Errorf("failed to close lock file: %w", err)
	}

	h.file = nil
	return nil
}
