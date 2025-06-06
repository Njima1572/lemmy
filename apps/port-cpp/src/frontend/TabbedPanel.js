/**
 * TabbedPanel - Self-contained panel component that manages tabs, active file, and view modes
 * Replaces the old Panel class with full tab management capabilities
 */
class TabbedPanel {
	constructor(containerId, webSocketManager) {
		this.containerId = containerId;
		this.container = document.getElementById(containerId);
		this.webSocketManager = webSocketManager;

		if (!this.container) {
			throw new Error(`Container with id '${containerId}' not found`);
		}

		console.log(`📋 TabbedPanel created for container: ${containerId}`);

		// Panel state
		this.tabs = []; // Array of file keys
		this.activeTab = null; // Currently active file key
		this.fileViews = new Map(); // fileKey -> FileView

		// Create permanent DOM structure
		this.setupDOM();

		// Create Monaco editors immediately
		this.createEditors();

		// Event listeners
		this.updateListeners = new Set();
	}

	/**
	 * Setup permanent DOM structure
	 */
	setupDOM() {
		this.container.innerHTML = `
			<div class="panel-header" style="display: none;"></div>
			<div class="file-info" style="display: none;"></div>
			<div class="content">
				<div class="content-editor-container" style="width: 100%; height: 100%; display: none;"></div>
				<div class="diff-editor-container" style="width: 100%; height: 100%; display: none;"></div>
				<div class="full-diff-editor-container" style="width: 100%; height: 100%; display: none;"></div>
				<div class="message-container" style="width: 100%; height: 100%; display: none; align-items: center; justify-content: center;"></div>
			</div>
		`;

		this.header = this.container.querySelector(".panel-header");
		this.fileInfo = this.container.querySelector(".file-info");
		this.content = this.container.querySelector(".content");
		this.contentContainer = this.container.querySelector(".content-editor-container");
		this.diffContainer = this.container.querySelector(".diff-editor-container");
		this.fullDiffContainer = this.container.querySelector(".full-diff-editor-container");
		this.messageContainer = this.container.querySelector(".message-container");
	}

	/**
	 * Create all Monaco editors immediately
	 */
	createEditors() {
		const commonOptions = {
			theme: "custom-dark",
			readOnly: true,
			automaticLayout: true,
			scrollBeyondLastLine: false,
			minimap: { enabled: false },
			renderWhitespace: "selection",
		};

		// Create content editor
		this.contentEditor = monaco.editor.create(this.contentContainer, {
			...commonOptions,
			value: "",
			language: "text",
		});

		// Create context diff editor (only changed lines + context)
		this.diffEditor = monaco.editor.createDiffEditor(this.diffContainer, {
			...commonOptions,
			renderSideBySide: true,
			ignoreTrimWhitespace: false,
		});

		// Create full diff editor (complete files side-by-side)
		this.fullDiffEditor = monaco.editor.createDiffEditor(this.fullDiffContainer, {
			...commonOptions,
			renderSideBySide: true,
			ignoreTrimWhitespace: false,
		});

		console.log(`✅ TabbedPanel ${this.containerId} editors created`);
	}

	/**
	 * Add a file to this panel
	 */
	addFile(fileIdentity) {
		const fileKey = fileIdentity.getKey();

		// Don't add duplicates
		if (this.tabs.includes(fileKey)) {
			this.activeTab = fileKey;
			this.updateUI();
			return;
		}

		// Create FileView if doesn't exist
		if (!this.fileViews.has(fileKey)) {
			const fileView = new FileView(fileIdentity, this.webSocketManager);
			this.fileViews.set(fileKey, fileView);

			// Listen for file view events
			fileView.addUpdateListener((event) => {
				this.handleFileViewEvent(event);
			});
		}

		// Add to tabs and set as active
		this.tabs.push(fileKey);
		this.activeTab = fileKey;

		this.updateUI();
		this.displayActiveFile();

		console.log(`📂 Added file to panel ${this.containerId}: ${fileKey}`);
	}

