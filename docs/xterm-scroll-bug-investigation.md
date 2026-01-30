# xterm.js Scroll-on-Click Bug Investigation

**Bug**: When scrolled up in the terminal, clicking to select text causes immediate scroll-to-bottom
**Environment**: Wails app (WKWebView) with xterm.js v5.5.0
**Status**: ✅ **FIXED** (Attempt #31b) - Force altKey when scrolled up to trigger macOptionClickForcesSelection

## Summary of Findings

After 30 attempts, we've confirmed:

1. **xterm.js snaps viewport to bottom BEFORE generating mouse escape sequences** - intercepting at onData is too late
2. **shiftKey override doesn't work in WKWebView** - xterm.js ignores our modification
3. **Manual Shift+click also fails** - blocks selection instead of enabling it
4. **Blocking mouse events completely** - prevents scroll but also blocks all selection
5. **Browser native text selection doesn't work** - xterm.js renders content that doesn't support it

**Root cause**: The xterm.js + tmux + WKWebView architecture creates an unsolvable conflict. When tmux has `mouse on`, it intercepts all mouse events. xterm.js's internal handling snaps to bottom before we can intercept.

**Possible paths forward**:
- Accept limitation and document Cmd+F search as workaround
- Investigate xterm.js addons or patches for WKWebView
- Architectural change: bypass tmux for mouse events entirely (significant rework)
- File issue with xterm.js maintainers about WKWebView behavior

---

## ROOT CAUSE IDENTIFIED (Session 2026-01-29)

### The Architecture Loop

When mouse modes (1000, 1002, 1006) are active:
1. User clicks in terminal while scrolled up
2. xterm.js sends mouse event escape sequence (`\x1b[<...`) to tmux
3. tmux processes click, triggers redraw/refresh
4. xterm.js receives incoming data and "snaps" viewport to bottom

**Key Insight**: The scroll-to-bottom is caused by **mouse events being forwarded to tmux**, not by xterm.js scroll position management.

### Visual Evidence
- **Working (xterm.js selection)**: Gray/blue highlight, no tmux overlay
- **Failing (tmux copy mode)**: Yellow highlight, tmux line-number overlay appears

When you see yellow selection with tmux line numbers, tmux is capturing the mouse event and entering copy mode.

### Native tmux vs Desktop App
| Scenario | Scroll-to-bottom timing | Selection works? |
|----------|------------------------|------------------|
| Native tmux (Terminal.app) | On **mouseup** | YES |
| Desktop app (xterm.js + tmux) | On **mousedown** | NO |

The native terminal handles this gracefully; our xterm.js + tmux architecture does not.

---

## LLM COUNCIL RECOMMENDATION

**Consensus Solution**: Force "Shift-Mode" when scrolled up

In xterm.js, holding `Shift` is the hard-coded override that:
1. Disables application mouse reporting (no escape sequences sent to tmux)
2. Enables local text selection

By programmatically forcing `shiftKey: true` when the user is scrolled up, we get both behaviors.

### Implementation (TypeScript/JavaScript)

```typescript
const termContainer = document.getElementById('terminal'); // or term.element

const handleMouseFn = (e: MouseEvent) => {
    // Check if scrolled up: viewportY < baseY means viewing history
    const isScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY;

    if (isScrolledUp) {
        // Force "Shift" behavior - xterm skips mouse reporting
        // and performs local text selection instead
        Object.defineProperty(e, 'shiftKey', { get: () => true });
    }
};

if (termContainer) {
    // Capture phase to intercept before xterm.js sees the event
    termContainer.addEventListener('mousedown', handleMouseFn, true);
    termContainer.addEventListener('mousemove', handleMouseFn, true);
    termContainer.addEventListener('mouseup', handleMouseFn, true);
    termContainer.addEventListener('click', handleMouseFn, true);
}
```

### Why This Works
1. **Breaks the loop**: By forcing `shiftKey: true`, xterm decides NOT to send escape sequences to tmux
2. **Enables selection**: The Shift state tells xterm to use its built-in local selection logic
3. **No coordinate math**: Avoids complex pixel-to-grid calculations

### Trade-offs
- While scrolled up, cannot resize tmux panes or switch focus by mouse
- This is standard terminal emulator behavior

---

## Problem Statement

Users cannot select text in terminal history because clicking triggers an unwanted scroll-to-bottom. This makes copy/paste from scrollback impossible.

---

## Critical Findings

### 1. Chromium vs WKWebView Divergence

**Automated tests in Chromium pass, but manual tests in WKWebView fail.**

The test harness (using Playwright + Chromium) shows fixes working, but the actual app (WKWebView) behaves differently.

### 2. Native tmux Has Same Behavior

**Important Discovery**: In the TUI app running inside native tmux (not the desktop app), clicking ALSO scrolls to bottom. The difference is:
- **Native tmux**: Scroll-to-bottom happens on **mouseup** (after selection completes)
- **Desktop app**: Scroll-to-bottom happens on **mousedown** (immediately)

This suggests the behavior may be partially inherited from tmux's design, not purely an xterm.js bug.

### 3. viewportY vs scrollTop Disconnect

- `buffer.viewportY` is xterm's internal scroll position (which line is at top)
- `.xterm-viewport scrollTop` is the DOM scroll position
- These are linked but **viewportY changes don't always reflect in scrollTop immediately**
- Our DOM scrollTop restoration wasn't detecting changes because scrollTop wasn't changing

### 4. Post-mouseup Restoration Works (Partially)

The post-mouseup monitoring successfully catches and restores scroll position AFTER mouseup:
```
[MOUSEDOWN] scrollTop=0, viewportY=0, baseY=67
[MOUSEUP] viewportY=67, savedViewportY=0
[POST-MOUSEUP] viewportY jumped 0 -> 67, restoring
[Post-mouseup monitoring complete]
```

But this doesn't help during the drag - user sees scroll to bottom immediately on mousedown.

---

## Attempt History

### Attempts #1-21: See Appendix

### Attempt #22: DOM scrollTop Restore

**Hypothesis**: Use DOM `scrollTop` directly instead of xterm's API to avoid "scroll war".

**Result**: ❌ DOM scrollTop wasn't changing (viewportY was), so nothing to restore.

### Attempt #23: RAF Loop with viewportY Tracking

**Hypothesis**: Monitor both scrollTop AND viewportY, restore whichever changes.

**Implementation**: Added viewportY tracking alongside scrollTop in RAF loop.

**Result**: RAF loop detected viewportY jumps (0 → 68) but calling `scrollToLine()` to restore broke text selection.

### Attempt #24: DOM-Only Restoration During Drag

**Hypothesis**: Only use DOM scrollTop during drag to preserve selection, use scrollToLine on mouseup.

**Implementation**:
```javascript
// During drag: DOM scrollTop only (preserves selection)
if (viewportEl.scrollTop !== savedScrollTop) {
    viewportEl.scrollTop = savedScrollTop;
}

// On mouseup: Use scrollToLine (selection already complete)
term.scrollToLine(savedViewportY);
```

**Result**:
- ✅ Selection works
- ✅ Post-mouseup restoration works
- ❌ Scroll still jumps to bottom on mousedown (RAF loop not catching it)

### Attempt #25: Post-mouseup Extended Monitoring (500ms)

**Hypothesis**: The scroll-to-bottom happens AFTER mouseup, so extend monitoring.

**Implementation**: Continue RAF loop for 500ms after mouseup to catch delayed scrolls.

**Result**:
- ✅ Successfully catches and restores post-mouseup scrolls
- ❌ Still doesn't prevent immediate scroll on mousedown

### Attempt #26: RAF Loop Debugging

**Problem Identified**: The RAF loop runs but **never logs any changes between mousedown and mouseup**. Either:
1. The loop isn't running during drag
2. Both scrollTop and viewportY appear unchanged to the loop (even though user sees scroll)

**Added Instrumentation**:
- Log when RAF loop starts
- Log when RAF loop exits (and why)
- Log every 30th frame regardless of changes
- Log both scrollTop and viewportY values

**Result**: RAF loop was requested but never fired during drag. No "[RAF] Loop started!" message appeared.

### Attempt #27: Unconditional RAF Debug (CURRENT)

**Hypothesis**: The RAF callback is being scheduled but never executes. Add completely unconditional logging at the very first line of the callback to verify RAF is firing at all.

**Added Instrumentation**:
```javascript
const scrollFixLoop = () => {
    // UNCONDITIONAL - MUST ALWAYS LOG
    const now = Date.now();
    const elapsed = rafStartTime > 0 ? now - rafStartTime : 0;
    console.log(`>>> RAF TICK #${rafLoopCount} at +${elapsed}ms <<<`);
    // ... rest of code
};
```

**Also Fixed**: Automation script updated to properly navigate command menu:
1. Cmd+N opens command menu
2. Down arrow to select first project
3. Enter to select project
4. Enter again to select "Local" host
5. Session is created

**Current Code Location**: `Terminal.jsx` lines 565-580

**Expected Outcome**:
- If RAF TICK logs appear: RAF is firing, problem is in detection logic
- If RAF TICK logs DON'T appear: WebKit is blocking RAF during drag (need different approach)

### Attempt #27b: Mouse Mode Analysis & Alt-Screen Reset

**Discovery**: The RAF approach was addressing the wrong problem. Through debugging we discovered:

1. **Mouse modes stay enabled**: Logs showed modes 1000, 1002, 1006 active even after CC exits
2. **Yellow selection = tmux copy mode**: When selection fails, we see yellow highlight (tmux) instead of gray/blue (xterm.js)
3. **Orphaned session test**: A session accidentally disconnected from tmux had WORKING selection - proving tmux is the cause

**Key Insight**: The scroll-to-bottom happens because xterm.js forwards mouse events to tmux (due to active mouse modes), and tmux enters copy mode which scrolls to bottom.

**Code Changes Made**:
1. Added mouse mode reset on alt-screen exit (`Terminal.jsx` lines 245-268)
2. Moved `mouseModes` Set declaration before alt-screen handler
3. Added `term.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l')` on alt-screen exit

