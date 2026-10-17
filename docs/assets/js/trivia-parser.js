/*
	Trivia parser + stats.

	Pure functions with no DOM or storage access, so the same file runs in the
	browser (games.html) and in Node (tests, and later a Railway service that
	re-parses pasted text on the server instead of trusting the browser).

	Each game turns a pasted share-text into:
	  { game, name, puzzle, raw, score, detail }
	where `score` is normalised to 0-100, or null when the scoring rule for that
	game has not been defined yet (it is still logged, and counts toward streaks).
*/
(function (root, factory) {
	if (typeof module === 'object' && module.exports) { module.exports = factory(); }
	else { root.TriviaParser = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var toInt = function (s) { return parseInt(String(s).replace(/,/g, ''), 10); };
	var round1 = function (n) { return Math.round(n * 10) / 10; };

	/* Scoring rules (all produce 0-100) ----------------------------------- */

	// Wordle: fewer guesses is better; any solve beats a fail.
	var WORDLE_SCORES = { 1: 100, 2: 85, 3: 70, 4: 55, 5: 40, 6: 25 };
	function wordleScore(guesses) { return guesses === 'X' ? 0 : WORDLE_SCORES[guesses]; }

	// Connections: solved = 100 minus 20 per mistake; unsolved = 10 per group found.
	function connectionsScore(solved, mistakes, groups) {
		return solved ? Math.max(0, 100 - 20 * mistakes) : groups * 10;
	}

	// TimeGuessr: points as a share of the maximum.
	function timeguessrScore(points, max) { return max > 0 ? round1((points / max) * 100) : null; }

	// Contexto: fewer guesses is better on a log scale (1 = 100, 10 = 75, 100 = 50),
	// 3 points off per hint, never below 10 once solved. Giving up scores 0.
	function contextoScore(guesses, hints, gaveUp) {
		if (gaveUp) { return 0; }
		var base = 100 - 25 * Math.log10(Math.max(1, guesses));
		return round1(Math.max(10, base - 3 * (hints || 0)));
	}

	// Fermi: the score is a multiplier, how far off your estimates were, so 1x is perfect
	// and lower is better. On a log scale: 1x = 100, 10x = 67, 100x = 33, 1,000x = 0.
	function fermiScore(multiplier) {
		if (!(multiplier > 0)) { return null; }
		return round1(Math.max(0, Math.min(100, 100 * (1 - Math.log10(Math.max(1, multiplier)) / 3))));
	}

	// The Dozen: share of squares answered correctly, half credit for a correct
	// answer after a double dip (purple).
	function dozenScore(greens, purples, total) {
		return total > 0 ? round1(((greens + 0.5 * purples) / total) * 100) : null;
	}

	// Contexto prints a date instead of a puzzle number. US order (MM/DD/YYYY) unless
	// the first number can only be a day. Returns { key: 'YYYY-MM-DD', id: 20260801 } or null.
	function parseSlashDate(str) {
		var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
		if (!m) { return null; }
		var a = +m[1], b = +m[2], y = +m[3];
		var month = a, day = b;
		if (a > 12 && b <= 12) { month = b; day = a; }
		if (month < 1 || month > 12 || day < 1 || day > 31) { return null; }
		var d = new Date(Date.UTC(y, month - 1, day));
		if (d.getUTCMonth() !== month - 1) { return null; }
		var pad = function (n) { return (n < 10 ? '0' : '') + n; };
		return { key: y + '-' + pad(month) + '-' + pad(day), id: y * 10000 + month * 100 + day };
	}

	/* Game registry ------------------------------------------------------- */

	var SQUARES = ['🟨', '🟩', '🟦', '🟪'];   // yellow, green, blue, purple

	var GAMES = [
		{
			id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle',
			rule: '1 guess = 100, then 85, 70, 55, 40, 25 for 6 guesses. A miss is 0.',
			header: /Wordle\s+([\d,]+)\s+([1-6X])\s*\/\s*6\*?/gi,
			parse: function (m) {
				var g = m[2] === 'X' ? 'X' : parseInt(m[2], 10);
				return { puzzle: toInt(m[1]), raw: g + '/6', score: wordleScore(g) };
			}
		},
		{
			id: 'connections', name: 'Connections', url: 'https://www.nytimes.com/games/connections',
			rule: 'Solved: 100 minus 20 per mistake. Not solved: 10 per group found.',
			header: /Connections[ \t]*\n[ \t]*Puzzle[ \t]*#?[ \t]*([\d,]+)/gi,
			parse: function (m, block) {
				var rows = block.split('\n').map(function (l) { return Array.from(l.trim()); })
					.filter(function (cells) {
						return cells.length === 4 && cells.every(function (c) { return SQUARES.indexOf(c) !== -1; });
					});
				if (!rows.length) { return { problem: 'Connections: I could not find the colour rows.' }; }
				var groups = rows.filter(function (r) { return r.every(function (c) { return c === r[0]; }); }).length;
				var mistakes = rows.length - groups;
				var solved = groups === 4;
				return {
					puzzle: toInt(m[1]),
					raw: solved ? (mistakes === 0 ? 'perfect' : mistakes + (mistakes === 1 ? ' mistake' : ' mistakes')) : groups + '/4 groups',
					score: connectionsScore(solved, mistakes, groups)
				};
			}
		},
		{
			id: 'contexto', name: 'Contexto', url: 'https://contexto.me',
			rule: 'Fewer guesses is better on a log scale: 1 guess = 100, 10 = 75, 100 = 50. Each hint costs 3 points. Giving up scores 0.',
			header: /I played contexto\.me\s+(#?[\d\/,]+)\s+(and got it in|but I gave up in)\s+([\d,]+)\s+guess(?:es)?(?:\s+and\s+([\d,]+)\s+(?:hint|tip)s?)?/gi,
			parse: function (m) {
				var guesses = toInt(m[3]);
				var gaveUp = /gave up/i.test(m[2]);
				var hints = m[4] ? toInt(m[4]) : 0;
				var out = { raw: gaveUp ? 'gave up' : guesses + (guesses === 1 ? ' guess' : ' guesses') + (hints ? ' + ' + hints + (hints === 1 ? ' hint' : ' hints') : ''),
					score: contextoScore(guesses, hints, gaveUp) };
				if (m[1].charAt(0) === '#') {
					out.puzzle = toInt(m[1].slice(1));
				} else {
					var d = parseSlashDate(m[1]);
					if (!d) { return { problem: 'Contexto: I could not read the date ' + m[1] + '.' }; }
					out.puzzle = d.id; out.label = m[1]; out.date = d.key;
				}
				return out;
			}
		},
		{
			id: 'timeguessr', name: 'TimeGuessr', url: 'https://timeguessr.com',
			rule: 'Your points as a share of the 50,000 maximum.',
			header: /TimeGuessr\s*#\s*(\d+)\s*[—–-]+\s*([\d,]+)\s*\/\s*([\d,]+)/gi,
			parse: function (m) {
				var pts = toInt(m[2]), max = toInt(m[3]);
				return { puzzle: toInt(m[1]), raw: m[2] + '/' + m[3], score: timeguessrScore(pts, max) };
			}
		},
		{
			id: 'krillion', name: 'Krillion', url: 'https://krillion.io',
			rule: 'Logged for streaks. Not in the average yet.',
			header: /Krillion\s*#\s*(\d+)/gi,
			parse: function (m, block) {
				var pts = /^[ \t]*([\d,]+)[ \t]*$/m.exec(block.slice(m[0].length));
				return { puzzle: toInt(m[1]), raw: pts ? pts[1] + ' pts' : 'played', score: null };
			}
		},
		{
			id: 'fermi', name: 'Fermi', url: 'https://fermi.gg',
			rule: 'Your score is a multiplier of how far off your estimates were (1\u00D7 is perfect, lower is better), on a log scale: 1\u00D7 = 100, 10\u00D7 = 67, 100\u00D7 = 33, 1,000\u00D7 = 0.',
			header: /Fermi\s*(?:[\u00B7\u2022|\-\u2013\u2014]\s*)?No\.?\s*0*(\d+)/gi,
			parse: function (m, block) {
				// The share sheet can put a bare "Fermi No. 83" title above the real card, so a
				// block with no score line is "incomplete" and is dropped if a full one follows.
				var sc = /([\d,]+(?:\.\d+)?)\s*[\u00D7x]\s*score/i.exec(block);
				if (!sc) { return { incomplete: true }; }
				var mult = parseFloat(sc[1].replace(/,/g, ''));
				var top = /top\s*(\d+)\s*%/i.exec(block);
				return { puzzle: toInt(m[1]), raw: sc[1] + '\u00D7', score: fermiScore(mult), detail: top ? 'Top ' + top[1] + '%' : '' };
			}
		},
		{
			id: 'dozen', name: 'The Dozen', url: 'https://dailydozentrivia.com',
			rule: 'The share of questions answered correctly from the colour squares, with half credit for a correct answer after a double dip (purple).',
			header: /The Dozen:?\s*Daily Trivia[ \t]*\n[ \t]*Game[ \t]*#?[ \t]*([\d,]+)/gi,
			parse: function (m, block) {
				var DOZEN_SQUARES = ['\uD83D\uDFE5', '\uD83D\uDFE9', '\uD83D\uDFEA'];   // red, green, purple
				var cells = [];
				block.split('\n').forEach(function (line) {
					var chars = Array.from(line.trim());
					if (chars.length && chars.every(function (c) { return DOZEN_SQUARES.indexOf(c) !== -1; })) { cells = cells.concat(chars); }
				});
				if (!cells.length) { return { problem: 'The Dozen: I could not find the colour squares.' }; }
				var greens = cells.filter(function (c) { return c === DOZEN_SQUARES[1]; }).length;
				var purples = cells.filter(function (c) { return c === DOZEN_SQUARES[2]; }).length;
				var out = { puzzle: toInt(m[1]), raw: (greens + purples) + '/' + cells.length + ' correct', score: dozenScore(greens, purples, cells.length) };
				var pts = /Score:\s*([\d,]+)/i.exec(block), time = /Time\s+(\d+:\d{2})/i.exec(block);
				out.detail = [pts ? 'Score ' + pts[1] : '', time ? time[1] : ''].filter(Boolean).join(', ');
				return out;
			}
		},
		{
			id: 'top5', name: 'Top 5 Trivia', url: 'https://topfivetrivia.com',
			rule: 'Logged for streaks. Not in the average yet.',
			header: /^[ \t]*(Top\s*(?:5|five)\b[^\n]*?)\s*\(#\s*(\d+)\s*\)[ \t]*$/gim,
			parse: function (m) {
				return { puzzle: toInt(m[2]), raw: 'played', score: null, detail: m[1].trim() };
			}
		}
	];

	var BY_ID = {};
	GAMES.forEach(function (g) { BY_ID[g.id] = g; });

	/* Parsing ------------------------------------------------------------- */

	// Accepts one result or several pasted together, in any order.
	function parse(text) {
		var src = String(text || '').replace(/\r\n?/g, '\n');
		var found = [];
		GAMES.forEach(function (game) {
			var re = new RegExp(game.header.source, game.header.flags);
			var m;
			while ((m = re.exec(src)) !== null) {
				found.push({ game: game, match: m, index: m.index });
				if (m[0].length === 0) { re.lastIndex++; }
			}
		});
		found.sort(function (a, b) { return a.index - b.index; });

		var results = [], problems = [], incomplete = [];
		found.forEach(function (f, i) {
			var end = i + 1 < found.length ? found[i + 1].index : src.length;
			var parsed = f.game.parse(f.match, src.slice(f.index, end));
			if (parsed.incomplete) { incomplete.push(f.game); return; }
			if (parsed.problem) { problems.push(parsed.problem); return; }
			parsed.game = f.game.id;
			parsed.name = f.game.name;
			results.push(parsed);
		});
		incomplete.forEach(function (game) {
			if (!results.some(function (r) { return r.game === game.id; })) {
				problems.push(game.name + ': I could not find the score in that paste.');
			}
		});
		return { results: results, problems: problems };
	}

	/* Dates and stats ----------------------------------------------------- */

	// Day keys are 'YYYY-MM-DD'. All math is in UTC so daylight saving can't skew it.
	function dayNumber(key) {
		var p = key.split('-');
		return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
	}

	function dailyScore(day) {
		var scores = Object.keys(day || {}).map(function (id) { return day[id].score; })
			.filter(function (s) { return typeof s === 'number'; });
		if (!scores.length) { return null; }
		return round1(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
	}

	// Consecutive days with at least one game logged. Today not being logged yet
	// does not break the streak; it only ends once a whole day has been missed.
	function currentStreak(dayKeys, todayKey) {
		var set = {};
		dayKeys.forEach(function (k) { set[dayNumber(k)] = true; });
		var d = dayNumber(todayKey);
		if (!set[d]) { d -= 1; }
		var n = 0;
		while (set[d]) { n++; d--; }
		return n;
	}

	function bestStreak(dayKeys) {
		var nums = dayKeys.map(dayNumber).sort(function (a, b) { return a - b; });
		var best = 0, run = 0, prev = null;
		nums.forEach(function (n) {
			if (n === prev) { return; }
			run = prev !== null && n === prev + 1 ? run + 1 : 1;
			if (run > best) { best = run; }
			prev = n;
		});
		return best;
	}

	function gameAverages(days) {
		var sums = {};
		Object.keys(days).forEach(function (k) {
			Object.keys(days[k]).forEach(function (id) {
				var e = days[k][id];
				var s = sums[id] || (sums[id] = { played: 0, scored: 0, total: 0 });
				s.played++;
				if (typeof e.score === 'number') { s.scored++; s.total += e.score; }
			});
		});
		Object.keys(sums).forEach(function (id) {
			sums[id].average = sums[id].scored ? round1(sums[id].total / sums[id].scored) : null;
		});
		return sums;
	}

	function overallAverage(days) {
		var vals = Object.keys(days).map(function (k) { return dailyScore(days[k]); })
			.filter(function (s) { return s !== null; });
		return vals.length ? round1(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null;
	}

	return {
		GAMES: GAMES,
		BY_ID: BY_ID,
		parse: parse,
		wordleScore: wordleScore,
		connectionsScore: connectionsScore,
		contextoScore: contextoScore,
		fermiScore: fermiScore,
		dozenScore: dozenScore,
		parseSlashDate: parseSlashDate,
		timeguessrScore: timeguessrScore,
		dailyScore: dailyScore,
		currentStreak: currentStreak,
		bestStreak: bestStreak,
		gameAverages: gameAverages,
		overallAverage: overallAverage,
		dayNumber: dayNumber
	};
}));
