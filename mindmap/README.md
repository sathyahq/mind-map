# Mind Map

A personal, private mind mapping tool that runs locally and is accessed via browser.

## Setup

```bash
cd mindmap
npm install
```

## Run

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Create a new child node |
| `Enter` | Create a new sibling node |
| `Delete` / `Backspace` | Delete selected node |
| `F2` or start typing | Edit selected node's text |
| `Escape` | Deselect / cancel edit |
| `Arrow Up/Down` | Navigate between siblings |
| `Arrow Left` | Navigate to parent |
| `Arrow Right` | Navigate to first child |

## Features

- **Sidebar** — list, create, rename, delete maps
- **Canvas** — zoomable, pannable mind map with auto-layout
- **Breadcrumb navigation** — double-click a node to drill into its subtree
- **Cross-map linking** — right-click a node to link it to another map
- **SQLite storage** — all data in a single `mindmap.db` file
