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

		var results = [], problems = [];
		found.forEach(function (f, i) {
			var end = i + 1 < found.length ? found[i + 1].index : src.length;
			var parsed = f.game.parse(f.match, src.slice(f.index, end));
			if (parsed.problem) { problems.push(parsed.problem); return; }
			parsed.game = f.game.id;
			parsed.name = f.game.name;
			results.push(parsed);
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
		timeguessrScore: timeguessrScore,
		dailyScore: dailyScore,
		currentStreak: currentStreak,
		bestStreak: bestStreak,
		gameAverages: gameAverages,
		overallAverage: overallAverage,
		dayNumber: dayNumber
	};
}));
