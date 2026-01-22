package tmux

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"golang.org/x/term"
)

// LocalExecutor executes tmux commands on the local machine
type LocalExecutor struct{}

// NewLocalExecutor creates a new local executor
func NewLocalExecutor() *LocalExecutor {
	return &LocalExecutor{}
}

// defaultExecutor is the singleton local executor
var defaultExecutor = &LocalExecutor{}

// DefaultExecutor returns the default local executor
func DefaultExecutor() TmuxExecutor {
	return defaultExecutor
}

// NewSession creates a new tmux session
func (e *LocalExecutor) NewSession(name, workDir string) error {
	if workDir == "" {
		workDir = os.Getenv("HOME")
	}
	cmd := exec.Command("tmux", "new-session", "-d", "-s", name, "-c", workDir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to create tmux session: %w (output: %s)", err, string(output))
	}
	return nil
}

// KillSession terminates a tmux session
func (e *LocalExecutor) KillSession(name string) error {
	cmd := exec.Command("tmux", "kill-session", "-t", name)
	return cmd.Run()
}

// SessionExists checks if a session exists
func (e *LocalExecutor) SessionExists(name string) (bool, error) {
	cmd := exec.Command("tmux", "has-session", "-t", name)
	err := cmd.Run()
	if err != nil {
		// Exit code 1 means session doesn't exist
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// ListSessions returns all sessions with their window activity timestamps
func (e *LocalExecutor) ListSessions() (map[string]int64, error) {
	cmd := exec.Command("tmux", "list-windows", "-a", "-F", "#{session_name}\t#{window_activity}")
	output, err := cmd.Output()
	if err != nil {
		// tmux not running or error
		return nil, err
	}

	sessions := make(map[string]int64)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		name := parts[0]
		var activity int64
		_, _ = fmt.Sscanf(parts[1], "%d", &activity)
		// Keep maximum activity (most recent) if session has multiple windows
		if existing, ok := sessions[name]; !ok || activity > existing {
			sessions[name] = activity
		}
	}
	return sessions, nil
}

// SendKeys sends keys to a session
func (e *LocalExecutor) SendKeys(session, keys string, literal bool) error {
	args := []string{"send-keys"}
	if literal {
		args = append(args, "-l")
	}
	args = append(args, "-t", session, keys)
	cmd := exec.Command("tmux", args...)
	return cmd.Run()
}

// CapturePane captures the visible content of a pane
func (e *LocalExecutor) CapturePane(session string, joinWrapped bool) (string, error) {
	args := []string{"capture-pane", "-t", session, "-p"}
	if joinWrapped {
		args = append(args, "-J")
	}
	cmd := exec.Command("tmux", args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to capture pane: %w", err)
	}
	return string(output), nil
}

// CapturePaneHistory captures scrollback history
func (e *LocalExecutor) CapturePaneHistory(session string, lines int) (string, error) {
	args := []string{"capture-pane", "-t", session, "-p", "-J", "-S", fmt.Sprintf("-%d", lines)}
	cmd := exec.Command("tmux", args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to capture history: %w", err)
	}
	return string(output), nil
}

// RespawnPane kills the current process and starts a new command
func (e *LocalExecutor) RespawnPane(session, command string) error {
	target := session + ":" // Append colon to target the active pane
	args := []string{"respawn-pane", "-k", "-t", target}
	if command != "" {
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
		}
		// Force bash for bash-specific syntax
		if strings.Contains(command, "$(") || strings.Contains(command, "session_id=") {
			shell = "/bin/bash"
		}
		wrappedCmd := fmt.Sprintf("%s -ic %q", shell, command)
		args = append(args, wrappedCmd)
	}
	cmd := exec.Command("tmux", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to respawn pane: %w (output: %s)", err, string(output))
	}
	return nil
}

// SetOption sets a tmux option for a session
func (e *LocalExecutor) SetOption(session, option, value string) error {
	cmd := exec.Command("tmux", "set-option", "-t", session, option, value)
	return cmd.Run()
}

// SetServerOption sets a server-wide tmux option
func (e *LocalExecutor) SetServerOption(option, value string) error {
	cmd := exec.Command("tmux", "set", "-asq", option, value)
	return cmd.Run()
}

// SetEnvironment sets an environment variable for a session
func (e *LocalExecutor) SetEnvironment(session, key, value string) error {
	cmd := exec.Command("tmux", "set-environment", "-t", session, key, value)
	return cmd.Run()
}

