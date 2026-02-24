const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Setup ---

const db = new Database(path.join(__dirname, 'mindmap.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    parent_id INTEGER,
    text TEXT NOT NULL DEFAULT 'New Node',
    position_order INTEGER NOT NULL DEFAULT 0,
    linked_map_id INTEGER,
    FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_map_id) REFERENCES maps(id) ON DELETE SET NULL
  );
`);

// --- Map Endpoints ---

app.get('/api/maps', (req, res) => {
  const maps = db.prepare('SELECT * FROM maps ORDER BY created_at DESC').all();
  res.json(maps);
});

app.post('/api/maps', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Map name is required' });
  }

  const insertMap = db.prepare('INSERT INTO maps (name) VALUES (?)');
  const insertNode = db.prepare('INSERT INTO nodes (map_id, parent_id, text, position_order) VALUES (?, NULL, ?, 0)');

  const txn = db.transaction(() => {
    const mapResult = insertMap.run(name.trim());
    insertNode.run(mapResult.lastInsertRowid, name.trim());
    return mapResult.lastInsertRowid;
  });

  const mapId = txn();
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
  res.status(201).json(map);
});

app.put('/api/maps/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Map name is required' });
  }

  const result = db.prepare('UPDATE maps SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Map not found' });
  }

  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  res.json(map);
});

app.delete('/api/maps/:id', (req, res) => {
  const result = db.prepare('DELETE FROM maps WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Map not found' });
  }
  res.json({ success: true });
});

// --- Node Endpoints ---

app.get('/api/maps/:id/nodes', (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    return res.status(404).json({ error: 'Map not found' });
  }

  const nodes = db.prepare('SELECT * FROM nodes WHERE map_id = ? ORDER BY position_order').all(req.params.id);
  res.json(nodes);
});

app.post('/api/maps/:id/nodes', (req, res) => {
  const { parent_id, text } = req.body;
  const mapId = req.params.id;

  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
  if (!map) {
    return res.status(404).json({ error: 'Map not found' });
  }

  if (parent_id != null) {
    const parent = db.prepare('SELECT * FROM nodes WHERE id = ? AND map_id = ?').get(parent_id, mapId);
    if (!parent) {
      return res.status(400).json({ error: 'Parent node not found in this map' });
    }
  }

  // Get next position_order among siblings
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(position_order), -1) as max_order FROM nodes WHERE map_id = ? AND parent_id IS ?'
  ).get(mapId, parent_id || null);

  const result = db.prepare(
    'INSERT INTO nodes (map_id, parent_id, text, position_order) VALUES (?, ?, ?, ?)'
  ).run(mapId, parent_id || null, text || 'New Node', (maxOrder.max_order + 1));

  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(node);
});

app.put('/api/nodes/:id', (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) {
    return res.status(404).json({ error: 'Node not found' });
  }

  const { text, linked_map_id, position_order, parent_id } = req.body;

  const updates = [];
  const values = [];

  if (text !== undefined) {
    updates.push('text = ?');
    values.push(text);
  }
  if (linked_map_id !== undefined) {
    updates.push('linked_map_id = ?');
    values.push(linked_map_id);
  }
  if (position_order !== undefined) {
    updates.push('position_order = ?');
    values.push(position_order);
  }
  if (parent_id !== undefined) {
    updates.push('parent_id = ?');
    values.push(parent_id);
  }

  if (updates.length === 0) {
    return res.json(node);
  }

  values.push(req.params.id);
  db.prepare(`UPDATE nodes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/nodes/:id', (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) {
    return res.status(404).json({ error: 'Node not found' });
  }

  // Don't allow deleting the root node
  if (node.parent_id === null) {
    return res.status(400).json({ error: 'Cannot delete the root node' });
  }

  // CASCADE will handle children
  db.prepare('DELETE FROM nodes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Reorder siblings endpoint
app.put('/api/nodes/:id/reorder', (req, res) => {
  const { new_position } = req.body;
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) {
    return res.status(404).json({ error: 'Node not found' });
  }

  const siblings = db.prepare(
    'SELECT * FROM nodes WHERE map_id = ? AND parent_id IS ? ORDER BY position_order'
  ).all(node.map_id, node.parent_id);

  const filtered = siblings.filter(s => s.id !== node.id);
  const clamped = Math.max(0, Math.min(new_position, filtered.length));
  filtered.splice(clamped, 0, node);

  const updateOrder = db.prepare('UPDATE nodes SET position_order = ? WHERE id = ?');
  const txn = db.transaction(() => {
    filtered.forEach((s, i) => updateOrder.run(i, s.id));
  });
  txn();

  res.json({ success: true });
});

// --- Start ---

app.listen(PORT, () => {
  console.log(`Mind Map running at http://localhost:${PORT}`);
});