	/**
	 * Remove a file from this panel
	 */
	removeFile(fileKey) {
		const tabIndex = this.tabs.indexOf(fileKey);
		if (tabIndex === -1) return;

		// Remove from tabs
		this.tabs.splice(tabIndex, 1);

		// Update active tab
		if (this.activeTab === fileKey) {
			this.activeTab = this.tabs.length > 0 ? this.tabs[0] : null;
		}

		// Dispose file view
		const fileView = this.fileViews.get(fileKey);
		if (fileView) {
			fileView.dispose();
			this.fileViews.delete(fileKey);
		}

		this.updateUI();
		if (this.activeTab) {
			this.displayActiveFile();
		}

		console.log(`🗑️ Removed file from panel ${this.containerId}: ${fileKey}`);

		// Notify listeners about tab changes
		this.notifyListeners({
			type: "tabsChanged",
			panel: this,
			hasFiles: this.hasFiles(),
		});
	}

	/**
	 * Switch to a different tab
	 */
	switchToTab(fileKey) {
		if (!this.tabs.includes(fileKey)) return;

		this.activeTab = fileKey;
		this.updateUI();
		this.displayActiveFile();
	}

	/**
	 * Toggle view mode for active file
	 */
	toggleViewMode() {
		if (!this.activeTab) return;

		const fileView = this.fileViews.get(this.activeTab);
		if (fileView) {
			fileView.toggleMode();
			this.updateUI(); // Refresh toggle button
		}
	}

	/**
	 * Handle file view events
	 */
	handleFileViewEvent(event) {
		if (event.type === "removed") {
			// File was removed, close it
			const fileKey = event.fileView.getFileIdentity().getKey();
			this.removeFile(fileKey);
		}
		// Forward other events to App
		this.notifyListeners(event);
	}

	/**
	 * Update UI (tabs, file info, toggle button)
	 */
	updateUI() {
		if (this.tabs.length === 0) {
			// No files - hide everything
			this.header.style.display = "none";
			this.fileInfo.style.display = "none";
			this.showEmpty();
			return;
		}

		// Show header and file info
		this.header.style.display = "block";
		this.fileInfo.style.display = "flex";

		// Build tabs HTML
		const tabs = this.tabs
			.map((fileKey) => {
				const fileView = this.fileViews.get(fileKey);
				const displayInfo = fileView.getDisplayInfo();
				const isActive = fileKey === this.activeTab;

				return `
					<div class="tab ${isActive ? "active" : ""}" data-file-key="${fileKey}">
						<span class="tab-name" title="${displayInfo.filepath}">${displayInfo.filename}</span>
						<button class="tab-close" data-file-key="${fileKey}" title="Close">×</button>
					</div>
				`;
			})
			.join("");

		this.header.innerHTML = `<div class="tabs">${tabs}</div>`;

		// Update file info for active tab
		if (this.activeTab) {
			const activeFileView = this.fileViews.get(this.activeTab);
			if (activeFileView) {
				const identity = activeFileView.fileIdentity;
				const branchInfo = this.formatBranchInfo(identity.prevBranch, identity.currBranch);
				const currentMode = activeFileView.getCurrentMode();

				// Toggle button
				const { toggleIcon, toggleTitle } = this.getToggleIconAndTitle(currentMode);

				this.fileInfo.innerHTML = `
					<div class="file-info-content">
						<div class="file-path clickable" title="Click to open in Cursor: ${identity.filepath}" data-filepath="${identity.filepath}">${identity.filepath}</div>
						<div class="branch-info">${branchInfo}</div>
					</div>
					<button class="toggle-btn" title="${toggleTitle}">${toggleIcon}</button>
				`;
			}
		}

		// Setup event listeners
		this.setupEventListeners();
	}

