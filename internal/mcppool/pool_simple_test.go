package mcppool

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestPoolShouldPool verifies the decision tree for whether an MCP should be pooled.
// This tests the core business logic: pool-all mode with exclusions, pool-specific mode,
// and disabled mode.
func TestPoolShouldPool(t *testing.T) {
	tests := []struct {
		name        string
		config      *PoolConfig
		mcpName     string
		shouldPool  bool
	}{
		{
			name:       "disabled pool returns false",
			config:     &PoolConfig{Enabled: false, PoolAll: false},
			mcpName:    "any-mcp",
			shouldPool: false,
		},
		{
			name:       "pool-all mode includes by default",
			config:     &PoolConfig{Enabled: true, PoolAll: true, ExcludeMCPs: []string{}},
			mcpName:    "filesystem",
			shouldPool: true,
		},
		{
			name:       "pool-all mode excludes explicitly excluded MCPs",
			config:     &PoolConfig{Enabled: true, PoolAll: true, ExcludeMCPs: []string{"github", "slack"}},
			mcpName:    "github",
			shouldPool: false,
		},
		{
			name:       "pool-all mode includes non-excluded MCPs",
			config:     &PoolConfig{Enabled: true, PoolAll: true, ExcludeMCPs: []string{"github"}},
			mcpName:    "filesystem",
			shouldPool: true,
		},
		{
			name:       "pool-specific mode includes explicitly listed MCPs",
			config:     &PoolConfig{Enabled: true, PoolAll: false, PoolMCPs: []string{"puppeteer", "filesystem"}},
			mcpName:    "puppeteer",
			shouldPool: true,
		},
		{
			name:       "pool-specific mode excludes unlisted MCPs",
			config:     &PoolConfig{Enabled: true, PoolAll: false, PoolMCPs: []string{"puppeteer"}},
			mcpName:    "github",
			shouldPool: false,
		},
		{
			name:       "pool-specific mode excludes when pool list is empty",
			config:     &PoolConfig{Enabled: true, PoolAll: false, PoolMCPs: []string{}},
			mcpName:    "filesystem",
			shouldPool: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool, err := NewPool(context.Background(), tt.config)
			if err != nil {
				t.Fatalf("NewPool failed: %v", err)
			}
			defer func() { _ = pool.Shutdown() }()

			result := pool.ShouldPool(tt.mcpName)
			if result != tt.shouldPool {
				t.Errorf("ShouldPool(%q) = %v, want %v", tt.mcpName, result, tt.shouldPool)
			}
		})
	}
}

// TestPoolIsRunningReturnsFalseForNonexistent verifies that IsRunning returns false
// for proxies that haven't been started. This is the error-path behavior.
func TestPoolIsRunningReturnsFalseForNonexistent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	config := &PoolConfig{Enabled: true}
	pool, err := NewPool(ctx, config)
	if err != nil {
		t.Fatalf("NewPool failed: %v", err)
	}
	defer func() { _ = pool.Shutdown() }()

	// Nonexistent proxy should not be running
	if pool.IsRunning("nonexistent-mcp") {
		t.Error("IsRunning should return false for nonexistent proxy")
	}
}

// TestPoolGetSocketPath verifies that getting a socket path returns empty for nonexistent proxies.
func TestPoolGetSocketPath(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	config := &PoolConfig{Enabled: true}
	pool, err := NewPool(ctx, config)
	if err != nil {
		t.Fatalf("NewPool failed: %v", err)
	}
	defer func() { _ = pool.Shutdown() }()

	// Nonexistent proxy should return empty path
	path := pool.GetSocketPath("nonexistent")
	if path != "" {
		t.Errorf("GetSocketPath for nonexistent proxy = %q, want empty string", path)
	}
}

// TestPoolFallbackEnabled is removed - it was just testing a simple accessor,
// which doesn't verify meaningful behavior. The fallback functionality itself
// would be tested in integration tests where actual MCP processes are started.

