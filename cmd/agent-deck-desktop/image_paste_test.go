package main

import (
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
	// Create data with invalid header
	data := []byte("not a PNG image")

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