	/**
	 * Get toggle button icon and title based on current mode
	 */
	getToggleIconAndTitle(currentMode) {
		const contentIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
			<path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zM4 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4z"/>
			<path d="M4.5 8a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5z"/>
		</svg>`;

		const diffIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
			<path d="M0 3a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H2z"/>
			<path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-.5v11h.5a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h.5V3H7a.5.5 0 0 1-.5-.5v-1A.5.5 0 0 1 7 1h2.5z"/>
			<path d="M11 3a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2V3zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-1z"/>
		</svg>`;

		if (currentMode === "content") {
			return { toggleIcon: diffIcon, toggleTitle: "Diff (Context)" };
		} else if (currentMode === "diff") {
			return { toggleIcon: diffIcon, toggleTitle: "Full Diff" };
		} else {
			return { toggleIcon: contentIcon, toggleTitle: "Content" };
		}
	}

	/**
	 * Format branch information for display
	 */
	formatBranchInfo(prevBranch, currBranch) {
		if (prevBranch && currBranch) {
			return `${prevBranch} → ${currBranch}`;
		} else if (prevBranch) {
			return `${prevBranch} → working`;
		} else {
			return `working → HEAD`;
		}
	}

	/**
	 * Setup event listeners for tabs and buttons
	 */
	setupEventListeners() {
		// Remove existing listeners by cloning elements
		const newHeader = this.header.cloneNode(true);
		this.header.parentNode.replaceChild(newHeader, this.header);
		this.header = newHeader;

		const newFileInfo = this.fileInfo.cloneNode(true);
		this.fileInfo.parentNode.replaceChild(newFileInfo, this.fileInfo);
		this.fileInfo = newFileInfo;

		// Tab events
		this.header.addEventListener("click", (e) => {
			// Tab clicks
			const tab = e.target.closest(".tab");
			if (tab && !e.target.classList.contains("tab-close")) {
				const fileKey = tab.dataset.fileKey;
				if (fileKey && fileKey !== this.activeTab) {
					this.switchToTab(fileKey);
				}
				return;
			}

			// Tab close buttons
			const closeBtn = e.target.closest(".tab-close");
			if (closeBtn) {
				e.stopPropagation();
				const fileKey = closeBtn.dataset.fileKey;
				this.removeFile(fileKey);
				return;
			}
		});

		// File info events
		this.fileInfo.addEventListener("click", (e) => {
			// Toggle button
			const toggleBtn = e.target.closest(".toggle-btn");
			if (toggleBtn) {
				this.toggleViewMode();
				return;
			}

			// File path clicks (open in Cursor)
			const filePath = e.target.closest(".file-path.clickable");
			if (filePath) {
				const filepath = filePath.dataset.filepath;
				if (filepath) {
					this.openInCursor(filepath);
				}
				return;
			}
		});
	}

	/**
	 * Display the currently active file
	 */
	displayActiveFile() {
		if (!this.activeTab) {
			this.showEmpty();
			return;
		}

		const fileView = this.fileViews.get(this.activeTab);
		if (!fileView) {
			this.showEmpty();
			return;
		}

		// Create a Panel-like interface for FileView
		const panelInterface = {
			showContent: (fileModel) => this.showContent(fileModel),
			showDiff: (fileModel) => this.showDiff(fileModel),
			showFullDiff: (fileModel) => this.showFullDiff(fileModel),
			showError: (error) => this.showError(error),
			getCurrentMode: () => fileView.getCurrentMode(),
			saveCurrentViewState: () => this.saveCurrentViewState(),
			highlightLine: (lineNumber) => this.highlightLine(lineNumber),
			layout: () => this.layout(),
		};

		fileView.displayIn(panelInterface, fileView.getCurrentMode());
	}

	/**
	 * Show file in content mode
	 */
	showContent(fileModel) {
		this.hideAllContainers();
		this.contentContainer.style.display = "block";

		if (fileModel && fileModel.contentModel) {
			this.contentEditor.setModel(fileModel.contentModel);

			setTimeout(() => {
				if (fileModel.contentViewState) {
					this.contentEditor.restoreViewState(fileModel.contentViewState);
				}
			}, 200);
		}

		this.currentFileModel = fileModel;
		this.currentMode = "content";
	}

