package main

import (
	"embed"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// createAppMenu builds a custom menu for macOS that removes the Redo keyboard
// shortcut (Cmd+Shift+Z). This prevents macOS from intercepting the shortcut
// before it reaches the app, allowing it to work as a zoom toggle in the terminal.
func createAppMenu() *menu.Menu {
	appMenu := menu.NewMenu()

	if runtime.GOOS == "darwin" {
		// App menu (About, Quit, etc.)
		appMenu.Append(menu.AppMenu())

		// Custom Edit menu without Redo shortcut
		// By setting Redo's accelerator to nil, macOS won't intercept Cmd+Shift+Z
		editMenu := appMenu.AddSubmenu("Edit")
		editMenu.AddText("Undo", keys.CmdOrCtrl("z"), nil)
		editMenu.AddText("Redo", nil, nil) // No accelerator - key goes to JS
		editMenu.AddSeparator()
		editMenu.AddText("Cut", keys.CmdOrCtrl("x"), nil)
		editMenu.AddText("Copy", keys.CmdOrCtrl("c"), nil)
		editMenu.AddText("Paste", keys.CmdOrCtrl("v"), nil)
		editMenu.AddSeparator()
		editMenu.AddText("Select All", keys.CmdOrCtrl("a"), nil)
	}

	return appMenu
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Detect development mode
	isDev := os.Getenv("WAILS_DEV") != "" || Version == "0.1.0-dev"

	// Configure logger
	logLevel := logger.INFO
	if isDev {
		logLevel = logger.DEBUG
	}

	// Set app title based on mode
	appTitle := "RevvySwarm"
	if isDev {
		appTitle = "RevvySwarm (Dev)"
	}

	// Create application with options
	err := wails.Run(&options.App{
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
		// Enable DevTools in development mode
		Debug: options.Debug{
			OpenInspectorOnStartup: isDev,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
