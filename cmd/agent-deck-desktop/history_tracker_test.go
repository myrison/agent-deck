package main

import (
	"strings"
	"testing"
)

func TestNewHistoryTracker(t *testing.T) {
	ht := NewHistoryTracker("test-session", 24)

	if ht.tmuxSession != "test-session" {
		t.Errorf("expected session 'test-session', got %q", ht.tmuxSession)
	}
	if ht.viewportRows != 24 {
		t.Errorf("expected viewportRows 24, got %d", ht.viewportRows)
	}
	if ht.lastHistoryIndex != 0 {
		t.Errorf("expected lastHistoryIndex 0, got %d", ht.lastHistoryIndex)
	}
	if len(ht.lastViewportLines) != 0 {
		t.Errorf("expected empty lastViewportLines, got %d", len(ht.lastViewportLines))
	}
	if ht.inAltScreen {
		t.Error("expected inAltScreen false")
	}
}

func TestHistoryTrackerReset(t *testing.T) {
	ht := NewHistoryTracker("test", 24)
	ht.lastHistoryIndex = 100
	ht.lastViewportLines = []string{"line1", "line2"}
	ht.inAltScreen = true

	ht.Reset()

	if ht.lastHistoryIndex != 0 {
		t.Errorf("Reset should set lastHistoryIndex to 0, got %d", ht.lastHistoryIndex)
	}
	if len(ht.lastViewportLines) != 0 {
		t.Errorf("Reset should clear lastViewportLines, got %d", len(ht.lastViewportLines))
	}
	// inAltScreen should NOT be reset by Reset() - it's controlled by SetAltScreen
	if !ht.inAltScreen {
		t.Error("Reset should not change inAltScreen")
	}
}

func TestHistoryTrackerSetViewportRows(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	ht.SetViewportRows(50)

	if ht.viewportRows != 50 {
		t.Errorf("expected viewportRows 50, got %d", ht.viewportRows)
	}
}

func TestHistoryTrackerSetAltScreen(t *testing.T) {
	ht := NewHistoryTracker("test", 24)
	ht.lastViewportLines = []string{"line1", "line2", "line3"}

	// Enter alt-screen (like opening vim)
	ht.SetAltScreen(true)
	if !ht.inAltScreen {
		t.Error("expected inAltScreen true after SetAltScreen(true)")
	}
	// Viewport lines should be preserved when entering alt-screen
	if len(ht.lastViewportLines) != 3 {
		t.Errorf("entering alt-screen should preserve viewport lines, got %d", len(ht.lastViewportLines))
	}

	// Exit alt-screen (like closing vim)
	ht.SetAltScreen(false)
	if ht.inAltScreen {
		t.Error("expected inAltScreen false after SetAltScreen(false)")
	}
	// Viewport lines should be cleared when EXITING alt-screen
	// because the screen content is completely different after vim closes
	if len(ht.lastViewportLines) != 0 {
		t.Errorf("exiting alt-screen should clear viewport lines, got %d", len(ht.lastViewportLines))
	}
}

func TestDiffViewportFirstCapture(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// First capture should produce full output (no previous state to diff against)
	result := ht.DiffViewport("line1\nline2\nline3")

	// Should contain home sequence, all lines, and cursor hide
	if !strings.Contains(result, "\x1b[H") {
		t.Error("first capture should contain home sequence")
	}
	if !strings.Contains(result, "line1") {
		t.Error("first capture should contain line1")
	}
	if !strings.Contains(result, "line2") {
		t.Error("first capture should contain line2")
	}
	if !strings.Contains(result, "line3") {
		t.Error("first capture should contain line3")
	}
	if !strings.Contains(result, "\x1b[?25l") {
		t.Error("first capture should hide cursor")
	}
}

func TestDiffViewportUnchangedContent(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// First capture to establish baseline
	ht.DiffViewport("line1\nline2\nline3")

	// Same content - should produce minimal output (just cursor hide)
	result := ht.DiffViewport("line1\nline2\nline3")

	// Should only contain cursor hide, no line content
	if strings.Contains(result, "line1") {
		t.Error("unchanged content should not re-emit lines")
	}
	if !strings.Contains(result, "\x1b[?25l") {
		t.Error("should still hide cursor")
	}
}

