package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExpandHomePath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("Cannot get home directory")
	}

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"absolute path", "/var/log/test.log", "/var/log/test.log"},
		{"relative path", ".env", ".env"},
		{"tilde prefix", "~/.secrets", filepath.Join(home, ".secrets")},
		{"just tilde", "~", home},
		{"tilde in middle", "/path/~/.env", "/path/~/.env"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := expandHomePath(tt.input)
			if result != tt.expected {
				t.Errorf("expandHomePath(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestResolveEnvFilePath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("Cannot get home directory")
	}

	workDir := "/projects/myapp"

	tests := []struct {
		name     string
		path     string
		workDir  string
		expected string
	}{
		{"absolute path", "/etc/env", workDir, "/etc/env"},
		{"home path", "~/.secrets", workDir, filepath.Join(home, ".secrets")},
		{"relative path", ".env", workDir, "/projects/myapp/.env"},
		{"relative subdir", "config/.env", workDir, "/projects/myapp/config/.env"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := resolveEnvFilePath(tt.path, tt.workDir)
			if result != tt.expected {
				t.Errorf("resolveEnvFilePath(%q, %q) = %q, want %q", tt.path, tt.workDir, result, tt.expected)
			}
		})
	}
}

func TestIsFilePath(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"/etc/env", true},
		{"~/env", true},
		{"./env", true},
		{"../env", true},
		{"~", true},
		{"eval $(direnv hook bash)", false},
		{"source ~/.bashrc", false},
		{".env", false}, // Treated as inline command, not file path
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := isFilePath(tt.input)
			if result != tt.expected {
				t.Errorf("isFilePath(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestBuildSourceCmd(t *testing.T) {
	tests := []struct {
		name          string
		path          string
		ignoreMissing bool
		wantContains  []string
	}{
		{
			name:          "ignore missing",
			path:          "/path/.env",
			ignoreMissing: true,
			wantContains:  []string{`[ -f "/path/.env" ]`, `source "/path/.env"`},
		},
		{
			name:          "strict mode",
			path:          "/path/.env",
			ignoreMissing: false,
			wantContains:  []string{`source "/path/.env"`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := buildSourceCmd(tt.path, tt.ignoreMissing)
			for _, want := range tt.wantContains {
				if !strings.Contains(result, want) {
					t.Errorf("buildSourceCmd(%q, %v) = %q, want to contain %q", tt.path, tt.ignoreMissing, result, want)
				}
			}
		})
	}
}

func TestShellSettings_GetIgnoreMissingEnvFiles(t *testing.T) {
	trueBool := true
	falseBool := false

	tests := []struct {
		name     string
		settings ShellSettings
		expected bool
	}{
		{"nil pointer defaults to true", ShellSettings{}, true},
		{"explicit true", ShellSettings{IgnoreMissingEnvFiles: &trueBool}, true},
		{"explicit false", ShellSettings{IgnoreMissingEnvFiles: &falseBool}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.settings.GetIgnoreMissingEnvFiles()
			if result != tt.expected {
				t.Errorf("GetIgnoreMissingEnvFiles() = %v, want %v", result, tt.expected)
			}
		})
	}
}

// =============================================================================
// buildEnvSourceCommand Tests
// =============================================================================
// Tests the orchestration of env file sourcing across global, init script,
// and tool-specific configurations. This is the main entry point for the
// .env file sourcing feature added in PR #106.

func TestBuildEnvSourceCommand_NoConfig(t *testing.T) {
	// Setup: temp directory with no config file
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "claude",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// With no config, should return empty string
	if result != "" {
		t.Errorf("buildEnvSourceCommand() = %q, want empty string", result)
	}
}

