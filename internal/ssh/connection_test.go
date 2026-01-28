package ssh

import (
	"strings"
	"testing"
)

func TestBuildSSHArgs_BasicHost(t *testing.T) {
	conn := NewConnection(Config{Host: "example.com"})
	args := conn.buildSSHArgs()

	// Should end with just the host (no user@)
	target := args[len(args)-1]
	if target != "example.com" {
		t.Errorf("Expected target 'example.com', got %q", target)
	}

	// Should not contain -p (default port 22)
	for i, arg := range args {
		if arg == "-p" {
			t.Errorf("Should not have -p flag for default port, found at index %d", i)
		}
	}
}

func TestBuildSSHArgs_WithUser(t *testing.T) {
	conn := NewConnection(Config{Host: "example.com", User: "deploy"})
	args := conn.buildSSHArgs()

	target := args[len(args)-1]
	if target != "deploy@example.com" {
		t.Errorf("Expected target 'deploy@example.com', got %q", target)
	}
}

func TestBuildSSHArgs_WithNonDefaultPort(t *testing.T) {
	conn := NewConnection(Config{Host: "example.com", Port: 2222})
	args := conn.buildSSHArgs()

	foundPort := false
	for i, arg := range args {
		if arg == "-p" && i+1 < len(args) && args[i+1] == "2222" {
			foundPort = true
			break
		}
	}
	if !foundPort {
		t.Errorf("Expected -p 2222 in args, got %v", args)
	}
}

func TestBuildSSHArgs_WithJumpHost(t *testing.T) {
	conn := NewConnection(Config{Host: "internal.example.com", JumpHost: "bastion.example.com"})
	args := conn.buildSSHArgs()

	foundJump := false
	for i, arg := range args {
		if arg == "-J" && i+1 < len(args) && args[i+1] == "bastion.example.com" {
			foundJump = true
			break
		}
	}
	if !foundJump {
		t.Errorf("Expected -J bastion.example.com in args, got %v", args)
	}
}

func TestBuildSSHArgs_WithIdentityFile(t *testing.T) {
	conn := NewConnection(Config{Host: "example.com", IdentityFile: "/home/user/.ssh/deploy_key"})
	args := conn.buildSSHArgs()

	foundIdentity := false
	for i, arg := range args {
		if arg == "-i" && i+1 < len(args) && args[i+1] == "/home/user/.ssh/deploy_key" {
			foundIdentity = true
			break
		}
	}
	if !foundIdentity {
		t.Errorf("Expected -i /home/user/.ssh/deploy_key in args, got %v", args)
	}
}

func TestBuildSSHArgs_AllOptions(t *testing.T) {
	conn := NewConnection(Config{
		Host:         "internal.example.com",
		User:         "deploy",
		Port:         2222,
		JumpHost:     "bastion.example.com",
		IdentityFile: "/home/user/.ssh/deploy_key",
	})
	args := conn.buildSSHArgs()

	// Verify target is last and correctly formatted
	target := args[len(args)-1]
	if target != "deploy@internal.example.com" {
		t.Errorf("Expected target 'deploy@internal.example.com', got %q", target)
	}

	// Verify all options present
	argsStr := strings.Join(args, " ")
	checks := []string{
		"-J bastion.example.com",
		"-i /home/user/.ssh/deploy_key",
		"-p 2222",
	}
	for _, check := range checks {
		if !strings.Contains(argsStr, check) {
			t.Errorf("Expected %q in args, got %v", check, args)
		}
	}
}

func TestBuildSSHArgs_ContainsRequiredOptions(t *testing.T) {
	conn := NewConnection(Config{Host: "example.com"})
	args := conn.buildSSHArgs()
	argsStr := strings.Join(args, " ")

	// These options should always be present
	required := []string{
		"StrictHostKeyChecking=accept-new",
		"BatchMode=yes",
		"ConnectTimeout=10",
		"ControlMaster=auto",
		"ControlPersist=300",
	}

	for _, opt := range required {
		if !strings.Contains(argsStr, opt) {
			t.Errorf("Expected %q in args, got %v", opt, args)
		}
	}
}

func TestBuildSSHArgs_ControlPathContainsHostInfo(t *testing.T) {
	conn := NewConnection(Config{Host: "example.com", Port: 2222, User: "deploy"})
	args := conn.buildSSHArgs()

	var controlPath string
	for i, arg := range args {
		if strings.HasPrefix(arg, "ControlPath=") {
			controlPath = arg
			break
		}
		// Also check if it's a separate -o ControlPath=... argument
		if arg == "-o" && i+1 < len(args) && strings.HasPrefix(args[i+1], "ControlPath=") {
			controlPath = args[i+1]
			break
		}
	}

	if controlPath == "" {
		t.Fatal("ControlPath not found in args")
	}

	// ControlPath should contain host, port, and user for uniqueness
	if !strings.Contains(controlPath, "example.com") {
		t.Errorf("ControlPath should contain host, got %q", controlPath)
	}
	if !strings.Contains(controlPath, "2222") {
		t.Errorf("ControlPath should contain port, got %q", controlPath)
	}
	if !strings.Contains(controlPath, "deploy") {
		t.Errorf("ControlPath should contain user, got %q", controlPath)
	}
}