**Result**: Did not fix the issue because tmux `mouse on` remains enabled regardless of xterm.js mouse mode state.

### Attempt #27c: LLM Council Consultation

**Action**: Consulted the LLM Council (GPT-5.2, Gemini-3-Pro, Claude Opus 4.5, Grok-4) with full context.

**Council Consensus**: The best solution is to **force `shiftKey: true`** on mouse events when scrolled up. This leverages xterm.js's built-in behavior where Shift disables mouse reporting and enables local selection.

**Rationale**:
- Prevents mouse events from being forwarded to tmux (breaks the loop)
- Uses xterm.js's native selection logic (no manual coordinate math)
- Standard terminal emulator behavior (scrollback = local mouse)

See "LLM COUNCIL RECOMMENDATION" section above for implementation details.

### Attempt #28: Council Solution - Force shiftKey

**Implementation**: Applied the LLM council's recommended solution - force `shiftKey: true` on mouse events when scrolled up.

**Code Added** (`Terminal.jsx` lines 165-193):
```javascript
const forceShiftWhenScrolled = (e) => {
    const isScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY;
    if (isScrolledUp) {
        Object.defineProperty(e, 'shiftKey', { get: () => true });
    }
};

termContainer.addEventListener('mousedown', forceShiftWhenScrolled, true);
termContainer.addEventListener('mousemove', forceShiftWhenScrolled, true);
termContainer.addEventListener('mouseup', forceShiftWhenScrolled, true);
termContainer.addEventListener('click', forceShiftWhenScrolled, true);
```

