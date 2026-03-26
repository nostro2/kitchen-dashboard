# CLAUDE.md

## Project: Household Chores Dashboard

### Overview
Static, GitHub Pages–hosted dashboard driven entirely by YAML. No runtime state, no completion workflow. Tasks count down to their next due date and automatically roll forward when reached.

---

## Core Principles
- Static site only (GitHub Pages)
- YAML is the single source of truth
- No saved state, no completion/reset actions
- Minimal dependencies, clear logic
- Single shared dashboard

---

## Tech Stack
- Static HTML/CSS/JS
- Optional lightweight build step to transform YAML → JSON at build time

---

## Directory Structure
```text
/tasks
  *.yaml
/src
/public
CLAUDE.md
README.md
```

---

## Task Model

### Fields
```yaml
title: "Take bins out"
description: "Put bins out for collection"
room: "Outside"
assignee: "Shared"
priority: "high"
icon: "🗑️"

schedule:
  type: "weekly"
  interval: 1
  weekday: "wednesday"
```

Optional:
- start_date
- end_date
- tags

---

## Scheduling Rules

All tasks are schedule-driven and auto-roll forward. No cooldowns, no completion state.

### Weekly
```yaml
schedule:
  type: "weekly"
  interval: 1
  weekday: "wednesday"
```

### Bi-weekly / multi-week
```yaml
schedule:
  type: "weekly"
  interval: 2
  weekday: "wednesday"
  anchor_date: "2026-01-07"
```

### Monthly
```yaml
schedule:
  type: "monthly"
  interval: 1
  day: 1
```

---

## Alternating Tasks (Important)

Support alternating schedules where multiple tasks share the same interval but occur on alternating cycles.

### Example

```yaml
title: "Black bags, glass and cans"
schedule:
  type: "weekly"
  interval: 2
  weekday: "wednesday"
  anchor_date: "2026-01-07"
  group: "bins"
  phase: 0
```

```yaml
title: "Cardboard and plastic"
schedule:
  type: "weekly"
  interval: 2
  weekday: "wednesday"
  anchor_date: "2026-01-07"
  group: "bins"
  phase: 1
```

### Behavior
- Tasks in the same `group` share the same recurrence cycle
- `phase` determines which occurrence is active
- Only matching phase tasks appear in current cycle

---

## Visual Urgency System (Critical UI Requirement)

Each task must visually communicate how close it is to its due time using both color and a progress bar.

### Color progression
- Tasks transition from **cool → warm → hot** as they approach their due time
- Based on percentage of time elapsed in current cycle:
  - 0–50% → cool (blue/green)
  - 50–80% → warm (yellow/orange)
  - 80–100% → hot (red)
- After rollover, reset to cool

### Countdown progress bar
Each task must include a horizontal bar:

- Represents elapsed time toward next due date
- Starts empty at cycle start
- Fills progressively
- Reaches 100% at due moment
- Resets immediately after rollover

### Requirements
- Updates in real time
- Same calculation drives both color and bar
- Must be readable at a glance

---

## Time & Countdown
- Show: `Due in X`, `Due now`
- Auto-roll to next occurrence after due time

---

## UI Behavior
- Show all tasks
- Filters:
  - urgency
  - room
  - assignee

### Themes
- minimalist
- RPG/game
- cozy

---

## Interaction Rules
- No buttons
- No completion
- No persistence
- Read-only dashboard

---

## Error Handling
- Invalid YAML → skip + warn
- Invalid schedule → skip + explain

---

## GitHub Pages Requirements
- Fully static output
- Works on subpath

---

## Commands
```bash
npm install
npm run build
npm run dev
```

---

## Rules for Future Changes

### Do NOT
- add backend
- add saved state
- add completion logic

### Do
- keep YAML-driven
- keep static
- keep simple

---

## Design Philosophy
Simple, visual, deterministic household dashboard.

---

## What Claude Code Should Produce
- static site
- YAML examples
- parser
- deployment guide
