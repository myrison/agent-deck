---
name: read-desktop-logs
description: Read RevvySwarm desktop app frontend console logs. Use when debugging desktop app UI issues.
---

# Read Desktop App Logs

Reads frontend console logs from the RevvySwarm (agent-deck) desktop app. All `console.log/debug/info/warn/error` calls are automatically captured to a log file.

## Log File Location

```
~/.agent-deck/logs/frontend-console.log
```

## Quick Commands

### Tail logs (watch live)
```bash
tail -f ~/.agent-deck/logs/frontend-console.log
```

### Read last 100 lines
```bash
tail -100 ~/.agent-deck/logs/frontend-console.log
```

### Search for specific pattern
```bash
grep -i "DEBUG" ~/.agent-deck/logs/frontend-console.log | tail -50
```

### Clear log file (fresh start)
```bash
: > ~/.agent-deck/logs/frontend-console.log
```

## Log Format

Logs are formatted as:
```
[HH:MM:SS.mmm] [FRONTEND-DIAG] [TIMESTAMP] [CONSOLE.LEVEL] message
```

Example:
```
[15:42:33.123] [FRONTEND-DIAG] [2026-01-26T15:42:33.123Z] [CONSOLE.LOG] [DEBUG] handleRemotePathSubmit called
```

## When to Use

- Debugging UI issues in the desktop app
- Tracing session creation flow
- Investigating why button clicks don't work
- Checking for JavaScript errors
- Understanding state changes

## Implementation Notes

The logging is implemented in:
- **Frontend**: `cmd/agent-deck-desktop/frontend/src/logger.js` - Intercepts all console.* calls
- **Backend**: `cmd/agent-deck-desktop/terminal.go:LogDiagnostic()` - Writes to file

Console interception is installed automatically at app startup via `installGlobalErrorHandler()` in `main.jsx`.