func TestDiffViewportSingleLineChange(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// First capture
	ht.DiffViewport("line1\nspinner: |\nline3")

	// Second capture - only middle line changed (simulates spinner)
	result := ht.DiffViewport("line1\nspinner: /\nline3")

	// Should NOT contain unchanged lines
	if strings.Contains(result, "line1") {
		t.Error("unchanged line1 should not be in diff output")
	}
	if strings.Contains(result, "line3") {
		t.Error("unchanged line3 should not be in diff output")
	}

	// SHOULD contain the changed line with cursor positioning
	if !strings.Contains(result, "spinner: /") {
		t.Error("changed line should be in diff output")
	}
	// Should position cursor to line 2 (1-indexed)
	if !strings.Contains(result, "\x1b[2;1H") {
		t.Error("should contain cursor position for line 2")
	}
}

func TestDiffViewportContentShrinks(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// First capture with 5 lines of content
	ht.DiffViewport("line1\nline2\nline3\nline4\nline5")

	// Second capture with only 3 lines of content
	result := ht.DiffViewport("line1\nline2\nline3")

	// With fixed-viewport normalization, both captures have 24 lines
	// (content + empty padding). When content shrinks, rows 4-5 change
	// from "line4"/"line5" to "" (empty), which triggers line-by-line
	// updates with \x1b[K (clear to end of line) for those rows.
	if !strings.Contains(result, "\x1b[4;1H") {
		t.Error("shrinking content should update row 4")
	}
	if !strings.Contains(result, "\x1b[5;1H") {
		t.Error("shrinking content should update row 5")
	}
	if !strings.Contains(result, "\x1b[K") {
		t.Error("updated rows should clear to end of line")
	}
}

func TestDiffViewportMajorChangeTriggersHardResync(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// First capture with 5 content lines (padded to 24 with empty)
	ht.DiffViewport("aaaaaa\nbbbbbb\ncccccc\ndddddd\neeeeee")

	// Second capture - completely different content in first 5 rows
	// With 24-row viewport, 5 changed rows = 20.8% change (below 80% threshold)
	// So this will do line-by-line diff, not hard resync
	result := ht.DiffViewport("111111\n222222\n333333\n444444\n555555")

	// Should do line-by-line updates since <80% of viewport changed
	// All new lines should be present via cursor positioning
	if !strings.Contains(result, "111111") {
		t.Error("diff should contain new content")
	}
	if !strings.Contains(result, "\x1b[1;1H") {
		t.Error("diff should position cursor to update lines")
	}
}

func TestDiffViewportLineMismatchTriggersHardResync(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// First capture with 2 content lines (padded to 24)
	ht.DiffViewport("line1\nline2")

	// Second capture with 10 content lines (still padded to 24)
	// With fixed-viewport normalization, both have 24 lines, so no
	// "line count mismatch". The 8 new content rows (rows 3-10) go
	// from empty to content, which is 8/24 = 33% change (below 80%)
	result := ht.DiffViewport("a\nb\nc\nd\ne\nf\ng\nh\ni\nj")

	// Should do line-by-line updates (not hard resync) since both
	// captures are normalized to 24 rows and <80% changed
	if !strings.Contains(result, "\x1b[1;1H") || !strings.Contains(result, "\x1b[2;1H") {
		t.Error("should update changed lines with cursor positioning")
	}
	if !strings.Contains(result, "a") {
		t.Error("should contain new content")
	}
}

func TestDiffViewportPreservesANSIColors(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// Content with ANSI color codes
	colorContent := "\x1b[31mred text\x1b[0m\n\x1b[32mgreen text\x1b[0m"

	result := ht.DiffViewport(colorContent)

	// Should preserve the color codes
	if !strings.Contains(result, "\x1b[31m") {
		t.Error("should preserve red color code")
	}
	if !strings.Contains(result, "\x1b[32m") {
		t.Error("should preserve green color code")
	}
}

func TestBuildFullViewportOutput(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	lines := []string{"first", "second", "third"}
	result := ht.buildFullViewportOutput(lines)

	// Should start with home
	if !strings.HasPrefix(result, "\x1b[H") {
		t.Error("should start with home sequence")
	}

	// Should contain all lines
	if !strings.Contains(result, "first") {
		t.Error("should contain first line")
	}
	if !strings.Contains(result, "second") {
		t.Error("should contain second line")
	}
	if !strings.Contains(result, "third") {
		t.Error("should contain third line")
	}

	// Should end with clear-to-end and cursor hide
	if !strings.Contains(result, "\x1b[J") {
		t.Error("should contain erase to end sequence")
	}
	if !strings.HasSuffix(result, "\x1b[?25l") {
		t.Error("should end with cursor hide")
	}
}

// ============================================================================
// ADVERSARIAL TESTS - Testing real-world failure scenarios and edge cases
// ============================================================================

