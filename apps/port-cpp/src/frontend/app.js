/**
 * App class coordinates the entire file viewer application
 * Manages an array of TabbedPanels and overall UI state
 */
class App {
	constructor() {
		console.log("🚀 Starting File Viewer App");

		// Step 1: Create WebSocket manager immediately
		this.webSocketManager = new WebSocketManager();

		// Step 2: Wait for Monaco, then create everything else
		this.initializeAsync();
	}

	/**
	 * Initialize the application asynchronously
	 */
	async initializeAsync() {
		// Step 3: Wait for Monaco to be FULLY ready
		await this.waitForMonaco();

		// Step 4: Create the permanent editor containers in DOM
		this.createEditorContainers();

		// Step 5: Create panels array
		this.panels = [];
		this.panels.push(new TabbedPanel("panel0-editor", this.webSocketManager));
		this.panels.push(new TabbedPanel("panel1-editor", this.webSocketManager));

		// Listen to panel events
		this.panels.forEach((panel, index) => {
			panel.addUpdateListener((event) => {
				this.handlePanelEvent(event, index);
			});
		});

		// Initialize everything
		this.initializeWebSocket();
		this.initializeResizer();
		this.updateLayout();
		this.setupGlobalAPI();

		console.log("✅ File Viewer App fully initialized");
	}

	/**
	 * Create permanent editor containers in the DOM
	 */
	createEditorContainers() {
		// Replace left section content with permanent structure
		const leftSection = document.querySelector(".left-section");
		if (leftSection) {
			leftSection.innerHTML = '<div class="monaco-editor-container" id="panel0-editor"></div>';
		}

		// Replace right section with permanent structure
		const rightSection = document.querySelector(".right-section");
		if (rightSection) {
			rightSection.innerHTML = '<div class="monaco-editor-container" id="panel1-editor"></div>';
		}

		console.log("📦 Permanent editor containers created");
	}

	/**
	 * Wait for Monaco Editor to be available
	 */
	async waitForMonaco() {
		return new Promise((resolve) => {
			console.log("🔧 Initializing Monaco Editor...");

			// Configure require.js for Monaco
			require.config({
				paths: {
					vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs",
				},
			});

			// Load Monaco Editor
			require(["vs/editor/editor.main"], () => {
				console.log("✅ Monaco Editor loaded");

				try {
					// Set Monaco theme to match our dark UI
					monaco.editor.defineTheme("custom-dark", {
						base: "vs-dark",
						inherit: true,
						rules: [],
						colors: {
							"editor.background": "#1e1e1e",
							"editor.foreground": "#d4d4d4",
							"editorLineNumber.foreground": "#858585",
							"editorLineNumber.activeForeground": "#c6c6c6",
							"editor.selectionBackground": "#264f78",
							"editor.selectionHighlightBackground": "#add6ff26",
						},
					});

					monaco.editor.setTheme("custom-dark");
					console.log("✅ Monaco theme configured");
					resolve();
				} catch (error) {
					console.error("Failed to configure Monaco theme:", error);
					resolve(); // Still resolve to continue initialization
				}
			});
		});
	}

	/**
	 * Initialize WebSocket connection
	 */
	initializeWebSocket() {
		// Add connection status listener
		this.webSocketManager.addConnectionListener((connected) => {
			this.updateConnectionStatus(connected);
		});

		// Connect
		this.webSocketManager.connect();

		console.log("🔌 WebSocket manager initialized");
	}

	/**
	 * Initialize resizer for panel splitting
	 */
	initializeResizer() {
		const resizer = document.getElementById("resizer");
		const leftSection = document.querySelector(".left-section");
		const rightSection = document.querySelector(".right-section");

		if (!resizer || !leftSection || !rightSection) {
			console.warn("Resizer elements not found");
			return;
		}

		let isResizing = false;

		resizer.addEventListener("mousedown", (e) => {
			isResizing = true;
			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
			e.preventDefault();
		});

		const handleMouseMove = (e) => {
			if (!isResizing) return;

			const containerWidth = document.querySelector(".container").offsetWidth;
			const leftWidth = (e.clientX / containerWidth) * 100;
			const rightWidth = 100 - leftWidth;

			if (leftWidth > 20 && rightWidth > 20) {
				leftSection.style.width = `${leftWidth}%`;
				rightSection.style.width = `${rightWidth}%`;

				// Layout editors after resize
				setTimeout(() => {
					this.panels.forEach((panel) => panel.layout());
				}, 0);
			}
		};

		const handleMouseUp = () => {
			isResizing = false;
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};

		console.log("📐 Resizer initialized");
	}

	/**
	 * Setup global fileViewer API for external access
	 */
	setupGlobalAPI() {
		window.fileViewer = {
			open: (filepath, panel, prevBranch, currBranch) => {
				this.open(filepath, panel, prevBranch, currBranch);
			},
			close: (filepath, prevBranch, currBranch) => {
				this.close(filepath, prevBranch, currBranch);
			},
			closeAll: () => {
				this.closeAll();
			},
			highlight: (filepath, lineNumber, prevBranch, currBranch) => {
				this.highlight(filepath, lineNumber, prevBranch, currBranch);
			},
			refresh: () => {
				this.refresh();
			},
		};

		console.log("🌐 Global fileViewer API created");
	}

