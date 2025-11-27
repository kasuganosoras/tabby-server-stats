Tabby Server Stats Plugin

A plugin for [Tabby Terminal](https://github.com/Eugeny/tabby) that displays real-time server statistics (CPU, RAM, Disk, Network) when connected via SSH.

## Features
* Real-time Monitoring: Displays CPU usage, RAM usage, Disk usage, and Network upload/download speeds.
* Draggable Panel: You can drag the stats panel anywhere on the screen.
* Permanent Bottom Bar: Stats are displayed in a fixed bottom bar that's always visible.
* Customizable:
  * Change chart colors and opacity.
  * Switch between Vertical and Horizontal layouts.
  * Adjust chart size.
  * Position is saved automatically.
* Zero Dependency on Server: Uses standard Linux commands (`/proc/stat`, `free`, `df`, `/proc/net/dev`) via SSH channel. No agent installation required on the server.

## Installation
1. Open Tabby Settings.
2. Go to Plugins.
3. Search for `tabby-server-stats`.
4. Click Install.

## Usage
The stats will automatically appear when you connect to a Linux server via SSH.
You can toggle the visibility using the "Activity" icon in the toolbar.

## License
MIT