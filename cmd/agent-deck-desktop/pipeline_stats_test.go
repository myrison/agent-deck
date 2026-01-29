package main

import (
	"sync"
	"testing"
)

// =============================================================================
// Pipeline Stats Tests
// =============================================================================
//
// These tests verify the public API for pipeline instrumentation, used by the
// debug overlay to track data flow through the terminal polling pipeline.
// Tests focus on observable behavior via exported methods.

// TestResetPipelineStatsClearsAllCounters verifies that ResetPipelineStats
// sets all counters back to zero.
func TestResetPipelineStatsClearsAllCounters(t *testing.T) {
	term := NewTerminal("test-session")

	// Record some stats (linesProduced, historyGapLines, viewportDiffBytes, bytesSent, linesSent, durationMs, captureErr)
	term.recordPollStats(100, 20, 2048, 4096, 50, 10, false)
	term.recordPollStats(50, 10, 1024, 2048, 25, 5, true)

	// Verify stats are non-zero
	stats := term.GetPipelineStats()
	if stats.TmuxCaptureCount == 0 {
		t.Fatal("Stats should be non-zero before reset")
	}

	// Reset
	term.ResetPipelineStats()

	// Verify all counters are zero
	stats = term.GetPipelineStats()
	if stats.TmuxCaptureCount != 0 {
		t.Errorf("After reset: expected TmuxCaptureCount 0, got %d", stats.TmuxCaptureCount)
	}
	if stats.TmuxLinesProduced != 0 {
		t.Errorf("After reset: expected TmuxLinesProduced 0, got %d", stats.TmuxLinesProduced)
	}
	if stats.HistoryGapLines != 0 {
		t.Errorf("After reset: expected HistoryGapLines 0, got %d", stats.HistoryGapLines)
	}
	if stats.ViewportDiffBytes != 0 {
		t.Errorf("After reset: expected ViewportDiffBytes 0, got %d", stats.ViewportDiffBytes)
	}
	if stats.GoBackendLinesSent != 0 {
		t.Errorf("After reset: expected GoBackendLinesSent 0, got %d", stats.GoBackendLinesSent)
	}
	if stats.GoBackendBytesSent != 0 {
		t.Errorf("After reset: expected GoBackendBytesSent 0, got %d", stats.GoBackendBytesSent)
	}
	if stats.LastPollDurationMs != 0 {
		t.Errorf("After reset: expected LastPollDurationMs 0, got %d", stats.LastPollDurationMs)
	}
	if stats.TotalPollTimeMs != 0 {
		t.Errorf("After reset: expected TotalPollTimeMs 0, got %d", stats.TotalPollTimeMs)
	}
	if stats.PollCount != 0 {
		t.Errorf("After reset: expected PollCount 0, got %d", stats.PollCount)
	}
	if stats.CaptureErrors != 0 {
		t.Errorf("After reset: expected CaptureErrors 0, got %d", stats.CaptureErrors)
	}
	if stats.EmitErrors != 0 {
		t.Errorf("After reset: expected EmitErrors 0, got %d", stats.EmitErrors)
	}
}

// TestGetPipelineStatsReturnsCopy verifies that GetPipelineStats returns a copy
// of the stats, not a reference to internal state. Modifications to the returned
// struct should not affect the terminal's internal counters.
func TestGetPipelineStatsReturnsCopy(t *testing.T) {
	term := NewTerminal("test-session")

	// Record some stats (linesProduced, historyGapLines, viewportDiffBytes, bytesSent, linesSent, durationMs, captureErr)
	term.recordPollStats(100, 0, 1024, 2048, 50, 10, false)

	// Get stats
	stats1 := term.GetPipelineStats()
	originalCount := stats1.TmuxCaptureCount

	// Modify the returned struct (should not affect internal state)
	stats1.TmuxCaptureCount = 999

	// Get stats again
	stats2 := term.GetPipelineStats()

	// Verify internal state was not modified
	if stats2.TmuxCaptureCount != originalCount {
		t.Errorf("Expected TmuxCaptureCount %d (unchanged), got %d", originalCount, stats2.TmuxCaptureCount)
	}
}

// TestPipelineStatsConcurrentAccess verifies that concurrent access to pipeline
// stats is safe (no race conditions). This uses goroutines to simulate the
// polling loop recording stats while the debug overlay reads them.
func TestPipelineStatsConcurrentAccess(t *testing.T) {
	term := NewTerminal("test-session")

	var wg sync.WaitGroup
	iterations := 1000

	// Writer goroutine (simulates polling loop)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			term.recordPollStats(10, 2, 100, 200, 5, 1, i%10 == 0)
		}
	}()

	// Reader goroutine (simulates debug overlay polling)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			stats := term.GetPipelineStats()
			// Just access the fields to ensure no race
			_ = stats.TmuxCaptureCount
			_ = stats.PollCount
			_ = stats.CaptureErrors
		}
	}()

	// Reset goroutine (simulates user clicking reset in debug overlay)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations/10; i++ {
			term.ResetPipelineStats()
		}
	}()

	wg.Wait()

	// If we get here without a race detector complaint, the test passes
	// Final stats may be anything due to resets, just verify we can read them
	_ = term.GetPipelineStats()
}
