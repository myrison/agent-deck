package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"math/rand"
	"os"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/asheshgoplani/agent-deck/internal/ssh"
)

// ImagePasteResult contains the result of an image paste operation
type ImagePasteResult struct {
	Success    bool   `json:"success"`
	NoImage    bool   `json:"noImage,omitempty"`
	Error      string `json:"error,omitempty"`
	RemotePath string `json:"remotePath,omitempty"`
	InjectText string `json:"injectText,omitempty"`
	ByteCount  int    `json:"byteCount,omitempty"`
}

// MaxImageSize is the maximum allowed image size (10MB)
const MaxImageSize = 10 * 1024 * 1024

// uploadedFilesRegistry tracks uploaded files per session for cleanup
// Key: sessionID, Value: list of remote file paths with their hostID
var uploadedFilesRegistry = struct {
	sync.RWMutex
	files map[string][]uploadedFile
}{
	files: make(map[string][]uploadedFile),
}

// uploadedFile tracks a file uploaded to a remote host
type uploadedFile struct {
	hostID     string
	remotePath string
}

// trackUploadedFile records a file upload for later cleanup
func trackUploadedFile(sessionID, hostID, remotePath string) {
	uploadedFilesRegistry.Lock()
	defer uploadedFilesRegistry.Unlock()

	uploadedFilesRegistry.files[sessionID] = append(
		uploadedFilesRegistry.files[sessionID],
		uploadedFile{hostID: hostID, remotePath: remotePath},
	)
}

// cleanupUploadedFiles removes all uploaded files for a session
// Called when the terminal/session is closed
func cleanupUploadedFiles(sessionID string, sshBridge *SSHBridge) {
	uploadedFilesRegistry.Lock()
	files, exists := uploadedFilesRegistry.files[sessionID]
	if exists {
		delete(uploadedFilesRegistry.files, sessionID)
	}
	uploadedFilesRegistry.Unlock()

	if !exists || len(files) == 0 || sshBridge == nil {
		return
	}

	// Delete files in background to not block session close
	go func() {
		for _, f := range files {
			conn, err := sshBridge.GetConnection(f.hostID)
			if err != nil {
				continue
			}
			// Best effort deletion - ignore errors
			_, _ = conn.RunCommand(fmt.Sprintf("rm -f %q 2>/dev/null", f.remotePath))
		}
	}()
}

// readClipboardImage reads image data from the clipboard.
// Uses native macOS APIs (clipboard_darwin.go) to support TIFF (screenshot format) and PNG.
// Returns PNG-encoded data or nil if no image is present.
func readClipboardImage() ([]byte, error) {
	return readClipboardImageNative()
}

// validateImageData performs validation on image data before transfer.
// Accepts PNG, JPEG, GIF, and WebP formats via magic bytes detection.
// Returns an error if the image is too large or has an unrecognized format.
func validateImageData(data []byte) error {
	if len(data) > MaxImageSize {
		return fmt.Errorf("image too large: %d bytes (max %d bytes / 10MB)", len(data), MaxImageSize)
	}

	if detectImageFormat(data) == "" {
		return fmt.Errorf("invalid image format: expected PNG, JPEG, GIF, or WebP")
	}

	return nil
}

// detectImageFormat identifies an image format from magic bytes.
// Returns the format name ("png", "jpeg", "gif", "webp") or "" if unrecognized.
func detectImageFormat(data []byte) string {
	if len(data) < 12 {
		return ""
	}

	// PNG: \x89PNG\r\n\x1a\n
	if bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}) {
		return "png"
	}

	// JPEG: \xFF\xD8\xFF
	if bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}) {
		return "jpeg"
	}

	// GIF: GIF87a or GIF89a
	if bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")) {
		return "gif"
	}

	// WebP: RIFF....WEBP (bytes 0-3 = "RIFF", bytes 8-11 = "WEBP")
	if bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return "webp"
	}

	return ""
}

// imageExtensionForFormat returns the file extension (with dot) for a format name.
func imageExtensionForFormat(format string) string {
	switch format {
	case "png":
		return ".png"
	case "jpeg":
		return ".jpg"
	case "gif":
		return ".gif"
	case "webp":
		return ".webp"
	default:
		return ".png"
	}
}

// isImageFile checks if a file path points to an image based on magic bytes.
// Reads the first 12 bytes of the file for format detection.
func isImageFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	header := make([]byte, 12)
	n, err := f.Read(header)
	if err != nil || n < 12 {
		return false
	}

	return detectImageFormat(header) != ""
}

// generateRemotePath creates a unique remote path for a PNG image file.
// Uses nanosecond timestamp + random suffix for uniqueness.
func generateRemotePath() string {
	return generateRemotePathWithExt(".png")
}

