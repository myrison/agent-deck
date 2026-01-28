package ssh

import (
	"testing"
	"time"
)

func TestPoolStatus_ReturnsEmptyForNoHosts(t *testing.T) {
	pool := NewPool()
	statuses := pool.Status()

	if len(statuses) != 0 {
		t.Errorf("Expected empty or nil statuses, got %d", len(statuses))
	}
}

func TestPoolRegister_AddsConfig(t *testing.T) {
	pool := NewPool()
	cfg := Config{Host: "test-host", User: "testuser"}

	pool.Register("test", cfg)

	got, exists := pool.GetConfig("test")
	if !exists {
		t.Fatal("Expected config to exist")
	}
	if got.Host != "test-host" || got.User != "testuser" {
		t.Errorf("Config mismatch: got %+v", got)
	}
}

func TestPoolListHosts_ReturnsRegisteredHosts(t *testing.T) {
	pool := NewPool()
	pool.Register("host1", Config{Host: "h1"})
	pool.Register("host2", Config{Host: "h2"})

	hosts := pool.ListHosts()
	if len(hosts) != 2 {
		t.Errorf("Expected 2 hosts, got %d", len(hosts))
	}

	// Check both hosts are present (order not guaranteed)
	hostMap := make(map[string]bool)
	for _, h := range hosts {
		hostMap[h] = true
	}
	if !hostMap["host1"] || !hostMap["host2"] {
		t.Errorf("Missing hosts: got %v", hosts)
	}
}

func TestPoolClose_RemovesConnection(t *testing.T) {
	pool := NewPool()
	pool.Register("test", Config{Host: "localhost"})

	// Simulate an established connection by injecting a connected state
	conn := NewConnection(Config{Host: "localhost"})
	conn.mu.Lock()
	conn.connected = true
	conn.mu.Unlock()

	pool.mu.Lock()
	pool.connections["test"] = conn
	pool.mu.Unlock()

	// Verify connection exists via public API before close
	if pool.GetIfExists("test") == nil {
		t.Fatal("Expected connection to exist before Close")
	}

	// Close should remove it
	pool.Close("test")

	// Verify via public API that connection no longer exists
	if pool.GetIfExists("test") != nil {
		t.Error("Expected GetIfExists to return nil after Close")
	}
}

func TestPoolCloseAll_RemovesAllConnections(t *testing.T) {
	pool := NewPool()
	pool.Register("h1", Config{Host: "host1"})
	pool.Register("h2", Config{Host: "host2"})

	// Simulate established connections
	for _, hid := range []string{"h1", "h2"} {
		conn := NewConnection(Config{Host: hid})
		conn.mu.Lock()
		conn.connected = true
		conn.mu.Unlock()

		pool.mu.Lock()
		pool.connections[hid] = conn
		pool.mu.Unlock()
	}

	// Verify connections exist via public API before close
	if pool.GetIfExists("h1") == nil || pool.GetIfExists("h2") == nil {
		t.Fatal("Expected connections to exist before CloseAll")
	}

	pool.CloseAll()

	// Verify via public API that no connections exist
	if pool.GetIfExists("h1") != nil {
		t.Error("Expected GetIfExists('h1') to return nil after CloseAll")
	}
	if pool.GetIfExists("h2") != nil {
		t.Error("Expected GetIfExists('h2') to return nil after CloseAll")
	}
}

func TestGetIfExists_ReturnsNilForUnconnectedConnection(t *testing.T) {
	pool := NewPool()
	pool.Register("test", Config{Host: "localhost"})

	// Manually add a connection that is NOT marked as connected
	conn := NewConnection(Config{Host: "localhost"})
	// Note: conn.connected defaults to false
	pool.mu.Lock()
	pool.connections["test"] = conn
	pool.mu.Unlock()

	// GetIfExists should return nil because connection is not marked connected
	result := pool.GetIfExists("test")
	if result != nil {
		t.Error("Expected nil for unconnected connection, got non-nil")
	}
}

