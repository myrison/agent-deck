package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestFrecencyScoring tests the frecency calculation algorithm
func TestFrecencyScoring(t *testing.T) {
	// Create a temp directory for test data
	tmpDir := t.TempDir()
	frecencyPath := filepath.Join(tmpDir, "frecency.json")

	pd := &ProjectDiscovery{
		frecencyPath: frecencyPath,
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   filepath.Join(tmpDir, "config.toml"), // Non-existent
	}

	// Test: unused project has score 0
	score := pd.calculateFrecencyScore("/some/path")
	if score != 0 {
		t.Errorf("Expected score 0 for unused project, got %f", score)
	}

	// Test: project used today gets 100x multiplier
	pd.frecency.Projects["/today/project"] = ProjectUsage{
		UseCount:   5,
		LastUsedAt: time.Now(),
	}
	score = pd.calculateFrecencyScore("/today/project")
	expectedScore := 5.0 * 100 // 5 uses * 100 (today multiplier)
	if score != expectedScore {
		t.Errorf("Expected score %f for today's project, got %f", expectedScore, score)
	}

	// Test: project used 3 days ago gets 70x multiplier (this week)
	pd.frecency.Projects["/week/project"] = ProjectUsage{
		UseCount:   3,
		LastUsedAt: time.Now().Add(-3 * 24 * time.Hour),
	}
	score = pd.calculateFrecencyScore("/week/project")
	expectedScore = 3.0 * 70 // 3 uses * 70 (this week multiplier)
	if score != expectedScore {
		t.Errorf("Expected score %f for this week's project, got %f", expectedScore, score)
	}

	// Test: project used 15 days ago gets 50x multiplier (this month)
	pd.frecency.Projects["/month/project"] = ProjectUsage{
		UseCount:   10,
		LastUsedAt: time.Now().Add(-15 * 24 * time.Hour),
	}
	score = pd.calculateFrecencyScore("/month/project")
	expectedScore = 10.0 * 50 // 10 uses * 50 (this month multiplier)
	if score != expectedScore {
		t.Errorf("Expected score %f for this month's project, got %f", expectedScore, score)
	}

	// Test: project used 60 days ago gets 30x multiplier (this quarter)
	pd.frecency.Projects["/quarter/project"] = ProjectUsage{
		UseCount:   2,
		LastUsedAt: time.Now().Add(-60 * 24 * time.Hour),
	}
	score = pd.calculateFrecencyScore("/quarter/project")
	expectedScore = 2.0 * 30 // 2 uses * 30 (this quarter multiplier)
	if score != expectedScore {
		t.Errorf("Expected score %f for this quarter's project, got %f", expectedScore, score)
	}

	// Test: project used 120 days ago gets 10x multiplier (older)
	pd.frecency.Projects["/old/project"] = ProjectUsage{
		UseCount:   8,
		LastUsedAt: time.Now().Add(-120 * 24 * time.Hour),
	}
	score = pd.calculateFrecencyScore("/old/project")
	expectedScore = 8.0 * 10 // 8 uses * 10 (older multiplier)
	if score != expectedScore {
		t.Errorf("Expected score %f for old project, got %f", expectedScore, score)
	}
}

// TestRecordUsage tests usage recording and persistence
func TestRecordUsage(t *testing.T) {
	tmpDir := t.TempDir()
	frecencyPath := filepath.Join(tmpDir, "frecency.json")

	pd := &ProjectDiscovery{
		frecencyPath: frecencyPath,
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   filepath.Join(tmpDir, "config.toml"),
	}

	projectPath := "/my/project"

	// Record first usage
	err := pd.RecordUsage(projectPath)
	if err != nil {
		t.Fatalf("RecordUsage failed: %v", err)
	}

	// Verify usage was recorded
	usage := pd.frecency.Projects[projectPath]
	if usage.UseCount != 1 {
		t.Errorf("Expected UseCount 1, got %d", usage.UseCount)
	}
	if usage.LastUsedAt.IsZero() {
		t.Error("Expected LastUsedAt to be set")
	}

	// Record another usage
	err = pd.RecordUsage(projectPath)
	if err != nil {
		t.Fatalf("RecordUsage failed: %v", err)
	}

	usage = pd.frecency.Projects[projectPath]
	if usage.UseCount != 2 {
		t.Errorf("Expected UseCount 2, got %d", usage.UseCount)
	}

	// Verify file was written
	data, err := os.ReadFile(frecencyPath)
	if err != nil {
		t.Fatalf("Failed to read frecency file: %v", err)
	}

	var savedFrecency FrecencyData
	if err := json.Unmarshal(data, &savedFrecency); err != nil {
		t.Fatalf("Failed to parse frecency file: %v", err)
	}

	if savedFrecency.Projects[projectPath].UseCount != 2 {
		t.Errorf("Expected persisted UseCount 2, got %d", savedFrecency.Projects[projectPath].UseCount)
	}
}