**Result**: ❌ **FAILED** - Same behavior persists:
- Yellow tmux copy mode selector still appears
- Scroll still jumps to bottom on mousedown

**Log Evidence** (handler IS firing):
```
[22:26:34.920] [SHIFT-FIX] Forced shiftKey=true (scrolled up)
[22:26:34.937] [SHIFT-FIX] Forced shiftKey=true (scrolled up)
[22:26:34.955] [SHIFT-FIX] Forced shiftKey=true (scrolled up)
... (many more - fires on every mousemove during drag)
```

**Analysis**: Our capture-phase handler IS running, and we ARE modifying the event object, but xterm.js still sends mouse events to tmux. This means:

1. **NOT a timing issue** - Our handler fires before xterm.js sees the event
2. **NOT a detection issue** - We correctly identify scrolled-up state
3. **The override itself doesn't work** - xterm.js either:
   - Caches shiftKey before we modify it
   - Reads shiftKey from a native/internal source, not event.shiftKey
   - Uses a different mechanism entirely for shift detection in WKWebView
   - Has already determined mouse mode state before mousedown fires

**Conclusion**: The `Object.defineProperty` approach doesn't affect xterm.js's mouse reporting decision. Need to intercept at a different level - either block the event entirely or filter the escape sequences in onData.

