package main

import (
	"testing"
)

// TestShouldUsePTYStreaming removed - was trivial projection test of hardcoded constant.
// See adversarial review: tests should verify behavior, not constants.

// TestFindLastValidUTF8Boundary tests UTF-8 boundary detection.
// This is critical for preventing corrupted multi-byte characters in streaming mode.
func TestFindLastValidUTF8Boundary(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected int
	}{
		{
			name:     "empty data",
			input:    []byte{},
			expected: 0,
		},
		{
			name:     "complete ASCII",
			input:    []byte("hello"),
			expected: 5,
		},
		{
			name:     "complete UTF-8 emoji",
			input:    []byte("hello 🎉"),
			expected: 10, // "hello " (6) + 🎉 (4 bytes)
		},
		{
			name:     "incomplete UTF-8 emoji - first byte only",
			input:    []byte("hello \xF0"), // Start of 4-byte sequence
			expected: 6,                     // Should return up to "hello "
		},
		{
			name:     "incomplete UTF-8 emoji - two bytes",
			input:    []byte("hello \xF0\x9F"), // First 2 bytes of 🎉
			expected: 6,                         // Should return up to "hello "
		},
		{
			name:     "incomplete UTF-8 emoji - three bytes",
			input:    []byte("hello \xF0\x9F\x8E"), // First 3 bytes of 🎉
			expected: 6,                             // Should return up to "hello "
		},
		{
			name:     "incomplete 2-byte UTF-8",
			input:    []byte("test \xC3"), // Start of é (2-byte)
			expected: 5,                    // Should return up to "test "
		},
		{
			name:     "complete multi-byte then incomplete",
			input:    []byte("café\xF0"), // Complete "café" then incomplete emoji
			expected: 5,                   // Should return complete "café"
		},
		{
			name:     "multiple complete UTF-8 chars",
			input:    []byte("日本語"), // Complete Japanese characters
			expected: 9,                // 3 chars × 3 bytes each
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := findLastValidUTF8Boundary(tt.input)
			if result != tt.expected {
				t.Errorf("findLastValidUTF8Boundary(%q) = %d, want %d",
					string(tt.input), result, tt.expected)
			}
		})
	}
}

// TestFindLastValidUTF8BoundaryInvalidSequences tests handling of invalid UTF-8.
func TestFindLastValidUTF8BoundaryInvalidSequences(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected int
	}{
		{
			name:  "invalid start byte",
			input: []byte{0xFF, 0xFF}, // Invalid UTF-8 start bytes
			// The function returns 1 because it checks last 4 bytes looking for valid rune start
			// 0xFF is treated as RuneError with size 1, so it stops at byte 1
			expected: 1,
		},
		{
			name:     "valid then invalid",
			input:    []byte("ok\xFF"),
			expected: 2, // Should return up to "ok"
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := findLastValidUTF8Boundary(tt.input)
			if result != tt.expected {
				t.Errorf("findLastValidUTF8Boundary(%v) = %d, want %d",
					tt.input, result, tt.expected)
			}
		})
	}
}

// TestVerifyTmuxConfig removed - was a permanently skipped non-test.
// See adversarial review: skipped tests provide zero verification.

// TestStripTTSMarkers tests TTS marker removal from terminal output.
func TestStripTTSMarkers(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "no markers",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name:     "start marker only",
			input:    "hello «tts»world",
			expected: "hello world",
		},
		{
			name:     "end marker only",
			input:    "hello«/tts» world",
			expected: "hello world",
		},
		{
			name:     "both markers",
			input:    "before«tts»content«/tts»after",
			expected: "beforecontentafter",
		},
		{
			name:     "multiple markers",
			input:    "«tts»first«/tts» and «tts»second«/tts»",
			expected: "first and second",
		},
		{
			name:     "empty input",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripTTSMarkers(tt.input)
			if result != tt.expected {
				t.Errorf("stripTTSMarkers(%q) = %q, want %q",
					tt.input, result, tt.expected)
			}
		})
	}
}

// TestNormalizeCRLF tests line ending normalization for xterm.js.
func TestNormalizeCRLF(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "LF only",
			input:    "line1\nline2\n",
			expected: "line1\r\nline2\r\n",
		},
		{
			name:     "CRLF already",
			input:    "line1\r\nline2\r\n",
			expected: "line1\r\nline2\r\n",
		},
		{
			name:     "CR only",
			input:    "line1\rline2\r",
			expected: "line1\r\nline2\r\n",
		},
		{
			name:     "mixed endings",
			input:    "line1\nline2\r\nline3\r",
			expected: "line1\r\nline2\r\nline3\r\n",
		},
		{
			name:     "no line endings",
			input:    "single line",
			expected: "single line",
		},
		{
			name:     "empty",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeCRLF(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeCRLF(%q) = %q, want %q",
					tt.input, result, tt.expected)
			}
		})
	}
}

// TestItoa removed - was testing language operators instead of application logic.
// See adversarial review: Go's type system already guarantees int-to-string conversion works.
// Recommendation: Use strconv.Itoa() in production code and remove custom implementation.