	/**
	 * Show file in diff mode
	 */
	showDiff(fileModel) {
		if (!fileModel || !fileModel.hasDiff()) {
			this.showNoDiff();
			return;
		}

		this.hideAllContainers();
		this.diffContainer.style.display = "block";

		if (fileModel && fileModel.originalModel && fileModel.modifiedModel) {
			this.diffEditor.setModel({
				original: fileModel.originalModel,
				modified: fileModel.modifiedModel,
			});

			const restoreViewState = () => {
				if (fileModel.diffViewState) {
					this.diffEditor.restoreViewState(fileModel.diffViewState);
				}
			};

			const disposable = this.diffEditor.onDidUpdateDiff(() => {
				restoreViewState();
				disposable.dispose();
			});

			setTimeout(restoreViewState, 200);
		}

		this.currentFileModel = fileModel;
		this.currentMode = "diff";
	}

	/**
	 * Show file in full diff mode
	 */
	showFullDiff(fileModel) {
		if (!fileModel || !fileModel.fullOriginalModel || !fileModel.fullModifiedModel) {
			this.showError("Full diff not available - no branch content found");
			return;
		}

		this.hideAllContainers();
		this.fullDiffContainer.style.display = "block";

		this.fullDiffEditor.setModel({
			original: fileModel.fullOriginalModel,
			modified: fileModel.fullModifiedModel,
		});

		const restoreViewState = () => {
			if (fileModel.fullDiffViewState) {
				this.fullDiffEditor.restoreViewState(fileModel.fullDiffViewState);
			}
		};

		const disposable = this.fullDiffEditor.onDidUpdateDiff(() => {
			restoreViewState();
			disposable.dispose();
		});

		setTimeout(restoreViewState, 200);

		this.currentFileModel = fileModel;
		this.currentMode = "fullDiff";
	}

	/**
	 * Show no diff message
	 */
	showNoDiff() {
		this.hideAllContainers();
		this.messageContainer.innerHTML = `
			<div class="no-changes">
				<div class="no-changes-icon">📄</div>
				<div class="no-changes-title">No Changes</div>
				<div class="no-changes-message">There are no differences to display between the selected versions.</div>
			</div>
		`;
		this.messageContainer.style.display = "flex";
		this.currentMode = "no-diff";
	}

	/**
	 * Show error message
	 */
	showError(error) {
		this.hideAllContainers();
		this.messageContainer.innerHTML = `
			<div class="error">
				<div class="error-title">Error</div>
				<div class="error-message">${error || "An unknown error occurred"}</div>
			</div>
		`;
		this.messageContainer.style.display = "flex";
		this.currentMode = "error";
	}

	/**
	 * Show empty state
	 */
	showEmpty(message = "No file selected") {
		this.hideAllContainers();
		this.messageContainer.innerHTML = `
			<div class="empty-state">
				<div class="empty-message">${message}</div>
			</div>
		`;
		this.messageContainer.style.display = "flex";
		this.currentMode = "empty";
	}

	/**
	 * Hide all editor containers
	 */
	hideAllContainers() {
		this.contentContainer.style.display = "none";
		this.diffContainer.style.display = "none";
		this.fullDiffContainer.style.display = "none";
		this.messageContainer.style.display = "none";
	}

	/**
	 * Save current view state
	 */
	saveCurrentViewState() {
		if (!this.currentFileModel) return;

		try {
			if (this.currentMode === "content" && this.contentEditor) {
				const viewState = this.contentEditor.saveViewState();
				this.currentFileModel.contentViewState = viewState;
			} else if (this.currentMode === "diff" && this.diffEditor) {
				const viewState = this.diffEditor.saveViewState();
				this.currentFileModel.diffViewState = viewState;
			} else if (this.currentMode === "fullDiff" && this.fullDiffEditor) {
				const viewState = this.fullDiffEditor.saveViewState();
				this.currentFileModel.fullDiffViewState = viewState;
			}
		} catch (error) {
			console.error("Failed to save view state:", error);
		}
	}

