package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateImageData_TooLarge(t *testing.T) {
	// Create data larger than 10MB
	data := make([]byte, MaxImageSize+1)
	// Add PNG header to pass format check if size passed
	copy(data, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})

	err := validateImageData(data)
	if err == nil {
		t.Error("expected error for oversized image, got nil")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Errorf("expected 'too large' in error message, got: %v", err)
	}
}

func TestValidateImageData_InvalidFormat(t *testing.T) {
	// Create data with invalid header (must be >= 12 bytes for detectImageFormat)
	data := []byte("not a valid image file format")

	err := validateImageData(data)
	if err == nil {
		t.Error("expected error for invalid format, got nil")
	}
	if !strings.Contains(err.Error(), "invalid image format") {
		t.Errorf("expected 'invalid image format' in error message, got: %v", err)
	}
}

func TestValidateImageData_ValidPNG(t *testing.T) {
	// Create valid PNG header with small data
	data := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	// Add some padding to make it look like a real image
	data = append(data, make([]byte, 100)...)

	err := validateImageData(data)
	if err != nil {
		t.Errorf("expected no error for valid PNG, got: %v", err)
	}
}

func TestGenerateRemotePath(t *testing.T) {
	path1 := generateRemotePath()
	path2 := generateRemotePath()

	// Should start with /tmp/revden_img_
	if !strings.HasPrefix(path1, "/tmp/revden_img_") {
		t.Errorf("expected path to start with /tmp/revden_img_, got: %s", path1)
	}
	if !strings.HasSuffix(path1, ".png") {
		t.Errorf("expected path to end with .png, got: %s", path1)
	}

	// Paths should be unique
	if path1 == path2 {
		t.Error("expected unique paths, got same path twice")
	}
}

func TestFormatBracketedPaste(t *testing.T) {
	text := "/tmp/test.png"
	result := formatBracketedPaste(text)

	// Should start with bracketed paste start sequence
	expectedStart := "\x1b[200~"
	if !strings.HasPrefix(result, expectedStart) {
		t.Errorf("expected result to start with bracketed paste sequence, got: %q", result[:min(len(result), 10)])
	}

	// Should end with bracketed paste end sequence
	expectedEnd := "\x1b[201~"
	if !strings.HasSuffix(result, expectedEnd) {
		t.Errorf("expected result to end with bracketed paste end sequence, got: %q", result[max(0, len(result)-10):])
	}

	// Should contain the original text
	if !strings.Contains(result, text) {
		t.Errorf("expected result to contain original text %q, got: %q", text, result)
	}
}

func TestTrackAndCleanupFiles(t *testing.T) {
	sessionID := "test-session-123"
	hostID := "test-host"
	remotePath1 := "/tmp/test1.png"
	remotePath2 := "/tmp/test2.png"

	// Track some files
	trackUploadedFile(sessionID, hostID, remotePath1)
	trackUploadedFile(sessionID, hostID, remotePath2)

	// Verify files are tracked
	uploadedFilesRegistry.RLock()
	files, exists := uploadedFilesRegistry.files[sessionID]
	uploadedFilesRegistry.RUnlock()

	if !exists {
		t.Error("expected session to be tracked")
	}
	if len(files) != 2 {
		t.Errorf("expected 2 files tracked, got %d", len(files))
	}

	// Cleanup with nil sshBridge (should remove from registry without error)
	cleanupUploadedFiles(sessionID, nil)

	// Verify files are removed from registry
	uploadedFilesRegistry.RLock()
	_, exists = uploadedFilesRegistry.files[sessionID]
	uploadedFilesRegistry.RUnlock()

	if exists {
		t.Error("expected session to be removed from registry after cleanup")
	}
}

func TestImagePasteResult_NoImage(t *testing.T) {
	result := ImagePasteResult{NoImage: true}

	if !result.NoImage {
		t.Error("expected NoImage to be true")
	}
	if result.Success {
		t.Error("expected Success to be false when NoImage is true")
	}
}

func TestImagePasteResult_Success(t *testing.T) {
	result := ImagePasteResult{
		Success:    true,
		RemotePath: "/tmp/test.png",
		InjectText: "\x1b[200~/tmp/test.png\x1b[201~",
		ByteCount:  1024,
	}

	if !result.Success {
		t.Error("expected Success to be true")
	}
	if result.RemotePath != "/tmp/test.png" {
		t.Errorf("expected RemotePath to be /tmp/test.png, got %s", result.RemotePath)
	}
	if result.ByteCount != 1024 {
		t.Errorf("expected ByteCount to be 1024, got %d", result.ByteCount)
	}
}

func TestImagePasteResult_Error(t *testing.T) {
	result := ImagePasteResult{Error: "transfer failed: connection refused"}

	if result.Success {
		t.Error("expected Success to be false when Error is set")
	}
	if !strings.Contains(result.Error, "transfer failed") {
		t.Errorf("expected Error to contain 'transfer failed', got %s", result.Error)
	}
}

// ==================== Multi-format validation tests ====================

func TestValidateImageData_JPEG(t *testing.T) {
	// JPEG magic bytes: \xFF\xD8\xFF + padding to >= 12 bytes
	data := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01}
	data = append(data, make([]byte, 100)...)

	err := validateImageData(data)
	if err != nil {
		t.Errorf("expected no error for valid JPEG, got: %v", err)
	}
}