### Attempt #29: onData Mouse Sequence Interception

**Hypothesis**: Intercept mouse escape sequences in `term.onData()` before they reach tmux.

**Implementation** (`Terminal.jsx`):
```javascript
const dataDisposable = term.onData((data) => {
    const isScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY;
    const isMouseSequence = data.startsWith('\x1b[M') || data.startsWith('\x1b[<');

    if (isScrolledUp && isMouseSequence) {
        console.log('[MOUSE-INTERCEPT] Swallowed mouse sequence while scrolled up');
        return; // Don't send to tmux
    }
    WriteTerminal(sessionId, data);
});
```

**Result**: ❌ **FAILED**

**Critical Finding**: Added detailed logging showing viewport state when mouse sequences fire:
```
[MOUSE-SEQ] "\u001b[<0;50;14M" vY=443 bY=443 scrolledUp=false
[MOUSE-SEQ] "\u001b[<32;8;6M" vY=443 bY=443 scrolledUp=false
```

**Every single mouse sequence shows `viewportY = baseY`** (scrolledUp=false), even when user was visually scrolled up before clicking.

**Root Cause Confirmed**: xterm.js snaps viewport to bottom BEFORE generating the mouse escape sequence:
1. User clicks while scrolled up (vY < bY)
2. xterm.js INTERNALLY snaps viewport to bottom (vY = bY)
3. xterm.js generates mouse escape sequence (with bottom position)
4. onData fires (too late - already scrolled, vY = bY)

**Conclusion**: Intercepting at onData is too late in the pipeline. The scroll happens during xterm.js's internal mouse event processing, before any data is sent.

### Attempt #29b: Manual Shift+Click Test

**Discovery**: Manual Shift+click also fails - it blocks selection entirely rather than enabling xterm.js local selection.

| Action | Behavior |
|--------|----------|
| Regular click | Scrolls to bottom, yellow tmux selection |
| Shift+click | Blocks selection entirely (no scroll, no select) |

This indicates xterm.js's Shift handling in WKWebView is fundamentally broken or different from standard browsers.

### Attempt #30: Block Mouse Events Entirely

**Hypothesis**: Use `stopPropagation()` + `stopImmediatePropagation()` to completely prevent xterm.js from seeing mouse events when scrolled up. Allow browser's native text selection to work instead.

**Implementation** (`Terminal.jsx`):
```javascript
const blockMouseWhenScrolled = (e) => {
    const isScrolledUp = term.buffer.active.viewportY < term.buffer.active.baseY;
    if (isScrolledUp) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        // Don't preventDefault - allow browser selection
    }
};
termContainer.addEventListener('mousedown', blockMouseWhenScrolled, true);
// ... also mousemove, mouseup, click
```

**Result**: ❌ **FAILED**

**Log Evidence** (blocking IS working):
```
[22:46:17.723] [BLOCK-MOUSE] Blocked mousemove while scrolled up
[22:46:17.977] [BLOCK-MOUSE] Blocked mouseup while scrolled up
[22:46:17.977] [BLOCK-MOUSE] Blocked click while scrolled up
```

No mouse sequences reached onData during the blocking period - scroll-to-bottom was prevented.

**But**: Mouse is completely blocked. No browser text selection works either. xterm.js renders content in a way that doesn't support native browser selection (likely canvas or DOM with `user-select: none`).

---

## Key Technical Insights

### The "Scroll War" Problem

When we use `term.scrollToLine()` to restore position, it triggers xterm's onScroll handlers, which trigger MORE scrolls:

```
RESTORE: scrollToLine(0)
onScroll(68) → xterm scrolls back
RESTORE: scrollToLine(0)
onScroll(68) → xterm scrolls back again
... infinite loop, xterm always wins
```

