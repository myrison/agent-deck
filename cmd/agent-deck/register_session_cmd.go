package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/asheshgoplani/agent-deck/internal/session"
)

// Exit codes for register-session command
const (
	exitSuccess       = 0
	exitGeneralError  = 1
	exitAlreadyExists = 2
)

// handleRegisterSession registers an existing tmux session in sessions.json.
// This is used by remote machines to register sessions they created via SSH.
// The session is registered locally without verifying the tmux session exists.
func handleRegisterSession(profile string, args []string) {
	fs := flag.NewFlagSet("register-session", flag.ExitOnError)

	// Required flags
	tmuxName := fs.String("tmux", "", "tmux session name (required)")
	tmuxShort := fs.String("t", "", "tmux session name (short)")
	projectPath := fs.String("path", "", "Project directory path (required)")
	pathShort := fs.String("d", "", "Project directory path (short)")
	tool := fs.String("tool", "", "Tool type: claude, gemini, opencode, shell (required)")
	toolShort := fs.String("c", "", "Tool type (short)")

	// Optional flags
	title := fs.String("title", "", "Session title (defaults to folder name)")
	titleShort := fs.String("n", "", "Session title (short)")
	group := fs.String("group", "", "Group path (defaults to computed from path)")
	groupShort := fs.String("g", "", "Group path (short)")
	idempotent := fs.Bool("idempotent", false, "Don't fail if session already exists")
	idempotentShort := fs.Bool("i", false, "Don't fail if session already exists (short)")
	jsonOutput := fs.Bool("json", false, "Output JSON response")
	quiet := fs.Bool("quiet", false, "Suppress output")
	quietShort := fs.Bool("q", false, "Suppress output (short)")

	fs.Usage = func() {
		fmt.Println("Usage: agent-deck register-session [options]")
		fmt.Println()
		fmt.Println("Register an existing tmux session in Agent Deck's session storage.")
		fmt.Println("Used by remote machines to register sessions created via SSH.")
		fmt.Println()
		fmt.Println("Required flags:")
		fmt.Println("  -t, --tmux <name>     tmux session name (e.g., agentdeck_1234567890)")
		fmt.Println("  -d, --path <path>     Project directory path")
		fmt.Println("  -c, --tool <tool>     Tool type: claude, gemini, opencode, shell")
		fmt.Println()
		fmt.Println("Optional flags:")
		fmt.Println("  -n, --title <title>   Session title (defaults to folder name)")
		fmt.Println("  -g, --group <path>    Group path (defaults to computed from path)")
		fmt.Println("  -i, --idempotent      Don't fail if session already exists")
		fmt.Println("  --json                Output JSON response")
		fmt.Println("  -q, --quiet           Suppress output")
		fmt.Println()
		fmt.Println("Exit codes:")
		fmt.Println("  0  Success")
		fmt.Println("  1  General error")
		fmt.Println("  2  Session already exists (without --idempotent)")
		fmt.Println()
		fmt.Println("Examples:")
		fmt.Println("  agent-deck register-session \\")
		fmt.Println("    --tmux agentdeck_1234567890 \\")
		fmt.Println("    --path /home/user/project \\")
		fmt.Println("    --tool claude")
		fmt.Println()
		fmt.Println("  agent-deck register-session \\")
		fmt.Println("    -t agentdeck_1234567890 \\")
		fmt.Println("    -d ~/project -c claude \\")
		fmt.Println("    -n \"My Project\" -g work \\")
		fmt.Println("    --json --idempotent")
	}

	if err := fs.Parse(args); err != nil {
		os.Exit(exitGeneralError)
	}

	// Merge short and long flags
	sessionTmux := mergeFlags(*tmuxName, *tmuxShort)
	sessionPath := mergeFlags(*projectPath, *pathShort)
	sessionTool := mergeFlags(*tool, *toolShort)
	sessionTitle := mergeFlags(*title, *titleShort)
	sessionGroup := mergeFlags(*group, *groupShort)
	isIdempotent := *idempotent || *idempotentShort
	isQuiet := *quiet || *quietShort

	// Validate required flags
	var errors []string
	if sessionTmux == "" {
		errors = append(errors, "tmux session name is required (--tmux or -t)")
	}
	if sessionPath == "" {
		errors = append(errors, "project path is required (--path or -d)")
	}
	if sessionTool == "" {
		errors = append(errors, "tool type is required (--tool or -c)")
	}

	if len(errors) > 0 {
		outputError(*jsonOutput, isQuiet, strings.Join(errors, "; "), "MISSING_REQUIRED")
		os.Exit(exitGeneralError)
	}

	// Validate tool type
	validTools := map[string]bool{
		"claude":   true,
		"gemini":   true,
		"opencode": true,
		"shell":    true,
		"codex":    true,
	}
	if !validTools[strings.ToLower(sessionTool)] {
		outputError(*jsonOutput, isQuiet,
			fmt.Sprintf("invalid tool type: %s (valid: claude, gemini, opencode, shell, codex)", sessionTool),
			"INVALID_TOOL")
		os.Exit(exitGeneralError)
	}
	sessionTool = strings.ToLower(sessionTool)

	// Default title to folder name
	if sessionTitle == "" {
		// Extract folder name from path
		parts := strings.Split(sessionPath, "/")
		for i := len(parts) - 1; i >= 0; i-- {
			if parts[i] != "" {
				sessionTitle = parts[i]
				break
			}
		}
		if sessionTitle == "" {
			sessionTitle = "session"
		}
	}

	// Load existing sessions
	storage, err := session.NewStorageWithProfile(profile)
	if err != nil {
		outputError(*jsonOutput, isQuiet,
			fmt.Sprintf("failed to initialize storage: %v", err),
			"STORAGE_ERROR")
		os.Exit(exitGeneralError)
	}

	instances, groups, err := storage.LoadWithGroups()
	if err != nil {
		outputError(*jsonOutput, isQuiet,
			fmt.Sprintf("failed to load sessions: %v", err),
			"LOAD_ERROR")
		os.Exit(exitGeneralError)
	}

	// Check if session with this tmux name already exists
	for _, inst := range instances {
		tmuxSession := inst.GetTmuxSession()
		if tmuxSession != nil && tmuxSession.Name == sessionTmux {
			if isIdempotent {
				// Session already exists, return success with existing ID
				outputSuccess(*jsonOutput, isQuiet,
					fmt.Sprintf("session already registered: %s", inst.Title),
					map[string]interface{}{
						"success":  true,
						"id":       inst.ID,
						"title":    inst.Title,
						"tmux":     sessionTmux,
						"existing": true,
					})
				os.Exit(exitSuccess)
			} else {
				outputError(*jsonOutput, isQuiet,
					fmt.Sprintf("session with tmux name %q already exists: %s (%s)", sessionTmux, inst.Title, inst.ID),
					"ALREADY_EXISTS")
				os.Exit(exitAlreadyExists)
			}
		}
	}

	// Create new instance
	newInstance := session.NewRegisteredInstance(sessionTitle, sessionPath, sessionGroup, sessionTool, sessionTmux)

	// Add to instances
	instances = append(instances, newInstance)

	// Rebuild group tree and ensure the session's group exists
	groupTree := session.NewGroupTreeWithGroups(instances, groups)
	if newInstance.GroupPath != "" {
		groupTree.CreateGroup(newInstance.GroupPath)
	}

	// Save
	if err := storage.SaveWithGroups(instances, groupTree); err != nil {
		outputError(*jsonOutput, isQuiet,
			fmt.Sprintf("failed to save session: %v", err),
			"SAVE_ERROR")
		os.Exit(exitGeneralError)
	}

	// Output success
	outputSuccess(*jsonOutput, isQuiet,
		fmt.Sprintf("registered session: %s (%s)", newInstance.Title, newInstance.ID),
		map[string]interface{}{
			"success": true,
			"id":      newInstance.ID,
			"title":   newInstance.Title,
			"path":    newInstance.ProjectPath,
			"group":   newInstance.GroupPath,
			"tool":    newInstance.Tool,
			"tmux":    sessionTmux,
		})
	os.Exit(exitSuccess)
}

// outputError outputs an error message in the appropriate format
func outputError(jsonMode, quietMode bool, message, code string) {
	if quietMode {
		return
	}
	if jsonMode {
		output, _ := json.MarshalIndent(map[string]interface{}{
			"success": false,
			"error":   message,
			"code":    code,
		}, "", "  ")
		fmt.Println(string(output))
	} else {
		fmt.Fprintf(os.Stderr, "Error: %s\n", message)
	}
}

// outputSuccess outputs a success message in the appropriate format
func outputSuccess(jsonMode, quietMode bool, message string, data map[string]interface{}) {
	if quietMode {
		return
	}
	if jsonMode {
		output, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(output))
	} else {
		fmt.Printf("✓ %s\n", message)
	}
}
