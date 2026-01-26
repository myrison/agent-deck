.PHONY: build run install install-user kill-running clean dev release test fmt lint desktop-dev desktop-build desktop-install

BINARY_NAME=agent-deck
BUILD_DIR=./build
VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS=-ldflags "-X main.Version=$(VERSION)"

# Build the binary
build:
	go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/agent-deck

# Run in development
run:
	go run ./cmd/agent-deck

# Kill running agent-deck instances and clean up lock files
kill-running:
	@echo "Stopping running agent-deck instances..."
	@-pkill -x "agent-deck" 2>/dev/null || true
	@sleep 0.5
	@-find $(HOME)/.agent-deck/profiles -name ".lock" -type f -delete 2>/dev/null || true

# Install to /usr/local/bin (requires sudo)
install: build kill-running
	sudo cp $(BUILD_DIR)/$(BINARY_NAME) /usr/local/bin/$(BINARY_NAME)
	@echo "✅ Installed to /usr/local/bin/$(BINARY_NAME)"
	@echo "Run 'agent-deck' to start"

# Install to user's local bin (no sudo required)
install-user: build kill-running
	mkdir -p $(HOME)/.local/bin
	cp $(BUILD_DIR)/$(BINARY_NAME) $(HOME)/.local/bin/$(BINARY_NAME)
	@echo "✅ Installed to $(HOME)/.local/bin/$(BINARY_NAME)"
	@echo "Make sure $(HOME)/.local/bin is in your PATH"
	@echo "Run 'agent-deck' to start"

# Uninstall from /usr/local/bin
uninstall:
	sudo rm -f /usr/local/bin/$(BINARY_NAME)
	@echo "✅ Uninstalled $(BINARY_NAME)"

# Uninstall from user's local bin
uninstall-user:
	rm -f $(HOME)/.local/bin/$(BINARY_NAME)
	@echo "✅ Uninstalled $(BINARY_NAME)"

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)
	go clean

# Development with auto-reload
dev:
	@which air > /dev/null || go install github.com/cosmtrek/air@latest
	air

# Run tests
test:
	go test -v ./...

# Format code
fmt:
	go fmt ./...

# Lint
lint:
	@which golangci-lint > /dev/null || go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	golangci-lint run

# Build for all platforms
release: clean
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 ./cmd/agent-deck
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64 ./cmd/agent-deck
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 ./cmd/agent-deck
	@echo "✅ Built releases in $(BUILD_DIR)/"

# Desktop app targets
DESKTOP_DIR=./cmd/agent-deck-desktop

# Run desktop app in dev mode (uses "RevvySwarm (Dev)" name)
desktop-dev:
	@$(DESKTOP_DIR)/dev.sh

# Build desktop app for production
desktop-build:
	@cd $(DESKTOP_DIR) && wails build -ldflags "-X main.Version=$(VERSION)"

# Install desktop app to /Applications
desktop-install: desktop-build
	@echo "Installing RevvySwarm.app to /Applications..."
	@rm -rf /Applications/RevvySwarm.app
	@cp -r $(DESKTOP_DIR)/build/bin/RevvySwarm.app /Applications/
	@echo "✅ Installed to /Applications/RevvySwarm.app"
