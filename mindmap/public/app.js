// === State ===
let cy = null;
let allMaps = [];
let currentMapId = null;
let currentNodes = [];
let selectedNodeId = null;
let drillPath = []; // array of node ids for breadcrumb trail
let editingNodeId = null;
let contextNodeId = null;

// === DOM References ===
const mapListEl = document.getElementById('map-list');
const breadcrumbsEl = document.getElementById('breadcrumbs');
const cyEl = document.getElementById('cy');
const emptyStateEl = document.getElementById('empty-state');
const nodeEditorEl = document.getElementById('node-editor');
const contextMenuEl = document.getElementById('context-menu');
const mapPickerOverlay = document.getElementById('map-picker-overlay');
const mapPickerList = document.getElementById('map-picker-list');

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
          'text-max-width': '140px',
          'font-size': '13px',
          'font-family': '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
          'text-valign': 'center',
          'text-halign': 'center',
          'background-color': '#ffffff',
          'border-width': 2,
          'border-color': '#d1d5db',
          'shape': 'roundrectangle',
          'width': 'label',
          'height': 'label',
          'padding': '14px',
          'color': '#1a1a2e',
          'shadow-blur': 8,
          'shadow-color': 'rgba(0,0,0,0.06)',
          'shadow-offset-x': 0,
          'shadow-offset-y': 2,
          'shadow-opacity': 1,
          'min-width': '60px',
          'min-height': '30px',
        }
      },
      {
        selector: 'node.root',
        style: {
          'border-width': 3,
          'border-color': '#4a6cf7',
          'background-color': '#f0f4ff',
          'font-weight': 'bold',
          'font-size': '15px',
          'padding': '18px',
        }
      },
      {
        selector: 'node.linked',
        style: {
          'border-color': '#8b5cf6',
          'border-style': 'dashed',
          'border-width': 2.5,
        }
      },
      {
        selector: 'node:selected',
        style: {
          'border-color': '#4a6cf7',
          'border-width': 3,
          'shadow-blur': 16,
          'shadow-color': 'rgba(74, 108, 247, 0.3)',
          'shadow-opacity': 1,
        }
      },
      {
        selector: 'node.linked:selected',
        style: {
          'border-color': '#8b5cf6',
          'border-width': 3,
          'shadow-color': 'rgba(139, 92, 246, 0.3)',
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#d1d5db',
          'curve-style': 'unbundled-bezier',
          'target-arrow-shape': 'none',
          'control-point-distances': [40],
          'control-point-weights': [0.5],
        }
      },
    ],
    layout: { name: 'preset' },
    minZoom: 0.2,
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

  // Drag for sibling reorder
  cy.on('free', 'node', onNodeDragEnd);
}

// === Render Map on Canvas ===
function renderMap(nodes) {
  if (!cy) initCytoscape();
  cy.elements().remove();

  if (!nodes || nodes.length === 0) return;

  // Determine visible nodes based on drill path
  const drillNodeId = drillPath.length > 0 ? drillPath[drillPath.length - 1] : null;
  const visibleNodes = drillNodeId ? getSubtree(nodes, drillNodeId) : nodes;

  const nodeMap = {};
  nodes.forEach(n => nodeMap[n.id] = n);

  // Root of visible tree
  const visibleRoot = drillNodeId || nodes.find(n => n.parent_id === null)?.id;

  // Add nodes
  visibleNodes.forEach(n => {
    const classes = [];
    if (n.id === visibleRoot) classes.push('root');
    if (n.linked_map_id) classes.push('linked');

    let label = n.text;
    if (n.linked_map_id) label = n.text + ' \u2197';

    cy.add({
      group: 'nodes',
      data: { id: 'n' + n.id, label: label, nodeId: n.id },
      classes: classes.join(' '),
    });
  });

  // Add edges
  visibleNodes.forEach(n => {
    if (n.parent_id !== null && visibleNodes.some(v => v.id === n.parent_id)) {
      cy.add({
        group: 'edges',
        data: { source: 'n' + n.parent_id, target: 'n' + n.id },
      });
    }
  });

  runLayout();
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
    spacingFactor: 1.4,
    nodeSep: 30,
    rankSep: 80,
    animate: true,
    animationDuration: 300,
    animationEasing: 'ease-in-out-cubic',
    fit: true,
    padding: 60,
  }).run();
}

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

  // Select all text
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

  // Build full path
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
        // Navigate to this level
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

  // If tapping already-selected node, enter edit mode
  // (handled via separate click tracking below)
}

