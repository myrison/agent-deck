package main

import (
	"strings"
	"sync"
	"testing"
)

// --- validateImageData ---

func TestValidateImageData_TooLarge(t *testing.T) {
	data := make([]byte, MaxImageSize+1)
	copy(data, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})

	err := validateImageData(data)
	if err == nil {
		t.Fatal("expected error for oversized image")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Errorf("expected 'too large' in error, got: %v", err)
	}
}

func TestValidateImageData_ExactlyAtLimit(t *testing.T) {
	data := make([]byte, MaxImageSize)
	copy(data, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})

	err := validateImageData(data)
	if err != nil {
		t.Errorf("image exactly at MaxImageSize should be valid, got: %v", err)
	}
}

func TestValidateImageData_InvalidFormat(t *testing.T) {
	data := []byte("not a PNG image at all")

	err := validateImageData(data)
	if err == nil {
		t.Fatal("expected error for non-PNG data")
	}
	if !strings.Contains(err.Error(), "invalid image format") {
		t.Errorf("expected 'invalid image format' in error, got: %v", err)
	}
}

func TestValidateImageData_ValidPNG(t *testing.T) {
	data := append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, make([]byte, 100)...)

	if err := validateImageData(data); err != nil {
		t.Errorf("valid PNG header should pass validation, got: %v", err)
	}
}

func TestValidateImageData_EmptyData(t *testing.T) {
	err := validateImageData([]byte{})
	if err == nil {
		t.Fatal("expected error for empty data")
	}
}

func TestValidateImageData_TruncatedHeader(t *testing.T) {
	// Only first 4 bytes of PNG header - should fail format check
	data := []byte{0x89, 0x50, 0x4E, 0x47}

	err := validateImageData(data)
	if err == nil {
		t.Fatal("expected error for truncated PNG header")
	}
}

// --- generateRemotePath ---

func TestGenerateRemotePath_Format(t *testing.T) {
	path := generateRemotePath()

	if !strings.HasPrefix(path, "/tmp/revden_img_") {
		t.Errorf("expected /tmp/revden_img_ prefix, got: %s", path)
	}
	if !strings.HasSuffix(path, ".png") {
		t.Errorf("expected .png suffix, got: %s", path)
	}
}

func TestGenerateRemotePath_Uniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		path := generateRemotePath()
		if seen[path] {
			t.Fatalf("duplicate path generated on iteration %d: %s", i, path)
		}
		seen[path] = true
	}
}

// --- formatBracketedPaste ---

func TestFormatBracketedPaste_WrapsPathCorrectly(t *testing.T) {
	result := formatBracketedPaste("/tmp/test.png")

	expected := "\x1b[200~/tmp/test.png\x1b[201~"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

// --- trackUploadedFile / cleanupUploadedFiles ---

func TestTrackAndCleanup_RegistryRemovedAfterCleanup(t *testing.T) {
	sessionID := "test-lifecycle-" + generateRemotePath()

	trackUploadedFile(sessionID, "host", "/tmp/img1.png")
	trackUploadedFile(sessionID, "host", "/tmp/img2.png")

	// Cleanup removes the session from the registry (prevents double-cleanup / memory leak)
	cleanupUploadedFiles(sessionID, nil)

	uploadedFilesRegistry.RLock()
	_, exists := uploadedFilesRegistry.files[sessionID]
	uploadedFilesRegistry.RUnlock()

	if exists {
		t.Error("session should be removed from registry after cleanup")
	}

	// A second cleanup on the same session should be a no-op
	cleanupUploadedFiles(sessionID, nil)
}

func TestTrackFiles_SessionIsolation(t *testing.T) {
	session1 := "test-isolation-1-" + generateRemotePath()
	session2 := "test-isolation-2-" + generateRemotePath()

	trackUploadedFile(session1, "host-a", "/tmp/s1_img.png")
	trackUploadedFile(session2, "host-b", "/tmp/s2_img.png")

	// Cleaning up session1 should not affect session2
	cleanupUploadedFiles(session1, nil)

	uploadedFilesRegistry.RLock()
	_, s1Exists := uploadedFilesRegistry.files[session1]
	s2Files, s2Exists := uploadedFilesRegistry.files[session2]
	uploadedFilesRegistry.RUnlock()

	if s1Exists {
		t.Error("session1 should be cleaned up")
	}
	if !s2Exists || len(s2Files) != 1 {
		t.Error("session2 should still have its files intact")
	}

	// Clean up session2 for test hygiene
	cleanupUploadedFiles(session2, nil)
}

func TestCleanupUploadedFiles_UnknownSession(t *testing.T) {
	// Cleaning up a session that was never tracked should be a no-op
	cleanupUploadedFiles("nonexistent-session-xyz", nil)
	// No panic, no error = success
}

func TestTrackFiles_ConcurrentAccess(t *testing.T) {
	sessionID := "test-concurrent-" + generateRemotePath()
	var wg sync.WaitGroup

	// Spawn 50 goroutines all tracking files for the same session
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			trackUploadedFile(sessionID, "host", generateRemotePath())
		}(i)
	}
	wg.Wait()

	uploadedFilesRegistry.RLock()
	count := len(uploadedFilesRegistry.files[sessionID])
	uploadedFilesRegistry.RUnlock()

	if count != 50 {
		t.Errorf("expected 50 tracked files after concurrent writes, got %d", count)
	}

	// Clean up
	cleanupUploadedFiles(sessionID, nil)
}

// --- emitToast ---

func TestEmitToast_NilContextDoesNotPanic(t *testing.T) {
	// emitToast with nil context should be a safe no-op
	emitToast(nil, "test message", "info")
	// No panic = test passes
}