	/**
	 * Highlight a line in the current editor
	 */
	highlightLine(lineNumber) {
		let currentEditor;
		if (this.currentMode === "diff") {
			currentEditor = this.diffEditor;
		} else if (this.currentMode === "fullDiff") {
			currentEditor = this.fullDiffEditor;
		} else {
			currentEditor = this.contentEditor;
		}

		if (!currentEditor || !this.currentFileModel) return;

		// Clear existing decorations
		if (this.currentFileModel.highlightDecorations) {
			if (this.currentMode === "diff" || this.currentMode === "fullDiff") {
				const model = currentEditor.getModel();
				if (model && model.modified) {
					model.modified.deltaDecorations(this.currentFileModel.highlightDecorations, []);
				}
			} else {
				currentEditor.deltaDecorations(this.currentFileModel.highlightDecorations, []);
			}
		}

		// Create highlight decoration
		const decoration = {
			range: new monaco.Range(lineNumber, 1, lineNumber, 1),
			options: {
				isWholeLine: true,
				className: "highlighted-line",
				overviewRuler: {
					color: "#ffd700",
					position: monaco.editor.OverviewRulerLane.Full,
				},
				minimap: {
					color: "#ffd700",
					position: monaco.editor.MinimapPosition.Inline,
				},
			},
		};

		// Apply decoration
		if (this.currentMode === "diff" || this.currentMode === "fullDiff") {
			const model = currentEditor.getModel();
			if (model && model.modified) {
				this.currentFileModel.highlightDecorations = model.modified.deltaDecorations([], [decoration]);
			}
		} else {
			this.currentFileModel.highlightDecorations = currentEditor.deltaDecorations([], [decoration]);
		}

		// Scroll to the line
		currentEditor.revealLineInCenter(lineNumber);
	}

	/**
	 * Open file in Cursor editor
	 */
	async openInCursor(filepath) {
		try {
			console.log(`🎯 Opening in Cursor: ${filepath}`);

			const response = await fetch("/api/open-in-cursor", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ filepath }),
			});

			if (response.ok) {
				console.log(`✅ Successfully opened ${filepath} in Cursor`);
			} else {
				console.error(`❌ Failed to open ${filepath} in Cursor:`, response.statusText);
			}
		} catch (error) {
			console.error(`❌ Error opening ${filepath} in Cursor:`, error);
		}
	}

	/**
	 * Force layout of current editor
	 */
	layout() {
		if (this.contentEditor) {
			this.contentEditor.layout();
		}
		if (this.diffEditor) {
			this.diffEditor.layout();
		}
		if (this.fullDiffEditor) {
			this.fullDiffEditor.layout();
		}
	}

	/**
	 * Check if panel has any files
	 */
	hasFiles() {
		return this.tabs.length > 0;
	}

	/**
	 * Get display info for external access
	 */
	getDisplayInfo() {
		return {
			hasFiles: this.hasFiles(),
			activeTab: this.activeTab,
			tabCount: this.tabs.length,
		};
	}

	/**
	 * Add event listener
	 */
	addUpdateListener(callback) {
		this.updateListeners.add(callback);
	}

	/**
	 * Remove event listener
	 */
	removeUpdateListener(callback) {
		this.updateListeners.delete(callback);
	}

	/**
	 * Notify listeners of events
	 */
	notifyListeners(event) {
		for (const callback of this.updateListeners) {
			try {
				callback(event);
			} catch (error) {
				console.error("Error in TabbedPanel listener:", error);
			}
		}
	}

	/**
	 * Dispose panel and cleanup
	 */
	dispose() {
		console.log(`🗑️ Disposing TabbedPanel: ${this.containerId}`);

		// Save current view state
		this.saveCurrentViewState();

		// Dispose all file views
		for (const fileView of this.fileViews.values()) {
			fileView.dispose();
		}

		// Dispose editors
		if (this.contentEditor) {
			this.contentEditor.dispose();
		}
		if (this.diffEditor) {
			this.diffEditor.dispose();
		}
		if (this.fullDiffEditor) {
			this.fullDiffEditor.dispose();
		}

		// Clear container
		this.container.innerHTML = "";

		// Clear state
		this.tabs = [];
		this.activeTab = null;
		this.fileViews.clear();
		this.updateListeners.clear();

		console.log(`✅ TabbedPanel ${this.containerId} disposed`);
	}
}