func TestValidateImageData_WebP(t *testing.T) {
	// WebP: RIFF + 4-byte size + WEBP
	data := []byte("RIFF")
	data = append(data, 0x00, 0x00, 0x00, 0x00) // size placeholder
	data = append(data, []byte("WEBP")...)
	data = append(data, make([]byte, 100)...)

	err := validateImageData(data)
	if err != nil {
		t.Errorf("expected no error for valid WebP, got: %v", err)
	}
}

func TestValidateImageData_GIF(t *testing.T) {
	// GIF89a header
	data := []byte("GIF89a")
	data = append(data, make([]byte, 100)...)

	err := validateImageData(data)
	if err != nil {
		t.Errorf("expected no error for valid GIF89a, got: %v", err)
	}

	// GIF87a header
	data2 := []byte("GIF87a")
	data2 = append(data2, make([]byte, 100)...)

	err = validateImageData(data2)
	if err != nil {
		t.Errorf("expected no error for valid GIF87a, got: %v", err)
	}
}

func TestDetectImageFormat(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		expected string
	}{
		{
			name:     "PNG",
			data:     append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D}, make([]byte, 10)...),
			expected: "png",
		},
		{
			name:     "JPEG",
			data:     append([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01}, make([]byte, 10)...),
			expected: "jpeg",
		},
		{
			name:     "GIF89a",
			data:     append([]byte("GIF89a"), make([]byte, 10)...),
			expected: "gif",
		},
		{
			name:     "GIF87a",
			data:     append([]byte("GIF87a"), make([]byte, 10)...),
			expected: "gif",
		},
		{
			name:     "WebP",
			data:     append(append(append([]byte("RIFF"), 0x00, 0x00, 0x00, 0x00), []byte("WEBP")...), make([]byte, 10)...),
			expected: "webp",
		},
		{
			name:     "Unknown",
			data:     []byte("not an image format!!"),
			expected: "",
		},
		{
			name:     "TooShort",
			data:     []byte{0x89, 0x50},
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectImageFormat(tt.data)
			if result != tt.expected {
				t.Errorf("detectImageFormat(%s) = %q, want %q", tt.name, result, tt.expected)
			}
		})
	}
}

func TestImageExtensionForFormat(t *testing.T) {
	tests := []struct {
		format   string
		expected string
	}{
		{"png", ".png"},
		{"jpeg", ".jpg"},
		{"gif", ".gif"},
		{"webp", ".webp"},
		{"unknown", ".png"}, // default fallback
	}

	for _, tt := range tests {
		result := imageExtensionForFormat(tt.format)
		if result != tt.expected {
			t.Errorf("imageExtensionForFormat(%q) = %q, want %q", tt.format, result, tt.expected)
		}
	}
}

func TestIsImageFile(t *testing.T) {
	// Create a temp dir with test files
	tmpDir := t.TempDir()

	// Write a PNG file
	pngPath := filepath.Join(tmpDir, "test.png")
	pngData := append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D}, make([]byte, 100)...)
	os.WriteFile(pngPath, pngData, 0644)

	// Write a JPEG file
	jpegPath := filepath.Join(tmpDir, "test.jpg")
	jpegData := append([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01}, make([]byte, 100)...)
	os.WriteFile(jpegPath, jpegData, 0644)

	// Write a text file
	textPath := filepath.Join(tmpDir, "readme.txt")
	os.WriteFile(textPath, []byte("just a text file with enough bytes"), 0644)

	if !isImageFile(pngPath) {
		t.Error("expected PNG file to be detected as image")
	}
	if !isImageFile(jpegPath) {
		t.Error("expected JPEG file to be detected as image")
	}
	if isImageFile(textPath) {
		t.Error("expected text file to NOT be detected as image")
	}
	if isImageFile(filepath.Join(tmpDir, "nonexistent.png")) {
		t.Error("expected nonexistent file to NOT be detected as image")
	}
}

func TestQuotePathForShell(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "simple path",
			input:    "/tmp/image.png",
			expected: "'/tmp/image.png'",
		},
		{
			name:     "path with spaces",
			input:    "/tmp/my image.png",
			expected: "'/tmp/my image.png'",
		},
		{
			name:     "path with single quote",
			input:    "/tmp/it's an image.png",
			expected: "'/tmp/it'\\''s an image.png'",
		},
		{
			name:     "malicious filename",
			input:    "/tmp/file; rm -rf /.png",
			expected: "'/tmp/file; rm -rf /.png'",
		},
		{
			name:     "path with dollar sign",
			input:    "/tmp/$HOME.png",
			expected: "'/tmp/$HOME.png'",
		},
		{
			name:     "path with backticks",
			input:    "/tmp/`whoami`.png",
			expected: "'/tmp/`whoami`.png'",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := quotePathForShell(tt.input)
			if result != tt.expected {
				t.Errorf("quotePathForShell(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestGenerateRemotePathWithExt(t *testing.T) {
	path := generateRemotePathWithExt(".jpg")
	if !strings.HasPrefix(path, "/tmp/revden_img_") {
		t.Errorf("expected path to start with /tmp/revden_img_, got: %s", path)
	}
	if !strings.HasSuffix(path, ".jpg") {
		t.Errorf("expected path to end with .jpg, got: %s", path)
	}

	// Ensure generateRemotePath still returns .png
	pngPath := generateRemotePath()
	if !strings.HasSuffix(pngPath, ".png") {
		t.Errorf("expected generateRemotePath() to end with .png, got: %s", pngPath)
	}
}

// Helper functions for Go 1.21+ compatibility
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
