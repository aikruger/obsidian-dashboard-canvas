(function diagWorkspaceTree() {
  const app = window.app;
  const ws = app.workspace;

  console.group('[DIAG] Full Workspace Tree');

  function walkItem(item, depth = 0) {
    const indent = '  '.repeat(depth);
    const type = item?.constructor?.name || 'Unknown';
    const viewType = item?.type || item?.getViewState?.()?.type || '';
    const id = item?.id || '';

    console.log(`${indent}[${type}] viewType="${viewType}" id="${id}"`);

    // Log containerEl dimensions
    if (item?.containerEl) {
      const r = item.containerEl.getBoundingClientRect();
      console.log(`${indent}  containerEl: ${Math.round(r.width)}x${Math.round(r.height)} at (${Math.round(r.left)},${Math.round(r.top)})`);
      console.log(`${indent}  containerEl.parentElement: ${item.containerEl.parentElement?.className || 'null'}`);
    }

    // Walk children
    if (item?.children) {
      for (const child of item.children) {
        walkItem(child, depth + 1);
      }
    }
  }

  walkItem(ws.rootSplit);

  console.log('[DIAG] leftSplit:');
  walkItem(ws.leftSplit, 1);

  console.log('[DIAG] rightSplit:');
  walkItem(ws.rightSplit, 1);

  console.groupEnd();
})();

(function diagWorkspaceMethods() {
  const ws = window.app.workspace;
  const proto = Object.getPrototypeOf(ws);
  const methods = Object.getOwnPropertyNames(proto)
    .filter(m => typeof proto[m] === 'function')
    .sort();

  console.group('[DIAG] Workspace prototype methods');
  console.log('ALL:', methods);
  console.log('LEAF-related:', methods.filter(m => m.toLowerCase().includes('leaf')));
  console.log('MOVE-related:', methods.filter(m => m.toLowerCase().includes('move')));
  console.log('SPLIT-related:', methods.filter(m => m.toLowerCase().includes('split')));
  console.log('CREATE-related:', methods.filter(m => m.toLowerCase().includes('create')));
  console.groupEnd();
})();

(function diagMoveLeaf() {
  const ws = window.app.workspace;

  // Check for internal drag handler on the workspace
  const internalKeys = Object.keys(ws).filter(k =>
    k.includes('drag') || k.includes('Drag') || k.includes('move') || k.includes('Move')
  );
  console.log('[DIAG] Workspace instance keys (drag/move):', internalKeys);

  // Try the internal moveLeaf if it exists
  if (typeof ws.moveLeaf === 'function') {
    console.log('[DIAG] workspace.moveLeaf EXISTS — signature:', ws.moveLeaf.toString().slice(0, 200));
  } else {
    console.log('[DIAG] workspace.moveLeaf does NOT exist — need to use createLeafInParent approach');
  }
})();