// TestPoolShutdownCancelsContext verifies that Shutdown cancels the pool's context.
// This is important for stopping background health monitors.
func TestPoolShutdownCancelsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	config := &PoolConfig{Enabled: true}
	pool, err := NewPool(ctx, config)
	if err != nil {
		t.Fatalf("NewPool failed: %v", err)
	}

	// Verify context is not canceled before shutdown
	select {
	case <-pool.ctx.Done():
		t.Fatal("Pool context should not be canceled before Shutdown")
	default:
		// Expected: context not canceled
	}

	// Shutdown the pool
	if err := pool.Shutdown(); err != nil {
		t.Fatalf("Shutdown failed: %v", err)
	}

	// Verify context is canceled after shutdown
	select {
	case <-pool.ctx.Done():
		// Expected: context is canceled
	case <-time.After(100 * time.Millisecond):
		t.Error("Pool context should be canceled after Shutdown")
	}
}

// TestPoolGetRunningCountZero is removed - it only tests the trivial zero case.
// A meaningful test would verify the count increases when proxies are actually started,
// which requires integration testing with real MCP processes.

// TestPoolListServersReturnsSlice verifies that ListServers returns a non-nil slice
// even when the pool is empty. This prevents nil pointer dereferences in callers.
func TestPoolListServersReturnsSlice(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	config := &PoolConfig{Enabled: true}
	pool, err := NewPool(ctx, config)
	if err != nil {
		t.Fatalf("NewPool failed: %v", err)
	}
	defer func() { _ = pool.Shutdown() }()

	servers := pool.ListServers()
	if servers == nil {
		t.Error("ListServers() should return empty slice, not nil - nil would cause panics in range loops")
	}
}

// TestIsSocketAliveCheck verifies socket liveness detection for nonexistent sockets.
func TestIsSocketAliveCheckNonexistent(t *testing.T) {
	tmpDir := t.TempDir()
	nonexistentPath := filepath.Join(tmpDir, "nonexistent.sock")

	// Nonexistent socket should not be alive
	if isSocketAliveCheck(nonexistentPath) {
		t.Error("isSocketAliveCheck should return false for nonexistent socket")
	}
}

// TestIsSocketAliveCheckRegularFile verifies that a regular file is not considered a live socket.
func TestIsSocketAliveCheckRegularFile(t *testing.T) {
	tmpDir := t.TempDir()
	regularFile := filepath.Join(tmpDir, "file.txt")

	// Create a regular file
	if err := os.WriteFile(regularFile, []byte("not a socket"), 0600); err != nil {
		t.Fatalf("Failed to create regular file: %v", err)
	}

	// Regular file should not be considered a live socket
	if isSocketAliveCheck(regularFile) {
		t.Error("isSocketAliveCheck should return false for regular file")
	}
}

// TestPoolDiscoverExistingSocketsNoSockets is removed - it doesn't verify meaningful behavior.
// A proper test would create a fake socket in /tmp and verify it gets discovered,
// but that's complex and fragile (depends on /tmp state, cleanup issues).

// TestPoolRegisterExternalSocketIdempotent verifies that registering the same socket twice is safe.
func TestPoolRegisterExternalSocketIdempotent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	config := &PoolConfig{Enabled: true}
	pool, err := NewPool(ctx, config)
	if err != nil {
		t.Fatalf("NewPool failed: %v", err)
	}
	defer func() { _ = pool.Shutdown() }()

	tmpDir := t.TempDir()
	socketPath := filepath.Join(tmpDir, "test.sock")

	// Register the same socket twice
	err1 := pool.RegisterExternalSocket("test-mcp", socketPath)
	if err1 != nil {
		t.Fatalf("First RegisterExternalSocket failed: %v", err1)
	}

	err2 := pool.RegisterExternalSocket("test-mcp", socketPath)
	if err2 != nil {
		t.Fatalf("Second RegisterExternalSocket should be idempotent, got error: %v", err2)
	}

	// Verify socket is registered (appears in list)
	servers := pool.ListServers()
	found := false
	for _, s := range servers {
		if s.Name == "test-mcp" {
			found = true
			break
		}
	}
	if !found {
		t.Error("RegisterExternalSocket should add socket to list")
	}
}
