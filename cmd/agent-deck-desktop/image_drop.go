package main

import (
	"fmt"
	"log"
	"os"
	"strings"
)

// HandleFileDrop processes files dropped onto a terminal pane.
// Filters for image files using magic bytes, then either:
//   - Remote sessions: uploads to remote host via SSH and returns bracketed paste with remote path
//   - Local sessions: validates file exists and returns bracketed paste with local path
//
// All valid image files from a multi-file drop are processed.
// Paths are quoted to prevent shell injection.
func (a *App) HandleFileDrop(sessionId, hostId string, filePaths []string) ImagePasteResult {
	if len(filePaths) == 0 {
		return ImagePasteResult{Error: "no files provided"}
	}

	// Filter to image files only (using magic bytes)
	var imagePaths []string
	for _, p := range filePaths {
		if isImageFile(p) {
			imagePaths = append(imagePaths, p)
		}
	}

	if len(imagePaths) == 0 {
		emitToast(a.ctx, "No image files detected in drop", "warning")
		return ImagePasteResult{Error: "no image files in drop"}
	}

	isRemote := hostId != ""

	if isRemote {
		return a.handleRemoteFileDrop(sessionId, hostId, imagePaths)
	}
	return a.handleLocalFileDrop(imagePaths)
}

// handleLocalFileDrop handles drops onto local sessions.
// Claude Code reads local files natively, so we just inject quoted paths.
func (a *App) handleLocalFileDrop(imagePaths []string) ImagePasteResult {
	var quotedPaths []string
	for _, p := range imagePaths {
		// Validate file exists
		if _, err := os.Stat(p); err != nil {
			log.Printf("[image-drop] local file not found: %s", p)
			continue
		}
		quotedPaths = append(quotedPaths, quotePathForShell(p))
	}

	if len(quotedPaths) == 0 {
		return ImagePasteResult{Error: "no valid image files found"}
	}

	injectText := formatBracketedPaste(strings.Join(quotedPaths, " "))

	log.Printf("[image-drop] local: injecting %d image path(s)", len(quotedPaths))

	return ImagePasteResult{
		Success:    true,
		InjectText: injectText,
	}
}

// handleRemoteFileDrop handles drops onto remote SSH sessions.
// Reads each file, validates via magic bytes, uploads to remote, returns bracketed paste.
func (a *App) handleRemoteFileDrop(sessionId, hostId string, imagePaths []string) ImagePasteResult {
	conn, err := a.sshBridge.GetConnection(hostId)
	if err != nil {
		log.Printf("[image-drop] SSH connection to %s failed: %v", hostId, err)
		emitToast(a.ctx, "SSH connection failed", "error")
		return ImagePasteResult{Error: fmt.Sprintf("SSH connection failed: %v", err)}
	}

	var remotePaths []string
	var totalBytes int

	for _, localPath := range imagePaths {
		data, err := os.ReadFile(localPath)
		if err != nil {
			log.Printf("[image-drop] failed to read %s: %v", localPath, err)
			continue
		}

		// Validate image data (size + magic bytes)
		format := detectImageFormat(data)
		if format == "" {
			log.Printf("[image-drop] invalid image format: %s", localPath)
			continue
		}

		if len(data) > MaxImageSize {
			log.Printf("[image-drop] file too large: %s (%d bytes)", localPath, len(data))
			emitToast(a.ctx, fmt.Sprintf("Image too large: %s", localPath), "warning")
			continue
		}

		// Show upload toast for larger files
		sizeMB := float64(len(data)) / (1024 * 1024)
		if sizeMB > 0.5 {
			emitToast(a.ctx, fmt.Sprintf("Uploading image (%.1f MB)...", sizeMB), "info")
		}

		// Generate remote path with correct extension
		ext := imageExtensionForFormat(format)
		remotePath := generateRemotePathWithExt(ext)

		if err := StreamToRemoteFile(conn, data, remotePath); err != nil {
			log.Printf("[image-drop] transfer to %s failed: %v", hostId, err)
			emitToast(a.ctx, "Image upload failed", "error")
			continue
		}

		trackUploadedFile(sessionId, hostId, remotePath)
		remotePaths = append(remotePaths, quotePathForShell(remotePath))
		totalBytes += len(data)
	}

	if len(remotePaths) == 0 {
		return ImagePasteResult{Error: "no images could be uploaded"}
	}

	emitToast(a.ctx, fmt.Sprintf("Uploaded %d image(s) to remote", len(remotePaths)), "success")

	injectText := formatBracketedPaste(strings.Join(remotePaths, " "))

	log.Printf("[image-drop] remote: uploaded %d image(s) (%d bytes) -> %s", len(remotePaths), totalBytes, hostId)

	return ImagePasteResult{
		Success:    true,
		InjectText: injectText,
		ByteCount:  totalBytes,
	}
}

// quotePathForShell wraps a path in single quotes and escapes internal single quotes.
// This prevents shell injection via crafted filenames like "file; rm -rf /.png".
func quotePathForShell(path string) string {
	// Replace ' with '\'' (end quote, escaped quote, start quote)
	escaped := strings.ReplaceAll(path, "'", "'\\''")
	return "'" + escaped + "'"
}