// TestLoadFrecency tests loading frecency data from disk
func TestLoadFrecency(t *testing.T) {
	tmpDir := t.TempDir()
	frecencyPath := filepath.Join(tmpDir, "frecency.json")

	// Create a frecency file with test data
	testData := FrecencyData{
		Projects: map[string]ProjectUsage{
			"/project/a": {UseCount: 5, LastUsedAt: time.Now()},
			"/project/b": {UseCount: 3, LastUsedAt: time.Now().Add(-24 * time.Hour)},
		},
	}
	data, _ := json.Marshal(testData)
	os.WriteFile(frecencyPath, data, 0600)

	// Create ProjectDiscovery and load
	pd := &ProjectDiscovery{
		frecencyPath: frecencyPath,
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   filepath.Join(tmpDir, "config.toml"),
	}
	pd.loadFrecency()

	// Verify data was loaded
	if len(pd.frecency.Projects) != 2 {
		t.Errorf("Expected 2 projects, got %d", len(pd.frecency.Projects))
	}

	if pd.frecency.Projects["/project/a"].UseCount != 5 {
		t.Errorf("Expected UseCount 5 for project/a, got %d", pd.frecency.Projects["/project/a"].UseCount)
	}
}

// TestIsProject tests project detection logic
func TestIsProject(t *testing.T) {
	tmpDir := t.TempDir()

	pd := &ProjectDiscovery{
		frecencyPath: filepath.Join(tmpDir, "frecency.json"),
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   filepath.Join(tmpDir, "config.toml"),
	}

	// Create test directories
	emptyDir := filepath.Join(tmpDir, "empty")
	os.MkdirAll(emptyDir, 0755)

	gitProject := filepath.Join(tmpDir, "git-project")
	os.MkdirAll(filepath.Join(gitProject, ".git"), 0755)

	npmProject := filepath.Join(tmpDir, "npm-project")
	os.MkdirAll(npmProject, 0755)
	os.WriteFile(filepath.Join(npmProject, "package.json"), []byte("{}"), 0644)

	goProject := filepath.Join(tmpDir, "go-project")
	os.MkdirAll(goProject, 0755)
	os.WriteFile(filepath.Join(goProject, "go.mod"), []byte("module test"), 0644)

	rustProject := filepath.Join(tmpDir, "rust-project")
	os.MkdirAll(rustProject, 0755)
	os.WriteFile(filepath.Join(rustProject, "Cargo.toml"), []byte("[package]"), 0644)

	pythonProject := filepath.Join(tmpDir, "python-project")
	os.MkdirAll(pythonProject, 0755)
	os.WriteFile(filepath.Join(pythonProject, "pyproject.toml"), []byte("[project]"), 0644)

	claudeProject := filepath.Join(tmpDir, "claude-project")
	os.MkdirAll(claudeProject, 0755)
	os.WriteFile(filepath.Join(claudeProject, "CLAUDE.md"), []byte("# Claude"), 0644)

	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{"empty directory", emptyDir, false},
		{"git project", gitProject, true},
		{"npm project", npmProject, true},
		{"go project", goProject, true},
		{"rust project", rustProject, true},
		{"python project", pythonProject, true},
		{"claude project", claudeProject, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := pd.isProject(tt.path)
			if result != tt.expected {
				t.Errorf("isProject(%s) = %v, want %v", tt.path, result, tt.expected)
			}
		})
	}
}

