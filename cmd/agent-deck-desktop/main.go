package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

// appContext holds the Wails context for menu callbacks.
// Set during app startup via SetAppContext.
var appContext context.Context

// SetAppContext stores the Wails context for use in menu callbacks.
// Called from App.startup().
func SetAppContext(ctx context.Context) {
	appContext = ctx
}


// createAppMenu builds a custom menu for macOS that:
// 1. Removes the Redo keyboard shortcut (Cmd+Shift+Z) to allow JS zoom toggle
// 2. Handles Paste via callback to emit clipboard content to JS
// 3. Adds File menu with New Window command (Cmd+Shift+N)
//
// The standard EditMenu enables macOS clipboard handling, but we need custom
// callbacks to bridge clipboard content to xterm.js terminal.
func createAppMenu() *menu.Menu {
	appMenu := menu.NewMenu()

	if runtime.GOOS == "darwin" {
		// App menu (About, Quit, etc.)
		appMenu.Append(menu.AppMenu())

		// File menu with New Window
		fileMenu := appMenu.AddSubmenu("File")
		fileMenu.AddText("New Window", keys.Combo("n", keys.CmdOrCtrlKey, keys.ShiftKey), func(cd *menu.CallbackData) {
			if appContext == nil {
				return
			}
			// Emit event to JS - frontend will call OpenNewWindow
			wailsRuntime.EventsEmit(appContext, "menu:newWindow")
		})

		// Custom Edit menu with callbacks for clipboard operations.
		// Wails on macOS requires an Edit menu with accelerators for clipboard to work.
		// We add callbacks that emit events to JavaScript for terminal integration.
		editMenu := appMenu.AddSubmenu("Edit")
		editMenu.AddText("Undo", keys.CmdOrCtrl("z"), nil)
		editMenu.AddText("Redo", nil, nil) // No accelerator - Cmd+Shift+Z goes to JS for zoom toggle
		editMenu.AddSeparator()
		editMenu.AddText("Cut", keys.CmdOrCtrl("x"), nil)
		// Copy with accelerator and callback - emits event for JS to handle terminal selection
		editMenu.AddText("Copy", keys.CmdOrCtrl("c"), func(cd *menu.CallbackData) {
			if appContext == nil {
				return
			}
			// Emit event to JS - the frontend will check for terminal selection
			// and copy it to clipboard if present
			wailsRuntime.EventsEmit(appContext, "menu:copy")
		})
		// Paste with accelerator and callback - reads clipboard and emits to JS
		editMenu.AddText("Paste", keys.CmdOrCtrl("v"), func(cd *menu.CallbackData) {
			if appContext == nil {
				return
			}
			// Read clipboard text and emit to JS for terminal input
			text, err := wailsRuntime.ClipboardGetText(appContext)
			if err != nil {
				return
			}
			if text != "" {
				wailsRuntime.EventsEmit(appContext, "menu:paste", text)
			}
		})
		editMenu.AddSeparator()
		editMenu.AddText("Select All", keys.CmdOrCtrl("a"), nil)
	}

	return appMenu
}

func main() {
	// Ensure UTF-8 locale for macOS .app bundles which don't inherit shell LANG.
	// Without this, clipboard operations corrupt non-ASCII characters (Wails issue #4132).
	if runtime.GOOS == "darwin" {
		if os.Getenv("LANG") == "" {
			os.Setenv("LANG", "en_US.UTF-8")
		}
		if os.Getenv("LC_ALL") == "" {
			os.Setenv("LC_ALL", "en_US.UTF-8")
		}
	}

	// Create an instance of the app structure
	app, err := NewApp()
	if err != nil {
		log.Fatalf("Failed to initialize application: %v", err)
	}

	// Detect development mode
	isDev := os.Getenv("WAILS_DEV") != "" || Version == "0.1.0-dev"

	// Configure logger
	logLevel := logger.INFO
	if isDev {
		logLevel = logger.DEBUG
	}

	// In dev mode, start hidden to prevent focus-stealing on hot-reload.
	// Click dock icon to reveal window.
	startHidden := isDev

	// Set app title based on mode and window number
	appTitle := "RevvySwarm"
	if isDev {
		appTitle = "RevvySwarm (Dev)"
	} else {
		// Check env var for window number (set by parent when spawning)
		if numStr := os.Getenv("REVDEN_WINDOW_NUM"); numStr != "" {
			var windowNum int
			if _, err := fmt.Sscanf(numStr, "%d", &windowNum); err == nil && windowNum > 1 {
				appTitle = fmt.Sprintf("RevvySwarm (%d)", windowNum)
			}
		}
	}

	// Create application with options
	err = wails.Run(&options.App{
		Title:  appTitle,
		Width:  1024,
		Height: 768,
		Menu:   createAppMenu(),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		LogLevel:           logLevel,
		LogLevelProduction: logger.ERROR,
		StartHidden:        startHidden,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
			CSSDropProperty:    "--wails-drop-target",
			CSSDropValue:       "drop",
		},
		// Enable DevTools in development mode
		Debug: options.Debug{
			OpenInspectorOnStartup: isDev,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
