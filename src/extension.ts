import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as child_process from 'child_process';

/**
 * Log priority levels in logcat
 */
enum LogLevel {
	VERBOSE = 'V',
	DEBUG = 'D', 
	INFO = 'I',
	WARNING = 'W',
	ERROR = 'E',
	FATAL = 'F'
}

/**
 * Mapping of log levels to colors (similar to Android Studio)
 */
const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
	[LogLevel.VERBOSE]: '#BBBBBB',
	[LogLevel.DEBUG]: '#38B2AC',
	[LogLevel.INFO]: '#4299E1',
	[LogLevel.WARNING]: '#F6AD55',
	[LogLevel.ERROR]: '#F56565',
	[LogLevel.FATAL]: '#000000'
};

// Background color for fatal logs
const FATAL_BACKGROUND = '#FEB2B2';

/**
 * Class to manage the Logcat panel
 */
class LogcatViewerPanel {
	public static currentPanel: LogcatViewerPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];
	private _terminal: vscode.Terminal | undefined;
	private _logProcess: child_process.ChildProcess | undefined;
	private _device: string | undefined;
	private _isRunning: boolean = false;

	public static createOrShow(extensionUri: vscode.Uri) {
		const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

		// If we already have a panel, show it
		if (LogcatViewerPanel.currentPanel) {
			LogcatViewerPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			'androidLogcatViewer',
			'Android Logcat',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'media')
				]
			}
		);

		LogcatViewerPanel.currentPanel = new LogcatViewerPanel(panel, extensionUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;

		this._update();

		// Listen for when the panel is disposed
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'clearLogs':
						this._clearLogs();
						break;
					case 'startLogcat':
						this._startLogcat(message.device);
						break;
					case 'stopLogcat':
						this._stopLogcat();
						break;
					case 'filterLogs':
						this._filterLogs(message.filter);
						break;
				}
			},
			null,
			this._disposables
		);
	}

	public dispose() {
		LogcatViewerPanel.currentPanel = undefined;

		// Clean up resources
		this._panel.dispose();
		this._stopLogcat();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	private _update() {
		const webview = this._panel.webview;
		this._panel.title = 'Android Logcat';
		this._panel.webview.html = this._getHtmlForWebview(webview);

		// Detect connected devices
		this._getConnectedDevices().then(devices => {
			webview.postMessage({ command: 'updateDevices', devices });
		});
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Android Logcat</title>
			<style>
				body {
					padding: 0;
					margin: 0;
					width: 100%;
					height: 100vh;
					font-family: var(--vscode-editor-font-family);
					font-size: var(--vscode-editor-font-size);
					background-color: var(--vscode-editor-background);
					color: var(--vscode-editor-foreground);
					display: flex;
					flex-direction: column;
				}
				.controls {
					display: flex;
					padding: 8px;
					background-color: var(--vscode-panel-background);
					border-bottom: 1px solid var(--vscode-panel-border);
				}
				.controls select, .controls button, .controls input {
					margin-right: 8px;
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 4px 8px;
					border-radius: 2px;
				}
				.controls input {
					background-color: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					width: 200px;
				}
				.logs {
					flex: 1;
					overflow: auto;
					padding: 8px;
					font-family: monospace;
					white-space: pre;
				}
				.log-entry {
					margin: 2px 0;
					display: flex;
				}
				.log-date, .log-time, .log-pid, .log-tag {
					margin-right: 8px;
					opacity: 0.8;
				}
				.log-message {
					flex: 1;
					word-break: break-word;
					white-space: pre-wrap;
				}
				.fatal {
					background-color: ${FATAL_BACKGROUND};
				}
			</style>
		</head>
		<body>
			<div class="controls">
				<select id="device-select">
					<option value="">Select a device...</option>
				</select>
				<button id="start-btn">Start</button>
				<button id="stop-btn" disabled>Stop</button>
				<button id="clear-btn">Clear</button>
				<input type="text" id="filter-input" placeholder="Filter (e.g., tag:MyTag, level:E)">
			</div>
			<div class="logs" id="logs"></div>

			<script>
				const vscode = acquireVsCodeApi();
				const logsContainer = document.getElementById('logs');
				const deviceSelect = document.getElementById('device-select');
				const startBtn = document.getElementById('start-btn');
				const stopBtn = document.getElementById('stop-btn');
				const clearBtn = document.getElementById('clear-btn');
				const filterInput = document.getElementById('filter-input');
				
				let filter = '';
				let autoScroll = true;
				
				// Handle messages from the extension
				window.addEventListener('message', event => {
					const message = event.data;
					
					switch (message.command) {
						case 'logcat':
							appendLog(message.line);
							break;
						case 'updateDevices':
							updateDeviceList(message.devices);
							break;
						case 'clearLogs':
							clearLogs();
							break;
					}
				});
				
				startBtn.addEventListener('click', () => {
					if (deviceSelect.value) {
						vscode.postMessage({
							command: 'startLogcat',
							device: deviceSelect.value
						});
						startBtn.disabled = true;
						stopBtn.disabled = false;
					}
				});
				
				stopBtn.addEventListener('click', () => {
					vscode.postMessage({
						command: 'stopLogcat'
					});
					startBtn.disabled = false;
					stopBtn.disabled = true;
				});
				
				clearBtn.addEventListener('click', () => {
					vscode.postMessage({
						command: 'clearLogs'
					});
				});
				
				filterInput.addEventListener('input', () => {
					filter = filterInput.value.trim().toLowerCase();
					vscode.postMessage({
						command: 'filterLogs',
						filter: filter
					});
				});
				
				logsContainer.addEventListener('scroll', () => {
					// Disable auto-scroll if user manually scrolls up
					const isAtBottom = logsContainer.scrollHeight - logsContainer.clientHeight <= logsContainer.scrollTop + 50;
					autoScroll = isAtBottom;
				});
				
				function updateDeviceList(devices) {
					deviceSelect.innerHTML = '<option value="">Select a device...</option>';
					devices.forEach(device => {
						const option = document.createElement('option');
						option.value = device.id;
						option.textContent = device.name || device.id;
						deviceSelect.appendChild(option);
					});
				}
				
				function clearLogs() {
					logsContainer.innerHTML = '';
				}
				
				function appendLog(logLine) {
					const logEntry = document.createElement('div');
					logEntry.className = 'log-entry';
					
					// Parse log line from logcat's format
					// Example: 2022-12-29 04:00:18.823 30249-30321 ProfileInstaller D Installing profile
					const parts = logLine.match(/^([\d-]+)\s+([\d:.]+)\s+(\d+[-\d]*)\s+([^\s]+)\s+([VDIWEF])\s+(.*)$/);
					
					if (parts) {
						const [, date, time, pid, tag, level, message] = parts;
						
						// Apply color based on log level
						let color = '#BBBBBB'; // Default color
						let isFatal = false;
						
						switch (level) {
							case 'V': color = '${LOG_LEVEL_COLORS[LogLevel.VERBOSE]}'; break;
							case 'D': color = '${LOG_LEVEL_COLORS[LogLevel.DEBUG]}'; break;
							case 'I': color = '${LOG_LEVEL_COLORS[LogLevel.INFO]}'; break;
							case 'W': color = '${LOG_LEVEL_COLORS[LogLevel.WARNING]}'; break;
							case 'E': color = '${LOG_LEVEL_COLORS[LogLevel.ERROR]}'; break;
							case 'F': 
								color = '${LOG_LEVEL_COLORS[LogLevel.FATAL]}'; 
								isFatal = true;
								break;
						}
						
						logEntry.innerHTML = \`
							<span class="log-date">\${date}</span>
							<span class="log-time">\${time}</span>
							<span class="log-pid">\${pid}</span>
							<span class="log-tag" style="color: \${color}">\${tag}</span>
							<span class="log-level" style="color: \${color}">\${level}</span>
							<span class="log-message" style="color: \${color}">\${escapeHtml(message)}</span>
						\`;
						
						if (isFatal) {
							logEntry.classList.add('fatal');
						}
					} else {
						// If it doesn't match the expected format, just show the raw line
						logEntry.innerHTML = \`<span class="log-message">\${escapeHtml(logLine)}</span>\`;
					}
					
					logsContainer.appendChild(logEntry);
					
					// Auto-scroll to the bottom if enabled
					if (autoScroll) {
						logsContainer.scrollTop = logsContainer.scrollHeight;
					}
				}
				
				function escapeHtml(text) {
					return text
						.replace(/&/g, "&amp;")
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;")
						.replace(/"/g, "&quot;")
						.replace(/'/g, "&#039;");
				}
			</script>
		</body>
		</html>`;
	}

	private async _getConnectedDevices(): Promise<Array<{ id: string, name?: string }>> {
		return new Promise((resolve) => {
			child_process.exec('adb devices -l', (error, stdout) => {
				if (error) {
					vscode.window.showErrorMessage('Error detecting Android devices: ' + error.message);
					resolve([]);
					return;
				}

				const devices: Array<{ id: string, name?: string }> = [];
				const lines = stdout.trim().split('\n');
				
				// Skip the first line which is just a header
				for (let i = 1; i < lines.length; i++) {
					const line = lines[i].trim();
					if (line && !line.startsWith('*')) { // Ignore lines with errors or warnings
						// Extract just the serial number (first word in the line)
						const parts = line.split(/\s+/);
						const id = parts[0]; // This is the serial number
						let name;
						
						// Try to extract device name
						const modelMatch = line.match(/model:([^\s]+)/);
						if (modelMatch) {
							name = modelMatch[1].replace('_', ' '); // Make the name more readable
						}
						
						devices.push({ id, name });
					}
				}

				resolve(devices);
			});
		});
	}

	private _startLogcat(deviceId: string) {
		this._stopLogcat(); // Stop any existing logcat process
		
		this._device = deviceId;
		this._isRunning = true;
		
		// Clear logs first
		this._clearLogs();
		
		try {
			// Use child_process to run logcat and capture output
			// Adding '-T 1' to fetch only the latest logs
			this._logProcess = child_process.spawn('adb', ['-s', deviceId, 'logcat', '-v', 'threadtime', '-T', '1']);
			
			if (this._logProcess.stdout) {
				this._logProcess.stdout.on('data', (data) => {
					const lines = data.toString().split('\n');
					for (const line of lines) {
						if (line.trim()) {
							this._panel.webview.postMessage({ command: 'logcat', line });
						}
					}
				});
			}
			
			if (this._logProcess.stderr) {
				this._logProcess.stderr.on('data', (data) => {
					const errorMsg = data.toString().trim();
					vscode.window.showErrorMessage('Logcat error: ' + errorMsg);
				});
			}
			
			this._logProcess.on('error', (error) => {
				vscode.window.showErrorMessage('Failed to start logcat process: ' + error.message);
				this._isRunning = false;
			});
			
			this._logProcess.on('close', (code) => {
				if (code !== 0 && this._isRunning) {
					vscode.window.showWarningMessage(`Logcat process exited with code ${code}`);
				}
				this._isRunning = false;
			});
		} catch (error) {
			vscode.window.showErrorMessage('Error starting logcat: ' + (error instanceof Error ? error.message : String(error)));
			this._isRunning = false;
		}
	}

	private _stopLogcat() {
		this._isRunning = false;
		if (this._logProcess) {
			this._logProcess.kill();
			this._logProcess = undefined;
		}
	}

	private _clearLogs() {
		this._panel.webview.postMessage({ command: 'clearLogs' });
	}

	private _filterLogs(filter: string) {
		// The filtering is done in the WebView
		// This method could be extended to apply server-side filtering
		// by modifying the adb logcat command with filter parameters
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('android-logcat-viewer.show', () => {
			LogcatViewerPanel.createOrShow(context.extensionUri);
		})
	);
}

export function deactivate() {
	// Stop any running logcat process when the extension is deactivated
	if (LogcatViewerPanel.currentPanel) {
		LogcatViewerPanel.currentPanel.dispose();
	}
}