// TestDiscoverProjects tests the full project discovery flow
func TestDiscoverProjects(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a scan path with some projects
	scanPath := filepath.Join(tmpDir, "code")
	os.MkdirAll(scanPath, 0755)

	// Create test projects
	project1 := filepath.Join(scanPath, "project1")
	os.MkdirAll(project1, 0755)
	os.WriteFile(filepath.Join(project1, "go.mod"), []byte("module p1"), 0644)

	project2 := filepath.Join(scanPath, "project2")
	os.MkdirAll(project2, 0755)
	os.WriteFile(filepath.Join(project2, "package.json"), []byte("{}"), 0644)

	// Create a nested project
	nestedPath := filepath.Join(scanPath, "org", "project3")
	os.MkdirAll(nestedPath, 0755)
	os.WriteFile(filepath.Join(nestedPath, "Cargo.toml"), []byte("[package]"), 0644)

	// Create node_modules (should be ignored)
	nodeModules := filepath.Join(scanPath, "node_modules", "somepkg")
	os.MkdirAll(nodeModules, 0755)
	os.WriteFile(filepath.Join(nodeModules, "package.json"), []byte("{}"), 0644)

	// Create a hidden directory (should be ignored)
	hiddenDir := filepath.Join(scanPath, ".hidden-project")
	os.MkdirAll(hiddenDir, 0755)
	os.WriteFile(filepath.Join(hiddenDir, "go.mod"), []byte("module hidden"), 0644)

	// Create config.toml with scan_paths
	configPath := filepath.Join(tmpDir, "config.toml")
	configContent := `
[project_discovery]
scan_paths = ["` + scanPath + `"]
max_depth = 2
ignore_patterns = ["node_modules", ".git", "vendor"]
`
	os.WriteFile(configPath, []byte(configContent), 0644)

	pd := &ProjectDiscovery{
		frecencyPath: filepath.Join(tmpDir, "frecency.json"),
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   configPath,
	}

	// Discover projects (no existing sessions)
	projects, err := pd.DiscoverProjects([]SessionInfo{})
	if err != nil {
		t.Fatalf("DiscoverProjects failed: %v", err)
	}

	// Should find 3 projects (project1, project2, project3)
	// node_modules and hidden should be ignored
	if len(projects) != 3 {
		t.Errorf("Expected 3 projects, got %d", len(projects))
		for _, p := range projects {
			t.Logf("Found: %s", p.Path)
		}
	}

	// Verify node_modules was ignored
	for _, p := range projects {
		if filepath.Base(p.Path) == "somepkg" {
			t.Error("node_modules project should have been ignored")
		}
	}

	// Verify hidden was ignored
	for _, p := range projects {
		if filepath.Base(p.Path) == ".hidden-project" {
			t.Error("hidden project should have been ignored")
		}
	}
}

// TestDiscoverProjectsWithSessions tests session boosting
func TestDiscoverProjectsWithSessions(t *testing.T) {
	tmpDir := t.TempDir()

	pd := &ProjectDiscovery{
		frecencyPath: filepath.Join(tmpDir, "frecency.json"),
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   filepath.Join(tmpDir, "config.toml"), // No config = no scan paths
	}

	// Create sessions
	sessions := []SessionInfo{
		{ID: "sess1", ProjectPath: "/projects/api", Tool: "claude"},
		{ID: "sess2", ProjectPath: "/projects/web", Tool: "gemini"},
	}

	projects, err := pd.DiscoverProjects(sessions)
	if err != nil {
		t.Fatalf("DiscoverProjects failed: %v", err)
	}

	// Should find 2 projects from sessions
	if len(projects) != 2 {
		t.Errorf("Expected 2 projects, got %d", len(projects))
	}

	// All should have sessions
	for _, p := range projects {
		if !p.HasSession {
			t.Errorf("Project %s should have HasSession=true", p.Path)
		}
	}

	// Session projects should have boosted score (1000+)
	for _, p := range projects {
		if p.Score < 1000 {
			t.Errorf("Session project %s should have score >= 1000, got %f", p.Path, p.Score)
		}
	}
}

