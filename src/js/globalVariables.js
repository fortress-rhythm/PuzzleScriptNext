var unitTesting=false;
let curLevelNo = 0;
var solvedSections = [];
var curlevelTarget=null;
var hasUsedCheckpoint=false;
var levelEditorOpened=false;

// Level editor rectangular selection and clipboard.
// A selection is in level coordinates, inclusive of both corners. The clipboard
// holds a rectangle of cell masks, so a copied region can be stamped back down
// overwriting whatever is under it rather than being inserted.
var editorSelection=null;       // {x0,y0,x1,y1}, normalised
var editorSelectAnchor=null;    // {x,y} corner held down while dragging a selection out
var editorClipboard=null;       // {w,h,cells:[BitVec]} in row-major order
var editorPasteMode=false;      // true while the paste ghost follows the cursor

// Drop any in-progress selection or paste. The clipboard deliberately survives,
// so a rectangle copied from one level can be pasted into another.
function editorClearSelectionState() {
	editorSelection=null;
	editorSelectAnchor=null;
	editorPasteMode=false;
}

var muted=0;
var runrulesonlevelstart_phase=false;
var ignoreNotJustPressedAction=true;

var verbose_logging=false;
var throttle_movement=false;
var cache_console_messages=false;
var quittingTitleScreen=false;
var quittingMessageScreen=false;

var deltatime=17; // this gets updated every frame; see loop()
var timer=0;
var repeatinterval=150;
var autotick=0;
var autotickinterval=0;
var winning=false;
var againing=false;
var againinterval=150;
var norepeat_action=false;
var oldflickscreendat = [];//used for buffering old flickscreen/scrollscreen positions, in case player vanishes
var keybuffer = [];

var debugSwitch = '';
var exportOptions = '';
var showLayers = false;
var showLayerNo = 0;
var defaultDebugMode = false;
var defaultVerboseLogging = false;

var tweeninterval=0;
var tweentimer=0;
var isTweening = false;     // true for tweening not yet complete, to defer againing
var isAnimating = false;    // true for animation/tweening/smoothscreen to keep rendering
var animateinterval=0;

var restarting=false;

var messageselected=false;

var textImages = {};
var initLevel = {};
var curLevel = initLevel;
var suppressInput = false;
