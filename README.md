# Android Logcat Viewer for VS Code

A Visual Studio Code extension that provides a colored logcat output viewer for Android devices, similar to Android Studio's logcat viewer.

## Features

- View logcat output from connected Android devices with color-coding
- Filter log messages by tag, level, or message content
- Auto-scroll option to follow new log entries
- Clear log view
- Multiple device support

## Requirements

- Android Debug Bridge (ADB) must be installed and available in the system PATH
- Android device connected via USB with USB debugging enabled, or an Android emulator running

## Usage

1. Connect your Android device via USB or start an Android emulator
2. In VS Code, open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS)
3. Type "Show Android Logcat" and select the command
4. Select your device from the dropdown
5. Click "Start" to begin viewing logs

## Log Colors

Logs are color-coded by priority level, similar to Android Studio:
- Verbose (V): Gray
- Debug (D): Teal
- Info (I): Blue
- Warning (W): Orange
- Error (E): Red
- Fatal (F): Black text on red background

## Filtering

Use the filter input box to filter log messages. You can filter by:
- Text content (just type the text to search for)
- Tag (e.g., type "tag:MyTag" to show only logs with the "MyTag" tag)
- Log level (e.g., type "level:E" to show only Error logs)

## License

This extension is licensed under the MIT License.
