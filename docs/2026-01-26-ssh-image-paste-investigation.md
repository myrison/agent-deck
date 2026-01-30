# SSH Image Paste Support - Technical Investigation

**Date:** 2026-01-26
**Status:** Investigation Complete
**Feature:** Enable image paste (Ctrl+V) for remote SSH sessions in the desktop app

---

## Problem Statement

When using the RevvySwarm desktop app locally, users can paste images into Claude Code sessions using **Ctrl+V** (macOS). This works because:

1. User presses Ctrl+V → desktop app passes keystroke to terminal
2. Claude Code binary receives Ctrl+V
3. Claude Code reads image data from the **local** macOS clipboard
4. Image is processed and included in the conversation

**The problem with SSH sessions:** When connected to a remote host, the Claude Code binary runs on the **remote machine**, but the image is in the **local clipboard**. Claude Code on the remote host cannot access the local clipboard.

---

## Technical Investigation

### 1. Wails Clipboard API

**Finding:** Wails v2 only supports text clipboard operations.

| Method | Supported | Notes |
|--------|-----------|-------|
| `ClipboardGetText()` | ✅ | Used for Cmd+V text paste |
| `ClipboardSetText()` | ✅ | Used for copy operations |
| `ClipboardGetImage()` | ❌ | Does not exist |

**Source:** [Wails Clipboard Documentation](https://wails.io/docs/reference/runtime/clipboard/)

**Implication:** Cannot use Wails native API for image clipboard. Need alternative.

---

### 2. Go Clipboard Image Library

**Finding:** The `golang-design/clipboard` package supports image clipboard on macOS.

**Package:** https://github.com/golang-design/clipboard

**Key API:**
```go
import "golang.design/x/clipboard"

// Initialize (required once)
clipboard.Init()

// Read image as PNG bytes
imgData := clipboard.Read(clipboard.FmtImage)
if imgData != nil {
    // imgData contains PNG-encoded bytes
}
```

**Requirements:**
- **Cgo required** on macOS (uses Objective-C bridge)
- Images returned as **PNG format** only
- No external dependencies beyond Cgo
- Works on macOS, Linux, Windows (desktop only)

**Implication:** ✅ Viable for reading clipboard images from Go backend.

---

### 3. JavaScript Clipboard API (WKWebView)

**Finding:** WebKit supports `navigator.clipboard.read()` for images, but WKWebView has restrictions.

**Standard API:**
```javascript
const items = await navigator.clipboard.read();
for (const item of items) {
    if (item.types.includes("image/png")) {
        const blob = await item.getType("image/png");
        // blob contains image data
    }
}
```

**WebKit Support:**
- Supports: `text/plain`, `text/html`, `text/uri-list`, `image/png`
- Source: [WebKit Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/)

**WKWebView Caveats:**
- Requires document to be in focused state
- May require specific permissions configuration
- Sandbox restrictions may apply
- Known issues with some clipboard operations in macOS apps

**Implication:** ⚠️ Possible but unreliable. Go-based approach is more robust.

---

### 4. SCP with SSH ControlMaster

**Finding:** SCP can reuse existing SSH ControlMaster connections for fast file transfers.

The desktop app already uses SSH ControlMaster for connection multiplexing:
```go
// From internal/ssh/connection.go
args = append(args, "-o", "ControlMaster=auto")
args = append(args, "-o", fmt.Sprintf("ControlPath=%s", controlPath))
args = append(args, "-o", "ControlPersist=300")
```

**SCP Reuse Pattern:**
```bash
# SCP automatically uses existing ControlMaster socket
scp -o "ControlPath=/tmp/agentdeck-ssh-host-22-user" \
    local_file.png user@host:/tmp/

# Benefits:
# - No new TCP connection (10x faster)
# - No re-authentication
# - Uses existing SSH config (jump hosts, identity files)
```

**Performance:** Subsequent file transfers over existing connection have ~10x less overhead.

**Source:** [SSH ControlMaster Documentation](https://ldpreload.com/blog/ssh-control)

**Implication:** ✅ File transfers will be fast using existing infrastructure.

---

### 5. Existing SSH Infrastructure

**Finding:** Strong foundation exists. Only need to add file transfer method.

**Already Implemented:**
- `Connection.buildSSHArgs()` - Constructs SSH command with ControlPath
- `Connection.RunCommand()` - Execute remote commands
- `Connection.controlSocketPath()` - Get ControlMaster socket path
- `SSHBridge` - Desktop app wrapper for SSH operations
- Host configuration from `config.toml`

**Gap:** No `Connection.CopyFile()` or equivalent SCP method.

**Implementation Effort:** ~50 lines of Go code to add SCP wrapper.

---

## Recommended Approach

### Auto-Transfer Temp File Method

**Flow:**
```
1. User presses Ctrl+V with image in clipboard
2. Frontend intercepts keypress, calls Go backend
3. Go backend reads clipboard image (golang-design/clipboard)
4. Go backend saves to local temp file: /tmp/revden_img_XXXXX.png
5. Go backend SCPs file to remote: /tmp/revden_img_XXXXX.png
6. Go backend injects text into terminal: @/tmp/revden_img_XXXXX.png
7. Claude Code on remote host reads the file normally
```

**Why This Approach:**
- Matches existing Claude Code workflow (`@/path/to/image`)
- Works with any SSH host (no special setup)
- User sees what's happening (file path visible)
- Leverages existing ControlMaster infrastructure
- No changes needed to Claude Code binary

---

## Implementation Components

### Component 1: Clipboard Image Reader (Go)

```go
// New file: cmd/agent-deck-desktop/clipboard_image.go

import "golang.design/x/clipboard"

func (a *App) GetClipboardImage() ([]byte, error) {
    if err := clipboard.Init(); err != nil {
        return nil, err
    }

    data := clipboard.Read(clipboard.FmtImage)
    if data == nil {
        return nil, nil // No image in clipboard
    }

    return data, nil // PNG bytes
}
```

### Component 2: SCP File Transfer (Go)

```go
// Add to: internal/ssh/connection.go

func (c *Connection) CopyFileToRemote(localPath, remotePath string) error {
    args := []string{
        "-o", fmt.Sprintf("ControlPath=%s", c.controlSocketPath()),
        "-o", "ControlMaster=auto",
    }

    if c.Port != 22 {
        args = append(args, "-P", fmt.Sprintf("%d", c.Port))
    }
    if c.IdentityFile != "" {
        args = append(args, "-i", c.IdentityFile)
    }

    target := c.Host
    if c.User != "" {
        target = c.User + "@" + c.Host
    }

    args = append(args, localPath, target+":"+remotePath)

    cmd := exec.Command("scp", args...)
    return cmd.Run()
}
```

### Component 3: Frontend Keyboard Handler (JavaScript)

```javascript
// Modify: Terminal.jsx customKeyHandler

// Detect Ctrl+V (not Cmd+V) on macOS for image paste
if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v' && isMac) {
    if (session?.isRemote) {
        e.preventDefault();
        // Call Go backend to handle image paste
        HandleRemoteImagePaste(sessionId, session.remoteHost)
            .then(result => {
                if (result.success) {
                    // File was transferred, path injected
                    logger.info('Image transferred:', result.remotePath);
                } else if (result.noImage) {
                    // No image in clipboard, pass through normally
                    WriteTerminal(sessionId, '\x16'); // Ctrl+V
                }
            });
        return false;
    }
}
```

### Component 4: Orchestration (Go)

```go
// New method in app.go

func (a *App) HandleRemoteImagePaste(sessionId, hostId string) map[string]interface{} {
    // 1. Read clipboard image
    imgData, err := a.GetClipboardImage()
    if err != nil || imgData == nil {
        return map[string]interface{}{"noImage": true}
    }

    // 2. Save to local temp file
    localPath := filepath.Join(os.TempDir(),
        fmt.Sprintf("revden_img_%d.png", time.Now().UnixNano()))
    if err := os.WriteFile(localPath, imgData, 0644); err != nil {
        return map[string]interface{}{"error": err.Error()}
    }
    defer os.Remove(localPath) // Cleanup local after transfer

    // 3. SCP to remote
    remotePath := fmt.Sprintf("/tmp/revden_img_%d.png", time.Now().UnixNano())
    conn := a.sshBridge.GetConnection(hostId)
    if err := conn.CopyFileToRemote(localPath, remotePath); err != nil {
        return map[string]interface{}{"error": err.Error()}
    }

    // 4. Inject path into terminal
    a.WriteTerminal(sessionId, "@"+remotePath)

    return map[string]interface{}{
        "success": true,
        "remotePath": remotePath,
    }
}
```

---

## Complexity Assessment

| Component | Effort | Risk |
|-----------|--------|------|
| Clipboard image reading (Go) | Low | Low - well-documented library |
| SCP wrapper | Low | Low - simple exec wrapper |
| Frontend Ctrl+V interception | Medium | Medium - WKWebView quirks |
| Integration & testing | Medium | Medium - edge cases |
| Temp file cleanup | Low | Low - straightforward |

**Overall Complexity:** **Medium**

**Estimated Implementation Time:** 1-2 days for full implementation with tests

---

## Confidence Level

**Confidence: 85% (High)**

**Reasons for confidence:**
1. `golang-design/clipboard` is mature and well-tested on macOS
2. SCP over ControlMaster is standard, proven infrastructure
3. Similar pattern to drag-and-drop (just different trigger)
4. Existing SSH infrastructure handles all the hard parts

**Potential risks:**
1. WKWebView keyboard event handling may have edge cases (15% risk)
2. Cgo requirement adds build complexity (minor)
3. Large images may have transfer latency (UX concern, not failure)

---

## Proof of Concept Plan

### Phase 1: Clipboard Reading (30 min)

**Goal:** Verify `golang-design/clipboard` works in Wails app

**Steps:**
1. Add dependency: `go get golang.design/x/clipboard`
2. Create test method in `app.go`:
   ```go
   func (a *App) TestClipboardImage() string {
       clipboard.Init()
       data := clipboard.Read(clipboard.FmtImage)
       if data == nil {
           return "No image in clipboard"
       }
       return fmt.Sprintf("Found image: %d bytes", len(data))
   }
   ```
3. Call from frontend, verify output
4. Test with screenshot in clipboard (Cmd+Ctrl+Shift+4)

**Success criteria:** Function returns byte count when image is in clipboard

### Phase 2: SCP Transfer (30 min)

**Goal:** Verify SCP reuses ControlMaster connection

**Steps:**
1. Add `CopyFileToRemote()` to `connection.go`
2. Create test method:
   ```go
   func (a *App) TestSCPTransfer(hostId string) string {
       // Create test file
       tmpFile := "/tmp/revden_test.txt"
       os.WriteFile(tmpFile, []byte("test"), 0644)

       conn := a.sshBridge.GetConnection(hostId)
       err := conn.CopyFileToRemote(tmpFile, "/tmp/revden_test.txt")
       if err != nil {
           return "SCP failed: " + err.Error()
       }
       return "SCP succeeded"
   }
   ```
3. Test with active SSH session (ControlMaster should exist)

**Success criteria:** File appears on remote host, transfer is fast (<1 second)

### Phase 3: Integration (1 hour)

**Goal:** End-to-end image paste working

**Steps:**
1. Implement full `HandleRemoteImagePaste()`
2. Add Ctrl+V interception in Terminal.jsx
3. Test with real Claude Code session on remote host

**Success criteria:**
- Copy screenshot (Cmd+Ctrl+Shift+4)
- Press Ctrl+V in remote Claude session
- Claude receives image and responds to it

---

## Alternative Approaches Considered

### OSC 52 Clipboard Protocol

**Description:** Standard terminal escape sequence for clipboard access over SSH.

**Why rejected:**
- Limited to ~75KB (many screenshots exceed this)
- Text-focused, image support would need custom protocol
- Would require Claude Code changes (upstream dependency)

### X11 Forwarding

**Description:** Traditional Unix clipboard forwarding.

**Why rejected:**
- macOS doesn't use X11 natively
- Requires XQuartz installation
- Poor user experience

### Custom Daemon on Remote

**Description:** Run a helper daemon on remote host that receives images.

**Why rejected:**
- Requires installation on every remote host
- Complex setup for users
- Over-engineered for the problem

---

## Files to Modify

| File | Changes |
|------|---------|
| `cmd/agent-deck-desktop/app.go` | Add `HandleRemoteImagePaste()`, `GetClipboardImage()` |
| `cmd/agent-deck-desktop/go.mod` | Add `golang.design/x/clipboard` dependency |
| `internal/ssh/connection.go` | Add `CopyFileToRemote()` method |
| `cmd/agent-deck-desktop/frontend/src/Terminal.jsx` | Add Ctrl+V interception for remote sessions |

---

## References

- [Wails Clipboard API](https://wails.io/docs/reference/runtime/clipboard/)
- [golang-design/clipboard](https://github.com/golang-design/clipboard)
- [WebKit Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/)
- [SSH ControlMaster](https://ldpreload.com/blog/ssh-control)
- [How to Paste Images in Claude Code](https://www.arsturn.com/blog/claude-code-paste-image-guide)
- [Claude Code Image Paste Issues](https://github.com/anthropics/claude-code/issues/834)

---

## Next Steps

1. **Approve approach** - Confirm auto-transfer temp file method
2. **Run PoC Phase 1** - Verify clipboard reading works
3. **Run PoC Phase 2** - Verify SCP transfer works
4. **Full implementation** - If PoC succeeds, implement full feature
5. **Add drag-and-drop** - Same infrastructure, different trigger