// GetEnvironment gets an environment variable from a session
func (e *LocalExecutor) GetEnvironment(session, key string) (string, error) {
	cmd := exec.Command("tmux", "show-environment", "-t", session, key)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("variable not found or session doesn't exist: %s", key)
	}
	line := strings.TrimSpace(string(output))
	prefix := key + "="
	if strings.HasPrefix(line, prefix) {
		return strings.TrimPrefix(line, prefix), nil
	}
	return "", fmt.Errorf("variable not found: %s", key)
}

// DisplayMessage runs tmux display-message and returns the output
func (e *LocalExecutor) DisplayMessage(session, format string) (string, error) {
	cmd := exec.Command("tmux", "display-message", "-t", session, "-p", format)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to display message: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}

// EnablePipePane enables pipe-pane to log output to a file
func (e *LocalExecutor) EnablePipePane(session, outputFile string) error {
	cmd := exec.Command("tmux", "pipe-pane", "-t", session, "-o", fmt.Sprintf("cat >> '%s'", outputFile))
	return cmd.Run()
}

// DisablePipePane disables pipe-pane logging
func (e *LocalExecutor) DisablePipePane(session string) error {
	cmd := exec.Command("tmux", "pipe-pane", "-t", session)
	return cmd.Run()
}

// Attach attaches to a tmux session with PTY support
func (e *LocalExecutor) Attach(ctx context.Context, session string, stdin io.Reader, stdout, stderr io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	cmd := exec.CommandContext(ctx, "tmux", "attach-session", "-t", session)

	// Start command with PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return fmt.Errorf("failed to start pty: %w", err)
	}
	defer ptmx.Close()

	// Get stdin as file for raw mode
	stdinFile, ok := stdin.(*os.File)
	if !ok {
		stdinFile = os.Stdin
	}

	// Save original terminal state and set raw mode
	oldState, err := term.MakeRaw(int(stdinFile.Fd()))
	if err != nil {
		return fmt.Errorf("failed to set raw mode: %w", err)
	}
	defer func() { _ = term.Restore(int(stdinFile.Fd()), oldState) }()

	// Handle window resize signals
	sigwinch := make(chan os.Signal, 1)
	signal.Notify(sigwinch, syscall.SIGWINCH)
	sigwinchDone := make(chan struct{})
	defer func() {
		signal.Stop(sigwinch)
		close(sigwinchDone)
	}()

	var wg sync.WaitGroup

	// SIGWINCH handler goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-sigwinchDone:
				return
			case _, ok := <-sigwinch:
				if !ok {
					return
				}
				if ws, err := pty.GetsizeFull(stdinFile); err == nil {
					_ = pty.Setsize(ptmx, ws)
				}
			}
		}
	}()
	// Initial resize
	sigwinch <- syscall.SIGWINCH

	// Channel to signal detach via Ctrl+Q
	detachCh := make(chan struct{})
	ioErrors := make(chan error, 2)

	// Timeout to ignore initial terminal control sequences
	startTime := time.Now()
	const controlSeqTimeout = 50 * time.Millisecond

	// Goroutine: Copy PTY output to stdout
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, err := io.Copy(stdout, ptmx)
		if err != nil && err != io.EOF {
			select {
			case ioErrors <- fmt.Errorf("PTY read error: %w", err):
			default:
			}
		}
	}()

	// Goroutine: Read stdin, intercept Ctrl+Q, forward rest to PTY
	wg.Add(1)
	go func() {
		defer wg.Done()
		buf := make([]byte, 32)
		for {
			n, err := stdin.Read(buf)
			if err != nil {
				if err == io.EOF {
					break
				}
				select {
				case ioErrors <- fmt.Errorf("stdin read error: %w", err):
				default:
				}
				return
			}

			// Discard initial terminal control sequences
			if time.Since(startTime) < controlSeqTimeout {
				continue
			}

			// Check for Ctrl+Q (ASCII 17)
			if n == 1 && buf[0] == 17 {
				close(detachCh)
				cancel()
				return
			}

			// Forward to PTY
			if _, err := ptmx.Write(buf[:n]); err != nil {
				select {
				case ioErrors <- fmt.Errorf("PTY write error: %w", err):
				default:
				}
				return
			}
		}
	}()

	// Wait for command to finish
	cmdDone := make(chan error, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		cmdDone <- cmd.Wait()
	}()

	// Wait for detach or completion
	select {
	case <-detachCh:
		return nil
	case err := <-cmdDone:
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				if exitErr.ExitCode() == 0 || exitErr.ExitCode() == 1 {
					return nil
				}
			}
			if ctx.Err() != nil {
				return nil
			}
		}
		return err
	case <-ctx.Done():
		return nil
	}
}

// IsRemote returns false for local executor
func (e *LocalExecutor) IsRemote() bool {
	return false
}

// HostID returns empty string for local executor
func (e *LocalExecutor) HostID() string {
	return ""
}
