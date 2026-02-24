// === Branch Colors (XMind-inspired) ===
const BRANCH_COLORS = [
  { node: '#6366f1', bg: '#e0e7ff', edge: '#6366f1' }, // indigo
  { node: '#22c55e', bg: '#dcfce7', edge: '#22c55e' }, // green
  { node: '#f97316', bg: '#ffedd5', edge: '#f97316' }, // orange
  { node: '#ec4899', bg: '#fce7f3', edge: '#ec4899' }, // pink
  { node: '#8b5cf6', bg: '#f3e8ff', edge: '#8b5cf6' }, // purple
  { node: '#14b8a6', bg: '#ccfbf1', edge: '#14b8a6' }, // teal
  { node: '#ef4444', bg: '#fee2e2', edge: '#ef4444' }, // red
  { node: '#0ea5e9', bg: '#e0f2fe', edge: '#0ea5e9' }, // sky
  { node: '#eab308', bg: '#fef9c3', edge: '#eab308' }, // yellow
  { node: '#06b6d4', bg: '#cffafe', edge: '#06b6d4' }, // cyan
];

// === State ===
let cy = null;
let allMaps = [];
let currentMapId = null;
let currentNodes = [];
let selectedNodeId = null;
let drillPath = [];
let editingNodeId = null;
let contextNodeId = null;
let branchColorMap = {}; // nodeId -> color index

// === DOM References ===
const mapListEl = document.getElementById('map-list');
const breadcrumbsEl = document.getElementById('breadcrumbs');
const cyEl = document.getElementById('cy');
const emptyStateEl = document.getElementById('empty-state');
const nodeEditorEl = document.getElementById('node-editor');
const contextMenuEl = document.getElementById('context-menu');
const mapPickerOverlay = document.getElementById('map-picker-overlay');
const mapPickerList = document.getElementById('map-picker-list');

// Toolbar
const tbAddChild = document.getElementById('tb-add-child');
const tbAddSibling = document.getElementById('tb-add-sibling');
const tbEdit = document.getElementById('tb-edit');
const tbDelete = document.getElementById('tb-delete');
const tbFit = document.getElementById('tb-fit');

// Zoom
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomLevelEl = document.getElementById('zoom-level');

// === API Helpers ===
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// === Branch Color Assignment ===
function assignBranchColors(nodes) {
  branchColorMap = {};
  const root = nodes.find(n => n.parent_id === null);
  if (!root) return;

  // Root gets special treatment (no branch color index)
  branchColorMap[root.id] = -1;

  // Direct children of root each get a unique color
  const topBranches = nodes
    .filter(n => n.parent_id === root.id)
    .sort((a, b) => a.position_order - b.position_order);

  topBranches.forEach((branch, i) => {
    const colorIdx = i % BRANCH_COLORS.length;
    branchColorMap[branch.id] = colorIdx;
    // Propagate to all descendants
    propagateColor(nodes, branch.id, colorIdx);
  });
}

function propagateColor(nodes, parentId, colorIdx) {
  const children = nodes.filter(n => n.parent_id === parentId);
  children.forEach(child => {
    branchColorMap[child.id] = colorIdx;
    propagateColor(nodes, child.id, colorIdx);
  });
}

function getNodeColor(nodeId) {
  const idx = branchColorMap[nodeId];
  if (idx === undefined || idx === -1) return null;
  return BRANCH_COLORS[idx];
}