	/**
	 * Open a file in specified panel
	 */
	open(filepath, panelIndex, prevBranch = null, currBranch = null) {
		console.log(`📂 Opening: ${filepath} in panel ${panelIndex}`, { prevBranch, currBranch });

		// Validate panel index
		if (panelIndex < 0 || panelIndex >= this.panels.length) {
			console.error(`Invalid panel index: ${panelIndex}`);
			return;
		}

		// Create file identity
		const fileIdentity = new FileIdentity(filepath, prevBranch, currBranch);

		// Add to panel
		this.panels[panelIndex].addFile(fileIdentity);

		// Update layout to show panels
		this.updateLayout();

		console.log(`✅ File opened: ${fileIdentity.getKey()}`);
	}

	/**
	 * Close a file from all panels
	 */
	close(filepath, prevBranch = null, currBranch = null) {
		const fileIdentity = new FileIdentity(filepath, prevBranch, currBranch);
		const fileKey = fileIdentity.getKey();

		console.log(`🗑️ Closing: ${fileKey}`);

		// Remove from all panels
		this.panels.forEach((panel) => {
			panel.removeFile(fileKey);
		});

		// Update layout
		this.updateLayout();

		console.log(`✅ File closed: ${fileKey}`);
	}

	/**
	 * Close all files
	 */
	closeAll() {
		console.log("🗑️ Closing all files");

		// Clear all panels
		this.panels.forEach((panel) => {
			// Get copy of tabs to avoid mutation during iteration
			const tabs = [...panel.tabs];
			tabs.forEach((fileKey) => {
				panel.removeFile(fileKey);
			});
		});

		// Update layout
		this.updateLayout();

		console.log("✅ All files closed");
	}

	/**
	 * Highlight a line in a file
	 */
	highlight(filepath, lineNumber, prevBranch = null, currBranch = null) {
		const fileIdentity = new FileIdentity(filepath, prevBranch, currBranch);
		const fileKey = fileIdentity.getKey();

		// Find the panel containing this file
		for (const panel of this.panels) {
			if (panel.tabs.includes(fileKey)) {
				// Switch to this tab and highlight
				panel.switchToTab(fileKey);

				// Get the file view and highlight the line
				const fileView = panel.fileViews.get(fileKey);
				if (fileView) {
					setTimeout(() => {
						panel.highlightLine(lineNumber);
					}, 300); // Give time for panel to display the file
				}

				console.log(`🎯 Highlighted line ${lineNumber} in ${fileKey}`);
				return;
			}
		}

		console.warn(`Cannot highlight line - file not open: ${fileKey}`);
	}

	/**
	 * Refresh all files
	 */
	refresh() {
		console.log("🔄 Refreshing all files");
		this.webSocketManager.refresh();
	}

	/**
	 * Handle events from panels
	 */
	handlePanelEvent(event, panelIndex) {
		if (event.type === "tabsChanged") {
			// Update layout when panels gain/lose files
			this.updateLayout();
		}
		// Other events can be handled here as needed
	}

	/**
	 * Update layout based on which panels have files
	 */
	updateLayout() {
		const leftSection = document.querySelector(".left-section");
		const rightSection = document.querySelector(".right-section");
		const resizer = document.getElementById("resizer");

		const panel0HasFiles = this.panels[0].hasFiles();
		const panel1HasFiles = this.panels[1].hasFiles();

		if (!panel0HasFiles && !panel1HasFiles) {
			// No files anywhere - show empty state
			leftSection.style.display = "flex";
			leftSection.style.width = "100%";
			rightSection.style.display = "none";
			resizer.style.display = "none";
		} else if (panel0HasFiles && !panel1HasFiles) {
			// Only panel 0 has files
			leftSection.style.display = "flex";
			leftSection.style.width = "100%";
			rightSection.style.display = "none";
			resizer.style.display = "none";
		} else if (!panel0HasFiles && panel1HasFiles) {
			// Only panel 1 has files - show it on the left
			leftSection.style.display = "none";
			rightSection.style.display = "flex";
			rightSection.style.width = "100%";
			resizer.style.display = "none";
		} else {
			// Both panels have files - show side by side
			leftSection.style.display = "flex";
			rightSection.style.display = "flex";
			leftSection.style.width = "50%";
			rightSection.style.width = "50%";
			resizer.style.display = "block";
		}

		// Layout editors
		setTimeout(() => {
			this.panels.forEach((panel) => panel.layout());
		}, 0);
	}

	/**
	 * Update connection status display
	 */
	updateConnectionStatus(connected) {
		const statusElement = document.getElementById("connection-status");
		const circleElement = document.getElementById("status-circle");

		if (statusElement) {
			statusElement.textContent = connected ? "Connected" : "Disconnected";
		}

		if (circleElement) {
			if (connected) {
				circleElement.classList.add("connected");
			} else {
				circleElement.classList.remove("connected");
			}
		}
	}

	/**
	 * Dispose app and cleanup
	 */
	dispose() {
		console.log("🗑️ Disposing App");

		// Dispose all panels
		this.panels.forEach((panel) => {
			panel.dispose();
		});

		// Disconnect WebSocket
		this.webSocketManager.disconnect();

		// Clear global API
		delete window.fileViewer;

		console.log("✅ App disposed");
	}
}

// Initialize app when page loads
document.addEventListener("DOMContentLoaded", () => {
	new App();
});