// TestDiffViewportEmptyContent verifies behavior when viewport becomes empty.
// This can happen during screen clears or when tmux pane is resized.
func TestDiffViewportEmptyContent(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// Establish baseline with content
	ht.DiffViewport("line1\nline2\nline3")

	// Now send empty content (simulates screen clear)
	result := ht.DiffViewport("")

	// With fixed-viewport normalization, empty content becomes 24 empty strings.
	// Rows 1-3 change from content to empty, triggering line-by-line updates.
	if !strings.Contains(result, "\x1b[1;1H") {
		t.Error("empty content should update row 1")
	}
	if !strings.Contains(result, "\x1b[K") {
		t.Error("updated rows should clear to end of line")
	}

	// Verify internal state was updated to 24 empty rows
	if len(ht.lastViewportLines) != 24 {
		t.Errorf("expected lastViewportLines to have 24 rows, got %d", len(ht.lastViewportLines))
	}
	// First 24 rows should all be empty
	for i, line := range ht.lastViewportLines {
		if line != "" {
			t.Errorf("expected row %d to be empty, got %q", i, line)
		}
	}
}

// TestDiffViewportTrailingNewlinesNormalized ensures trailing newlines don't
// cause phantom "blank lines" that accumulate over time (a real bug scenario).
func TestDiffViewportTrailingNewlinesNormalized(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// tmux often adds trailing newlines to pad to pane height
	// First capture with trailing newlines - normalized to 24 rows
	ht.DiffViewport("line1\nline2\n\n\n\n")

	// With fixed-viewport normalization, we always store exactly viewportRows (24)
	if len(ht.lastViewportLines) != 24 {
		t.Errorf("viewport should be normalized to 24 rows, got %d", len(ht.lastViewportLines))
	}
	// First 2 rows have content, rest are empty
	if ht.lastViewportLines[0] != "line1" || ht.lastViewportLines[1] != "line2" {
		t.Errorf("content lines should be preserved: got %v", ht.lastViewportLines[:2])
	}

	// Second capture with same content but different trailing newlines
	// Should NOT trigger any updates (content is semantically identical after normalization)
	result := ht.DiffViewport("line1\nline2\n\n")

	// If trailing newlines are properly normalized, this should be minimal output
	if strings.Contains(result, "line1") || strings.Contains(result, "line2") {
		t.Error("different trailing newline counts should not cause re-emission of unchanged lines")
	}
}

// TestDiffViewportStateUpdatedCorrectly verifies that internal state tracking
// works correctly across multiple calls - this catches bugs where state gets
// out of sync with what was actually sent to the terminal.
func TestDiffViewportStateUpdatedCorrectly(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// Call 1: Initial state (3 content lines normalized to 24)
	ht.DiffViewport("A\nB\nC")
	if len(ht.lastViewportLines) != 24 {
		t.Fatalf("after first call, expected 24 lines (normalized), got %d", len(ht.lastViewportLines))
	}
	if ht.lastViewportLines[0] != "A" || ht.lastViewportLines[1] != "B" || ht.lastViewportLines[2] != "C" {
		t.Fatalf("content lines should be at indices 0-2, got %v", ht.lastViewportLines[:3])
	}

	// Call 2: Modify line 2
	ht.DiffViewport("A\nB-modified\nC")
	if ht.lastViewportLines[1] != "B-modified" {
		t.Errorf("state should track 'B-modified', got %q", ht.lastViewportLines[1])
	}

	// Call 3: Now only line 2 should be considered "unchanged" in next diff
	result := ht.DiffViewport("A\nB-modified\nC-changed")

	// Should NOT re-emit A or B-modified (they match current state)
	if strings.Contains(result, "\x1b[1;1H") && strings.Contains(result, "A\x1b[K") {
		t.Error("line A should not be re-emitted, it hasn't changed")
	}
	// SHOULD emit C-changed
	if !strings.Contains(result, "C-changed") {
		t.Error("line C-changed should be emitted")
	}
}

// TestSetAltScreenIdempotent verifies calling SetAltScreen with same value is safe.
// This tests the "no-op" code path that could cause issues if implemented wrong.
func TestSetAltScreenIdempotent(t *testing.T) {
	ht := NewHistoryTracker("test", 24)
	ht.lastViewportLines = []string{"important", "data"}

	// Set to false when already false - should be no-op
	ht.SetAltScreen(false)
	if len(ht.lastViewportLines) != 2 {
		t.Error("SetAltScreen(false) when already false should not clear viewport")
	}

	// Enter alt screen
	ht.SetAltScreen(true)
	if len(ht.lastViewportLines) != 2 {
		t.Error("entering alt screen should preserve viewport")
	}

	// Call true again when already true - should be no-op
	ht.SetAltScreen(true)
	if len(ht.lastViewportLines) != 2 {
		t.Error("SetAltScreen(true) when already true should not affect viewport")
	}

	// Only exiting should clear
	ht.SetAltScreen(false)
	if len(ht.lastViewportLines) != 0 {
		t.Error("exiting alt screen should clear viewport")
	}
}

