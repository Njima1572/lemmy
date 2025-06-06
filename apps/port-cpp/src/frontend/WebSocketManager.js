import logger from "./logger.js";

/**
 * Manages single WebSocket connection with multiple file subscriptions
 * Routes file updates to appropriate subscribers based on FileIdentity
 */
export default class WebSocketManager {
	constructor() {
		this.ws = null;
		this.connected = false;
		this.watchedFiles = new Map(); // fileKey -> FileIdentity
		this.subscribers = new Map(); // fileKey -> callback function
		this.connectionListeners = new Set(); // connection status callbacks
		this.reconnectInterval = null;
		this.reconnectDelay = 1000; // Start with 1 second
		this.maxReconnectDelay = 30000; // Max 30 seconds
	}

	/**
	 * Connect to WebSocket server
	 */
	connect() {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const port = window.location.port ? `:${window.location.port}` : "";
		const wsUrl = `${protocol}//${window.location.hostname}${port}`;

		logger.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

		try {
			this.ws = new WebSocket(wsUrl);
			this.setupEventHandlers();
		} catch (error) {
			logger.error("Failed to create WebSocket:", error);
			this.scheduleReconnect();
		}
	}

	/**
	 * Setup WebSocket event handlers
	 */
	setupEventHandlers() {
		this.ws.onopen = () => {
			logger.log("✅ WebSocket connected successfully");
			this.connected = true;
			this.reconnectDelay = 1000; // Reset reconnect delay
			this.clearReconnectInterval();
			this.notifyConnectionListeners(true);

			// Re-subscribe to all watched files
			this.resubscribeAll();
		};

		this.ws.onclose = (event) => {
			logger.log("❌ WebSocket disconnected:", event.code, event.reason);
			this.connected = false;
			this.notifyConnectionListeners(false);

			// Auto-reconnect unless it was a clean close
			if (event.code !== 1000) {
				logger.log("🔄 WebSocket closed unexpectedly, will attempt to reconnect");
				this.scheduleReconnect();
			}
		};

		this.ws.onerror = (error) => {
			logger.error("❌ WebSocket error:", error);
			logger.log("WebSocket readyState:", this.ws.readyState);
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				this.handleMessage(data);
			} catch (error) {
				logger.error("Failed to parse WebSocket message:", error);
			}
		};
	}

	/**
	 * Handle incoming WebSocket messages
	 */
	handleMessage(data) {
		if (data.type === "fileUpdate") {
			// Route to appropriate subscriber
			const { absolutePath, content, diff, originalContent, modifiedContent, error } = data;

			// Find all subscribers for this file path (could be multiple with different branches)
			for (const [fileKey, fileIdentity] of this.watchedFiles.entries()) {
				if (fileIdentity.filepath === absolutePath) {
					const callback = this.subscribers.get(fileKey);
					if (callback) {
						callback({
							type: "fileUpdate",
							absolutePath,
							content,
							diff,
							originalContent,
							modifiedContent,
							error,
							fileIdentity,
						});
					}
				}
			}
		} else if (data.type === "fileRemoved") {
			// Notify all subscribers for this file path
			const { absolutePath } = data;

			for (const [fileKey, fileIdentity] of this.watchedFiles.entries()) {
				if (fileIdentity.filepath === absolutePath) {
					const callback = this.subscribers.get(fileKey);
					if (callback) {
						callback({
							type: "fileRemoved",
							absolutePath,
							fileIdentity,
						});
					}
				}
			}
		}
	}

	/**
	 * Subscribe to file updates for a specific FileIdentity
	 */
	subscribe(fileIdentity, callback) {
		const fileKey = fileIdentity.getKey();

		// Register callback
		this.subscribers.set(fileKey, callback);

		// Only send watch request if not already watching this exact combination
		if (!this.watchedFiles.has(fileKey)) {
			this.watchedFiles.set(fileKey, fileIdentity);

			if (this.connected) {
				this.sendWatchRequest(fileIdentity);
			}
		}

		logger.log(`📡 Subscribed to: ${fileKey}`);
	}

	/**
	 * Unsubscribe from file updates
	 */
	unsubscribe(fileIdentity) {
		const fileKey = fileIdentity.getKey();

		// Remove callback
		this.subscribers.delete(fileKey);

		// Send unwatch request if we were watching this combination
		if (this.watchedFiles.has(fileKey)) {
			this.watchedFiles.delete(fileKey);

			if (this.connected) {
				this.sendUnwatchRequest(fileIdentity);
			}
		}

		logger.log(`📡 Unsubscribed from: ${fileKey}`);
	}

	/**
	 * Send watch request to server
	 */
	sendWatchRequest(fileIdentity) {
		if (!this.connected) return;

		const request = fileIdentity.toWatchRequest();
		this.ws.send(JSON.stringify(request));
		logger.log(`👀 Watching:`, request);
	}

	/**
	 * Send unwatch request to server
	 */
	sendUnwatchRequest(fileIdentity) {
		if (!this.connected) return;

		const request = fileIdentity.toUnwatchRequest();
		this.ws.send(JSON.stringify(request));
		logger.log(`👁️ Unwatching:`, request);
	}

	/**
	 * Re-subscribe to all watched files after reconnection
	 */
	resubscribeAll() {
		logger.log(`🔄 Re-subscribing to ${this.watchedFiles.size} files`);

		for (const fileIdentity of this.watchedFiles.values()) {
			this.sendWatchRequest(fileIdentity);
		}
	}

	/**
	 * Schedule reconnection attempt
	 */
	scheduleReconnect() {
		this.clearReconnectInterval();

		logger.log(`🔄 Scheduling reconnect in ${this.reconnectDelay}ms`);

		this.reconnectInterval = setTimeout(() => {
			logger.log("🔄 Attempting to reconnect...");
			this.connect();

			// Exponential backoff
			this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
		}, this.reconnectDelay);
	}

	/**
	 * Clear reconnection interval
	 */
	clearReconnectInterval() {
		if (this.reconnectInterval) {
			clearTimeout(this.reconnectInterval);
			this.reconnectInterval = null;
		}
	}

	/**
	 * Add connection status listener
	 */
	addConnectionListener(callback) {
		this.connectionListeners.add(callback);
		// Immediately notify of current status
		callback(this.connected);
	}

	/**
	 * Remove connection status listener
	 */
	removeConnectionListener(callback) {
		this.connectionListeners.delete(callback);
	}

	/**
	 * Notify all connection listeners
	 */
	notifyConnectionListeners(connected) {
		for (const callback of this.connectionListeners) {
			try {
				callback(connected);
			} catch (error) {
				logger.error("Error in connection listener:", error);
			}
		}
	}

	/**
	 * Refresh all watched files
	 */
	refresh() {
		logger.log("🔄 Refreshing all files");

		// Re-send watch requests for all files to force server refresh
		for (const fileIdentity of this.watchedFiles.values()) {
			this.sendWatchRequest(fileIdentity);
		}
	}

	/**
	 * Refresh specific file
	 */
	refreshFile(fileIdentity) {
		const fileKey = fileIdentity.getKey();

		if (this.watchedFiles.has(fileKey)) {
			logger.log(`🔄 Refreshing file: ${fileKey}`);
			this.sendWatchRequest(fileIdentity);
		}
	}

	/**
	 * Close WebSocket connection and cleanup
	 */
	disconnect() {
		this.clearReconnectInterval();

		if (this.ws) {
			this.ws.close(1000, "Client disconnect");
			this.ws = null;
		}

		this.connected = false;
		this.watchedFiles.clear();
		this.subscribers.clear();
		this.connectionListeners.clear();
	}
}
