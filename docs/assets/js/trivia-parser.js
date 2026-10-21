/*
	Trivia parser, scoring and stats.

	Pure functions with no DOM or storage access, so the same file runs in the
	browser (games.html), in Node (tests), and later in a Railway service that
	re-parses pasted text on the server instead of trusting the browser.

	Each game turns a pasted share-text into:
	  { game, name, puzzle, raw, score, star, detail, label }
	where `score` is a 0-100 base score and `star` marks an exceptional result.

	Scoring v1 (see the rule text on each game below). A day's Average weights star
	results double; its Total adds a bonus per star. Phase 2 (a smarter score that is
	robust to one bad game and to hard puzzles) is tracked in the repo's issues.
	Because the site stores the pasted snippets and re-scores them on load, changing
	a rule here re-scores the whole history.
*/
(function (root, factory) {
	if (typeof module === 'object' && module.exports) { module.exports = factory(); }
	else { root.TriviaParser = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var toInt = function (s) { return parseInt(String(s).replace(/,/g, ''), 10); };
	var round1 = function (n) { return Math.round(n * 10) / 10; };
	var clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };

	var STAR_WEIGHT = 2;    // a star result counts double in the day's Average
	var STAR_BONUS = 10;    // and adds this many points to the day's Total

	/* Scoring rules ------------------------------------------------------- */

	// Wordle: 2 guesses or fewer is a star.
	var WORDLE_SCORES = { 1: 100, 2: 92, 3: 78, 4: 65, 5: 48, 6: 30 };
	function wordleScore(g) { return g === 'X' ? 0 : WORDLE_SCORES[g]; }
	function wordleStar(g) { return g !== 'X' && g <= 2; }

	// Connections: solved = 100, 80, 60, 40 for 0-3 mistakes; unsolved = 10 per group.
	// A perfect run (no mistakes) is a star.
	var CONNECTIONS_SOLVED = [100, 80, 60, 40];
	function connectionsScore(solved, mistakes, groups) {
		return solved ? CONNECTIONS_SOLVED[Math.min(mistakes, 3)] : groups * 10;
	}

	// TimeGuessr: points as a share of the maximum. 45,000 of 50,000 (90%) is a star.
	function timeguessrScore(points, max) { return max > 0 ? round1((points / max) * 100) : null; }
	function timeguessrStar(points, max) { return max > 0 && points >= 0.9 * max; }

	// Contexto: fewer guesses is better on a log scale with a steeper drop after 20
	// (1 = 100, 20 = 82, 100 = 50). Each hint costs 3 points. Green guesses add and red
	// guesses subtract, up to 10 points either way; yellow is neutral. Giving up is 0.
	// Fewer than 20 guesses with no hints is a star.
	var CTX_PIVOT = 20;
	var CTX_TOP = 100 - 14 * Math.log10(CTX_PIVOT);                 // score at the pivot
	var CTX_SLOPE = (CTX_TOP - 50) / Math.log10(100 / CTX_PIVOT);   // so that 100 guesses = 50
	function contextoBase(guesses) {
		var g = Math.max(1, guesses);
		return g <= CTX_PIVOT ? 100 - 14 * Math.log10(g) : CTX_TOP - CTX_SLOPE * Math.log10(g / CTX_PIVOT);
	}
	function contextoScore(guesses, hints, gaveUp, colors) {
		if (gaveUp) { return 0; }
		var c = colors || {}, g = c.green || 0, y = c.yellow || 0, r = c.red || 0;
		var total = g + y + r;
		var quality = total > 0 ? (g - r) / total : 0;
		return round1(clamp(contextoBase(guesses) - 3 * (hints || 0) + 10 * quality, 10, 100));
	}
	function contextoStar(guesses, hints, gaveUp) { return !gaveUp && guesses < 20 && !hints; }

	// Fermi: the score is a multiplier of how far off you were (1x is perfect, lower is
	// better), on a log scale: 1x = 100, 10x = 67, 100x = 33, 1,000x = 0.
	function fermiScore(multiplier) {
		if (!(multiplier > 0)) { return null; }
		return round1(clamp(100 * (1 - Math.log10(Math.max(1, multiplier)) / 3), 0, 100));
	}

	// Krillion: the in-game score. 0 = 0, 250 = 65, 450 or more = 100 (450 is the top tier).
	function krillionScore(points) {
		if (!(points >= 0)) { return null; }
		return round1(points <= 250 ? 65 * (points / 250) : Math.min(100, 65 + 35 * ((points - 250) / 200)));
	}

	// The Dozen: green (first try) counts 1, purple (second try) counts half, red counts 0,
	// over all squares. The time and in-game score are ignored.
	function dozenScore(greens, purples, total) {
		return total > 0 ? round1(((greens + 0.5 * purples) / total) * 100) : null;
	}

	// Top 5 Trivia: the share of the five answers found (coloured squares). Misses and
	// order are ignored for now.
	function top5Score(correct) { return round1((clamp(correct, 0, 5) / 5) * 100); }

	// Contexto prints a date instead of a puzzle number. US order (MM/DD/YYYY) unless the
	// first number can only be a day. Returns { key: 'YYYY-MM-DD', id: 20260801 } or null.
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

	var SQUARES = ['🟨', '🟩', '🟦', '🟪'];                   // Connections: yellow, green, blue, purple
	var DOZEN_SQUARES = ['🟥', '🟩', '🟪'];                             // The Dozen: red, green, purple
	var OTHER_SQUARES = ['⬛', '⬜', '🟧', '🟨', '🟦', '🟫'];   // any other square: not a correct answer
	var TOP5_MISS = ['⬜', '⬛'];                                                             // white / black square
	var TOP5_HIT = ['🟥', '🟧', '🟨', '🟩', '🟦'];  // red, orange, yellow, green, blue = #1-#5

	// Lines made only of the given emoji (optionally exactly n long), as rows and one flat list.
	// Spaces and invisible characters that phones add when copying (variation selectors,
	// zero-width spaces and joiners) are ignored, so "🟥 🟥 🟥" still counts as a row.
	var INVISIBLE = /[\s\uFE0E\uFE0F\u200B-\u200D\u2060\uFEFF]/g;
	function emojiRows(block, allowed, exactLength) {
		var cells = [], rows = [];
		block.split('\n').forEach(function (line) {
			var chars = Array.from(line.replace(INVISIBLE, ''));
			if (chars.length && (!exactLength || chars.length === exactLength) &&
				chars.every(function (c) { return allowed.indexOf(c) !== -1; })) {
				rows.push(chars); cells = cells.concat(chars);
			}
		});
		return { rows: rows, cells: cells };
	}

	var GAMES = [
		{
			id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle',
			example: 'Wordle 1,946 5/6\n\n⬛⬛⬛⬛🟩\n...',
			rule: '1 guess = 100, then 92, 78, 65, 48 and 30 for 6 guesses. A miss is 0.',
			starRule: 'Solved in 2 guesses or fewer.',
			header: /Wordle\s+([\d,]+)\s+([1-6X])\s*\/\s*6\*?/gi,
			parse: function (m) {
				var g = m[2] === 'X' ? 'X' : parseInt(m[2], 10);
				return { puzzle: toInt(m[1]), raw: g + '/6', score: wordleScore(g), star: wordleStar(g) };
			}
		},
		{
			id: 'connections', name: 'Connections', url: 'https://www.nytimes.com/games/connections',
			example: 'Connections\nPuzzle #1224\n🟨🟨🟨🟨\n...',
			rule: 'Solved: 100, minus 20 per mistake. Not solved: 10 per group found.',
			starRule: 'A perfect run, with no mistakes.',
			header: /Connections[ \t]*\n[ \t]*Puzzle[ \t]*#?[ \t]*([\d,]+)/gi,
			parse: function (m, block) {
				var rows = emojiRows(block, SQUARES, 4).rows;
				if (!rows.length) { return { problem: 'Connections: I could not find the colour rows.' }; }
				var groups = rows.filter(function (r) { return r.every(function (c) { return c === r[0]; }); }).length;
				var mistakes = rows.length - groups;
				var solved = groups === 4;
				return {
					puzzle: toInt(m[1]),
					raw: solved ? (mistakes === 0 ? 'perfect' : mistakes + (mistakes === 1 ? ' mistake' : ' mistakes')) : groups + '/4 groups',
					score: connectionsScore(solved, mistakes, groups),
					star: solved && mistakes === 0
				};
			}
		},
		{
			id: 'contexto', name: 'Contexto', url: 'https://contexto.me',
			example: 'I played contexto.me 08/01/2026 and got it in 12 guesses.\n\n🟩 3\n🟨 4\n🟥 5',
			rule: 'Fewer guesses is better: 1 = 100, 20 = 82, 100 = 50, dropping faster after 20. Each hint costs 3 points. Green guesses add and red guesses subtract, up to 10 points either way; yellow is neutral. Giving up scores 0.',
			starRule: 'Solved in fewer than 20 guesses with no hints.',
			header: /I played contexto\.me\s+(#?[\d\/,]+)\s+(and got it in|but I gave up in)\s+([\d,]+)\s+guess(?:es)?(?:\s+and\s+([\d,]+)\s+(?:hint|tip)s?)?/gi,
			parse: function (m, block) {
				var guesses = toInt(m[3]);
				var gaveUp = /gave up/i.test(m[2]);
				var hints = m[4] ? toInt(m[4]) : 0;

				// The three count lines are green, yellow, red, in that order. Zero-count lines
				// can arrive without their emoji, so position is the fallback.
				var colors = { green: 0, yellow: 0, red: 0 };
				var order = ['green', 'yellow', 'red'];
				var byEmoji = { '🟩': 'green', '🟨': 'yellow', '🟥': 'red' };
				var seen = 0;
				block.split('\n').slice(1).forEach(function (line) {
					var cm = /^\s*((?:\uD83D[\uDFE5\uDFE8\uDFE9])*)\s*(\d+)\s*$/.exec(line);
					if (!cm || seen >= 3) { return; }
					var emoji = cm[1] ? Array.from(cm[1])[0] : null;
					colors[(emoji && byEmoji[emoji]) || order[seen]] = parseInt(cm[2], 10);
					seen++;
				});

				var out = {
					raw: gaveUp ? 'gave up' : guesses + (guesses === 1 ? ' guess' : ' guesses') + (hints ? ' + ' + hints + (hints === 1 ? ' hint' : ' hints') : ''),
					score: contextoScore(guesses, hints, gaveUp, colors),
					star: contextoStar(guesses, hints, gaveUp),
					detail: seen ? colors.green + ' green, ' + colors.yellow + ' yellow, ' + colors.red + ' red' : ''
				};
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
			example: 'TimeGuessr #1235 — 24,002/50,000\n...',
			rule: 'Your points as a share of the 50,000 maximum.',
			starRule: '45,000 points or more.',
			header: /TimeGuessr\s*#\s*(\d+)\s*[—–-]+\s*([\d,]+)\s*\/\s*([\d,]+)/gi,
			parse: function (m) {
				var pts = toInt(m[2]), max = toInt(m[3]);
				return { puzzle: toInt(m[1]), raw: m[2] + '/' + m[3], score: timeguessrScore(pts, max), star: timeguessrStar(pts, max) };
			}
		},
		{
			id: 'krillion', name: 'Krillion', url: 'https://krillion.io',
			example: 'Krillion #94 🦐\n250\n\n🦑🦑🦑🫧🐟⬛🐟',
			rule: 'The in-game score: 0 = 0, 250 = 65, 450 or more = 100.',
			starRule: '',
			header: /Krillion\s*#\s*(\d+)/gi,
			parse: function (m, block) {
				var pts = /^[ \t]*([\d,]+)[ \t]*$/m.exec(block.slice(m[0].length));
				if (!pts) { return { problem: 'Krillion: I could not find the score under the title.' }; }
				return { puzzle: toInt(m[1]), raw: pts[1] + ' pts', score: krillionScore(toInt(pts[1])), star: false };
			}
		},
		{
			id: 'fermi', name: 'Fermi', url: 'https://fermi.gg',
			example: 'Fermi · No. 83\n01  1.36×\n02  1,167×\n03  1.10×\n─────────\n11.4× score · top 62%',
			rule: 'Your score is a multiplier of how far off you were (1× is perfect, lower is better), on a log scale: 1× = 100, 10× = 67, 100× = 33, 1,000× = 0.',
			starRule: '',
			header: /Fermi\s*(?:[·•|\-–—]\s*)?No\.?\s*0*(\d+)/gi,
			parse: function (m, block) {
				// The share sheet can put a bare "Fermi No. 83" title above the real card, so a
				// block with no score line is "incomplete" and is dropped if a full one follows.
				var sc = /([\d,]+(?:\.\d+)?)\s*[×x]\s*score/i.exec(block);
				if (!sc) { return { incomplete: true }; }
				var top = /top\s*(\d+)\s*%/i.exec(block);
				return { puzzle: toInt(m[1]), raw: sc[1] + '×', score: fermiScore(parseFloat(sc[1].replace(/,/g, ''))), star: false, detail: top ? 'Top ' + top[1] + '%' : '' };
			}
		},
		{
			id: 'dozen', name: 'The Dozen', url: 'https://dailydozentrivia.com',
			example: 'The Dozen: Daily Trivia\nGame 1182\n\nScore: 5\n🟥🟥🟥\n...',
			rule: 'Nine questions, one square each. Green (right first try) counts 1, purple (right on the double dip) counts half, red counts 0. The time and the in-game score are ignored.',
			starRule: '',
			header: /The Dozen:?\s*Daily Trivia[ \t]*\n[ \t]*Game[ \t]*#?[ \t]*([\d,]+)/gi,
			parse: function (m, block) {
				var cells = emojiRows(block, DOZEN_SQUARES.concat(OTHER_SQUARES)).cells;
				if (!cells.length) { return { problem: 'The Dozen: I could not find the colour squares.' }; }
				if (cells.length !== 9) {
					return { problem: 'The Dozen: I found ' + cells.length + ' squares, but there should be 9 (one per question). Paste the whole result, including all three rows.' };
				}
				var greens = cells.filter(function (c) { return c === DOZEN_SQUARES[1]; }).length;
				var purples = cells.filter(function (c) { return c === DOZEN_SQUARES[2]; }).length;
				return { puzzle: toInt(m[1]), raw: (greens + purples) + '/' + cells.length + ' correct', score: dozenScore(greens, purples, cells.length), star: false };
			}
		},
		{
			id: 'top5', name: 'Top 5 Trivia', url: 'https://topfivetrivia.com',
			example: 'Top 5 Best television shows of the 21st century (#966)\n⬜🟨⬜🟧⬜🟩⬜🟥⬜',
			rule: 'The share of the five answers you found (the coloured squares). Misses and order are ignored for now.',
			starRule: '',
			header: /^[ \t]*(Top\s*(?:5|five)\b[^\n]*?)\s*\(#\s*(\d+)\s*\)[ \t]*$/gim,
			parse: function (m, block) {
				var cells = emojiRows(block, TOP5_HIT.concat(TOP5_MISS)).cells;
				if (!cells.length) { return { problem: 'Top 5: I could not find the squares.' }; }
				var correct = cells.filter(function (c) { return TOP5_HIT.indexOf(c) !== -1; }).length;
				return { puzzle: toInt(m[2]), raw: correct + '/5', score: top5Score(correct), star: false, detail: m[1].trim() };
			}
		}
	];

	var BY_ID = {};
	GAMES.forEach(function (g) { BY_ID[g.id] = g; });

	/* Parsing ------------------------------------------------------------- */

	function normalize(text) { return String(text == null ? '' : text).replace(/\r\n?/g, '\n'); }

	function headerMatches(game, src) {
		var re = new RegExp(game.header.source, game.header.flags);
		var out = [], m;
		while ((m = re.exec(src)) !== null) {
			out.push(m);
			if (m[0].length === 0) { re.lastIndex++; }
		}
		return out;
	}

	// Which game does this text look like? (the earliest recognisable header), or null.
	function detect(text) {
		var src = normalize(text), best = null;
		GAMES.forEach(function (game) {
			var ms = headerMatches(game, src);
			if (ms.length && (best === null || ms[0].index < best.index)) { best = { id: game.id, index: ms[0].index }; }
		});
		return best ? best.id : null;
	}

	// One game's snippet in, one result out: { result } or { error }.
	function parseGame(id, text) {
		var game = BY_ID[id];
		if (!game) { return { error: 'That game is not supported.' }; }
		var src = normalize(text);
		if (!src.trim()) { return { error: 'Paste your ' + game.name + ' result first.' }; }

		var ms = headerMatches(game, src);
		if (!ms.length) {
			var other = detect(src);
			return { error: other && other !== id
				? 'That looks like a ' + BY_ID[other].name + ' result, not ' + game.name + '. Pick ' + BY_ID[other].name + ' in the list.'
				: 'I could not find a ' + game.name + ' result in that. Paste the text the game gives you when you tap Share.' };
		}

		var problem = null;
		for (var i = 0; i < ms.length; i++) {
			var end = i + 1 < ms.length ? ms[i + 1].index : src.length;
			var parsed = game.parse(ms[i], src.slice(ms[i].index, end));
			if (parsed.incomplete) { continue; }
			if (parsed.problem) { problem = problem || parsed.problem; continue; }
			parsed.game = game.id;
			parsed.name = game.name;
			parsed.star = !!parsed.star;
			return { result: parsed };
		}
		return { error: problem || game.name + ': I could not find the score in that paste.' };
	}

	// Several games in one blob, any order (kept for server-side use and tests).
	function parse(text) {
		var src = normalize(text);
		var found = [];
		GAMES.forEach(function (game) {
			headerMatches(game, src).forEach(function (m) { found.push({ game: game, match: m, index: m.index }); });
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
			parsed.star = !!parsed.star;
			results.push(parsed);
		});
		incomplete.forEach(function (game) {
			if (!results.some(function (r) { return r.game === game.id; })) {
				problems.push(game.name + ': I could not find the score in that paste.');
			}
		});
		return { results: results, problems: problems };
	}

	/* Day and history stats ----------------------------------------------- */

	// A day is a list (or id-keyed object) of results. Average: star results count
	// double. Total: every score added up, plus a bonus per star.
	function summarize(day) {
		var list = Array.isArray(day) ? day : Object.keys(day || {}).map(function (k) { return day[k]; });
		var scored = list.filter(function (r) { return r && typeof r.score === 'number'; });
		var stars = scored.filter(function (r) { return r.star; }).length;
		if (!scored.length) { return { average: null, total: 0, stars: 0, games: list.length, scored: 0 }; }
		var weighted = 0, weights = 0, total = 0;
		scored.forEach(function (r) {
			var w = r.star ? STAR_WEIGHT : 1;
			weighted += r.score * w; weights += w; total += r.score;
		});
		return { average: round1(weighted / weights), total: round1(total + STAR_BONUS * stars), stars: stars, games: list.length, scored: scored.length };
	}

	function overall(summaries) {
		var withAvg = summaries.filter(function (s) { return s.average !== null; });
		return {
			average: withAvg.length ? round1(withAvg.reduce(function (a, s) { return a + s.average; }, 0) / withAvg.length) : null,
			total: round1(summaries.reduce(function (a, s) { return a + s.total; }, 0)),
			stars: summaries.reduce(function (a, s) { return a + s.stars; }, 0),
			games: summaries.reduce(function (a, s) { return a + s.games; }, 0)
		};
	}

	// Day keys are 'YYYY-MM-DD'. All math is in UTC so daylight saving can't skew it.
	function dayNumber(key) {
		var p = key.split('-');
		return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
	}

	// Consecutive days with at least one game logged. Today not being logged yet does not
	// break the streak; it only ends once a whole day has been missed.
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

	// days: { 'YYYY-MM-DD': { gameId: result } } -> per-game played count and average base score
	function gameAverages(days) {
		var sums = {};
		Object.keys(days).forEach(function (k) {
			Object.keys(days[k]).forEach(function (id) {
				var e = days[k][id];
				var s = sums[id] || (sums[id] = { played: 0, scored: 0, total: 0, stars: 0 });
				s.played++;
				if (e.star) { s.stars++; }
				if (typeof e.score === 'number') { s.scored++; s.total += e.score; }
			});
		});
		Object.keys(sums).forEach(function (id) {
			sums[id].average = sums[id].scored ? round1(sums[id].total / sums[id].scored) : null;
		});
		return sums;
	}

	return {
		GAMES: GAMES,
		BY_ID: BY_ID,
		STAR_WEIGHT: STAR_WEIGHT,
		STAR_BONUS: STAR_BONUS,
		detect: detect,
		parseGame: parseGame,
		parse: parse,
		wordleScore: wordleScore,
		connectionsScore: connectionsScore,
		timeguessrScore: timeguessrScore,
		contextoScore: contextoScore,
		contextoBase: contextoBase,
		fermiScore: fermiScore,
		krillionScore: krillionScore,
		dozenScore: dozenScore,
		top5Score: top5Score,
		parseSlashDate: parseSlashDate,
		summarize: summarize,
		overall: overall,
		currentStreak: currentStreak,
		bestStreak: bestStreak,
		gameAverages: gameAverages,
		dayNumber: dayNumber
	};
}));