// TestGetSettings tests config loading with defaults
func TestGetSettings(t *testing.T) {
	tmpDir := t.TempDir()

	t.Run("no config file returns defaults", func(t *testing.T) {
		pd := &ProjectDiscovery{
			frecencyPath: filepath.Join(tmpDir, "frecency.json"),
			frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
			configPath:   filepath.Join(tmpDir, "nonexistent.toml"),
		}

		settings := pd.getSettings()

		if settings.MaxDepth != 2 {
			t.Errorf("Expected default MaxDepth 2, got %d", settings.MaxDepth)
		}
		if len(settings.ScanPaths) != 0 {
			t.Errorf("Expected empty ScanPaths, got %v", settings.ScanPaths)
		}
		if len(settings.IgnorePatterns) == 0 {
			t.Error("Expected default IgnorePatterns")
		}
	})

	t.Run("config file overrides defaults", func(t *testing.T) {
		configPath := filepath.Join(tmpDir, "config.toml")
		configContent := `
[project_discovery]
scan_paths = ["/custom/path"]
max_depth = 3
ignore_patterns = ["custom_ignore"]
`
		os.WriteFile(configPath, []byte(configContent), 0644)

		pd := &ProjectDiscovery{
			frecencyPath: filepath.Join(tmpDir, "frecency.json"),
			frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
			configPath:   configPath,
		}

		settings := pd.getSettings()

		if settings.MaxDepth != 3 {
			t.Errorf("Expected MaxDepth 3, got %d", settings.MaxDepth)
		}
		if len(settings.ScanPaths) != 1 || settings.ScanPaths[0] != "/custom/path" {
			t.Errorf("Expected ScanPaths [/custom/path], got %v", settings.ScanPaths)
		}
		if len(settings.IgnorePatterns) != 1 || settings.IgnorePatterns[0] != "custom_ignore" {
			t.Errorf("Expected IgnorePatterns [custom_ignore], got %v", settings.IgnorePatterns)
		}
	})

	t.Run("tilde expansion in scan paths", func(t *testing.T) {
		configPath := filepath.Join(tmpDir, "config-tilde.toml")
		configContent := `
[project_discovery]
scan_paths = ["~/code", "~/projects"]
`
		os.WriteFile(configPath, []byte(configContent), 0644)

		pd := &ProjectDiscovery{
			frecencyPath: filepath.Join(tmpDir, "frecency.json"),
			frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
			configPath:   configPath,
		}

		settings := pd.getSettings()
		home, _ := os.UserHomeDir()

		for _, path := range settings.ScanPaths {
			if path[0] == '~' {
				t.Errorf("Tilde was not expanded in path: %s", path)
			}
			if !filepath.IsAbs(path) {
				t.Errorf("Path should be absolute: %s", path)
			}
			if home != "" && len(path) > len(home) && path[:len(home)] != home {
				t.Errorf("Path should start with home directory: %s", path)
			}
		}
	})
}