**Solution**: Use DOM `scrollTop` manipulation which doesn't trigger xterm handlers.

### Why RAF Loop Might Not Detect Changes

Possible explanations:
1. The visual "scroll" is a re-render, not an actual scrollTop/viewportY change
2. xterm.js v6 uses virtual scrolling where visible content changes without scrollTop
3. The scroll happens synchronously in mousedown before RAF fires
4. WKWebView-specific timing issues

---

## Test Infrastructure

### 1. Playwright Test Suite (WebKit)

**Location**: `/tmp/playwright-scroll-test/`

**Setup**:
```bash
cd /tmp/playwright-scroll-test
npm install
npx playwright install webkit
```

**Files**:
- `test-page.html` - Standalone xterm.js test page with scroll fix code
- `scroll.test.js` - Playwright tests for scroll-on-click behavior
- `playwright.config.js` - Config for webkit and chromium browsers

**Run Tests**:
```bash
cd /tmp/playwright-scroll-test
npx playwright test --project=webkit   # Test in WebKit (closer to WKWebView)
npx playwright test --project=chromium # Test in Chromium (for comparison)
npx playwright test                     # Run all browsers
```

**Test Scenarios**:
1. Scroll up, click to select, verify scroll position maintained
2. Rapid clicking while scrolled up
3. Selection text verification

### 2. macOS System Events Automation

**Python Script**: `/tmp/scroll-test-automation.py`

**Purpose**: Automate the actual WKWebView app using native macOS events.

**Requirements**:
- Python 3 with Quartz framework (pyobjc-framework-Quartz)
- Or install cliclick: `brew install cliclick`

**Install Quartz**:
```bash
pip3 install pyobjc-framework-Quartz
```

**Run**:
```bash
python3 /tmp/scroll-test-automation.py
```

**What it does**:
1. Activates RevvySwarm (Dev) app
2. Creates new session (Cmd+N)
3. Types `seq 1 500` to generate content
4. Scrolls up using scroll wheel events
5. Attempts drag-select
6. Checks frontend logs for scroll-fix events

### 3. In-App Test Function

```javascript
// Run in dev tools console of the desktop app
window.__runScrollTest()
```

### 4. Log Monitoring

```bash
# Watch for scroll fix events
tail -f ~/.agent-deck/logs/frontend-console.log | grep -E "SCROLL-FIX|RAF"

# Check if RAF loop is running
tail -f ~/.agent-deck/logs/frontend-console.log | grep "RAF"
```

---

## Testing Checklist (For Automated Verification)

Before involving manual testing, automated tests should verify:

1. **[ ] RAF loop starts on mousedown when scrolled up**
   - Look for: `[SCROLL-FIX] Starting RAF loop...`
   - Look for: `[RAF] Loop started!`

2. **[ ] RAF loop detects viewportY changes during drag**
   - Look for: `[RAF #N] viewportY=X (saved=Y)` with X ≠ Y

3. **[ ] Selection works after fix**
   - Playwright: `term.getSelection()` returns selected text

4. **[ ] Scroll position maintained after mouseup**
   - `buffer.viewportY` should equal `savedViewportY` after selection completes

---

## Files Reference

| File | Purpose |
|------|---------|
| `Terminal.jsx` lines 565-700 | Scroll fix implementation |
| `/tmp/playwright-scroll-test/` | Playwright test suite |
| `/tmp/scroll-test-automation.py` | macOS system events automation |
| `docs/xterm-scroll-bug-investigation.md` | This document |

---

## Next Steps

1. **Debug why RAF loop isn't detecting changes**
   - Add more aggressive logging
   - Check if loop is actually running during drag
   - Compare scrollTop/viewportY values at mousedown vs during drag

2. **If RAF loop IS running but not detecting**:
   - The scroll might be a visual re-render without actual scroll position change
   - May need to intercept xterm's rendering, not scroll position

3. **If RAF loop ISN'T running**:
   - Check if scrollFixActive is being cleared unexpectedly
   - Check if savedScrollTop is null when it shouldn't be