func TestGetIfExists_ReturnsConnectionWhenConnected(t *testing.T) {
	pool := NewPool()
	pool.Register("test", Config{Host: "localhost"})

	// Manually add a connection that IS marked as connected
	conn := NewConnection(Config{Host: "localhost"})
	conn.mu.Lock()
	conn.connected = true
	conn.mu.Unlock()

	pool.mu.Lock()
	pool.connections["test"] = conn
	pool.mu.Unlock()

	// GetIfExists should return the connection
	result := pool.GetIfExists("test")
	if result == nil {
		t.Error("Expected connection, got nil")
	}
	if result != conn {
		t.Error("Expected same connection instance")
	}
}

func TestGetIfExists_ReturnsNilForNonexistentHost(t *testing.T) {
	pool := NewPool()

	result := pool.GetIfExists("nonexistent")
	if result != nil {
		t.Error("Expected nil for nonexistent host, got non-nil")
	}
}

func TestPoolStatus_UsesCachedStatusForRecentlyCheckedConnection(t *testing.T) {
	pool := NewPool()
	pool.Register("cached-host", Config{Host: "fake-host"})

	// Inject a recently-checked connected connection
	conn := NewConnection(Config{Host: "fake-host"})
	conn.mu.Lock()
	conn.connected = true
	conn.lastCheck = time.Now() // Recent - within cache duration
	conn.mu.Unlock()

	pool.mu.Lock()
	pool.connections["cached-host"] = conn
	pool.mu.Unlock()

	// Status should use cached result (not attempt SSH connection)
	statuses := pool.Status()

	if len(statuses) != 1 {
		t.Fatalf("Expected 1 status, got %d", len(statuses))
	}

	status := statuses[0]
	if status.HostID != "cached-host" {
		t.Errorf("Expected hostID 'cached-host', got %q", status.HostID)
	}
	if !status.Connected {
		t.Error("Expected Connected=true for cached connection")
	}
	if status.LastError != nil {
		t.Errorf("Expected no error for cached connection, got %v", status.LastError)
	}
}

func TestPoolStatus_ReturnsMultipleHostStatuses(t *testing.T) {
	pool := NewPool()
	pool.Register("host-a", Config{Host: "fake-a"})
	pool.Register("host-b", Config{Host: "fake-b"})

	// Inject cached connected connections for both
	for _, hid := range []string{"host-a", "host-b"} {
		conn := NewConnection(Config{Host: "fake"})
		conn.mu.Lock()
		conn.connected = true
		conn.lastCheck = time.Now()
		conn.mu.Unlock()

		pool.mu.Lock()
		pool.connections[hid] = conn
		pool.mu.Unlock()
	}

	statuses := pool.Status()

	if len(statuses) != 2 {
		t.Fatalf("Expected 2 statuses, got %d", len(statuses))
	}

	// Collect host IDs (order not guaranteed due to parallel execution)
	hostIDs := make(map[string]bool)
	for _, s := range statuses {
		hostIDs[s.HostID] = true
		if !s.Connected {
			t.Errorf("Expected Connected=true for %s", s.HostID)
		}
	}

	if !hostIDs["host-a"] || !hostIDs["host-b"] {
		t.Errorf("Missing expected hosts: got %v", hostIDs)
	}
}

func TestPoolStatus_CachedConnectionWithError(t *testing.T) {
	pool := NewPool()
	pool.Register("error-host", Config{Host: "fake-host"})

	// Inject a recently-checked connection that has an error
	conn := NewConnection(Config{Host: "fake-host"})
	testErr := &testError{msg: "connection refused"}
	conn.mu.Lock()
	conn.connected = false
	conn.lastError = testErr
	conn.lastCheck = time.Now()
	conn.mu.Unlock()

	pool.mu.Lock()
	pool.connections["error-host"] = conn
	pool.mu.Unlock()

	statuses := pool.Status()

	if len(statuses) != 1 {
		t.Fatalf("Expected 1 status, got %d", len(statuses))
	}

	status := statuses[0]
	if status.Connected {
		t.Error("Expected Connected=false for connection with error")
	}
	if status.LastError == nil {
		t.Fatal("Expected LastError to be set")
	}
	if status.LastError.Error() != "connection refused" {
		t.Errorf("Expected error message 'connection refused', got %q", status.LastError.Error())
	}
}

// testError is a simple error type for testing
type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}
