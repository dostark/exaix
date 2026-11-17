# TUI Dashboard

The terminal dashboard and its views. Part of the [Exaix User Guide](README.md).

## Working with the TUI Dashboard

Exaix provides a powerful Terminal User Interface (TUI) dashboard for real-time monitoring, plan review, portal management, and daemon control—all from your terminal. The TUI dashboard is the recommended cockpit for day-to-day operations.

### Launching the Dashboard

To start the dashboard, run:

```bash
exactl dashboard
```

For help and available options:

```bash
exactl dashboard --help
```

### Dashboard Views

The dashboard includes 7 integrated views, each accessible via the view picker (`p`) or `Tab` navigation:

| Icon | View                | Description                              |
| ---- | ------------------- | ---------------------------------------- |
| 🌀   | **Portal Manager**  | Manage project portals and aliases       |
| 📋   | **Plan Reviewer**   | Review and approve agent-generated plans |
| 📊   | **Monitor**         | Real-time activity log streaming         |
| ⚙️   | **Daemon Control**  | Start, stop, and manage the daemon       |
| 🤖   | **Agent Status**    | Monitor agent health and activity        |
| 📥   | **Request Manager** | Track and manage requests                |
| 💾   | **Memory View**     | Browse and manage Memory Banks           |

### Key Features

- **Multi-Pane Split View:** Run multiple views side-by-side
- **Real-time Log Streaming:** Filter and search Activity Journal logs
- **Plan Approval Workflow:** Review diffs and approve/reject plans
- **Portal Management:** Add, remove, refresh, and configure portals
- **Daemon Control:** Full lifecycle management from the TUI
- **Notification System:** Alerts for important events
- **Layout Persistence:** Save and restore your preferred layouts
- **Keyboard-First Navigation:** Vim-style keys supported
- **Accessibility:** High contrast mode and screen reader support

### Global Navigation

| Key                 | Action                     |
| ------------------- | -------------------------- |
| `Tab` / `Shift+Tab` | Switch between panes/views |
| `1`-`7`             | Jump directly to pane      |
| `?` / `F1`          | Show help overlay          |
| `p`                 | Open view picker           |
| `n`                 | Toggle notification panel  |
| `R`                 | Refresh current view       |
| `q` / `Esc`         | Quit dashboard             |

### Split View (Multi-Pane Mode)

The dashboard supports multiple panes for side-by-side view comparison:

| Key | Action                               |
| --- | ------------------------------------ |
| `v` | Split pane vertically (left/right)   |
| `h` | Split pane horizontally (top/bottom) |
| `c` | Close current pane                   |
| `z` | Maximize/restore pane (zoom)         |
| `s` | Save current layout                  |
| `r` | Restore saved layout                 |
| `d` | Reset to default layout              |

**Layout Persistence:** Press `s` to save your layout, `r` to restore it later. Layouts are saved to `~/.exaix/tui_layout.json`.

### Using the Dashboard

- **Navigation:** Use `Tab` or arrow keys to switch between panes. Use `↑↓` or `jk` within lists.
- **Split View:** Press `v` for vertical split or `h` for horizontal. Each pane can display a different view.
- **Plan Approval:** In the Plan Reviewer, press `a` to approve or `r` to reject. Use `Enter` to view details.
- **Log Monitoring:** The Monitor streams logs in real time. Press `Space` to pause, `f` to filter.
- **Portal Management:** Add (`a`), delete (`d`), or refresh (`r`) portals from the Portal Manager.
- **Daemon Control:** Press `s` to start, `k` to stop, `r` to restart the daemon.

### Example Workflow

```bash
# 1. Launch the dashboard
exactl dashboard

# 2. Split the view to see Plans and Monitor side-by-side
#    Press 'v' to split, then 'p' to pick a view

# 3. Navigate to Plan Reviewer (Tab or number key)
# 4. Review and approve a plan (Enter to view, 'a' to approve)
# 5. Watch execution logs in Monitor pane
# 6. Check agent status in Agent Status view
# 7. Save your layout for next time (press 's')
```

### Accessibility Features

Exaix TUI includes accessibility support:

- **High Contrast Mode:** Enhanced colors for visibility. Set `tui.high_contrast = true` in config.
- **Screen Reader Support:** Status announcements. Set `tui.screen_reader = true`.
- **Keyboard-Only:** All features accessible without mouse.

### Troubleshooting

- **Dashboard fails to launch:** Ensure your terminal supports ANSI escape codes and raw mode.
- **Keys not responding:** Check that your terminal is in focus and not in paste mode.
- **Layout not saving:** Verify write permissions to `~/.exaix/` directory.
- **Colors look wrong:** Try toggling high contrast mode or check `$TERM` environment variable.

For complete keyboard shortcuts, see [TUI Keyboard Reference](../TUI_Keyboard_Reference.md).

For technical details, see the [Implementation Plan](../../exaix-dev-docs/planning/phase-09-ux-improvement.md#step-93-tui-cockpit-implementation-plan).

## **Dashboard Command** - Terminal UI Cockpit

**Split View (Multi-Pane) Mode:**

- Press `s` or use the on-screen menu to split the dashboard into two or more panes.
- Each pane can show a different view (e.g., Monitor + Plans, Plans + Portals).
- Resize panes with `Ctrl+Arrow` keys. Switch focus with `Tab`.
- Preset layouts (vertical/horizontal) available in the settings panel (`?`).
- Example: Review a plan in one pane while watching logs in another.

The `exactl dashboard` command launches the interactive Terminal User Interface (TUI) cockpit for Exaix. This dashboard provides real-time monitoring, plan review, portal management, and daemon control—all from your terminal.

```bash
# Launch the TUI dashboard
exactl dashboard

# See help and options
exactl dashboard --help
```

**Features:**

- Real-time log streaming and filtering
- Review and approve/reject plans with diff view
- Manage portals (add, remove, refresh, view status)
- Control daemon (start, stop, restart, view status)
- View agent health and activity
- Keyboard navigation, theming, and notifications

**Example workflow:**

```bash
# 1. Launch the dashboard
$ exactl dashboard

# 2. Navigate between Monitor, Plans, Portals, Daemon, and Agents views
#    (use Tab/Arrow keys, see on-screen help)

# 3. Approve a plan from the Plan Reviewer view
# 4. Watch logs in real time in the Monitor view
# 5. Add or refresh a portal in the Portal Manager
# 6. Start/stop the daemon from the Daemon Control view
```

**Troubleshooting:**

- If the dashboard fails to launch, ensure your terminal supports ANSI escape codes and your workspace is initialized.
- For accessibility or theming issues, see the dashboard settings panel (press `?` in the TUI).

See the [Implementation Plan](../../exaix-dev-docs/planning/phase-09-ux-improvement.md#step-93-tui-cockpit-implementation-plan) for technical details and roadmap.

Exaix CLI is organized into ten main command groups:
