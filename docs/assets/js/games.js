/*
	Daily games scorecard (games.html).

	One game at a time: pick a game, paste its share-text, add it to today's card, and
	when the card is complete, "Score my day" saves it. Each saved result is stored as
	the original pasted snippet and re-parsed on load, so changing a scoring rule in
	trivia-parser.js re-scores the whole history. Everything stays in localStorage on
	this device; nothing is sent anywhere. User text is only ever written to the page
	with textContent, never as HTML.
*/
(function () {
	'use strict';

	var P = window.TriviaParser;
	var form = document.getElementById('log-form');
	if (!P || !form) { return; }

	var KEY = 'mk-trivia-v2';
	var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
	var MAX_SNIPPET = 2000;
	var $ = function (id) { return document.getElementById(id); };
	var els = {
		day: $('day'), game: $('game'), play: $('play-link'), paste: $('paste'),
		status: $('log-status'), list: $('card-list'), empty: $('card-empty'),
		remaining: $('remaining'), submit: $('btn-submit'), submitStatus: $('submit-status'),
		history: $('history-body'), historyEmpty: $('history-empty'), historyTable: $('history-table'),
		avgs: $('averages'), rules: $('rules'), toolStatus: $('tool-status'), importInput: $('import-file')
	};

	/* Data ------------------------------------------------------------------ */
	// data.days: { 'YYYY-MM-DD': { gameId: 'pasted snippet' } }   (saved)
	// pending:   { gameId: 'pasted snippet' }                      (staged for the chosen day)

	var cache = {};
	function resolve(id, snippet) {
		var k = id + '\u0000' + snippet;
		if (!(k in cache)) { var out = P.parseGame(id, snippet); cache[k] = out.result || null; }
		return cache[k];
	}

	// Keep only known games with snippets that still parse. Used for storage and imports.
	function sanitize(obj) {
		if (!obj || typeof obj !== 'object' || !obj.days || typeof obj.days !== 'object') { return null; }
		var days = {};
		Object.keys(obj.days).forEach(function (k) {
			var day = obj.days[k];
			if (!DAY_RE.test(k) || !day || typeof day !== 'object') { return; }
			Object.keys(day).forEach(function (id) {
				var text = day[id];
				if (!P.BY_ID[id] || typeof text !== 'string') { return; }
				text = text.slice(0, MAX_SNIPPET);
				if (!resolve(id, text)) { return; }
				(days[k] || (days[k] = {}))[id] = text;
			});
		});
		return days;
	}

	var canSave = true;
	function load() {
		try {
			var raw = window.localStorage.getItem(KEY);
			var clean = raw ? sanitize(JSON.parse(raw)) : {};
			return { days: clean || {} };
		} catch (e) { canSave = false; return { days: {} }; }
	}
	function save() {
		try { window.localStorage.setItem(KEY, JSON.stringify(data)); canSave = true; }
		catch (e) { canSave = false; }
		notice(canSave ? '' : 'This browser is blocking storage (private mode?), so results will be lost when you close the page. Use Export to keep a copy.');
	}

	var data = load();
	var pending = {};

	/* Helpers --------------------------------------------------------------- */

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) { n.className = cls; }
		if (text != null) { n.textContent = text; }
		return n;
	}
	function pad(n) { return (n < 10 ? '0' : '') + n; }
	function todayKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
	function prettyDay(key) {
		var p = key.split('-');
		return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
	}
	function fmt(n) { return n === null || n === undefined ? '—' : String(Math.round(n)); }
	function selectedDay() { return DAY_RE.test(els.day.value) ? els.day.value : todayKey(); }
	function say(node, text, state) { node.textContent = text; node.setAttribute('data-state', state || ''); }
	function notice(text) { els.toolStatus.textContent = text; }
	function star() { return el('span', 'star', '★'); }

	function savedResults(key) {
		var out = {}, day = data.days[key] || {};
		Object.keys(day).forEach(function (id) { var r = resolve(id, day[id]); if (r) { out[id] = r; } });
		return out;
	}
	function allSaved() {
		var out = {};
		Object.keys(data.days).forEach(function (k) { var r = savedResults(k); if (Object.keys(r).length) { out[k] = r; } });
		return out;
	}
	// Today's card = what is saved for the chosen day, overlaid with what is staged.
	function cardEntries(key) {
		var saved = data.days[key] || {};
		return P.GAMES.map(function (g) {
			var isNew = pending[g.id] !== undefined;
			var snippet = isNew ? pending[g.id] : saved[g.id];
			var result = snippet === undefined ? null : resolve(g.id, snippet);
			return result ? { game: g, result: result, isNew: isNew } : null;
		}).filter(Boolean);
	}

	/* Rendering ------------------------------------------------------------- */

	function renderCard() {
		var key = selectedDay();
		var entries = cardEntries(key);
		els.list.textContent = '';
		els.empty.hidden = entries.length > 0;

		entries.forEach(function (e) {
			var li = el('li');
			var left = el('span');
			left.appendChild(el('strong', null, e.game.name));
			left.appendChild(document.createTextNode(' · ' + e.result.raw));
			if (e.result.star) { left.appendChild(star()); }
			li.appendChild(left);

			var right = el('span', 'cardlist__right');
			right.appendChild(el('span', null, 'Score ' + fmt(e.result.score) + (e.isNew ? ' · new' : ' · saved')));
			var btn = el('button', 'link-btn', 'Remove');
			btn.type = 'button';
			btn.setAttribute('aria-label', 'Remove ' + e.game.name + ' from the card');
			btn.addEventListener('click', function () {
				if (e.isNew) { delete pending[e.game.id]; }
				else {
					delete data.days[key][e.game.id];
					if (!Object.keys(data.days[key]).length) { delete data.days[key]; }
					save();
				}
				renderAll();
			});
			right.appendChild(btn);
			li.appendChild(right);
			els.list.appendChild(li);
		});

		var s = P.summarize(entries.map(function (e) { return e.result; }));
		$('card-avg').textContent = fmt(s.average);
		$('card-total').textContent = fmt(s.total);
		$('card-stars').textContent = String(s.stars);

		// Links to whatever has not been played yet today
		var have = {};
		entries.forEach(function (e) { have[e.game.id] = true; });
		els.remaining.textContent = '';
		var todo = P.GAMES.filter(function (g) { return !have[g.id]; });
		if (todo.length) {
			els.remaining.appendChild(document.createTextNode('Still to play: '));
			todo.forEach(function (g, i) {
				var a = el('a', null, g.name);
				a.href = g.url; a.target = '_blank'; a.rel = 'noopener';
				els.remaining.appendChild(a);
				if (i < todo.length - 1) { els.remaining.appendChild(document.createTextNode(', ')); }
			});
		} else {
			els.remaining.textContent = 'Every scored game is on the card.';
		}
		els.submit.disabled = !Object.keys(pending).length;
	}

	function renderStats() {
		var key = selectedDay();
		var days = allSaved();
		var keys = Object.keys(days);
		var today = P.summarize(days[key] || {});
		var all = P.overall(keys.map(function (k) { return P.summarize(days[k]); }));
		$('stat-dayavg').textContent = fmt(today.average);
		$('stat-daytotal').textContent = days[key] ? fmt(today.total) : '—';
		$('stat-dayavg-label').textContent = 'Average · ' + prettyDay(key);
		$('stat-daytotal-label').textContent = 'Total · ' + prettyDay(key);
		$('stat-streak').textContent = String(P.currentStreak(keys, todayKey()));
		$('stat-best').textContent = String(P.bestStreak(keys));
		$('stat-avg').textContent = fmt(all.average);
		$('stat-total').textContent = keys.length ? fmt(all.total) : '—';
		$('stat-days').textContent = String(keys.length);
		$('stat-stars').textContent = String(all.stars);
	}

	function renderHistory() {
		var days = allSaved();
		var keys = Object.keys(days).sort().reverse().slice(0, 30);
		els.history.textContent = '';
		els.historyEmpty.hidden = keys.length > 0;
		els.historyTable.hidden = keys.length === 0;
		keys.forEach(function (k) {
			var s = P.summarize(days[k]);
			var tr = el('tr');
			tr.appendChild(el('td', 'history__date', prettyDay(k)));

			var chips = el('div', 'chips');
			P.GAMES.forEach(function (g) {
				var r = days[k][g.id];
				if (!r) { return; }
				var chip = el('span', 'chip', g.name + ' ' + r.raw);
				if (r.star) { chip.appendChild(star()); }
				chips.appendChild(chip);
			});
			var tdChips = el('td'); tdChips.appendChild(chips); tr.appendChild(tdChips);

			tr.appendChild(el('td', 'history__score', fmt(s.average)));
			tr.appendChild(el('td', 'history__score', fmt(s.total)));

			var tdBtn = el('td');
			var btn = el('button', 'link-btn', 'Remove');
			btn.type = 'button';
			btn.setAttribute('aria-label', 'Remove results for ' + prettyDay(k));
			btn.addEventListener('click', function () { delete data.days[k]; save(); renderAll(); });
			tdBtn.appendChild(btn); tr.appendChild(tdBtn);
			els.history.appendChild(tr);
		});
	}

	function renderAverages() {
		var avgs = P.gameAverages(allSaved());
		els.avgs.textContent = '';
		var any = false;
		P.GAMES.forEach(function (g) {
			if (!avgs[g.id]) { return; }
			any = true;
			var li = el('li');
			li.appendChild(el('span', null, g.name));
			li.appendChild(el('span', 'avgs__n', avgs[g.id].played + (avgs[g.id].played === 1 ? ' game' : ' games')));
			li.appendChild(el('strong', null, fmt(avgs[g.id].average)));
			els.avgs.appendChild(li);
		});
		if (!any) { els.avgs.appendChild(el('li', 'empty', 'Nothing yet.')); }
	}

	function renderRules() {
		els.rules.textContent = '';
		P.GAMES.forEach(function (g) {
			var row = el('div');
			row.appendChild(el('dt', null, g.name));
			var dd = el('dd', null, g.rule);
			if (g.starRule) {
				dd.appendChild(document.createElement('br'));
				dd.appendChild(star());
				dd.appendChild(document.createTextNode(' ' + g.starRule));
			}
			row.appendChild(dd);
			els.rules.appendChild(row);
		});
	}

	function renderAll() { renderCard(); renderStats(); renderHistory(); renderAverages(); }

	/* The game picker ------------------------------------------------------- */

	function currentGame() { return P.BY_ID[els.game.value]; }
	function syncPicker() {
		var g = currentGame();
		els.play.href = g.url;
		els.play.textContent = 'Play ' + g.name + ' ↗';
		els.paste.placeholder = g.example;
		say(els.status, '', '');
	}

	P.GAMES.forEach(function (g) {
		var o = el('option', null, g.name);
		o.value = g.id;
		els.game.appendChild(o);
	});
	els.game.addEventListener('change', syncPicker);

	function advancePicker() {
		var have = {};
		cardEntries(selectedDay()).forEach(function (e) { have[e.game.id] = true; });
		var next = P.GAMES.filter(function (g) { return !have[g.id]; })[0];
		if (next) { els.game.value = next.id; }
		syncPicker();
	}

	/* Adding a game, then scoring the day ----------------------------------- */

	form.addEventListener('submit', function (e) {
		e.preventDefault();
		var g = currentGame();
		var out = P.parseGame(g.id, els.paste.value.slice(0, MAX_SNIPPET * 2));
		if (out.error) { say(els.status, out.error, 'error'); els.paste.focus(); return; }

		var r = out.result;
		pending[g.id] = els.paste.value.trim().slice(0, MAX_SNIPPET);
		cache = {};   // a snippet may now resolve differently than before
		var msg = g.name + ' added: ' + r.raw + ', score ' + fmt(r.score) + (r.star ? ', a star!' : '.');
		if (r.date && r.date !== selectedDay()) {
			msg += ' Note: this result is dated ' + prettyDay(r.date) + ', but you are logging it under ' + prettyDay(selectedDay()) + '.';
		}
		els.paste.value = '';
		renderAll();
		advancePicker();
		say(els.status, msg, 'ok');
		say(els.submitStatus, '', '');
	});

	els.submit.addEventListener('click', function () {
		var ids = Object.keys(pending);
		if (!ids.length) { return; }
		var key = selectedDay();
		ids.forEach(function (id) { (data.days[key] || (data.days[key] = {}))[id] = pending[id]; });
		pending = {};
		save();
		var s = P.summarize(savedResults(key));
		renderAll();
		advancePicker();
		say(els.submitStatus, 'Saved ' + ids.length + (ids.length === 1 ? ' game' : ' games') + ' for ' + prettyDay(key) + '. Day average ' + fmt(s.average) + ', total ' + fmt(s.total) + (s.stars ? ', ' + s.stars + (s.stars === 1 ? ' star' : ' stars') : '') + '.', 'ok');
		say(els.status, '', '');
	});

	els.day.addEventListener('change', function () { renderAll(); advancePicker(); say(els.submitStatus, '', ''); });

	window.addEventListener('beforeunload', function (e) {
		if (Object.keys(pending).length) { e.preventDefault(); e.returnValue = ''; }
	});

	/* Toolbar --------------------------------------------------------------- */

	function summaryText() {
		var key = selectedDay();
		var day = savedResults(key);
		var s = P.summarize(day);
		var line = P.GAMES.filter(function (g) { return day[g.id]; })
			.map(function (g) { return g.name + ' ' + day[g.id].raw + (day[g.id].star ? ' ★' : ''); }).join(' · ');
		return 'Trivia score for ' + prettyDay(key) + ': ' + fmt(s.average) + ' average, ' + fmt(s.total) + ' total' +
			(line ? '\n' + line : '') +
			'\nStreak: ' + P.currentStreak(Object.keys(allSaved()), todayKey()) + ' days' +
			'\nhttps://mattkennedy24.github.io/games.html';
	}

	function copy(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) { return navigator.clipboard.writeText(text); }
		return new Promise(function (resolve, reject) {
			var ta = el('textarea');
			ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
			document.body.appendChild(ta); ta.select();
			var ok = false;
			try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
			document.body.removeChild(ta);
			ok ? resolve() : reject(new Error('copy failed'));
		});
	}

	$('btn-copy').addEventListener('click', function () {
		if (!data.days[selectedDay()]) { notice('Nothing saved for that day yet. Score your day first.'); return; }
		copy(summaryText()).then(function () { notice('Copied. Paste it into a group chat.'); },
			function () { notice('Could not copy automatically. Your browser blocked it.'); });
	});

	$('btn-export').addEventListener('click', function () {
		var blob = new Blob([JSON.stringify({ version: 2, days: data.days }, null, 2)], { type: 'application/json' });
		var a = el('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'trivia-scores-' + todayKey() + '.json';
		document.body.appendChild(a); a.click(); document.body.removeChild(a);
		window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		notice('Exported. Import it on another device to carry your history over.');
	});

	$('btn-import').addEventListener('click', function () { els.importInput.click(); });
	els.importInput.addEventListener('change', function () {
		var file = els.importInput.files && els.importInput.files[0];
		els.importInput.value = '';
		if (!file) { return; }
		if (file.size > 2 * 1024 * 1024) { notice('That file is too large to be a scorecard export.'); return; }
		var reader = new FileReader();
		reader.onload = function () {
			var clean;
			try { clean = sanitize(JSON.parse(reader.result)); } catch (err) { clean = null; }
			if (!clean) { notice('That does not look like a scorecard export.'); return; }
			var n = 0;
			Object.keys(clean).forEach(function (k) {
				Object.keys(clean[k]).forEach(function (id) { (data.days[k] || (data.days[k] = {}))[id] = clean[k][id]; n++; });
			});
			save(); renderAll();
			notice('Imported ' + n + (n === 1 ? ' result.' : ' results.'));
		};
		reader.onerror = function () { notice('Could not read that file.'); };
		reader.readAsText(file);
	});

	$('btn-reset').addEventListener('click', function () {
		if (!window.confirm('Delete all results saved in this browser? This cannot be undone.')) { return; }
		data = { days: {} }; pending = {};
		save(); renderAll(); advancePicker();
		say(els.submitStatus, '', '');
		notice('Scorecard cleared.');
	});

	/* Start ----------------------------------------------------------------- */

	els.day.value = todayKey();
	els.day.max = todayKey();
	renderRules();
	renderAll();
	advancePicker();
	if (!canSave) { notice('This browser is blocking storage (private mode?), so results will be lost when you close the page. Use Export to keep a copy.'); }
})();