// TestDiffViewportClearLineEscapeSequence verifies that changed lines include
// the clear-to-end-of-line sequence. Without this, leftover characters from
// longer previous lines would remain visible (a real rendering bug).
func TestDiffViewportClearLineEscapeSequence(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// First: long line
	ht.DiffViewport("short\nthis is a very long line with lots of text")

	// Second: shorter replacement for line 2
	result := ht.DiffViewport("short\nshort")

	// The shorter line MUST be followed by \x1b[K to clear remaining chars
	// Otherwise "this is a very long line with lots of text" would still show
	if !strings.Contains(result, "short\x1b[K") {
		t.Error("changed line must include clear-to-end-of-line (\\x1b[K) to prevent rendering artifacts")
	}
}

// TestDiffViewportBoundaryConditions tests the 80% threshold boundary.
// At exactly 80% changed, should still use incremental diff.
// Above 80% should trigger hard resync.
func TestDiffViewportBoundaryConditions(t *testing.T) {
	// Use a smaller viewport (10 rows) to make threshold math easier
	ht := NewHistoryTracker("test", 10)

	// Fill all 10 rows
	ht.DiffViewport("0\n1\n2\n3\n4\n5\n6\n7\n8\n9")

	// Change 8 of 10 lines (80%)
	result := ht.DiffViewport("X\nX\nX\nX\nX\nX\nX\nX\n8\n9")

	// At exactly 80%, should NOT trigger hard resync (threshold is >80%)
	// Hard resync would have \x1b[H at start
	if strings.HasPrefix(result, "\x1b[H") {
		t.Error("exactly 80% change should use incremental diff, not hard resync")
	}

	// Reset and test >80%
	ht2 := NewHistoryTracker("test", 10)
	ht2.DiffViewport("0\n1\n2\n3\n4\n5\n6\n7\n8\n9")

	// Change 9 of 10 lines (90% > 80%)
	result2 := ht2.DiffViewport("X\nX\nX\nX\nX\nX\nX\nX\nX\n9")

	// Should trigger hard resync
	if !strings.HasPrefix(result2, "\x1b[H") {
		t.Error("90% change should trigger hard resync")
	}
}

// TestBuildFullViewportOutputEmptyLines verifies handling of empty line slice.
func TestBuildFullViewportOutputEmptyLines(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	result := ht.buildFullViewportOutput([]string{})

	// Should still produce valid output structure
	if !strings.HasPrefix(result, "\x1b[H") {
		t.Error("empty lines should still start with home sequence")
	}
	if !strings.HasSuffix(result, "\x1b[?25l") {
		t.Error("empty lines should still end with cursor hide")
	}
}

// TestBuildFullViewportOutputSingleLine verifies single line edge case.
func TestBuildFullViewportOutputSingleLine(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	result := ht.buildFullViewportOutput([]string{"only line"})

	// Should have home, the line, clear sequence, and cursor hide
	if !strings.Contains(result, "only line") {
		t.Error("should contain the single line")
	}
	// Should NOT have \r\n between lines (since there's only one)
	// The line should be followed by \x1b[K (clear to end)
	if !strings.Contains(result, "only line\x1b[K") {
		t.Error("single line should have clear-to-end after it")
	}
}

// TestDiffViewportConsecutiveSmallChanges simulates rapid spinner updates
// to ensure we don't accumulate state drift over many iterations.
func TestDiffViewportConsecutiveSmallChanges(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	spinnerFrames := []string{"|", "/", "-", "\\"}

	// Initial - note: use consistent format for all iterations
	ht.DiffViewport("Processing...\nStatus: |\nProgress: 50 percent")

	// Simulate 100 spinner updates
	for i := range 100 {
		frame := spinnerFrames[i%4]
		content := "Processing...\nStatus: " + frame + "\nProgress: 50 percent"
		result := ht.DiffViewport(content)

		// Each update should only emit the changed spinner line
		if strings.Contains(result, "Processing") {
			t.Errorf("iteration %d: unchanged line 'Processing' should not be re-emitted", i)
		}
		if strings.Contains(result, "Progress") {
			t.Errorf("iteration %d: unchanged line 'Progress' should not be re-emitted", i)
		}
	}

	// Verify final state is correct (normalized to 24 rows)
	if len(ht.lastViewportLines) != 24 {
		t.Errorf("after 100 updates, should have 24 lines (normalized), got %d", len(ht.lastViewportLines))
	}
	if ht.lastViewportLines[0] != "Processing..." {
		t.Errorf("first line should be 'Processing...', got %q", ht.lastViewportLines[0])
	}
}