// TestMultiSessionDiscovery tests that multiple sessions at the same path are correctly discovered
func TestMultiSessionDiscovery(t *testing.T) {
	tmpDir := t.TempDir()

	pd := &ProjectDiscovery{
		frecencyPath: filepath.Join(tmpDir, "frecency.json"),
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   filepath.Join(tmpDir, "config.toml"), // No config = no scan paths
	}

	t.Run("single session at path", func(t *testing.T) {
		sessions := []SessionInfo{
			{ID: "sess1", ProjectPath: "/projects/api", Tool: "claude", Status: "running", CustomLabel: "bugfix"},
		}

		projects, err := pd.DiscoverProjects(sessions)
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		if len(projects) != 1 {
			t.Fatalf("Expected 1 project, got %d", len(projects))
		}

		p := projects[0]
		if p.SessionCount != 1 {
			t.Errorf("Expected SessionCount 1, got %d", p.SessionCount)
		}
		if len(p.Sessions) != 1 {
			t.Errorf("Expected 1 session in slice, got %d", len(p.Sessions))
		}
		if p.Sessions[0].ID != "sess1" {
			t.Errorf("Expected session ID 'sess1', got '%s'", p.Sessions[0].ID)
		}
		if p.Sessions[0].CustomLabel != "bugfix" {
			t.Errorf("Expected CustomLabel 'bugfix', got '%s'", p.Sessions[0].CustomLabel)
		}
		if p.Sessions[0].Status != "running" {
			t.Errorf("Expected Status 'running', got '%s'", p.Sessions[0].Status)
		}
		// Backward compat: Tool and SessionID should be from first session
		if p.Tool != "claude" {
			t.Errorf("Expected Tool 'claude', got '%s'", p.Tool)
		}
		if p.SessionID != "sess1" {
			t.Errorf("Expected SessionID 'sess1', got '%s'", p.SessionID)
		}
	})

	t.Run("multiple sessions at same path", func(t *testing.T) {
		sessions := []SessionInfo{
			{ID: "sess1", ProjectPath: "/projects/api", Tool: "claude", Status: "running", CustomLabel: "bugfix"},
			{ID: "sess2", ProjectPath: "/projects/api", Tool: "claude", Status: "waiting", CustomLabel: "#2"},
			{ID: "sess3", ProjectPath: "/projects/api", Tool: "gemini", Status: "running", CustomLabel: "feature"},
		}

		projects, err := pd.DiscoverProjects(sessions)
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		if len(projects) != 1 {
			t.Fatalf("Expected 1 project (same path), got %d", len(projects))
		}

		p := projects[0]
		if p.SessionCount != 3 {
			t.Errorf("Expected SessionCount 3, got %d", p.SessionCount)
		}
		if len(p.Sessions) != 3 {
			t.Errorf("Expected 3 sessions in slice, got %d", len(p.Sessions))
		}

		// Verify all sessions are present
		sessionIDs := make(map[string]bool)
		for _, s := range p.Sessions {
			sessionIDs[s.ID] = true
		}
		for _, expectedID := range []string{"sess1", "sess2", "sess3"} {
			if !sessionIDs[expectedID] {
				t.Errorf("Expected session '%s' to be in Sessions slice", expectedID)
			}
		}

		// Backward compat: first session's data should populate legacy fields
		if p.HasSession != true {
			t.Error("Expected HasSession to be true")
		}
	})

	t.Run("mixed local and remote sessions at same path become separate projects", func(t *testing.T) {
		sessions := []SessionInfo{
			{ID: "local1", ProjectPath: "/projects/api", Tool: "claude", Status: "running", IsRemote: false},
			{ID: "remote1", ProjectPath: "/projects/api", Tool: "claude", Status: "waiting", IsRemote: true, RemoteHost: "dev-server", RemoteHostDisplayName: "Dev Server"},
		}

		projects, err := pd.DiscoverProjects(sessions)
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		if len(projects) != 2 {
			t.Fatalf("Expected 2 projects (local + remote), got %d", len(projects))
		}

		// Find local and remote projects
		var localProject, remoteProject *ProjectInfo
		for i := range projects {
			if projects[i].IsRemote {
				remoteProject = &projects[i]
			} else {
				localProject = &projects[i]
			}
		}

		if localProject == nil {
			t.Fatal("Expected to find local project")
		}
		if localProject.SessionCount != 1 {
			t.Errorf("Expected local project SessionCount 1, got %d", localProject.SessionCount)
		}
		if localProject.Sessions[0].ID != "local1" {
			t.Errorf("Expected local session ID 'local1', got '%s'", localProject.Sessions[0].ID)
		}
		if localProject.IsRemote {
			t.Error("Expected local project IsRemote=false")
		}

		if remoteProject == nil {
			t.Fatal("Expected to find remote project")
		}
		if remoteProject.SessionCount != 1 {
			t.Errorf("Expected remote project SessionCount 1, got %d", remoteProject.SessionCount)
		}
		if remoteProject.Sessions[0].ID != "remote1" {
			t.Errorf("Expected remote session ID 'remote1', got '%s'", remoteProject.Sessions[0].ID)
		}
		if !remoteProject.IsRemote {
			t.Error("Expected remote project IsRemote=true")
		}
		if remoteProject.RemoteHost != "dev-server" {
			t.Errorf("Expected RemoteHost 'dev-server', got '%s'", remoteProject.RemoteHost)
		}
		if remoteProject.RemoteHostDisplayName != "Dev Server" {
			t.Errorf("Expected RemoteHostDisplayName 'Dev Server', got '%s'", remoteProject.RemoteHostDisplayName)
		}
	})

	t.Run("same path on different remote hosts become separate projects", func(t *testing.T) {
		sessions := []SessionInfo{
			{ID: "docker1", ProjectPath: "/app", Tool: "claude", Status: "running", IsRemote: true, RemoteHost: "docker-dev", RemoteHostDisplayName: "Docker"},
			{ID: "mac1", ProjectPath: "/app", Tool: "claude", Status: "waiting", IsRemote: true, RemoteHost: "macbook", RemoteHostDisplayName: "MacBook"},
		}

		projects, err := pd.DiscoverProjects(sessions)
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		if len(projects) != 2 {
			t.Fatalf("Expected 2 projects (different hosts), got %d", len(projects))
		}

		// Find projects by host
		hostToProject := make(map[string]*ProjectInfo)
		for i := range projects {
			hostToProject[projects[i].RemoteHost] = &projects[i]
		}

		dockerProject := hostToProject["docker-dev"]
		if dockerProject == nil {
			t.Fatal("Expected to find docker-dev project")
		}
		if dockerProject.SessionCount != 1 {
			t.Errorf("Expected docker SessionCount 1, got %d", dockerProject.SessionCount)
		}
		if dockerProject.Sessions[0].ID != "docker1" {
			t.Errorf("Expected docker session ID 'docker1', got '%s'", dockerProject.Sessions[0].ID)
		}

		macProject := hostToProject["macbook"]
		if macProject == nil {
			t.Fatal("Expected to find macbook project")
		}
		if macProject.SessionCount != 1 {
			t.Errorf("Expected macbook SessionCount 1, got %d", macProject.SessionCount)
		}
		if macProject.Sessions[0].ID != "mac1" {
			t.Errorf("Expected macbook session ID 'mac1', got '%s'", macProject.Sessions[0].ID)
		}
	})

	t.Run("multiple remote sessions on same host stay grouped", func(t *testing.T) {
		sessions := []SessionInfo{
			{ID: "r1", ProjectPath: "/app", Tool: "claude", Status: "running", IsRemote: true, RemoteHost: "docker-dev", RemoteHostDisplayName: "Docker"},
			{ID: "r2", ProjectPath: "/app", Tool: "claude", Status: "waiting", IsRemote: true, RemoteHost: "docker-dev", RemoteHostDisplayName: "Docker"},
			{ID: "r3", ProjectPath: "/app", Tool: "gemini", Status: "running", IsRemote: true, RemoteHost: "docker-dev", RemoteHostDisplayName: "Docker"},
		}

		projects, err := pd.DiscoverProjects(sessions)
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		if len(projects) != 1 {
			t.Fatalf("Expected 1 project (same host), got %d", len(projects))
		}

		p := projects[0]
		if p.SessionCount != 3 {
			t.Errorf("Expected SessionCount 3, got %d", p.SessionCount)
		}
		if !p.IsRemote {
			t.Error("Expected IsRemote=true")
		}
		if p.RemoteHost != "docker-dev" {
			t.Errorf("Expected RemoteHost 'docker-dev', got '%s'", p.RemoteHost)
		}

		sessionIDs := make(map[string]bool)
		for _, s := range p.Sessions {
			sessionIDs[s.ID] = true
		}
		for _, expectedID := range []string{"r1", "r2", "r3"} {
			if !sessionIDs[expectedID] {
				t.Errorf("Expected session '%s' in group", expectedID)
			}
		}
	})

	t.Run("scanned local project and remote session at same path coexist", func(t *testing.T) {
		// Create a real directory that the scanner will find
		scanPath := filepath.Join(tmpDir, "scan-coexist")
		os.MkdirAll(scanPath, 0755)

		projectDir := filepath.Join(scanPath, "api")
		os.MkdirAll(projectDir, 0755)
		os.WriteFile(filepath.Join(projectDir, "go.mod"), []byte("module api"), 0644)

		configPath := filepath.Join(tmpDir, "config-coexist.toml")
		configContent := `
[project_discovery]
scan_paths = ["` + scanPath + `"]
`
		os.WriteFile(configPath, []byte(configContent), 0644)

		pdCoexist := &ProjectDiscovery{
			frecencyPath: filepath.Join(tmpDir, "frecency-coexist.json"),
			frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
			configPath:   configPath,
		}

		// Remote session at the same path the scanner will find
		sessions := []SessionInfo{
			{ID: "remote1", ProjectPath: projectDir, Tool: "claude", Status: "running", IsRemote: true, RemoteHost: "docker-dev", RemoteHostDisplayName: "Docker"},
		}

		projects, err := pdCoexist.DiscoverProjects(sessions)
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		// Log all projects for diagnostics before asserting count
		for _, p := range projects {
			t.Logf("  path=%s isRemote=%v remoteHost=%s sessionCount=%d", p.Path, p.IsRemote, p.RemoteHost, p.SessionCount)
		}

		// Should find 2 entries: one from the remote session group and one from the scanner
		if len(projects) != 2 {
			t.Fatalf("Expected 2 projects (scanned local + remote session), got %d", len(projects))
		}

		var localProject, remoteProject *ProjectInfo
		for i := range projects {
			if projects[i].IsRemote {
				remoteProject = &projects[i]
			} else {
				localProject = &projects[i]
			}
		}

		// Verify local (scanned) project
		if localProject == nil {
			t.Fatal("Expected scanned local project entry")
		}
		if localProject.Path != projectDir {
			t.Errorf("Local project path should be %s, got %s", projectDir, localProject.Path)
		}
		if localProject.IsRemote {
			t.Error("Scanned local project should have IsRemote=false")
		}
		if localProject.HasSession {
			t.Error("Scanned local project should have HasSession=false")
		}
		if localProject.SessionCount != 0 {
			t.Errorf("Scanned local project should have SessionCount 0, got %d", localProject.SessionCount)
		}

		// Verify remote (session-based) project
		if remoteProject == nil {
			t.Fatal("Expected remote session project entry")
		}
		if remoteProject.Path != projectDir {
			t.Errorf("Remote project path should be %s, got %s", projectDir, remoteProject.Path)
		}
		if !remoteProject.HasSession {
			t.Error("Remote project should have HasSession=true")
		}
		if remoteProject.SessionCount != 1 {
			t.Errorf("Remote project should have SessionCount 1, got %d", remoteProject.SessionCount)
		}
		if remoteProject.RemoteHost != "docker-dev" {
			t.Errorf("Remote project should have RemoteHost 'docker-dev', got '%s'", remoteProject.RemoteHost)
		}
		// Verify the remote project's session data is correct
		if len(remoteProject.Sessions) != 1 {
			t.Fatalf("Remote project should have 1 session summary, got %d", len(remoteProject.Sessions))
		}
		if remoteProject.Sessions[0].ID != "remote1" {
			t.Errorf("Remote session ID should be 'remote1', got '%s'", remoteProject.Sessions[0].ID)
		}
	})

	t.Run("zero sessions for scanned projects", func(t *testing.T) {
		// Create a scan path with a project but no sessions
		scanPath := filepath.Join(tmpDir, "code")
		os.MkdirAll(scanPath, 0755)

		project := filepath.Join(scanPath, "myproject")
		os.MkdirAll(project, 0755)
		os.WriteFile(filepath.Join(project, "go.mod"), []byte("module test"), 0644)

		configPath := filepath.Join(tmpDir, "config-scan.toml")
		configContent := `
[project_discovery]
scan_paths = ["` + scanPath + `"]
`
		os.WriteFile(configPath, []byte(configContent), 0644)

		pdWithScan := &ProjectDiscovery{
			frecencyPath: filepath.Join(tmpDir, "frecency2.json"),
			frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
			configPath:   configPath,
		}

		projects, err := pdWithScan.DiscoverProjects([]SessionInfo{})
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		if len(projects) != 1 {
			t.Fatalf("Expected 1 project, got %d", len(projects))
		}

		p := projects[0]
		if p.SessionCount != 0 {
			t.Errorf("Expected SessionCount 0 for project without sessions, got %d", p.SessionCount)
		}
		if p.HasSession != false {
			t.Error("Expected HasSession to be false for project without sessions")
		}
		if len(p.Sessions) != 0 {
			t.Errorf("Expected empty Sessions slice, got %d sessions", len(p.Sessions))
		}
	})

	t.Run("session status is propagated correctly", func(t *testing.T) {
		sessions := []SessionInfo{
			{ID: "s1", ProjectPath: "/test/path", Tool: "claude", Status: "running"},
			{ID: "s2", ProjectPath: "/test/path", Tool: "claude", Status: "waiting"},
			{ID: "s3", ProjectPath: "/test/path", Tool: "claude", Status: "stopped"},
		}

		projects, err := pd.DiscoverProjects(sessions)
		if err != nil {
			t.Fatalf("DiscoverProjects failed: %v", err)
		}

		p := projects[0]
		statusMap := make(map[string]string)
		for _, s := range p.Sessions {
			statusMap[s.ID] = s.Status
		}

		if statusMap["s1"] != "running" {
			t.Errorf("Expected s1 status 'running', got '%s'", statusMap["s1"])
		}
		if statusMap["s2"] != "waiting" {
			t.Errorf("Expected s2 status 'waiting', got '%s'", statusMap["s2"])
		}
		if statusMap["s3"] != "stopped" {
			t.Errorf("Expected s3 status 'stopped', got '%s'", statusMap["s3"])
		}
	})
}
