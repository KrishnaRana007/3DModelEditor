/**
 * DOM reference registry for the editor shell.
 *
 * Keep all fixed HTML element lookups here so feature modules do not scatter
 * document.getElementById calls across the codebase.
 */
export function getDomRefs(documentRef = document) {
  return {
    viewport: documentRef.getElementById('viewport'),
    viewportHelp: documentRef.getElementById('viewportHelp'),
    selectionRect: documentRef.getElementById('selectionRect'),
    editorContextMenu: documentRef.getElementById('editorContextMenu'),
    sceneTree: documentRef.getElementById('sceneTree'),
    inspectorContent: documentRef.getElementById('inspectorContent'),
    materialAssetContent: documentRef.getElementById('materialAssetContent'),
    toolPropertiesContent: documentRef.getElementById('toolPropertiesContent'),
    animationContent: documentRef.getElementById('animationContent'),
    historyContent: documentRef.getElementById('historyContent'),
    selectedBadge: documentRef.getElementById('selectedBadge'),
    toolsPanel: documentRef.getElementById('toolsPanel'),
    hierarchyPanel: documentRef.getElementById('hierarchyPanel'),
    inspectorPanel: documentRef.getElementById('inspectorPanel'),
    undoBtn: documentRef.getElementById('undoBtn'),
    redoBtn: documentRef.getElementById('redoBtn'),
    resetViewBtn: documentRef.getElementById('resetViewBtn'),
    clearSelectionBtn: documentRef.getElementById('clearSelectionBtn'),
    deleteBtn: documentRef.getElementById('deleteBtn'),
    selectToolBtn: documentRef.getElementById('selectToolBtn'),
    objectMenuBtn: documentRef.getElementById('objectMenuBtn'),
    lightMenuBtn: documentRef.getElementById('lightMenuBtn'),
    cameraMenuBtn: documentRef.getElementById('cameraMenuBtn'),
    objectOptions: documentRef.getElementById('objectOptions'),
    lightOptions: documentRef.getElementById('lightOptions'),
    cameraOptions: documentRef.getElementById('cameraOptions'),
    cameraFrameOverlay: documentRef.getElementById('cameraFrameOverlay'),
    cameraViewBadge: documentRef.getElementById('cameraViewBadge'),
    toolsMenuBtn: documentRef.getElementById('toolsMenuBtn'),
    viewMenuBtn: documentRef.getElementById('viewMenuBtn'),
    viewMenuDropdown: documentRef.getElementById('viewMenuDropdown'),
    toolsMenuDropdown: documentRef.getElementById('toolsMenuDropdown'),
    fileMenuBtn: documentRef.getElementById('fileMenuBtn'),
    fileMenuDropdown: documentRef.getElementById('fileMenuDropdown'),
    projectFileInput: documentRef.getElementById('projectFileInput'),
    modelFileInput: documentRef.getElementById('modelFileInput'),
    createMenuBtn: documentRef.getElementById('createMenuBtn'),
    createMenuDropdown: documentRef.getElementById('createMenuDropdown'),
    guideBtn: documentRef.getElementById('guideBtn'),
    guideModal: documentRef.getElementById('guideModal'),
    guideCloseBtn: documentRef.getElementById('guideCloseBtn')
  };
}