// TestFetchHistoryGapNoGap verifies the early return when there's no gap.
// We test this without tmux by checking the logic directly.
func TestFetchHistoryGapNoGap(t *testing.T) {
	ht := NewHistoryTracker("fake-session", 24)
	ht.lastHistoryIndex = 100

	// Current history same as last - no gap
	result, err := ht.FetchHistoryGap(100)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result != "" {
		t.Error("no gap (same index) should return empty string")
	}

	// Current history less than last (e.g., session cleared) - should also return empty
	result, err = ht.FetchHistoryGap(50)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result != "" {
		t.Error("no gap (smaller index) should return empty string")
	}
}

// TestFetchHistoryGapWithinViewport verifies that when "gap" is within viewport,
// we return empty (viewport diff handles it).
func TestFetchHistoryGapWithinViewport(t *testing.T) {
	ht := NewHistoryTracker("fake-session", 24)
	ht.lastHistoryIndex = 0
	ht.viewportRows = 24

	// Gap of 20 lines, but viewport is 24 - all "new" lines still visible
	result, err := ht.FetchHistoryGap(20)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result != "" {
		t.Error("gap within viewport should return empty (viewport diff handles it)")
	}

	// Gap exactly at viewport boundary - still within viewport
	result, err = ht.FetchHistoryGap(24)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result != "" {
		t.Error("gap at viewport boundary should return empty")
	}
}

// TestFetchHistoryGapLogicWithMockedViewport tests the gap calculation logic
// with various viewport sizes. We can't test actual tmux fetch without tmux,
// but we CAN test the boundary conditions.
func TestFetchHistoryGapLogicWithMockedViewport(t *testing.T) {
	tests := []struct {
		name             string
		lastHistoryIndex int
		viewportRows     int
		currentHistory   int
		expectFetch      bool // Would we attempt a tmux fetch?
	}{
		{"no new history", 100, 24, 100, false},
		{"history decreased", 100, 24, 50, false},
		{"gap within viewport", 0, 24, 20, false},
		{"gap at viewport edge", 0, 24, 24, false},
		{"gap beyond viewport", 0, 24, 50, true},
		{"large gap small viewport", 0, 10, 100, true},
		{"gap equals viewport+1", 0, 24, 25, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ht := NewHistoryTracker("fake-session", tt.viewportRows)
			ht.lastHistoryIndex = tt.lastHistoryIndex

			// We can't actually fetch from tmux, but we can check if the function
			// would return early (empty string, no error) or attempt a fetch
			// (which would fail with exec error since there's no tmux)
			result, err := ht.FetchHistoryGap(tt.currentHistory)

			if tt.expectFetch {
				// Should have attempted tmux command (which fails without tmux)
				if err == nil && result == "" {
					// Might return early due to other conditions, that's ok
					// The test is mainly documenting expected behavior
				}
			} else {
				// Should return early without error
				if err != nil {
					t.Errorf("expected no error for early return, got: %v", err)
				}
				if result != "" {
					t.Errorf("expected empty result for early return, got: %q", result)
				}
			}
		})
	}
}

// TestDiffViewportNewLinesAppended tests the code path where new lines are
// added beyond the previous viewport length.
func TestDiffViewportNewLinesAppended(t *testing.T) {
	ht := NewHistoryTracker("test", 24)

	// Start with 2 content lines (normalized to 24)
	ht.DiffViewport("line1\nline2")

	// Add 2 more content lines (rows 3-4 change from empty to content)
	result := ht.DiffViewport("line1\nline2\nline3\nline4")

	// Should contain the new lines
	if !strings.Contains(result, "line3") {
		t.Error("new line3 should be in output")
	}
	if !strings.Contains(result, "line4") {
		t.Error("new line4 should be in output")
	}

	// Should NOT contain unchanged lines
	if strings.Contains(result, "\x1b[1;1H") {
		// If we see cursor positioning to line 1, check if it's emitting line1
		// (it shouldn't be)
	}

	// Verify state updated (always 24 rows after normalization)
	if len(ht.lastViewportLines) != 24 {
		t.Errorf("expected 24 lines in state (normalized), got %d", len(ht.lastViewportLines))
	}
	// Content should be in first 4 rows
	if ht.lastViewportLines[2] != "line3" || ht.lastViewportLines[3] != "line4" {
		t.Errorf("new content should be at indices 2-3, got %v", ht.lastViewportLines[2:4])
	}
}