// === Cytoscape Setup ===
function initCytoscape() {
  cy = cytoscape({
    container: cyEl,
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'text-wrap': 'wrap',
          'text-max-width': '150px',
          'font-size': '13px',
          'font-family': 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
          'font-weight': 500,
          'text-valign': 'center',
          'text-halign': 'center',
          'background-color': 'data(bgColor)',
          'border-width': 2.5,
          'border-color': 'data(borderColor)',
          'shape': 'roundrectangle',
          'width': 'label',
          'height': 'label',
          'padding': '14px',
          'color': 'data(textColor)',
          'shadow-blur': 12,
          'shadow-color': 'rgba(0,0,0,0.06)',
          'shadow-offset-x': 0,
          'shadow-offset-y': 3,
          'shadow-opacity': 1,
          'min-width': '60px',
          'min-height': '30px',
          'transition-property': 'border-color, border-width, shadow-blur, shadow-color, background-color',
          'transition-duration': '0.15s',
        }
      },
      {
        selector: 'node.root',
        style: {
          'shape': 'roundrectangle',
          'border-width': 3,
          'border-color': '#6366f1',
          'background-color': '#e0e7ff',
          'font-weight': 'bold',
          'font-size': '16px',
          'padding': '20px',
          'color': '#3730a3',
          'shadow-blur': 20,
          'shadow-color': 'rgba(99, 102, 241, 0.15)',
        }
      },
      {
        selector: 'node.linked',
        style: {
          'border-style': 'dashed',
        }
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 3.5,
          'shadow-blur': 24,
          'shadow-opacity': 1,
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 3,
          'line-color': 'data(color)',
          'curve-style': 'unbundled-bezier',
          'target-arrow-shape': 'none',
          'control-point-distances': [50],
          'control-point-weights': [0.5],
          'opacity': 0.7,
        }
      },
    ],
    layout: { name: 'preset' },
    minZoom: 0.15,
    maxZoom: 3,
    wheelSensitivity: 0.3,
    boxSelectionEnabled: false,
    autounselectify: false,
  });

  // --- Events ---
  cy.on('tap', 'node', onNodeTap);
  cy.on('dbltap', 'node', onNodeDoubleTap);
  cy.on('cxttap', 'node', onNodeRightClick);
  cy.on('tap', function (e) {
    if (e.target === cy) {
      deselectNode();
      hideContextMenu();
    }
  });
  cy.on('free', 'node', onNodeDragEnd);

  // Update zoom level display
  cy.on('zoom', () => {
    const z = Math.round(cy.zoom() * 100);
    zoomLevelEl.textContent = z + '%';
  });
}

// === Render Map on Canvas ===
function renderMap(nodes) {
  if (!cy) initCytoscape();
  cy.elements().remove();

  if (!nodes || nodes.length === 0) return;

  // Assign branch colors
  assignBranchColors(nodes);

  // Determine visible nodes based on drill path
  const drillNodeId = drillPath.length > 0 ? drillPath[drillPath.length - 1] : null;
  const visibleNodes = drillNodeId ? getSubtree(nodes, drillNodeId) : nodes;

  // Root of visible tree
  const visibleRoot = drillNodeId || nodes.find(n => n.parent_id === null)?.id;

  // Add nodes
  visibleNodes.forEach(n => {
    const classes = [];
    if (n.id === visibleRoot) classes.push('root');
    if (n.linked_map_id) classes.push('linked');

    let label = n.text;
    if (n.linked_map_id) label = n.text + ' \u2197';

    // Color based on branch
    const color = getNodeColor(n.id);
    let bgColor = '#ffffff';
    let borderColor = '#d1d5db';
    let textColor = '#1e293b';

    if (n.id === visibleRoot) {
      bgColor = '#e0e7ff';
      borderColor = '#6366f1';
      textColor = '#3730a3';
    } else if (color) {
      bgColor = color.bg;
      borderColor = color.node;
      textColor = darkenColor(color.node);
    }

    cy.add({
      group: 'nodes',
      data: {
        id: 'n' + n.id,
        label: label,
        nodeId: n.id,
        bgColor,
        borderColor,
        textColor,
      },
      classes: classes.join(' '),
    });
  });

  // Add edges
  visibleNodes.forEach(n => {
    if (n.parent_id !== null && visibleNodes.some(v => v.id === n.parent_id)) {
      const color = getNodeColor(n.id);
      cy.add({
        group: 'edges',
        data: {
          source: 'n' + n.parent_id,
          target: 'n' + n.id,
          color: color ? color.edge : '#d1d5db',
        },
      });
    }
  });

  runLayout();

  // Re-select if needed
  if (selectedNodeId) {
    const cyNode = cy.$('#n' + selectedNodeId);
    if (cyNode.length > 0) cyNode.select();
  }

  updateToolbar();
}

function darkenColor(hex) {
  // Return a darker shade for text
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const factor = 0.45;
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

function getSubtree(nodes, rootId) {
  const nodeMap = {};
  nodes.forEach(n => nodeMap[n.id] = n);

  const result = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    const node = nodeMap[id];
    if (node) {
      result.push(node);
      nodes.filter(n => n.parent_id === id).forEach(child => queue.push(child.id));
    }
  }
  return result;
}

function runLayout() {
  if (cy.nodes().length === 0) return;

  cy.layout({
    name: 'dagre',
    rankDir: 'LR',
    spacingFactor: 1.5,
    nodeSep: 40,
    rankSep: 100,
    animate: true,
    animationDuration: 350,
    animationEasing: 'ease-in-out-cubic',
    fit: true,
    padding: 80,
  }).run();
}

// === Toolbar State ===
function updateToolbar() {
  const hasSelection = selectedNodeId !== null;
  const node = hasSelection ? currentNodes.find(n => n.id === selectedNodeId) : null;
  const isRoot = node && node.parent_id === null;

  tbAddChild.disabled = !hasSelection;
  tbAddSibling.disabled = !hasSelection || isRoot;
  tbEdit.disabled = !hasSelection;
  tbDelete.disabled = !hasSelection || isRoot;
}

// Toolbar events
tbAddChild.addEventListener('click', () => {
  if (selectedNodeId) addChildNode(selectedNodeId);
});
tbAddSibling.addEventListener('click', () => {
  if (selectedNodeId) addSiblingNode(selectedNodeId);
});
tbEdit.addEventListener('click', () => {
  if (selectedNodeId) startEditNode(selectedNodeId);
});
tbDelete.addEventListener('click', () => {
  if (selectedNodeId) deleteNode(selectedNodeId);
});
tbFit.addEventListener('click', () => {
  if (cy) cy.fit(undefined, 80);
});

// Zoom controls
zoomInBtn.addEventListener('click', () => {
  if (cy) {
    const newZoom = Math.min(cy.zoom() * 1.25, 3);
    cy.animate({ zoom: { level: newZoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }, duration: 200 });
  }
});
zoomOutBtn.addEventListener('click', () => {
  if (cy) {
    const newZoom = Math.max(cy.zoom() / 1.25, 0.15);
    cy.animate({ zoom: { level: newZoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }, duration: 200 });
  }
});

// === Sidebar ===
async function loadMaps() {
  allMaps = await api('GET', '/maps');
  renderSidebar();
}

function renderSidebar() {
  mapListEl.innerHTML = '';
  allMaps.forEach(map => {
    const li = document.createElement('li');
    if (map.id === currentMapId) li.classList.add('active');

    li.innerHTML = `
      <span class="map-name">${escapeHtml(map.name)}</span>
      <div class="map-actions">
        <button class="btn-rename" title="Rename">&#9998;</button>
        <button class="btn-delete" title="Delete">&#10005;</button>
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.map-actions')) return;
      openMap(map.id);
    });

    const nameEl = li.querySelector('.map-name');

    li.querySelector('.btn-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameMap(map, nameEl);
    });

    li.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteMap(map);
    });

    mapListEl.appendChild(li);
  });
}

async function createMap() {
  const name = prompt('Map name:');
  if (!name || !name.trim()) return;
  const map = await api('POST', '/maps', { name: name.trim() });
  await loadMaps();
  openMap(map.id);
}

function startRenameMap(map, nameEl) {
  nameEl.contentEditable = 'true';
  nameEl.focus();

  const range = document.createRange();
  range.selectNodeContents(nameEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const finish = async () => {
    nameEl.contentEditable = 'false';
    const newName = nameEl.textContent.trim();
    if (newName && newName !== map.name) {
      await api('PUT', '/maps/' + map.id, { name: newName });
      await loadMaps();
    } else {
      nameEl.textContent = map.name;
    }
  };

  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = map.name; nameEl.blur(); }
  }, { once: false });

  nameEl.addEventListener('blur', finish, { once: true });
}

async function deleteMap(map) {
  if (!confirm(`Delete "${map.name}"? This cannot be undone.`)) return;
  await api('DELETE', '/maps/' + map.id);
  if (currentMapId === map.id) {
    currentMapId = null;
    currentNodes = [];
    drillPath = [];
    if (cy) cy.elements().remove();
    emptyStateEl.classList.remove('hidden');
    renderBreadcrumbs();
    updateToolbar();
  }
  await loadMaps();
}

// === Open Map ===
async function openMap(mapId) {
  currentMapId = mapId;
  drillPath = [];
  selectedNodeId = null;
  emptyStateEl.classList.add('hidden');

  currentNodes = await api('GET', '/maps/' + mapId + '/nodes');
  renderSidebar();
  renderBreadcrumbs();
  renderMap(currentNodes);
}

// === Breadcrumbs ===
function renderBreadcrumbs() {
  breadcrumbsEl.innerHTML = '';
  if (!currentMapId || currentNodes.length === 0) return;

  const root = currentNodes.find(n => n.parent_id === null);
  if (!root) return;

  const path = [root];
  for (const nodeId of drillPath) {
    const node = currentNodes.find(n => n.id === nodeId);
    if (node) path.push(node);
  }

  path.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'separator';
      sep.textContent = ' \u203A ';
      breadcrumbsEl.appendChild(sep);
    }

    const crumb = document.createElement('span');
    crumb.className = 'crumb';
    crumb.textContent = node.text;

    if (i === path.length - 1) {
      crumb.classList.add('current');
    } else {
      crumb.addEventListener('click', () => {
        if (i === 0) {
          drillPath = [];
        } else {
          drillPath = drillPath.slice(0, i);
        }
        renderBreadcrumbs();
        renderMap(currentNodes);
      });
    }

    breadcrumbsEl.appendChild(crumb);
  });
}

// === Node Events ===
function onNodeTap(e) {
  hideContextMenu();
  const nodeId = e.target.data('nodeId');
  selectedNodeId = nodeId;
  updateToolbar();
}

function onNodeDoubleTap(e) {
  const nodeId = e.target.data('nodeId');
  const node = currentNodes.find(n => n.id === nodeId);
  if (!node) return;

  if (node.linked_map_id) {
    openMap(node.linked_map_id);
    return;
  }

  if (currentNodes.some(n => n.parent_id === nodeId)) {
    const root = currentNodes.find(n => n.parent_id === null);
    if (nodeId === root?.id && drillPath.length === 0) return;

    const pathToNode = getPathToNode(nodeId);
    if (pathToNode.length > 1) {
      drillPath = pathToNode.slice(1);
    } else {
      drillPath = [];
    }
    renderBreadcrumbs();
    renderMap(currentNodes);
  }
}

function getPathToNode(nodeId) {
  const path = [];
  let current = currentNodes.find(n => n.id === nodeId);
  while (current) {
    path.unshift(current.id);
    current = current.parent_id ? currentNodes.find(n => n.id === current.parent_id) : null;
  }
  return path;
}

function onNodeRightClick(e) {
  e.originalEvent.preventDefault();
  contextNodeId = e.target.data('nodeId');

  const node = currentNodes.find(n => n.id === contextNodeId);
  const isRoot = node && node.parent_id === null;

  // Show/hide items based on context
  const removeLink = contextMenuEl.querySelector('[data-action="remove-link"]');
  removeLink.style.display = node?.linked_map_id ? 'flex' : 'none';

  const deleteItem = contextMenuEl.querySelector('[data-action="delete-node"]');
  deleteItem.style.display = isRoot ? 'none' : 'flex';

  const addSibling = contextMenuEl.querySelector('[data-action="add-sibling"]');
  addSibling.style.display = isRoot ? 'none' : 'flex';

  const pos = e.renderedPosition || e.position;
  const rect = cyEl.getBoundingClientRect();
  contextMenuEl.style.left = (rect.left + pos.x) + 'px';
  contextMenuEl.style.top = (rect.top + pos.y) + 'px';
  contextMenuEl.style.display = 'block';
}

function hideContextMenu() {
  contextMenuEl.style.display = 'none';
  contextNodeId = null;
}

// Context menu actions
contextMenuEl.addEventListener('click', async (e) => {
  const item = e.target.closest('.ctx-item');
  if (!item) return;
  const action = item.dataset.action;
  if (!action || !contextNodeId) return;

  const nodeId = contextNodeId;
  const node = currentNodes.find(n => n.id === nodeId);
  hideContextMenu();

  if (action === 'add-child') {
    addChildNode(nodeId);
  } else if (action === 'add-sibling') {
    if (node && node.parent_id) addSiblingNode(nodeId);
  } else if (action === 'edit-node') {
    startEditNode(nodeId);
  } else if (action === 'link-to-map') {
    showMapPicker(nodeId);
  } else if (action === 'remove-link') {
    await api('PUT', '/nodes/' + nodeId, { linked_map_id: null });
    await refreshCurrentMap();
  } else if (action === 'create-linked-map') {
    const newMap = await api('POST', '/maps', { name: node.text });
    await api('PUT', '/nodes/' + nodeId, { linked_map_id: newMap.id });
    await loadMaps();
    await refreshCurrentMap();
  } else if (action === 'delete-node') {
    deleteNode(nodeId);
  }
});

// Map picker
function showMapPicker(nodeId) {
  mapPickerList.innerHTML = '';
  allMaps.forEach(map => {
    if (map.id === currentMapId) return;
    const li = document.createElement('li');
    li.textContent = map.name;
    li.addEventListener('click', async () => {
      await api('PUT', '/nodes/' + nodeId, { linked_map_id: map.id });
      mapPickerOverlay.classList.remove('visible');
      await refreshCurrentMap();
    });
    mapPickerList.appendChild(li);
  });
  mapPickerOverlay.classList.add('visible');
}

document.getElementById('map-picker-cancel').addEventListener('click', () => {
  mapPickerOverlay.classList.remove('visible');
});

mapPickerOverlay.addEventListener('click', (e) => {
  if (e.target === mapPickerOverlay) {
    mapPickerOverlay.classList.remove('visible');
  }
});

// === Inline Editing ===
function startEditNode(nodeId) {
  const cyNode = cy.$('#n' + nodeId);
  if (cyNode.length === 0) return;

  const node = currentNodes.find(n => n.id === nodeId);
  if (!node) return;

  editingNodeId = nodeId;
  const pos = cyNode.renderedPosition();
  const bb = cyNode.renderedBoundingBox();
  const containerRect = cyEl.getBoundingClientRect();

  nodeEditorEl.style.display = 'block';
  nodeEditorEl.style.left = (containerRect.left + pos.x - (bb.w / 2)) + 'px';
  nodeEditorEl.style.top = (containerRect.top + pos.y - 14) + 'px';
  nodeEditorEl.style.width = Math.max(bb.w + 20, 120) + 'px';
  nodeEditorEl.value = node.text;
  nodeEditorEl.focus();
  nodeEditorEl.select();
}

nodeEditorEl.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    await finishEdit();
  } else if (e.key === 'Escape') {
    cancelEdit();
  }
});

nodeEditorEl.addEventListener('blur', () => {
  if (editingNodeId !== null) {
    finishEdit();
  }
});

async function finishEdit() {
  if (editingNodeId === null) return;
  const text = nodeEditorEl.value.trim();
  const nodeId = editingNodeId;
  editingNodeId = null;
  nodeEditorEl.style.display = 'none';

  if (text) {
    await api('PUT', '/nodes/' + nodeId, { text });
    await refreshCurrentMap();
    selectedNodeId = nodeId;
    const cyNode = cy.$('#n' + nodeId);
    if (cyNode.length > 0) cyNode.select();
  }
}

function cancelEdit() {
  editingNodeId = null;
  nodeEditorEl.style.display = 'none';
  cyEl.focus();
}

// === Node CRUD ===
async function addChildNode(parentId) {
  if (!currentMapId) return;
  const newNode = await api('POST', '/maps/' + currentMapId + '/nodes', {
    parent_id: parentId,
    text: 'New Node',
  });
  await refreshCurrentMap();
  selectedNodeId = newNode.id;
  const cyNode = cy.$('#n' + newNode.id);
  if (cyNode.length > 0) cyNode.select();
  startEditNode(newNode.id);
}

async function addSiblingNode(nodeId) {
  const node = currentNodes.find(n => n.id === nodeId);
  if (!node || !node.parent_id) return;
  const newNode = await api('POST', '/maps/' + currentMapId + '/nodes', {
    parent_id: node.parent_id,
    text: 'New Node',
  });
  await refreshCurrentMap();
  selectedNodeId = newNode.id;
  const cyNode = cy.$('#n' + newNode.id);
  if (cyNode.length > 0) cyNode.select();
  startEditNode(newNode.id);
}

async function deleteNode(nodeId) {
  const node = currentNodes.find(n => n.id === nodeId);
  if (!node || !node.parent_id) return;

  const children = currentNodes.filter(n => n.parent_id === nodeId);
  if (children.length > 0) {
    if (!confirm(`Delete this node and its ${children.length} child(ren)?`)) return;
  }

  const parentId = node.parent_id;
  await api('DELETE', '/nodes/' + nodeId);

  const drillIdx = drillPath.indexOf(nodeId);
  if (drillIdx >= 0) {
    drillPath = drillPath.slice(0, drillIdx);
    renderBreadcrumbs();
  }

  await refreshCurrentMap();

  selectedNodeId = parentId;
  const cyNode = cy.$('#n' + parentId);
  if (cyNode.length > 0) cyNode.select();
  updateToolbar();
}

async function refreshCurrentMap() {
  if (!currentMapId) return;
  currentNodes = await api('GET', '/maps/' + currentMapId + '/nodes');
  renderMap(currentNodes);
  renderBreadcrumbs();
}

// === Keyboard Shortcuts ===
document.addEventListener('keydown', (e) => {
  if (editingNodeId !== null) return;
  if (e.target.tagName === 'INPUT' || e.target.isContentEditable) return;

  if (!selectedNodeId || !currentMapId) return;

  const node = currentNodes.find(n => n.id === selectedNodeId);
  if (!node) return;

  switch (e.key) {
    case 'Tab': {
      e.preventDefault();
      addChildNode(selectedNodeId);
      break;
    }
    case 'Enter': {
      e.preventDefault();
      if (node.parent_id) {
        addSiblingNode(selectedNodeId);
      }
      break;
    }
    case 'Delete':
    case 'Backspace': {
      if (node.parent_id) {
        e.preventDefault();
        deleteNode(selectedNodeId);
      }
      break;
    }
    case 'F2': {
      e.preventDefault();
      startEditNode(selectedNodeId);
      break;
    }
    case 'Escape': {
      e.preventDefault();
      deselectNode();
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      navigateSibling(-1);
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      navigateSibling(1);
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      navigateToParent();
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      navigateToFirstChild();
      break;
    }
    default: {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        startEditNode(selectedNodeId);
        nodeEditorEl.value = e.key;
        nodeEditorEl.setSelectionRange(e.key.length, e.key.length);
      }
    }
  }
});

function deselectNode() {
  selectedNodeId = null;
  if (cy) cy.nodes().unselect();
  hideContextMenu();
  updateToolbar();
}

function navigateSibling(direction) {
  const node = currentNodes.find(n => n.id === selectedNodeId);
  if (!node) return;

  const siblings = currentNodes
    .filter(n => n.parent_id === node.parent_id)
    .sort((a, b) => a.position_order - b.position_order);

  const idx = siblings.findIndex(s => s.id === node.id);
  const nextIdx = idx + direction;
  if (nextIdx >= 0 && nextIdx < siblings.length) {
    selectNode(siblings[nextIdx].id);
  }
}

function navigateToParent() {
  const node = currentNodes.find(n => n.id === selectedNodeId);
  if (!node || !node.parent_id) return;

  const drillNodeId = drillPath.length > 0 ? drillPath[drillPath.length - 1] : null;
  if (drillNodeId && node.parent_id === drillNodeId) {
    selectNode(node.parent_id);
  } else if (!drillNodeId) {
    selectNode(node.parent_id);
  } else {
    const visibleNodes = getSubtree(currentNodes, drillNodeId);
    if (visibleNodes.some(n => n.id === node.parent_id)) {
      selectNode(node.parent_id);
    }
  }
}

function navigateToFirstChild() {
  const children = currentNodes
    .filter(n => n.parent_id === selectedNodeId)
    .sort((a, b) => a.position_order - b.position_order);

  if (children.length > 0) {
    selectNode(children[0].id);
  }
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  if (cy) {
    cy.nodes().unselect();
    const cyNode = cy.$('#n' + nodeId);
    if (cyNode.length > 0) {
      cyNode.select();
      cy.animate({ center: { eles: cyNode }, duration: 200 });
    }
  }
  updateToolbar();
}

// === Drag Reorder ===
function onNodeDragEnd(e) {
  const movedCyNode = e.target;
  const movedNodeId = movedCyNode.data('nodeId');
  const movedNode = currentNodes.find(n => n.id === movedNodeId);
  if (!movedNode || !movedNode.parent_id) return;

  const siblings = currentNodes
    .filter(n => n.parent_id === movedNode.parent_id && n.id !== movedNodeId)
    .sort((a, b) => a.position_order - b.position_order);

  if (siblings.length === 0) {
    runLayout();
    return;
  }

  const movedY = movedCyNode.position('y');
  let newPos = 0;
  for (let i = 0; i < siblings.length; i++) {
    const sibCyNode = cy.$('#n' + siblings[i].id);
    if (sibCyNode.length > 0 && movedY > sibCyNode.position('y')) {
      newPos = i + 1;
    }
  }

  api('PUT', '/nodes/' + movedNodeId + '/reorder', { new_position: newPos })
    .then(() => refreshCurrentMap());
}

// === Utilities ===
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === Hide context menu on clicks ===
document.addEventListener('click', (e) => {
  if (!contextMenuEl.contains(e.target)) {
    hideContextMenu();
  }
});

cyEl.addEventListener('contextmenu', (e) => e.preventDefault());

// === New Map Button ===
document.getElementById('btn-new-map').addEventListener('click', createMap);

// === Init ===
initCytoscape();
loadMaps();
