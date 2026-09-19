
for (var i=0;i<10;i++) {
	var idname = "newsound"+i;
	var el = document.getElementById(idname);
    el.addEventListener("click", (function(n){return function(){return newSound(n);};})(i), false);
}

//var soundButtonPress = document.getElementById("soundButtonPress");
//soundButtonPress.addEventListener("click", buttonPress, false);

var solveClickLink = document.getElementById("solveClickLink");
solveClickLink.addEventListener("click", solveClick, false);

var cancelClickLink = document.getElementById("cancelClickLink");
cancelClickLink.addEventListener("click", cancelClick, false);

var runClickLink = document.getElementById("runClickLink");
runClickLink.addEventListener("click", runClick, false);

var saveClickLink = document.getElementById("saveClickLink");
saveClickLink.addEventListener("click", saveClick, false);

var rebuildClickLink = document.getElementById("rebuildClickLink");
rebuildClickLink.addEventListener("click", rebuildClick, false);

var shareClickLink = document.getElementById("shareClickLink");
shareClickLink.addEventListener("click", shareClick, false);

var levelEditorClickLink = document.getElementById("levelEditorClickLink");
levelEditorClickLink.addEventListener("click", levelEditorClick_Fn, false);

var exportClickLink = document.getElementById("exportClickLink");
exportClickLink.addEventListener("click", exportClick, false);

// palette-set extension (fork-original)
var palettePreviewClickLink = document.getElementById("palettePreviewClickLink");
if (palettePreviewClickLink)
	palettePreviewClickLink.addEventListener("click", palettePreviewClick, false);

// MAP EDITOR - fork-original. Hands the game in the editor to the map editor
// in a new tab. A tab opened with window.open starts with a copy of this tab's
// sessionStorage, which is how the source gets across without a server; the
// map editor reads and clears `psmap.handoff` as it starts. On a file:// page
// some browsers give each tab its own storage, in which case the map editor
// opens empty and the game is one Open... away.
var mapEditorClickLink = document.getElementById("mapEditorClickLink");
if (mapEditorClickLink)
	mapEditorClickLink.addEventListener("click", function () {
		var source = editor.getValue();
		var title = (source.match(/^title\s+(.+)$/mi) || [])[1] || 'game';
		var fileName = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.txt';
		try {
			window.sessionStorage.setItem('psmap.handoff', JSON.stringify({ source: source, fileName: fileName }));
		} catch (e) { /* storage blocked; the map editor will open empty */ }
		window.open('../puzzlescript-map-editor/web/index.html', 'psmap');
	}, false);
var palettePanelClose = document.getElementById("palettePanelClose");
if (palettePanelClose)
	palettePanelClose.addEventListener("click", palettePreviewClick, false);

var exampleDropdown = document.getElementById("exampleDropdown");
exampleDropdown.addEventListener("change", dropdownChange, false);

var loadDropDown = document.getElementById("loadDropDown");
loadDropDown.addEventListener("change", loadDropDownChange, false);

var horizontalDragbar = document.getElementById("horizontaldragbar");
horizontalDragbar.addEventListener("mousedown", horizontalDragbarMouseDown, false);

var verticalDragbar = document.getElementById("verticaldragbar");
verticalDragbar.addEventListener("mousedown", verticalDragbarMouseDown, false);

window.addEventListener("resize", resize_all, false);
window.addEventListener("load", reset_panels, false);

/* https://github.com/ndrake/PuzzleScript/commit/de4ac2a38865b74e66c1d711a25f0691079a290d */
window.onbeforeunload = function (e) {
  var e = e || window.event;
  var msg = 'You have unsaved changes!';

  if(_editorDirty) {      

    // For IE and Firefox prior to version 4
    if (e) {
      e.preventDefault();
      e.returnValue = msg;
    }

    // For Safari
    return msg;
  }
};

var gestureHandler = Mobile.enable();
if (gestureHandler) {
    gestureHandler.setFocusElement(document.getElementById('gameCanvas'));
}