func TestBuildEnvSourceCommand_GlobalEnvFiles(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// Create config with global env_files
	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Shell: ShellSettings{
			EnvFiles: []string{".env", "~/.secrets"},
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "claude",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// Should include both env files with safe sourcing (ignore_missing_env_files defaults to true)
	if !strings.Contains(result, `/projects/myapp/.env`) {
		t.Errorf("buildEnvSourceCommand() should contain project .env path, got: %q", result)
	}
	if !strings.Contains(result, filepath.Join(tempDir, ".secrets")) {
		t.Errorf("buildEnvSourceCommand() should contain expanded ~/.secrets path, got: %q", result)
	}
	// Should use safe [ -f file ] && source pattern
	if !strings.Contains(result, `[ -f "`) {
		t.Errorf("buildEnvSourceCommand() should use safe sourcing pattern, got: %q", result)
	}
	// Should end with " && " for chaining with main command
	if !strings.HasSuffix(result, " && ") {
		t.Errorf("buildEnvSourceCommand() should end with ' && ', got: %q", result)
	}
}

func TestBuildEnvSourceCommand_InitScript_FilePath(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Shell: ShellSettings{
			InitScript: "~/.agent-deck/init.sh",
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "claude",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// Should source the init script as a file
	expectedPath := filepath.Join(tempDir, ".agent-deck/init.sh")
	if !strings.Contains(result, expectedPath) {
		t.Errorf("buildEnvSourceCommand() should contain init script path %q, got: %q", expectedPath, result)
	}
}

func TestBuildEnvSourceCommand_InitScript_InlineCommand(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Shell: ShellSettings{
			InitScript: `eval "$(direnv hook bash)"`,
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "claude",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// Inline command should be included directly (not wrapped in source)
	if !strings.Contains(result, `eval "$(direnv hook bash)"`) {
		t.Errorf("buildEnvSourceCommand() should contain inline command, got: %q", result)
	}
	// Should NOT have source prefix for inline commands
	if strings.Contains(result, `source "eval`) {
		t.Errorf("buildEnvSourceCommand() should not wrap inline command in source, got: %q", result)
	}
}

func TestBuildEnvSourceCommand_ToolSpecificEnvFile_Claude(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Claude: ClaudeSettings{
			EnvFile: ".claude.env",
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "claude",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// Should include Claude-specific env file
	if !strings.Contains(result, `/projects/myapp/.claude.env`) {
		t.Errorf("buildEnvSourceCommand() should contain Claude env file, got: %q", result)
	}
}

func TestBuildEnvSourceCommand_ToolSpecificEnvFile_Gemini(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Gemini: GeminiSettings{
			EnvFile: ".gemini.env",
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "gemini",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// Should include Gemini-specific env file
	if !strings.Contains(result, `/projects/myapp/.gemini.env`) {
		t.Errorf("buildEnvSourceCommand() should contain Gemini env file, got: %q", result)
	}
}

func TestBuildEnvSourceCommand_FullOrchestration(t *testing.T) {
	// Test the complete orchestration: global + init + tool-specific
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Shell: ShellSettings{
			EnvFiles:   []string{".env"},
			InitScript: `eval "$(direnv hook bash)"`,
		},
		Claude: ClaudeSettings{
			EnvFile: ".claude.env",
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "claude",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// Verify order: global env_files first, then init_script, then tool-specific
	globalPos := strings.Index(result, ".env")
	direnvPos := strings.Index(result, "direnv")
	claudeEnvPos := strings.Index(result, ".claude.env")

	if globalPos == -1 || direnvPos == -1 || claudeEnvPos == -1 {
		t.Fatalf("buildEnvSourceCommand() missing expected components, got: %q", result)
	}

	if globalPos > direnvPos {
		t.Errorf("Global env_files should come before init_script. Got order: .env@%d, direnv@%d", globalPos, direnvPos)
	}
	if direnvPos > claudeEnvPos {
		t.Errorf("init_script should come before tool env_file. Got order: direnv@%d, .claude.env@%d", direnvPos, claudeEnvPos)
	}
}

func TestBuildEnvSourceCommand_StrictMode(t *testing.T) {
	// Test with ignore_missing_env_files = false (strict mode)
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	falseBool := false
	config := &UserConfig{
		Shell: ShellSettings{
			EnvFiles:              []string{".env"},
			IgnoreMissingEnvFiles: &falseBool,
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{
		Tool:        "claude",
		ProjectPath: "/projects/myapp",
	}

	result := instance.buildEnvSourceCommand()

	// In strict mode, should NOT use [ -f file ] && pattern
	if strings.Contains(result, `[ -f "`) {
		t.Errorf("In strict mode, should not use file existence check, got: %q", result)
	}
	// Should just have plain source command
	if !strings.Contains(result, `source "`) {
		t.Errorf("In strict mode, should use plain source command, got: %q", result)
	}
}

// =============================================================================
// getToolEnvFile Tests
// =============================================================================
// Tests the tool-specific env file lookup for Claude, Gemini, and custom tools.

func TestGetToolEnvFile_Claude(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Claude: ClaudeSettings{
			EnvFile: ".claude-secrets",
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{Tool: "claude"}
	result := instance.getToolEnvFile()

	if result != ".claude-secrets" {
		t.Errorf("getToolEnvFile() = %q, want %q", result, ".claude-secrets")
	}
}

func TestGetToolEnvFile_Gemini(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Gemini: GeminiSettings{
			EnvFile: ".gemini-api",
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{Tool: "gemini"}
	result := instance.getToolEnvFile()

	if result != ".gemini-api" {
		t.Errorf("getToolEnvFile() = %q, want %q", result, ".gemini-api")
	}
}

func TestGetToolEnvFile_NoConfig(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	instance := &Instance{Tool: "claude"}
	result := instance.getToolEnvFile()

	if result != "" {
		t.Errorf("getToolEnvFile() with no config = %q, want empty string", result)
	}
}

func TestGetToolEnvFile_UnknownTool(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Claude: ClaudeSettings{
			EnvFile: ".claude-secrets",
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	instance := &Instance{Tool: "unknown-tool"}
	result := instance.getToolEnvFile()

	// Unknown tool with no custom tools config should return empty
	if result != "" {
		t.Errorf("getToolEnvFile() for unknown tool = %q, want empty string", result)
	}
}
