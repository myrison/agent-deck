# File-Based Activity Detection Research

**Date**: 2026-01-28
**Purpose**: Replace unreliable visual/tmux-based status detection with file-based activity detection for the activity ribbon.

## Executive Summary

Research confirms that file-based activity detection is viable and significantly more reliable than visual detection. Claude Code's JSONL files contain `progress` events written **every second** during tool execution, making file modification time an excellent primary signal for "running" status.

**Recommended approach**: Use file `mtime` as the primary activity signal for Claude sessions, with visual detection only as fallback for "waiting" vs "idle" distinction.

---

## Claude Code JSONL Format

### File Location
```
~/.claude/projects/{project-dir-name}/{session-id}.jsonl
```

Where `project-dir-name` is the project path with all non-alphanumeric characters replaced by hyphens:
- `/Users/jason/Documents/Project` → `-Users-jason-Documents-Project`

### Event Types Discovered

| Type | Description | Write Frequency |
|------|-------------|-----------------|
| `progress` | Tool execution updates | **Every 1 second** during tool execution |
| `user` | User messages/prompts | On user input |
| `assistant` | Claude's responses | On response completion |
| `summary` | Session summaries | Periodic |
| `file-history-snapshot` | File change tracking | On file operations |
| `queue-operation` | Internal queue ops | Varies |

### Sample `progress` Event (Most Useful for Detection)
```json
{
  "type": "progress",
  "data": {
    "type": "bash_progress",
    "output": "",
    "fullOutput": "",
    "elapsedTimeSeconds": 71,
    "totalLines": 0
  },
  "toolUseID": "bash-progress-69",
  "parentToolUseID": "toolu_01AhHmptztyW96D1KqXddLyd",
  "timestamp": "2026-01-28T18:13:48.726Z",
  "sessionId": "c8bc64fa-3e09-41cb-bdba-5d177970d42f"
}
```

### Key Observation
During active tool execution (Bash commands, file operations, etc.), Claude Code writes `progress` events every second with an incrementing `elapsedTimeSeconds` counter. This makes file modification time extremely reliable for detecting "running" status.

### Common Fields in All Events
- `type`: Event type (user, assistant, progress, etc.)
- `timestamp`: ISO 8601 formatted timestamp
- `sessionId`: UUID of the session
- `uuid`: Unique event identifier
- `parentUuid`: Links events in a chain
- `cwd`: Current working directory
- `version`: Claude Code version
- `gitBranch`: Current git branch

---

## Gemini CLI Format

### File Location
```
~/.gemini/tmp/{project-hash}/chats/session-{timestamp}-{session-id}.json
```

### Format
Regular JSON (not JSONL), single object per file with a `lastUpdated` timestamp:

```json
{
  "sessionId": "598fdb41-3ae0-4aec-adab-c0194889c79c",
  "projectHash": "ab841f668126c8d211855a0681f6ef1c98d53c74c6540f0613eb0d375b75ef1b",
  "startTime": "2026-01-15T22:35:21.917Z",
  "lastUpdated": "2026-01-15T22:35:24.252Z",
  "messages": [...]
}
```

### Activity Detection
- Can use file `mtime` or parse `lastUpdated` field
- Less granular than Claude Code (no per-second progress events)
- Messages array contains `type: "user"` and `type: "gemini"` entries

---

## OpenCode

No local telemetry files found at `~/.opencode` or `~/.config/opencode`. OpenCode may not persist session data locally, requiring continued reliance on visual detection.

---

## Existing Codebase Support

### Already Implemented
The codebase already has logic for working with Claude session files:

**`internal/session/claude.go:311-368`** - `findActiveSessionID()`:
- Converts project path to Claude directory format
- Finds most recently modified `.jsonl` file
- Only returns if modified within 5 minutes

**`internal/session/instance.go:1378-1408`** - `GetJSONLPath()`:
- Returns full path to session JSONL file
- Handles symlink resolution
- Validates file existence

**`cmd/agent-deck-desktop/tmux.go:427-483`** - `detectSessionStatus()`:
- Current visual detection logic
- Uses `tmux capture-pane` and pattern matching
- This is what we want to supplement/replace

---

## Implementation Strategy

### Recommended: Hybrid Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    Status Detection Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Get JSONL file path (for Claude sessions)               │
│     └── Use Instance.GetJSONLPath()                         │
│                                                              │
│  2. Check file modification time                            │
│     └── os.Stat(jsonlPath).ModTime()                        │
│                                                              │
│  3. Decision:                                                │
│     ├── mtime < 10 seconds → "running" (HIGH CONFIDENCE)    │
│     └── mtime >= 10 seconds → Fall back to visual detection │
│                                                              │
│  4. Visual detection (for waiting vs idle):                 │
│     ├── HasPrompt() returns true → "waiting"                │
│     └── else → "idle"                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why 10 Seconds?
- Progress events are written every 1 second during tool execution
- 10-second threshold accounts for brief pauses between tool calls
- If no writes for 10+ seconds, Claude is likely at prompt or user is typing

### Alternative: Parse Last Event Type

For more granular detection, read the last line of the JSONL:

```go
func getLastEventType(jsonlPath string) (string, time.Time, error) {
    // Read last 4KB of file (sufficient for one event)
    // Parse JSON to get type and timestamp
    // Return ("progress", timestamp, nil) etc.
}
```

Decision logic:
- Last event is `progress` → "running"
- Last event is `assistant` → likely "waiting" (just finished)
- Last event is `user` → "waiting" (prompt showing)

### Not Recommended: fsnotify

While fsnotify could provide real-time updates, it adds complexity:
- Requires watching multiple directories
- macOS has 4096 watched path limit
- File writes may batch/coalesce
- Simple polling (every 5 seconds) with stat() is sufficient

---

## Open Source References

### Related Projects

1. **[ccusage](https://github.com/ryoppippi/ccusage)** - CLI tool for analyzing Claude Code JSONL files
   - Parses session logs for usage tracking
   - 5-hour billing window analysis

2. **[claude-code-log](https://github.com/daaain/claude-code-log)** - Converts JSONL to HTML
   - Python CLI tool
   - Session parsing examples

3. **[Claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser)** - Web viewer
   - Handles all event types
   - File explorer for multiple logs

4. **[claude-code-otel](https://github.com/anthropics/claude-code-monitoring-guide)** - OpenTelemetry integration
   - Official monitoring approach
   - Events: `claude_code.user_prompt`, `claude_code.tool_result`, `claude_code.api_request`

### How Others Detect Activity

From the [DuckDB analysis article](https://liambx.com/blog/claude-code-log-analysis-with-duckdb):
- **Timestamp intervals**: Large gaps indicate idle periods
- **Message frequency**: Assistant/user ratio indicates engagement
- **Tool usage density**: High tool_use count = active session

---

## Official Claude Code Telemetry

Claude Code supports OpenTelemetry with these events (from [official docs](https://code.claude.com/docs/en/monitoring-usage)):

| Event | Description |
|-------|-------------|
| `claude_code.user_prompt` | User submits a prompt |
| `claude_code.tool_result` | Tool completes execution |
| `claude_code.api_request` | API request made |
| `claude_code.api_error` | API request failed |
| `claude_code.tool_decision` | User accepts/rejects tool |

While OTel is more comprehensive, it requires configuration and external collectors. The JSONL files provide sufficient data for local activity detection.

---

## Proposed Implementation

### Phase 1: File mtime Detection

Add to `cmd/agent-deck-desktop/tmux.go`:

```go
// detectSessionStatusViaFile checks Claude JSONL file modification time
// Returns status and whether file-based detection was successful
func (tm *TmuxManager) detectSessionStatusViaFile(inst *session.Instance) (string, bool) {
    if inst.Tool != "claude" {
        return "", false // Not applicable for non-Claude tools
    }

    jsonlPath := inst.GetJSONLPath()
    if jsonlPath == "" {
        return "", false // No session file available
    }

    stat, err := os.Stat(jsonlPath)
    if err != nil {
        return "", false // File not accessible
    }

    // If modified within last 10 seconds, Claude is actively working
    if time.Since(stat.ModTime()) < 10*time.Second {
        return "running", true
    }

    return "", false // Fall back to visual detection
}
```

### Phase 2: Integrate into Detection Flow

Modify `detectSessionStatus()`:

```go
func (tm *TmuxManager) detectSessionStatus(inst *session.Instance) (string, bool) {
    // Phase 1: Try file-based detection (Claude only)
    if status, ok := tm.detectSessionStatusViaFile(inst); ok {
        return status, true
    }

    // Phase 2: Fall back to visual detection
    return tm.detectSessionStatusViaTmux(inst.TmuxSession, inst.Tool)
}
```

### Phase 3: Add Gemini Support (Optional)

Similar approach for Gemini using session file mtime.

---

## Testing Strategy

1. **Manual testing**:
   - Start Claude session, trigger long-running command
   - Observe activity ribbon updates during execution
   - Verify "running" detected while command executes
   - Verify transition to "waiting" when complete

2. **Watch file writes**:
   ```bash
   # In one terminal
   tail -f ~/.claude/projects/-Users-jason-..../session-id.jsonl

   # In another terminal, have Claude run a command
   # Observe progress events written every second
   ```

3. **Edge cases**:
   - Session with no JSONL file (new session)
   - Session file deleted mid-session
   - Very old session file (mtime > threshold)
   - Gemini sessions (different file format)
   - OpenCode sessions (no file support)

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| JSONL file not yet created | Fall back to visual detection |
| File deleted during session | Fall back to visual detection |
| Different Claude versions change format | Use mtime only, not parsing |
| Performance impact of stat() calls | Already doing tmux capture-pane which is more expensive |
| Gemini file format changes | Use mtime only, not JSON parsing |

---

## Next Steps

1. [ ] Implement `detectSessionStatusViaFile()` in `tmux.go`
2. [ ] Update `detectSessionStatus()` to use hybrid approach
3. [ ] Add logging for debugging detection decisions
4. [ ] Test with real Claude sessions
5. [ ] Consider adding Gemini file-based detection
6. [ ] Document the detection behavior in CLAUDE.md
