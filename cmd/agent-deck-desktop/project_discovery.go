package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// SessionSummary provides summary info about a session for project discovery
type SessionSummary struct {
	ID                    string `json:"id"`
	CustomLabel           string `json:"customLabel,omitempty"`
	Status                string `json:"status"`
	Tool                  string `json:"tool"`
	IsRemote              bool   `json:"isRemote,omitempty"`
	RemoteHost            string `json:"remoteHost,omitempty"`
	RemoteHostDisplayName string `json:"remoteHostDisplayName,omitempty"`
}

// ProjectInfo represents a discovered project for the frontend
type ProjectInfo struct {
	Path                  string           `json:"path"`
	Name                  string           `json:"name"`
	Score                 float64          `json:"score"`                            // Frecency score
	HasSession            bool             `json:"hasSession"`                       // Has existing session?
	Tool                  string           `json:"tool"`                             // Tool if session exists (first session for backward compat)
	SessionID             string           `json:"sessionId"`                        // Session ID if exists (first session for backward compat)
	SessionCount          int              `json:"sessionCount"`                     // Total number of sessions at this path+host
	Sessions              []SessionSummary `json:"sessions,omitempty"`               // All sessions at this path+host
	IsRemote              bool             `json:"isRemote,omitempty"`               // Whether this project group is remote
	RemoteHost            string           `json:"remoteHost,omitempty"`             // SSH host for remote projects
	RemoteHostDisplayName string           `json:"remoteHostDisplayName,omitempty"`  // Display name for remote host
}

// ProjectDiscoverySettings defines settings for discovering projects
type ProjectDiscoverySettings struct {
	ScanPaths      []string `toml:"scan_paths"`
	MaxDepth       int      `toml:"max_depth"`
	IgnorePatterns []string `toml:"ignore_patterns"`
}

// FrecencyData stores project usage history for frecency scoring
type FrecencyData struct {
	Projects map[string]ProjectUsage `json:"projects"`
}

// ProjectUsage tracks usage stats for a single project
type ProjectUsage struct {
	UseCount   int       `json:"useCount"`
	LastUsedAt time.Time `json:"lastUsedAt"`
}

// ProjectDiscovery handles project scanning and ranking
type ProjectDiscovery struct {
	frecencyPath string
	frecency     *FrecencyData
	configPath   string
}

// NewProjectDiscovery creates a new project discovery instance
func NewProjectDiscovery() *ProjectDiscovery {
	home, _ := os.UserHomeDir()
	frecencyPath := filepath.Join(home, ".agent-deck", "frecency.json")
	configPath := filepath.Join(home, ".agent-deck", "config.toml")

	pd := &ProjectDiscovery{
		frecencyPath: frecencyPath,
		frecency:     &FrecencyData{Projects: make(map[string]ProjectUsage)},
		configPath:   configPath,
	}

	// Load frecency data
	pd.loadFrecency()

	return pd
}

// loadFrecency loads frecency data from disk
func (pd *ProjectDiscovery) loadFrecency() {
	data, err := os.ReadFile(pd.frecencyPath)
	if err != nil {
		return
	}

	var frecency FrecencyData
	if err := json.Unmarshal(data, &frecency); err != nil {
		return
	}

	if frecency.Projects == nil {
		frecency.Projects = make(map[string]ProjectUsage)
	}

	pd.frecency = &frecency
}

