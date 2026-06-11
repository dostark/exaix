# TUI Keyboard Reference

Complete keyboard shortcut reference for the Exaix TUI Dashboard.

---

## Table of Contents

- [Global Keys](#global-keys)
- [Navigation Keys](#navigation-keys)
- [Search & Filter](#search--filter)
- [Split View / Panes](#split-view--panes)
- [View-Specific Keys](#view-specific-keys)
  - [Portal Manager](#portal-manager)
  - [Plan Reviewer](#plan-reviewer)
  - [Monitor View](#monitor-view)
  - [Request Manager](#request-manager)
  - [Agent Status](#agent-status)
  - [Daemon Control](#daemon-control)
  - [Memory View](#memory-view)
- [Accessibility](#accessibility)

---

## Global Keys

These keys work from any view in the dashboard.

| Key         | Action             | Description                           |
| ----------- | ------------------ | ------------------------------------- |
| `Tab`       | Next pane/view     | Cycle forward through views or panes  |
| `Shift+Tab` | Previous pane/view | Cycle backward through views or panes |
| `1`-`7`     | Jump to pane       | Direct jump to pane number            |
| `?` / `F1`  | Show help          | Display help overlay for current view |
| `R`         | Refresh            | Refresh current view data             |
| `n`         | Notifications      | Toggle notification panel             |
| `p`         | View picker        | Open view picker dialog               |
| `q` / `Esc` | Quit               | Exit dashboard (with confirmation)    |

---

## Navigation Keys

Standard navigation within views and lists.

| Key          | Action         | Description                      |
| ------------ | -------------- | -------------------------------- |
| `↑` / `k`    | Move up        | Move selection up one item       |
| `↓` / `j`    | Move down      | Move selection down one item     |
| `←` / `h`    | Collapse/back  | Collapse tree node or go back    |
| `→` / `l`    | Expand/enter   | Expand tree node or enter item   |
| `Home` / `g` | First item     | Jump to first item in list       |
| `End` / `G`  | Last item      | Jump to last item in list        |
| `Enter`      | Select/confirm | Select item or confirm action    |
| `Space`      | Toggle         | Toggle selection or pause/resume |
| `Page Up`    | Page up        | Scroll up one page               |
| `Page Down`  | Page down      | Scroll down one page             |

---

## Search & Filter

Search functionality within views.

| Key       | Action         | Description                    |
| --------- | -------------- | ------------------------------ |
| `s` / `/` | Start search   | Open search input              |
| `Enter`   | Execute search | Run the search query           |
| `Escape`  | Cancel search  | Close search and clear query   |
| `Ctrl+F`  | Find in view   | Alternative search shortcut    |
| `n`       | Next match     | Jump to next search result     |
| `N`       | Previous match | Jump to previous search result |

---

## Split View / Panes

Manage multiple panes and layouts.

| Key         | Action           | Description                         |
| ----------- | ---------------- | ----------------------------------- |
| `v`         | Split vertical   | Split current pane left/right       |
| `h`         | Split horizontal | Split current pane top/bottom       |
| `c`         | Close pane       | Close current pane                  |
| `z`         | Maximize/restore | Toggle pane zoom (maximize/restore) |
| `x`         | Swap panes       | Swap current pane with next         |
| `Tab`       | Next pane        | Focus next pane                     |
| `Shift+Tab` | Previous pane    | Focus previous pane                 |
| `s`         | Save layout      | Save current layout to file         |
| `r`         | Restore layout   | Restore saved layout                |
| `d`         | Default layout   | Reset to default single-pane layout |
| `L`         | Layout presets   | Open layout preset picker           |
| `Ctrl+←`    | Shrink width     | Reduce pane width                   |
| `Ctrl+→`    | Grow width       | Increase pane width                 |
| `Ctrl+↑`    | Shrink height    | Reduce pane height                  |
| `Ctrl+↓`    | Grow height      | Increase pane height                |

### Layout Presets

Quick layout shortcuts (available after pressing `L`):

| Key | Layout         | Description                 |
| --- | -------------- | --------------------------- |
| `1` | Single         | Single full-screen pane     |
| `2` | Side-by-side   | Two panes, vertical split   |
| `3` | Stacked        | Two panes, horizontal split |
| `4` | Quad           | Four equal panes            |
| `5` | Main + sidebar | Large left, small right     |
| `6` | Triple         | Three-pane layout           |

---

## View-Specific Keys

### Portal Manager

Manage project portals and aliases.

| Key     | Action         | Description                       |
| ------- | -------------- | --------------------------------- |
| `Enter` | Open portal    | Navigate into selected portal     |
| `a`     | Add portal     | Create new portal alias           |
| `d`     | Delete portal  | Remove portal (with confirmation) |
| `r`     | Refresh        | Refresh portal status             |
| `e`     | Edit portal    | Edit portal configuration         |
| `c`     | Copy path      | Copy portal path to clipboard     |
| `o`     | Open in editor | Open portal in external editor    |

### Plan Reviewer

Review and approve agent-generated plans.

| Key     | Action          | Description               |
| ------- | --------------- | ------------------------- |
| `a`     | Approve         | Approve selected plan     |
| `r`     | Reject          | Reject selected plan      |
| `A`     | Approve all     | Approve all pending plans |
| `R`     | Reject all      | Reject all pending plans  |
| `c`     | Comment         | Add comment to plan       |
| `d`     | View diff       | Show detailed diff view   |
| `v`     | View raw        | View raw plan content     |
| `f`     | Filter          | Filter plans by status    |
| `Enter` | Expand/collapse | Toggle plan details       |

### Monitor View

Real-time activity log streaming.

| Key     | Action         | Description                   |
| ------- | -------------- | ----------------------------- |
| `Space` | Pause/resume   | Pause or resume log streaming |
| `f`     | Filter         | Open filter dialog            |
| `t`     | Time filter    | Filter by time range          |
| `l`     | Level filter   | Filter by log level           |
| `a`     | Agent filter   | Filter by agent ID            |
| `b`     | Bookmark       | Bookmark current entry        |
| `B`     | View bookmarks | Show bookmarked entries       |
| `e`     | Export         | Export logs to file           |
| `c`     | Clear          | Clear log display             |
| `w`     | Wrap toggle    | Toggle line wrapping          |

### Request Manager

Track and manage requests.

| Key     | Action       | Description             |
| ------- | ------------ | ----------------------- |
| `c`     | Create       | Create new request      |
| `d`     | Delete       | Cancel/delete request   |
| `p`     | Priority     | Change request priority |
| `f`     | Filter       | Filter by status        |
| `t`     | Tags         | Filter by tags          |
| `v`     | View details | View request details    |
| `r`     | Retry        | Retry failed request    |
| `Enter` | Expand       | Expand request details  |

### Agent Status

Monitor agent health and activity.

| Key     | Action       | Description              |
| ------- | ------------ | ------------------------ |
| `l`     | View logs    | View agent logs          |
| `r`     | Restart      | Restart agent            |
| `s`     | Statistics   | View agent statistics    |
| `c`     | Config       | View agent configuration |
| `h`     | Health check | Run health check         |
| `Enter` | Details      | View agent details       |

### Daemon Control

Manage the Exaix daemon.

| Key     | Action  | Description                     |
| ------- | ------- | ------------------------------- |
| `s`     | Start   | Start daemon                    |
| `k`     | Stop    | Stop daemon (with confirmation) |
| `r`     | Restart | Restart daemon                  |
| `l`     | Logs    | View daemon logs                |
| `c`     | Config  | View daemon configuration       |
| `h`     | Health  | View health status              |
| `m`     | Metrics | View daemon metrics             |
| `Enter` | Details | View detailed status            |

### Memory View

Browse and manage Memory Banks.

| Key     | Action       | Description                      |
| ------- | ------------ | -------------------------------- |
| `g`     | Global       | Jump to Global Memory section    |
| `p`     | Projects     | Jump to Project Memory section   |
| `e`     | Executions   | Jump to Execution Memory section |
| `n`     | Pending      | Jump to Pending Learnings        |
| `a`     | Approve      | Approve pending learning         |
| `r`     | Reject       | Reject pending learning          |
| `A`     | Approve all  | Approve all pending learnings    |
| `P`     | Promote      | Promote learning to higher scope |
| `L`     | Add learning | Add new learning manually        |
| `s`     | Search       | Search memory content            |
| `Enter` | View         | View memory entry details        |

---

## Accessibility

Exaix TUI supports accessibility features for users with different needs.

### High Contrast Mode

Enable high contrast colors for better visibility:

- Press `?` to open help, then navigate to Settings
- Toggle "High Contrast" option
- Or set `tui.high_contrast = true` in `exa.config.toml`

### Screen Reader Support

Enable screen reader announcements:

- Set `tui.screen_reader = true` in `exa.config.toml`
- Status changes and navigation will be announced
- List items include ARIA-style descriptions

### Keyboard-Only Navigation

All features are accessible via keyboard:

- No mouse required for any operation
- Focus indicators show current selection
- Tab order follows logical flow

### Configuration

Add to `exa.config.toml`:

````toml
[tui]
high_contrast = false
screen_reader = false
theme = "dark"  # "dark", "light", or "system"
```text

---

## Quick Reference Card

```text
┌─────────────────────────────────────────────────────────────┐
│                  Exaix TUI Quick Reference               │
├─────────────────────────────────────────────────────────────┤
│  NAVIGATION          │  PANES              │  VIEWS         │
│  ↑↓ or jk = Move     │  v = Split vertical │  ? = Help      │
│  ←→ or hl = Expand   │  h = Split horiz.   │  n = Notifs    │
│  Tab = Next pane     │  c = Close pane     │  p = Picker    │
│  Enter = Select      │  z = Maximize       │  R = Refresh   │
│                      │  s = Save layout    │  q = Quit      │
├─────────────────────────────────────────────────────────────┤
│  PLAN REVIEWER       │  MONITOR            │  DAEMON        │
│  a = Approve         │  Space = Pause      │  s = Start     │
│  r = Reject          │  f = Filter         │  k = Stop      │
│  A = Approve all     │  b = Bookmark       │  r = Restart   │
│  c = Comment         │  e = Export         │  l = Logs      │
└─────────────────────────────────────────────────────────────┘
```text

---

## See Also

- [Exaix User Guide](./Exaix_User_Guide.md) - Complete user documentation
- [Exaix Architecture](./Exaix_Architecture.md) - Technical architecture details
- [Implementation Plan](./Exaix_Implementation_Plan.md) - Development roadmap
````