4. **Alternative approach**: Instead of restoring scroll, PREVENT the scroll-to-bottom trigger in the first place by identifying what xterm code path causes it.

---

## Appendix: Previous Attempts (1-21)

| # | Approach | Result |
|---|----------|--------|
| 1-5 | Focus prevention | Failed - focus not the cause |
| 6-10 | Event preventDefault | Failed - events not cancelable |
| 11-15 | Scroll save/restore (delayed) | Failed - restore too late |
| 16-17 | Blur before click | Failed - still scrolls |
| 18 | Disable textarea | Failed - scroll bypasses focus |
| 19 | Remove smoothScrollDuration | Partial - works in Chromium only |
| 20 | RAF scroll restoration (scrollToLine) | Failed - "scroll war" |
| 21 | stopImmediatePropagation | Partial - breaks selection |

---

### Attempt #31: xterm.js Terminal Options (2026-01-29)

**Hypothesis**: xterm.js has built-in options that might control scroll-on-click behavior.

**Pre-test Discovery**: Disabled tmux mouse mode via escape sequences (`\x1b[?1000l` etc.) - scroll-to-bottom **still happened**. This confirms the issue is internal to xterm.js, NOT related to mouse escape sequences being sent to tmux.

**Research**: Searched xterm.js GitHub issues and documentation:
- [Issue #1824](https://github.com/xtermjs/xterm.js/issues/1824): `scrollOnUserInput` option added in v5.1.0
- [Discussion #4320](https://github.com/xtermjs/xterm.js/discussions/4320): `macOptionClickForcesSelection` for forcing selection mode

**Options Added** (`Terminal.jsx` BASE_TERMINAL_OPTIONS):
```javascript
scrollOnUserInput: false,        // Disable scroll-to-bottom on user input
macOptionClickForcesSelection: true,  // Option+click forces selection mode
```

**Tests to Run**:

1. **Test A - Regular click with `scrollOnUserInput: false`**:
   - Create new session, exit Claude Code, run `seq 1 300`
   - Scroll up, click to select
   - Expected: If this option affects click behavior, no scroll-to-bottom

2. **Test B - Option+click with `macOptionClickForcesSelection: true`**:
   - Same setup, scroll up
   - Hold **Option** key and click to select
   - Expected: Forces native xterm.js selection, may bypass scroll behavior

**Result**:
- **Test A (Regular click)**: ❌ Still scrolls to bottom
- **Test B (Option+click)**: ✅ **WORKS!** Selection works, no scroll-to-bottom!

**Status**: BREAKTHROUGH - Option+click bypasses the scroll behavior entirely!

### Attempt #31b: Force altKey When Scrolled Up

**Hypothesis**: Since manual Option+click works, we can programmatically force `altKey: true` on mouse events when scrolled up, similar to Attempt #28's shiftKey approach but using altKey instead.

**Key Difference from Attempt #28**:
- Attempt #28 tried `shiftKey: true` → xterm.js ignored it
- Option+click (altKey) is PROVEN to work manually
- `macOptionClickForcesSelection` specifically uses altKey to trigger selection mode

**Implementation** (`Terminal.jsx`):
```javascript
const forceAltKeyWhenScrolled = (e) => {
    const buffer = term.buffer.active;
    const isScrolledUp = buffer.viewportY < buffer.baseY;

    if (isScrolledUp) {
        // Force altKey to trigger macOptionClickForcesSelection behavior
        Object.defineProperty(e, 'altKey', { get: () => true, configurable: true });
    }
};

// Attach to capture phase so we modify events BEFORE xterm.js sees them
const scrollFixEvents = ['mousedown', 'mousemove', 'mouseup', 'click'];
scrollFixEvents.forEach(eventType => {
    terminalRef.current?.addEventListener(eventType, forceAltKeyWhenScrolled, { capture: true });
});
```

**Result**: ✅ **SUCCESS!** Text selection works while scrolled up without scroll-to-bottom.

**Why This Works (and shiftKey didn't)**:
- `macOptionClickForcesSelection: true` is an explicit xterm.js option that checks `altKey`
- shiftKey behavior is handled differently in xterm.js internals
- The option explicitly tells xterm.js to use local selection when altKey is detected

**Status**: ✅ FIXED