// generateRemotePathWithExt creates a unique remote path with the given extension.
func generateRemotePathWithExt(ext string) string {
	return fmt.Sprintf("/tmp/revden_img_%d_%d%s", time.Now().UnixNano(), rand.Intn(10000), ext)
}

// StreamToRemoteFile streams data to a file on the remote host using SSH.
// Uses 'umask 077; cat > path' for secure file creation with 0600 permissions.
func StreamToRemoteFile(conn *ssh.Connection, data []byte, remotePath string) error {
	// Use cat with umask for secure file creation (permissions 0600)
	command := fmt.Sprintf("umask 077; cat > %q", remotePath)

	reader := bytes.NewReader(data)
	_, err := conn.RunCommandWithStdin(command, reader)
	if err != nil {
		return fmt.Errorf("failed to stream file to remote: %w", err)
	}

	return nil
}

// formatBracketedPaste wraps text in bracketed paste escape sequences.
// This prevents the text from being interpreted as editor commands when
// pasted into vim, nano, or other terminal applications.
func formatBracketedPaste(text string) string {
	// Bracketed paste: \x1b[200~ starts paste mode, \x1b[201~ ends it
	return "\x1b[200~" + text + "\x1b[201~"
}

// emitToast sends a toast notification to the frontend
func emitToast(ctx context.Context, message, toastType string) {
	if ctx == nil {
		return
	}
	runtime.EventsEmit(ctx, "toast:show", map[string]string{
		"message": message,
		"type":    toastType, // "info", "success", "error", "warning"
	})
}

// HandleRemoteImagePaste handles Ctrl+V image paste for remote SSH sessions.
// It reads the clipboard image, transfers it to the remote host, and returns
// the path wrapped in bracketed paste sequences for injection into the terminal.
//
// Parameters:
//   - sessionId: the terminal session ID (for tracking/cleanup)
//   - hostId: the SSH host ID from config.toml
//
// Returns:
//   - ImagePasteResult with success=true and remotePath/injectText on success
//   - ImagePasteResult with noImage=true if no image in clipboard
//   - ImagePasteResult with error message on failure
func (a *App) HandleRemoteImagePaste(sessionId, hostId string) ImagePasteResult {
	// 1. Read clipboard image
	imgData, err := readClipboardImage()
	if err != nil {
		log.Printf("[image-paste] clipboard read failed: %v", err)
		emitToast(a.ctx, "Failed to read clipboard", "error")
		return ImagePasteResult{Error: err.Error()}
	}
	if imgData == nil {
		return ImagePasteResult{NoImage: true}
	}

	// 2. Validate image
	if err := validateImageData(imgData); err != nil {
		log.Printf("[image-paste] validation failed: %v", err)
		emitToast(a.ctx, err.Error(), "error")
		return ImagePasteResult{Error: err.Error()}
	}

	// 3. Get SSH connection
	conn, err := a.sshBridge.GetConnection(hostId)
	if err != nil {
		log.Printf("[image-paste] SSH connection to %s failed: %v", hostId, err)
		emitToast(a.ctx, "SSH connection failed", "error")
		return ImagePasteResult{Error: fmt.Sprintf("SSH connection failed: %v", err)}
	}

	// 4. Show uploading toast (for larger images)
	sizeMB := float64(len(imgData)) / (1024 * 1024)
	if sizeMB > 0.5 {
		emitToast(a.ctx, fmt.Sprintf("Uploading image (%.1f MB)...", sizeMB), "info")
	}

	// 5. Generate remote path and transfer
	remotePath := generateRemotePath()
	if err := StreamToRemoteFile(conn, imgData, remotePath); err != nil {
		log.Printf("[image-paste] transfer to %s failed: %v", hostId, err)
		emitToast(a.ctx, "Image upload failed", "error")
		return ImagePasteResult{Error: fmt.Sprintf("transfer failed: %v", err)}
	}

	// 6. Track file for cleanup when session closes
	trackUploadedFile(sessionId, hostId, remotePath)

	// 7. Show success toast
	emitToast(a.ctx, "Image uploaded to remote", "success")

	// 8. Return success with bracketed paste text
	// Claude Code recognizes raw file paths as image references (no @ prefix needed)
	// See: https://github.com/anthropics/claude-code/issues/5277
	injectText := formatBracketedPaste(remotePath)

	log.Printf("[image-paste] success: %s (%d bytes) -> %s", remotePath, len(imgData), hostId)

	return ImagePasteResult{
		Success:    true,
		RemotePath: remotePath,
		InjectText: injectText,
		ByteCount:  len(imgData),
	}
}
