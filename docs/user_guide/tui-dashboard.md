# TUI Dashboard

The terminal dashboard and its views. Part of the [Exaix User Guide](README.md).

## What the dashboard is

`exactl dashboard` opens the terminal user interface (TUI) of Exaix. It gives real-time monitoring, plan review, portal management and daemon control in one terminal window. It is the recommended cockpit for day-to-day operation. The command takes over the terminal until you quit it and prints no data of its own. See the generated [dashboard reference](../cli/dashboard.md).

## Views

The dashboard has seven views. Open one with the view picker (`p`), with `Tab`, or with its number key.

| Icon | View                | Description                              |
| ---- | ------------------- | ---------------------------------------- |
| 🌀   | **Portal Manager**  | Manage project portals and aliases       |
| 📋   | **Plan Reviewer**   | Review and approve agent-generated plans |
| 📊   | **Monitor**         | Real-time activity log streaming         |
| ⚙️   | **Daemon Control**  | Start, stop, and manage the daemon       |
| 🤖   | **Agent Status**    | Monitor agent health and activity        |
| 📥   | **Request Manager** | Track and manage requests                |
| 💾   | **Memory View**     | Browse and manage Memory Banks           |

Press `?` or `F1` in any view for the help overlay. Press `q` or `Esc` to quit. Every key of every view is in the [TUI Keyboard Reference](tui-keyboard-reference.md), which is the one list of keys. Vim-style movement keys work in lists.

## Typical workflow

1. Start the daemon from the Daemon Control view, or check that it already runs.
1. Add or refresh a portal in the Portal Manager.
1. Split the window with `v` or `h`. Show the Plan Reviewer in one pane and the Monitor in the other, so you can review a plan while you watch the logs.
1. In the Plan Reviewer, open a plan to read its diff. Approve it or reject it from the same view.
1. Watch the execution in the Monitor. Pause the stream and filter it when it moves too fast to read.
1. Check the Agent Status view if a run looks stuck.
1. Save the layout with `s` and restore it with `r` in the next session.

## Panes and layouts

Each pane shows one view. Split a pane vertically or horizontally, close it, zoom it to full size and resize it with `Ctrl` and the arrow keys. `L` opens a picker of preset layouts such as side-by-side, stacked and quad. A saved layout lives in `~/.exaix/tui_layout.json`. Press `d` to go back to the default single pane.

## Accessibility

- **High contrast mode:** Set `tui.high_contrast = true` in `exa.config.toml` for stronger colors.
- **Screen reader support:** Set `tui.screen_reader = true` for status announcements.
- **Keyboard only:** Every feature works without a mouse.

## Tips and troubleshooting

- **Dashboard fails to launch:** Check that your terminal supports ANSI escape codes and raw mode, and that your workspace is initialized.
- **Keys do not respond:** Check that the terminal has focus and is not in paste mode.
- **Layout does not save:** Check write permission on the `~/.exaix/` directory.
- **Colors look wrong:** Turn on high contrast mode or check the `$TERM` variable.
- **Plans need a decision elsewhere:** Pending items other than plans, such as wait states and tool confirmations, are decided with `exactl approval`. See [Security and Safety](security-and-safety.md#approvals).