function onNodeDoubleTap(e) {
  const nodeId = e.target.data('nodeId');
  const node = currentNodes.find(n => n.id === nodeId);
  if (!node) return;

  // If linked to another map, open that map
  if (node.linked_map_id) {
    openMap(node.linked_map_id);
    return;
  }

  // Otherwise, drill down into this node's subtree
  if (currentNodes.some(n => n.parent_id === nodeId)) {
    // Has children, drill in
    const root = currentNodes.find(n => n.parent_id === null);
    if (nodeId === root?.id && drillPath.length === 0) return; // already at root

    // Build drill path from root to this node
    const pathToNode = getPathToNode(nodeId);
    if (pathToNode.length > 1) {
      drillPath = pathToNode.slice(1); // exclude root
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
  const removeLink = contextMenuEl.querySelector('[data-action="remove-link"]');
  removeLink.style.display = node?.linked_map_id ? 'block' : 'none';

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
  const action = e.target.dataset.action;
  if (!action || !contextNodeId) return;

  const node = currentNodes.find(n => n.id === contextNodeId);
  hideContextMenu();

  if (action === 'link-to-map') {
    showMapPicker(contextNodeId);
  } else if (action === 'remove-link') {
    await api('PUT', '/nodes/' + contextNodeId, { linked_map_id: null });
    await refreshCurrentMap();
  } else if (action === 'create-linked-map') {
    const newMap = await api('POST', '/maps', { name: node.text });
    await api('PUT', '/nodes/' + contextNodeId, { linked_map_id: newMap.id });
    await loadMaps();
    await refreshCurrentMap();
  }
});

// Map picker
function showMapPicker(nodeId) {
  mapPickerList.innerHTML = '';
  allMaps.forEach(map => {
    if (map.id === currentMapId) return; // skip current map
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
  nodeEditorEl.style.width = Math.max(bb.w + 20, 100) + 'px';
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
    // Re-select the node
    selectedNodeId = nodeId;
    const cyNode = cy.$('#n' + nodeId);
    if (cyNode.length > 0) cyNode.select();
  }
}

function cancelEdit() {
  editingNodeId = null;
  nodeEditorEl.style.display = 'none';
  // Refocus the canvas so keyboard shortcuts work
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
  // Immediately edit
  startEditNode(newNode.id);
}

async function addSiblingNode(nodeId) {
  const node = currentNodes.find(n => n.id === nodeId);
  if (!node || !node.parent_id) return; // can't add sibling to root
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
  if (!node || !node.parent_id) return; // can't delete root

  const children = currentNodes.filter(n => n.parent_id === nodeId);
  if (children.length > 0) {
    if (!confirm(`Delete this node and its ${children.length} child(ren)?`)) return;
  }

  // Select parent before deleting
  const parentId = node.parent_id;

  await api('DELETE', '/nodes/' + nodeId);

  // If deleted node was in drill path, pop back
  const drillIdx = drillPath.indexOf(nodeId);
  if (drillIdx >= 0) {
    drillPath = drillPath.slice(0, drillIdx);
    renderBreadcrumbs();
  }

  await refreshCurrentMap();

  selectedNodeId = parentId;
  const cyNode = cy.$('#n' + parentId);
  if (cyNode.length > 0) cyNode.select();
}

async function refreshCurrentMap() {
  if (!currentMapId) return;
  currentNodes = await api('GET', '/maps/' + currentMapId + '/nodes');
  renderMap(currentNodes);
  renderBreadcrumbs();
}

// === Keyboard Shortcuts ===
document.addEventListener('keydown', (e) => {
  // Skip if editing a node or input field
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
      // Start typing to edit
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        startEditNode(selectedNodeId);
        // Put the typed character in
        nodeEditorEl.value = e.key;
        // Move cursor to end
        nodeEditorEl.setSelectionRange(e.key.length, e.key.length);
      }
    }
  }
});

function deselectNode() {
  selectedNodeId = null;
  if (cy) cy.nodes().unselect();
  hideContextMenu();
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

  // Check parent is visible
  const drillNodeId = drillPath.length > 0 ? drillPath[drillPath.length - 1] : null;
  if (drillNodeId && node.parent_id === drillNodeId) {
    // Parent is the drill root, it's visible
    selectNode(node.parent_id);
  } else if (!drillNodeId) {
    selectNode(node.parent_id);
  } else {
    // Check if parent is in visible set
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
      // Animate to center on the node
      cy.animate({ center: { eles: cyNode }, duration: 200 });
    }
  }
}

// === Drag Reorder ===
function onNodeDragEnd(e) {
  const movedCyNode = e.target;
  const movedNodeId = movedCyNode.data('nodeId');
  const movedNode = currentNodes.find(n => n.id === movedNodeId);
  if (!movedNode || !movedNode.parent_id) return; // can't reorder root

  const siblings = currentNodes
    .filter(n => n.parent_id === movedNode.parent_id && n.id !== movedNodeId)
    .sort((a, b) => a.position_order - b.position_order);

  if (siblings.length === 0) {
    runLayout(); // snap back
    return;
  }

  // Determine new position based on Y coordinate relative to siblings
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

// Prevent default context menu on canvas
cyEl.addEventListener('contextmenu', (e) => e.preventDefault());

// === New Map Button ===
document.getElementById('btn-new-map').addEventListener('click', createMap);

// === Init ===
initCytoscape();
loadMaps();
