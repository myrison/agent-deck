package ssh

import (
	"sync"
	"time"
)

// Pool manages a collection of SSH connections to different hosts.
// It provides connection reuse, health checking, and cleanup.
type Pool struct {
	mu          sync.RWMutex
	connections map[string]*Connection // hostID -> connection
	configs     map[string]Config      // hostID -> config for reconnection
}

// NewPool creates a new connection pool
func NewPool() *Pool {
	return &Pool{
		connections: make(map[string]*Connection),
		configs:     make(map[string]Config),
	}
}

// globalPool is the default connection pool
var globalPool = NewPool()

// DefaultPool returns the global connection pool
func DefaultPool() *Pool {
	return globalPool
}

// Register adds a host configuration to the pool without connecting
func (p *Pool) Register(hostID string, cfg Config) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.configs[hostID] = cfg
}

// Get returns a connection for the given host, creating one if needed
func (p *Pool) Get(hostID string) (*Connection, error) {
	p.mu.RLock()
	conn, exists := p.connections[hostID]
	p.mu.RUnlock()

	if exists && conn.IsConnected() {
		return conn, nil
	}

	// Create new connection
	p.mu.Lock()
	defer p.mu.Unlock()

	// Double-check after acquiring write lock
	if conn, exists := p.connections[hostID]; exists && conn.IsConnected() {
		return conn, nil
	}

	cfg, hasCfg := p.configs[hostID]
	if !hasCfg {
		// Try to use hostID directly as hostname
		cfg = Config{Host: hostID}
	}

	conn = NewConnection(cfg)

	// Test the connection
	if err := conn.TestConnection(); err != nil {
		return nil, err
	}

	p.connections[hostID] = conn
	return conn, nil
}

// GetIfExists returns a connection if it exists and is connected, nil otherwise
func (p *Pool) GetIfExists(hostID string) *Connection {
	p.mu.RLock()
	defer p.mu.RUnlock()

	conn, exists := p.connections[hostID]
	if exists && conn.IsConnected() {
		return conn
	}
	return nil
}

// TestConnection tests if a host is reachable
func (p *Pool) TestConnection(hostID string) error {
	conn, err := p.Get(hostID)
	if err != nil {
		return err
	}
	return conn.TestConnection()
}

// HealthCheck tests all registered connections and returns their status
func (p *Pool) HealthCheck() map[string]error {
	p.mu.RLock()
	hostIDs := make([]string, 0, len(p.configs))
	for hostID := range p.configs {
		hostIDs = append(hostIDs, hostID)
	}
	p.mu.RUnlock()

	results := make(map[string]error)
	var wg sync.WaitGroup

	for _, hostID := range hostIDs {
		wg.Add(1)
		go func(hid string) {
			defer wg.Done()
			_, err := p.Get(hid)
			results[hid] = err
		}(hostID)
	}

	wg.Wait()
	return results
}

// Close closes a specific connection
func (p *Pool) Close(hostID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.connections, hostID)
}

// CloseAll closes all connections in the pool
func (p *Pool) CloseAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.connections = make(map[string]*Connection)
}

// ListHosts returns all registered host IDs
func (p *Pool) ListHosts() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	hosts := make([]string, 0, len(p.configs))
	for hostID := range p.configs {
		hosts = append(hosts, hostID)
	}
	return hosts
}

// GetConfig returns the configuration for a host
func (p *Pool) GetConfig(hostID string) (Config, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	cfg, exists := p.configs[hostID]
	return cfg, exists
}

// Status represents the status of a connection
type Status struct {
	HostID    string
	Connected bool
	LastError error
	LastCheck time.Time
}

// Status returns the status of all connections
func (p *Pool) Status() []Status {
	p.mu.RLock()
	defer p.mu.RUnlock()

	statuses := make([]Status, 0, len(p.configs))
	for hostID := range p.configs {
		status := Status{
			HostID: hostID,
		}
		if conn, exists := p.connections[hostID]; exists {
			status.Connected = conn.IsConnected()
			status.LastError = conn.LastError()
			conn.mu.Lock()
			status.LastCheck = conn.lastCheck
			conn.mu.Unlock()
		}
		statuses = append(statuses, status)
	}
	return statuses
}

// StartHealthChecker starts a background goroutine that periodically checks connections
func (p *Pool) StartHealthChecker(interval time.Duration, stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				p.HealthCheck()
			case <-stop:
				return
			}
		}
	}()
}
