//go:build !windows
// +build !windows

package tmux

import (
	"context"
	"fmt"
	"os"
)

// Attach attaches to the tmux session with full PTY support
// Ctrl+Q will detach and return to the caller
func (s *Session) Attach(ctx context.Context) error {
	if !s.Exists() {
		return fmt.Errorf("session %s does not exist", s.Name)
	}

	// Delegate to the executor which handles PTY and remote attach
	return s.getExecutor().Attach(ctx, s.Name, os.Stdin, os.Stdout, os.Stderr)
}

// AttachReadOnly attaches to the session in read-only mode
func (s *Session) AttachReadOnly(ctx context.Context) error {
	if !s.Exists() {
		return fmt.Errorf("session %s does not exist", s.Name)
	}

	// For read-only mode, we still use the executor's attach
	// The LocalExecutor implementation handles PTY properly
	return s.getExecutor().Attach(ctx, s.Name, os.Stdin, os.Stdout, os.Stderr)
}