// saveFrecency saves frecency data to disk
func (pd *ProjectDiscovery) saveFrecency() error {
	data, err := json.MarshalIndent(pd.frecency, "", "  ")
	if err != nil {
		return err
	}

	// Ensure directory exists
	dir := filepath.Dir(pd.frecencyPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	return os.WriteFile(pd.frecencyPath, data, 0600)
}

// RecordUsage records that a project was used
func (pd *ProjectDiscovery) RecordUsage(projectPath string) error {
	usage := pd.frecency.Projects[projectPath]
	usage.UseCount++
	usage.LastUsedAt = time.Now()
	pd.frecency.Projects[projectPath] = usage

	return pd.saveFrecency()
}

// getSettings loads project discovery settings from config.toml
func (pd *ProjectDiscovery) getSettings() ProjectDiscoverySettings {
	defaults := ProjectDiscoverySettings{
		ScanPaths:      []string{},
		MaxDepth:       2,
		IgnorePatterns: []string{"node_modules", ".git", "vendor", "__pycache__", ".venv", "dist", "build"},
	}

	// Try to load from config.toml
	data, err := os.ReadFile(pd.configPath)
	if err != nil {
		return defaults
	}

	// Parse just the project_discovery section
	var config struct {
		ProjectDiscovery ProjectDiscoverySettings `toml:"project_discovery"`
	}

	if err := toml.Unmarshal(data, &config); err != nil {
		return defaults
	}

	settings := config.ProjectDiscovery

	// Apply defaults for unset values
	if settings.MaxDepth <= 0 {
		settings.MaxDepth = defaults.MaxDepth
	}
	if len(settings.IgnorePatterns) == 0 {
		settings.IgnorePatterns = defaults.IgnorePatterns
	}

	// Expand ~ in scan paths
	home, _ := os.UserHomeDir()
	expandedPaths := make([]string, 0, len(settings.ScanPaths))
	for _, p := range settings.ScanPaths {
		if strings.HasPrefix(p, "~/") {
			p = filepath.Join(home, p[2:])
		}
		expandedPaths = append(expandedPaths, p)
	}
	settings.ScanPaths = expandedPaths

	return settings
}

// GetRawScanPaths returns the unexpanded scan paths (with ~/ preserved) for display
func (pd *ProjectDiscovery) GetRawScanPaths() []string {
	data, err := os.ReadFile(pd.configPath)
	if err != nil {
		return []string{}
	}

	var config struct {
		ProjectDiscovery ProjectDiscoverySettings `toml:"project_discovery"`
	}
	if err := toml.Unmarshal(data, &config); err != nil {
		return []string{}
	}

	if len(config.ProjectDiscovery.ScanPaths) == 0 {
		return []string{}
	}
	return config.ProjectDiscovery.ScanPaths
}

// SetScanPaths writes the scan paths to config.toml, preserving other sections
func (pd *ProjectDiscovery) SetScanPaths(paths []string) error {
	// Normalize paths
	normalized := make([]string, 0, len(paths))
	seen := make(map[string]bool)
	for _, p := range paths {
		p = strings.TrimSpace(p)
		p = strings.TrimRight(p, "/")
		if p == "" {
			continue
		}
		if seen[p] {
			continue
		}
		seen[p] = true
		normalized = append(normalized, p)
	}

	return pd.saveProjectDiscoverySettings(func(settings map[string]interface{}) {
		settings["scan_paths"] = normalized
	})
}

// AddScanPath appends a path, deduplicating against existing paths
func (pd *ProjectDiscovery) AddScanPath(path string) error {
	path = strings.TrimSpace(path)
	path = strings.TrimRight(path, "/")
	if path == "" {
		return nil
	}

	existing := pd.GetRawScanPaths()

	// Also check with home dir collapsed to ~/
	home, _ := os.UserHomeDir()
	collapsedPath := path
	if home != "" && strings.HasPrefix(path, home+"/") {
		collapsedPath = "~/" + path[len(home)+1:]
	}

	for _, p := range existing {
		if p == path || p == collapsedPath {
			return nil // Already exists
		}
		// Expand existing path for comparison
		expanded := p
		if strings.HasPrefix(p, "~/") && home != "" {
			expanded = filepath.Join(home, p[2:])
		}
		if expanded == path {
			return nil
		}
	}

	// Store with ~/ prefix when possible
	storePath := collapsedPath
	existing = append(existing, storePath)
	return pd.SetScanPaths(existing)
}

// RemoveScanPath removes a path by value match
func (pd *ProjectDiscovery) RemoveScanPath(path string) error {
	path = strings.TrimSpace(path)
	existing := pd.GetRawScanPaths()

	// Also expand path for comparison
	home, _ := os.UserHomeDir()

	filtered := make([]string, 0, len(existing))
	for _, p := range existing {
		if p == path {
			continue
		}
		// Also check expanded forms
		expandedP := p
		if strings.HasPrefix(p, "~/") && home != "" {
			expandedP = filepath.Join(home, p[2:])
		}
		expandedPath := path
		if strings.HasPrefix(path, "~/") && home != "" {
			expandedPath = filepath.Join(home, path[2:])
		}
		if expandedP == expandedPath {
			continue
		}
		filtered = append(filtered, p)
	}
	return pd.SetScanPaths(filtered)
}

// GetMaxDepth returns the current max_depth setting
func (pd *ProjectDiscovery) GetMaxDepth() int {
	settings := pd.getSettings()
	return settings.MaxDepth
}

// SetMaxDepth saves the max_depth setting, clamped to 1-5
func (pd *ProjectDiscovery) SetMaxDepth(depth int) error {
	if depth < 1 {
		depth = 1
	} else if depth > 5 {
		depth = 5
	}

	return pd.saveProjectDiscoverySettings(func(settings map[string]interface{}) {
		settings["max_depth"] = depth
	})
}

// HasScanPaths returns whether any scan paths are configured
func (pd *ProjectDiscovery) HasScanPaths() bool {
	return len(pd.GetRawScanPaths()) > 0
}

// saveProjectDiscoverySettings is a helper that reads config.toml, applies a mutation
// to the project_discovery section, and writes it back preserving other sections.
func (pd *ProjectDiscovery) saveProjectDiscoverySettings(mutate func(settings map[string]interface{})) error {
	existingData, _ := os.ReadFile(pd.configPath)

	var existingConfig map[string]interface{}
	if len(existingData) > 0 {
		if err := toml.Unmarshal(existingData, &existingConfig); err != nil {
			existingConfig = make(map[string]interface{})
		}
	} else {
		existingConfig = make(map[string]interface{})
	}

	// Get or create project_discovery section
	pdSection, ok := existingConfig["project_discovery"].(map[string]interface{})
	if !ok {
		pdSection = make(map[string]interface{})
	}

	mutate(pdSection)
	existingConfig["project_discovery"] = pdSection

	// Ensure directory exists
	dir := filepath.Dir(pd.configPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	var buf bytes.Buffer
	if len(existingData) == 0 {
		buf.WriteString("# Agent Deck Configuration\n\n")
	}

	if err := toml.NewEncoder(&buf).Encode(existingConfig); err != nil {
		return err
	}

	return os.WriteFile(pd.configPath, buf.Bytes(), 0600)
}

// calculateFrecencyScore calculates the frecency score for a project
func (pd *ProjectDiscovery) calculateFrecencyScore(projectPath string) float64 {
	usage, ok := pd.frecency.Projects[projectPath]
	if !ok {
		return 0
	}

	// Calculate recency multiplier
	now := time.Now()
	daysSince := now.Sub(usage.LastUsedAt).Hours() / 24

	var recencyMultiplier float64
	switch {
	case daysSince < 1:
		recencyMultiplier = 100 // Today
	case daysSince < 7:
		recencyMultiplier = 70 // This week
	case daysSince < 30:
		recencyMultiplier = 50 // This month
	case daysSince < 90:
		recencyMultiplier = 30 // This quarter
	default:
		recencyMultiplier = 10 // Older
	}

	return float64(usage.UseCount) * recencyMultiplier
}

// DiscoverProjects finds all projects from configured paths and existing sessions
func (pd *ProjectDiscovery) DiscoverProjects(sessions []SessionInfo) ([]ProjectInfo, error) {
	settings := pd.getSettings()

	// Build a map of (path, remoteHost) -> all sessions at that path+host.
	// Local sessions use just the path as key; remote sessions use "path|host".
	type groupKey struct {
		path       string
		remoteHost string
	}
	sessionsByGroup := make(map[groupKey][]SessionInfo)
	for _, s := range sessions {
		if s.ProjectPath != "" {
			key := groupKey{path: s.ProjectPath}
			if s.IsRemote {
				key.remoteHost = s.RemoteHost
			}
			sessionsByGroup[key] = append(sessionsByGroup[key], s)
		}
	}

	// Collect all discovered projects
	projectMap := make(map[string]*ProjectInfo)

	// Add all projects from existing sessions (highest priority)
	for gk, groupSessions := range sessionsByGroup {
		// Sort sessions by ID for deterministic ordering
		sort.Slice(groupSessions, func(i, j int) bool {
			return groupSessions[i].ID < groupSessions[j].ID
		})

		// Build SessionSummary slice from all sessions in this group
		summaries := make([]SessionSummary, len(groupSessions))
		for i, s := range groupSessions {
			summaries[i] = SessionSummary{
				ID:                    s.ID,
				CustomLabel:           s.CustomLabel,
				Status:                s.Status,
				Tool:                  s.Tool,
				IsRemote:              s.IsRemote,
				RemoteHost:            s.RemoteHost,
				RemoteHostDisplayName: s.RemoteHostDisplayName,
			}
		}

		// Use first session (by ID) for backward-compatible Tool/SessionID fields
		firstSession := groupSessions[0]

		// Map key: plain path for local, "path|host" for remote
		mapKey := gk.path
		if gk.remoteHost != "" {
			mapKey = gk.path + "|" + gk.remoteHost
		}

		projectMap[mapKey] = &ProjectInfo{
			Path:                  gk.path,
			Name:                  filepath.Base(gk.path),
			Score:                 pd.calculateFrecencyScore(gk.path) + 1000, // Boost existing sessions
			HasSession:            true,
			Tool:                  firstSession.Tool,
			SessionID:             firstSession.ID,
			SessionCount:          len(groupSessions),
			Sessions:              summaries,
			IsRemote:              firstSession.IsRemote,
			RemoteHost:            firstSession.RemoteHost,
			RemoteHostDisplayName: firstSession.RemoteHostDisplayName,
		}
	}

	// Scan configured paths
	for _, scanPath := range settings.ScanPaths {
		pd.scanDirectory(scanPath, 0, settings.MaxDepth, settings.IgnorePatterns, projectMap)
	}

	// Convert to slice and sort by score
	projects := make([]ProjectInfo, 0, len(projectMap))
	for _, p := range projectMap {
		// Calculate score if not already set
		if p.Score == 0 {
			p.Score = pd.calculateFrecencyScore(p.Path)
		}
		projects = append(projects, *p)
	}

	// Sort by score (descending)
	sort.Slice(projects, func(i, j int) bool {
		return projects[i].Score > projects[j].Score
	})

	return projects, nil
}

// scanDirectory recursively scans for projects
func (pd *ProjectDiscovery) scanDirectory(path string, depth, maxDepth int, ignorePatterns []string, projects map[string]*ProjectInfo) {
	if depth > maxDepth {
		return
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		name := entry.Name()

		// Skip hidden directories and ignored patterns
		if strings.HasPrefix(name, ".") {
			continue
		}

		skip := false
		for _, pattern := range ignorePatterns {
			if name == pattern {
				skip = true
				break
			}
		}
		if skip {
			continue
		}

		subPath := filepath.Join(path, name)

		// Check if this is a project (has .git, package.json, go.mod, etc.)
		if pd.isProject(subPath) {
			if _, exists := projects[subPath]; !exists {
				projects[subPath] = &ProjectInfo{
					Path:       subPath,
					Name:       name,
					Score:      pd.calculateFrecencyScore(subPath),
					HasSession: false,
				}
			}
		}

		// Continue scanning subdirectories
		if depth < maxDepth {
			pd.scanDirectory(subPath, depth+1, maxDepth, ignorePatterns, projects)
		}
	}
}

// isProject checks if a directory looks like a project
func (pd *ProjectDiscovery) isProject(path string) bool {
	projectMarkers := []string{
		".git",
		"package.json",
		"go.mod",
		"Cargo.toml",
		"pyproject.toml",
		"requirements.txt",
		"pom.xml",
		"build.gradle",
		"Makefile",
		".svn",
		"CLAUDE.md", // Agent Deck specific
	}

	for _, marker := range projectMarkers {
		if _, err := os.Stat(filepath.Join(path, marker)); err == nil {
			return true
		}
	}

	return false
}
