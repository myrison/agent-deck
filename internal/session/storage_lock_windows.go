//go:build windows

package session

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// fileLock provides cross-process file locking using LockFileEx (Windows).
// This prevents race conditions when multiple agent-deck processes
// read/modify/write sessions.json concurrently.
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

	// Acquire exclusive lock using LockFileEx
	// LOCKFILE_EXCLUSIVE_LOCK = 0x2, wait for lock (no LOCKFILE_FAIL_IMMEDIATELY)
	ol := &windows.Overlapped{}
	err = windows.LockFileEx(
		windows.Handle(f.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK,
		0,  // reserved
		1,  // nNumberOfBytesToLockLow
		0,  // nNumberOfBytesToLockHigh
		ol,
	)
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("failed to acquire lock: %w", err)
	}

	return &lockHandle{file: f}, nil
}

// Unlock releases the lock.
func (h *lockHandle) Unlock() error {
	if h == nil || h.file == nil {
		return nil
	}

	// Release the lock using UnlockFileEx
	ol := &windows.Overlapped{}
	err := windows.UnlockFileEx(
		windows.Handle(h.file.Fd()),
		0,  // reserved
		1,  // nNumberOfBytesToUnlockLow
		0,  // nNumberOfBytesToUnlockHigh
		ol,
	)
	if err != nil {
		h.file.Close()
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
