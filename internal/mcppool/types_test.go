package mcppool

import "testing"

// TestServerStatusString verifies that ServerStatus.String() returns the correct
// human-readable representation for each status value. This is the status display
// contract used by the MCP pool UI and logging.
func TestServerStatusString(t *testing.T) {
	tests := []struct {
		status   ServerStatus
		expected string
	}{
		{StatusStopped, "stopped"},
		{StatusStarting, "starting"},
		{StatusRunning, "running"},
		{StatusFailed, "failed"},
		{ServerStatus(999), "unknown"}, // Invalid value should return "unknown"
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := tt.status.String()
			if result != tt.expected {
				t.Errorf("ServerStatus(%d).String() = %q, want %q", tt.status, result, tt.expected)
			}
		})
	}
}

// TestServerStatusConstants verifies the numeric values of status constants.
// This ensures backward compatibility - changing these values would break
// any code that stores or compares status as integers.
func TestServerStatusConstants(t *testing.T) {
	if StatusStopped != 0 {
		t.Errorf("StatusStopped = %d, want 0", StatusStopped)
	}
	if StatusStarting != 1 {
		t.Errorf("StatusStarting = %d, want 1", StatusStarting)
	}
	if StatusRunning != 2 {
		t.Errorf("StatusRunning = %d, want 2", StatusRunning)
	}
	if StatusFailed != 3 {
		t.Errorf("StatusFailed = %d, want 3", StatusFailed)
	}
}
