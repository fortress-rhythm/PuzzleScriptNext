// COPY FOR AI - fork-original. Puts one block of text on the clipboard that
// any AI chat can be handed: the context pack (doc/ai-context-pack.md, embedded
// as AI_CONTEXT_PACK by tools/build_ai_pack.js), the game in the editor, the
// selected lines if there are any, the tail of the console, and a short
// question template for the person to fill in. Nothing is sent anywhere; the
// person pastes it into whichever chat they use.

var AI_CONSOLE_LINES = 80;      // the most recent lines are the ones that matter
var AI_CONSOLE_CHARS = 8000;

// A fence longer than any run of backticks in the text, so a game that
// happens to contain ``` cannot close its own block early.
function aiFence(text, lang) {
	var longest = 2;
	(text.match(/`+/g) || []).forEach(function (run) { longest = Math.max(longest, run.length); });
	var fence = new Array(longest + 2).join('`');
	return fence + (lang || '') + '\n' + text.replace(/\s+$/, '') + '\n' + fence;
}

function aiConsoleTail() {
	var el = document.getElementById('consoletextarea');
	if (!el) return '';
	var lines = (el.innerText || el.textContent || '').split('\n')
		.map(function (line) { return line.replace(/\s+$/, ''); })
		.filter(function (line) { return line !== ''; });
	var tail = lines.slice(-AI_CONSOLE_LINES).join('\n');
	if (tail.length > AI_CONSOLE_CHARS) tail = tail.slice(-AI_CONSOLE_CHARS);
	if (lines.length > AI_CONSOLE_LINES || tail.length === AI_CONSOLE_CHARS) tail = '[...earlier console output left out...]\n' + tail;
	return tail;
}

function aiSelection() {
	if (!editor.somethingSelected()) return null;
	var from = editor.getCursor('from'), to = editor.getCursor('to');
	return { from: from.line + 1, to: to.line + 1 - (to.ch === 0 && to.line > from.line ? 1 : 0), text: editor.getSelection() };
}

function aiBuildPrompt() {
	var source = editor.getValue();
	var parts = [];
	parts.push(typeof AI_CONTEXT_PACK === 'string' ? AI_CONTEXT_PACK.replace(/\s+$/, '')
		: '(The PuzzleScript Next context pack failed to load. Answer carefully: you may not know this dialect well.)');
	parts.push('---\n\n# My game\n\nThis is the full source, as it is in the editor right now.\n\n' + aiFence(source, 'text'));
	var selection = aiSelection();
	if (selection)
		parts.push('# The part I am asking about\n\nLines ' + selection.from + (selection.to > selection.from ? '–' + selection.to : '') + ':\n\n' + aiFence(selection.text, 'text'));
	var tail = aiConsoleTail();
	parts.push('# Console output\n\nMost recent last. Errors here stop the game compiling; warnings do not.\n\n' + (tail ? aiFence(tail, 'text') : '(The console is empty. I may not have pressed RUN yet.)'));
	parts.push('# My question\n\n'
		+ 'What I am trying to do: \n\n'
		+ 'What I expected to happen: \n\n'
		+ 'What actually happened: \n');
	return parts.join('\n\n');
}

// Clipboard API where the page allows it, the old execCommand route where it
// does not, and a downloaded file as the last resort, so the button always
// produces something.
function aiCopyText(text, done) {
	function legacy() {
		var area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', '');
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		var ok = false;
		try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
		document.body.removeChild(area);
		if (ok) return done('copied');
		try {
			saveAs(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'for-ai.txt');
			done('saved');
		} catch (e) {
			done('failed');
		}
	}
	if (navigator.clipboard && navigator.clipboard.writeText)
		navigator.clipboard.writeText(text).then(function () { done('copied'); }, legacy);
	else
		legacy();
}

function copyForAIClick() {
	var link = document.getElementById('copyForAIClickLink');
	var text = aiBuildPrompt();
	aiCopyText(text, function (outcome) {
		var label = { copied: 'COPIED ✓', saved: 'SAVED for-ai.txt', failed: 'COPY FAILED' }[outcome];
		if (link) {
			link.textContent = label;
			clearTimeout(copyForAIClick.timer);
			copyForAIClick.timer = setTimeout(function () { link.textContent = 'COPY FOR AI'; }, 2500);
		}
		if (outcome === 'failed')
			consolePrint('<span class="errorText">COPY FOR AI could not reach the clipboard or save a file in this browser.</span>', true);
	});
}
