package tmux

import (
	"context"
	"io"
)

// TmuxExecutor abstracts tmux operations, allowing local and remote (SSH) execution.
// This interface enables managing tmux sessions on remote machines over SSH.
type TmuxExecutor interface {
	// Session management
	NewSession(name, workDir string) error
	KillSession(name string) error
	SessionExists(name string) (bool, error)
	ListSessions() (map[string]int64, error) // name -> window_activity timestamp

	// Commands
	SendKeys(session, keys string, literal bool) error
	CapturePane(session string, joinWrapped bool) (string, error)
	CapturePaneHistory(session string, lines int) (string, error)
	RespawnPane(session, command string) error

	// Options
	SetOption(session, option, value string) error
	SetServerOption(option, value string) error

	// Environment
	SetEnvironment(session, key, value string) error
	GetEnvironment(session, key string) (string, error)

	// Display
	DisplayMessage(session, format string) (string, error)

	// Pipe-pane for logging
	EnablePipePane(session, outputFile string) error
	DisablePipePane(session string) error

	// Interactive attach
	// Attach connects to the session interactively using a PTY.
	// For local: runs tmux attach with PTY
	// For SSH: runs ssh -t host tmux attach
	Attach(ctx context.Context, session string, stdin io.Reader, stdout, stderr io.Writer) error

	// Identification
	IsRemote() bool
	HostID() string // empty for local, hostname for remote
}

// ExecutorOption configures an executor
type ExecutorOption func(interface{})
