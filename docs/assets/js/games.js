/*
	Daily games scorecard (games.html).

	Everything is stored per device in localStorage; nothing is sent anywhere.
	Parsing and stats come from trivia-parser.js. User-supplied text is only ever
	written to the page with textContent, never as HTML.
*/
(function () {
	'use strict';

	var P = window.TriviaParser;
	var form = document.getElementById('log-form');
	if (!P || !form) { return; }

	var KEY = 'mk-trivia-v1';
	var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
	var els = {
		paste: document.getElementById('paste'),
		day: document.getElementById('day'),
		status: document.getElementById('log-status'),
		parsed: document.getElementById('parsed'),
		history: document.getElementById('history-body'),
		historyEmpty: document.getElementById('history-empty'),
		historyTable: document.getElementById('history-table'),
		avgs: document.getElementById('averages'),
		rules: document.getElementById('rules'),
		dayLabel: document.getElementById('stat-day-label'),
		toolStatus: document.getElementById('tool-status'),
		importInput: document.getElementById('import-file')
	};

	/* Storage -------------------------------------------------------------- */

	var canSave = true;
	var memory = { days: {} };

	function load() {
		try {
			var raw = window.localStorage.getItem(KEY);
			if (!raw) { return { days: {} }; }
			var clean = sanitize(JSON.parse(raw));
			return clean ? { days: clean } : { days: {} };
		} catch (e) {
			canSave = false;
			return { days: {} };
		}
	}

	function save() {
		try { window.localStorage.setItem(KEY, JSON.stringify(data)); canSave = true; }
		catch (e) { canSave = false; memory = data; }
		notice(canSave ? '' : 'This browser is blocking storage (private mode?), so results will be lost when you close the page. Use Export to keep a copy.');
	}

	// Only known games, known fields, bounded sizes. Used for stored data and imports.
	function sanitize(obj) {
		if (!obj || typeof obj !== 'object' || !obj.days || typeof obj.days !== 'object') { return null; }
		var days = {};
		Object.keys(obj.days).forEach(function (k) {
			if (!DAY_RE.test(k) || !obj.days[k] || typeof obj.days[k] !== 'object') { return; }
			Object.keys(obj.days[k]).forEach(function (id) {
				var e = obj.days[k][id];
				if (!P.BY_ID[id] || !e || typeof e !== 'object') { return; }
				var score = typeof e.score === 'number' && isFinite(e.score) ? Math.max(0, Math.min(100, e.score)) : null;
				var entry = {
					name: P.BY_ID[id].name,
					puzzle: typeof e.puzzle === 'number' && isFinite(e.puzzle) ? Math.floor(e.puzzle) : 0,
					raw: String(e.raw == null ? '' : e.raw).slice(0, 40),
					score: score
				};
				if (e.detail) { entry.detail = String(e.detail).slice(0, 120); }
				if (e.label) { entry.label = String(e.label).slice(0, 40); }
				(days[k] || (days[k] = {}))[id] = entry;
			});
		});
		return days;
	}

	var data = load();

	/* Small helpers -------------------------------------------------------- */

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

	function fmt(score) { return score === null || score === undefined ? '—' : String(Math.round(score)); }
	function loggedKeys() { return Object.keys(data.days).filter(function (k) { return Object.keys(data.days[k]).length; }); }
	function ordered(day) {
		return P.GAMES.filter(function (g) { return day[g.id]; }).map(function (g) { return day[g.id]; });
	}

	function say(text, state) { els.status.textContent = text; els.status.setAttribute('data-state', state || ''); }
	function notice(text) { els.toolStatus.textContent = text; }

	/* Rendering ------------------------------------------------------------ */

	function setText(id, value) { document.getElementById(id).textContent = value; }

	function renderStats() {
		var keys = loggedKeys();
		var games = keys.reduce(function (n, k) { return n + Object.keys(data.days[k]).length; }, 0);
		var selected = els.day.value || todayKey();
		setText('stat-streak', String(P.currentStreak(keys, todayKey())));
		setText('stat-best', String(P.bestStreak(keys)));
		setText('stat-days', String(keys.length));
		setText('stat-games', String(games));
		setText('stat-avg', fmt(P.overallAverage(data.days)));
		setText('stat-day', fmt(P.dailyScore(data.days[selected])));
		els.dayLabel.textContent = 'Score · ' + prettyDay(selected);
	}

	function renderHistory() {
		var keys = loggedKeys().sort().reverse().slice(0, 30);
		els.history.textContent = '';
		els.historyEmpty.hidden = keys.length > 0;
		els.historyTable.hidden = keys.length === 0;
		keys.forEach(function (k) {
			var day = data.days[k];
			var tr = el('tr');
			tr.appendChild(el('td', 'history__date', prettyDay(k)));

			var chips = el('div', 'chips');
			ordered(day).forEach(function (e) {
				chips.appendChild(el('span', 'chip', e.name + ' ' + e.raw));
			});
			var tdChips = el('td');
			tdChips.appendChild(chips);
			tr.appendChild(tdChips);

			tr.appendChild(el('td', 'history__score', fmt(P.dailyScore(day))));

			var tdBtn = el('td');
			var btn = el('button', 'link-btn', 'Remove');
			btn.type = 'button';
			btn.setAttribute('aria-label', 'Remove results for ' + prettyDay(k));
			btn.addEventListener('click', function () {
				delete data.days[k];
				save(); renderAll();
			});
			tdBtn.appendChild(btn);
			tr.appendChild(tdBtn);
			els.history.appendChild(tr);
		});
	}

	function renderAverages() {
		var avgs = P.gameAverages(data.days);
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
			row.appendChild(el('dd', null, g.rule));
			els.rules.appendChild(row);
		});
	}

	function renderAll() { renderStats(); renderHistory(); renderAverages(); }

	/* Adding results ------------------------------------------------------- */

	function puzzleIndex() {
		var idx = {};
		Object.keys(data.days).forEach(function (k) {
			Object.keys(data.days[k]).forEach(function (id) { idx[id + ':' + data.days[k][id].puzzle] = k; });
		});
		return idx;
	}

	form.addEventListener('submit', function (e) {
		e.preventDefault();
		var text = els.paste.value.trim();
		var day = DAY_RE.test(els.day.value) ? els.day.value : todayKey();
		els.parsed.textContent = '';

		if (!text) { say('Paste a result first.', 'error'); els.paste.focus(); return; }
		var out = P.parse(text);
		if (!out.results.length) {
			say(out.problems.length ? out.problems[0] : 'I couldn’t find a result I recognise. Tap Share in the game and paste that text.', 'error');
			return;
		}

		var seen = puzzleIndex();
		var addedToday = {};
		var counts = { added: 0, skipped: 0 };
		var touched = {};
		out.results.forEach(function (r) {
			var state, note;
			// A date printed in the share text (Contexto) wins over the date picker.
			var rday = r.date || day;
			var elsewhere = seen[r.game + ':' + r.puzzle];
			var existing = data.days[rday] && data.days[rday][r.game];
			if (rday > todayKey()) {
				state = 'skipped'; note = 'that date is in the future';
			} else if (addedToday[r.game + ':' + rday]) {
				state = 'skipped'; note = 'one result per game per day';
			} else if (elsewhere && elsewhere !== rday) {
				state = 'skipped'; note = 'already logged on ' + prettyDay(elsewhere);
			} else if (existing && existing.puzzle === r.puzzle) {
				state = 'skipped'; note = 'already logged';
			} else {
				state = existing ? 'updated' : 'added';
				var entry = { name: r.name, puzzle: r.puzzle, raw: r.raw, score: r.score };
				if (r.detail) { entry.detail = r.detail; }
				if (r.label) { entry.label = r.label; }
				(data.days[rday] || (data.days[rday] = {}))[r.game] = entry;
				addedToday[r.game + ':' + rday] = true;
				touched[rday] = true;
			}
			if (state === 'skipped') { counts.skipped++; } else { counts.added++; }

			var li = el('li');
			var left = el('span');
			left.appendChild(el('strong', null, r.name + ' ' + (r.label || '#' + r.puzzle.toLocaleString())));
			left.appendChild(document.createTextNode(' · ' + r.raw));
			li.appendChild(left);
			li.appendChild(el('span', null, state === 'skipped' ? 'Skipped: ' + note : (r.score === null ? 'Logged (not scored yet)' : 'Score ' + fmt(r.score)) + (state === 'updated' ? ' · updated' : '') + (r.date && state !== 'skipped' ? ' · filed under ' + prettyDay(rday) : '')));
			els.parsed.appendChild(li);
		});

		if (counts.added) { save(); }
		var touchedDays = Object.keys(touched);
		var where = touchedDays.length === 1 ? prettyDay(touchedDays[0]) : touchedDays.length + ' days';
		var parts = [counts.added + (counts.added === 1 ? ' result' : ' results') + ' added' + (counts.added ? ' for ' + where : '')];
		if (counts.skipped) { parts.push(counts.skipped + ' skipped'); }
		if (out.problems.length) { parts.push(out.problems[0]); }
		say(parts.join('. ') + '.', counts.added ? 'ok' : 'error');
		if (counts.added) { els.paste.value = ''; }
		renderAll();
	});

	els.day.addEventListener('change', renderStats);

	/* Toolbar -------------------------------------------------------------- */

	function summaryText() {
		var selected = els.day.value || todayKey();
		var day = data.days[selected] || {};
		var line = ordered(day).map(function (e) { return e.name + ' ' + e.raw; }).join(' · ');
		var keys = loggedKeys();
		return 'Trivia score for ' + prettyDay(selected) + ': ' + fmt(P.dailyScore(day)) +
			(line ? '\n' + line : '') +
			'\nStreak: ' + P.currentStreak(keys, todayKey()) + ' days' +
			'\nhttps://mattkennedy24.github.io/games.html';
	}

	function copy(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text);
		}
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

	document.getElementById('btn-copy').addEventListener('click', function () {
		if (!Object.keys(data.days[els.day.value || todayKey()] || {}).length) { notice('Nothing logged for that day yet.'); return; }
		copy(summaryText()).then(function () { notice('Copied. Paste it into a group chat.'); },
			function () { notice('Couldn’t copy automatically. Your browser blocked it.'); });
	});

	document.getElementById('btn-export').addEventListener('click', function () {
		var blob = new Blob([JSON.stringify({ version: 1, days: data.days }, null, 2)], { type: 'application/json' });
		var a = el('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'trivia-scores-' + todayKey() + '.json';
		document.body.appendChild(a); a.click(); document.body.removeChild(a);
		window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		notice('Exported. Import it on another device to carry your history over.');
	});

	document.getElementById('btn-import').addEventListener('click', function () { els.importInput.click(); });
	els.importInput.addEventListener('change', function () {
		var file = els.importInput.files && els.importInput.files[0];
		els.importInput.value = '';
		if (!file) { return; }
		if (file.size > 2 * 1024 * 1024) { notice('That file is too large to be a scorecard export.'); return; }
		var reader = new FileReader();
		reader.onload = function () {
			var clean;
			try { clean = sanitize(JSON.parse(reader.result)); } catch (err) { clean = null; }
			if (!clean) { notice('That doesn’t look like a scorecard export.'); return; }
			var n = 0;
			Object.keys(clean).forEach(function (k) {
				Object.keys(clean[k]).forEach(function (id) {
					(data.days[k] || (data.days[k] = {}))[id] = clean[k][id]; n++;
				});
			});
			save(); renderAll();
			notice('Imported ' + n + (n === 1 ? ' result.' : ' results.'));
		};
		reader.onerror = function () { notice('Couldn’t read that file.'); };
		reader.readAsText(file);
	});

	document.getElementById('btn-reset').addEventListener('click', function () {
		if (!window.confirm('Delete all results saved in this browser? This can’t be undone.')) { return; }
		data = { days: {} };
		save(); renderAll();
		els.parsed.textContent = '';
		say('', '');
		notice('Scorecard cleared.');
	});

	/* Start ---------------------------------------------------------------- */

	els.day.value = todayKey();
	els.day.max = todayKey();
	renderRules();
	renderAll();
	if (!canSave) { notice('This browser is blocking storage (private mode?), so results will be lost when you close the page. Use Export to keep a copy.'); }
})();
