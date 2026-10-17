// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../docs/assets/js/trivia-parser.js');

/* ---------- Real share-texts, exactly as the games produce them ---------- */

const WORDLE = `Wordle 1,946 5/6

⬛⬛⬛⬛🟩
⬛⬛⬛🟨🟩
⬛⬛⬛🟨🟩
🟩⬛🟨⬛🟩
🟩🟩🟩🟩🟩`;

const CONNECTIONS = `Connections
Puzzle #1224
🟨🟨🟨🟨
🟩🟩🟩🟩
🟪🟪🟪🟪
🟦🟦🟦🟦`;

const CONTEXTO_WIN = `I played contexto.me 08/01/2026 and got it in 1 guesses.

🟩 1
 0
 0`;

const CONTEXTO_GAVE_UP = `I played contexto.me 08/02/2026 but I gave up in 12 guesses and 9 hints.

🟩🟩🟩🟩 16
🟨 1
🟥 4`;

const TIMEGUESSR = `TimeGuessr #1235 — 24,002/50,000

1️⃣ 🏆2512 - 📅8y - 🌍6247.6 mi
2️⃣ 🏆1497 - 📅20y - 🌍3116.3 mi
3️⃣ 🏆5131 - 📅16y - 🌍229.4 mi
4️⃣ 🏆7766 - 📅6y - 🌍83.3 mi
5️⃣ 🏆7096 - 📅4y - 🌍874.4 mi

https://timeguessr.com`;

const KRILLION_1 = `Krillion #94 🦐
250

🦑🦑🦑🫧🐟⬛🐟`;

const KRILLION_2 = `Krillion #94 🦐
325

🌟🏮🦑🐟🫧🫧🐟`;

const FERMI = `Fermi

Fermi No. 83

Fermi · No. 83
01  1.36×
02  1,167×
03  1.10×
─────────
11.4× score · top 62%
<https://fermi.gg/s/daily>`;

const DOZEN = `The Dozen: Daily Trivia
Game 1182

Score: 5
🟥🟥🟥
🟥🟥🟩
🟥🟥🟥
1 Correct, Time 03:04

DailyDozenTrivia.com

@TheDozenTrivia x @BarstoolSports
#TheDailyDozen`;

const TOP5 = `Top 5 Best television shows of the 21st century (per New York Times) (#966)
⬜🟨⬜🟧⬜🟩⬜🟥⬜
https://topfivetrivia.com/?utm_medium=share`;

const ok = (id, text) => {
	const out = T.parseGame(id, text);
	assert.equal(out.error, undefined, out.error);
	return out.result;
};

/* ---------- Each game, from the real pastes ---------- */

test('Wordle: real paste (5/6 = 48, not a star)', () => {
	const r = ok('wordle', WORDLE);
	assert.deepEqual([r.puzzle, r.raw, r.score, r.star], [1946, '5/6', 48, false]);
});

test('Wordle: curve, miss, hard-mode star, and the 2-guess star boundary', () => {
	assert.deepEqual([1, 2, 3, 4, 5, 6].map(T.wordleScore), [100, 92, 78, 65, 48, 30]);
	assert.equal(ok('wordle', 'Wordle 1,947 X/6\n\n⬛⬛⬛⬛⬛').score, 0);
	assert.equal(ok('wordle', 'Wordle 1,948 1/6*\n\n🟩🟩🟩🟩🟩').score, 100);
	assert.equal(ok('wordle', 'Wordle 1,949 2/6\n\n⬛⬛⬛⬛⬛\n🟩🟩🟩🟩🟩').star, true);
	assert.equal(ok('wordle', 'Wordle 1,950 3/6\n\n⬛⬛⬛⬛⬛').star, false);
	assert.equal(ok('wordle', 'Wordle 1,951 X/6\n\n⬛⬛⬛⬛⬛').star, false);
});

test('Connections: real perfect run = 100 and a star', () => {
	const r = ok('connections', CONNECTIONS);
	assert.deepEqual([r.puzzle, r.raw, r.score, r.star], [1224, 'perfect', 100, true]);
});

test('Connections: mistakes cost 20 each, no star; unsolved = 10 per group', () => {
	const oneMistake = 'Connections\nPuzzle #567\n🟨🟨🟨🟨\n🟩🟩🟦🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪';
	let r = ok('connections', oneMistake);
	assert.deepEqual([r.score, r.raw, r.star], [80, '1 mistake', false]);
	const unsolved = 'Connections\nPuzzle #568\n🟨🟨🟨🟨\n🟩🟦🟩🟩\n🟦🟪🟦🟦\n🟪🟩🟪🟪\n🟩🟦🟪🟨';
	r = ok('connections', unsolved);
	assert.deepEqual([r.score, r.raw, r.star], [10, '1/4 groups', false]);
	assert.deepEqual([0, 1, 2, 3].map((m) => T.connectionsScore(true, m, 4)), [100, 80, 60, 40]);
});

test('Contexto: real one-guess win = 100 and a star; the date is the puzzle id', () => {
	const r = ok('contexto', CONTEXTO_WIN);
	assert.deepEqual([r.score, r.star, r.raw, r.date, r.puzzle, r.label], [100, true, '1 guess', '2026-08-01', 20260801, '08/01/2026']);
	assert.equal(r.detail, '1 green, 0 yellow, 0 red');   // zero-count lines arrive without emoji
});

test('Contexto: real give-up = 0 and still counts as played', () => {
	const r = ok('contexto', CONTEXTO_GAVE_UP);
	assert.deepEqual([r.score, r.star, r.raw, r.date], [0, false, 'gave up', '2026-08-02']);
	assert.equal(r.detail, '16 green, 1 yellow, 4 red');
});

test('Contexto: log curve with a steeper drop after 20 (1 = 100, 20 ≈ 82, 100 = 50)', () => {
	assert.equal(T.contextoBase(1), 100);
	assert.equal(Math.round(T.contextoBase(10)), 86);
	assert.equal(Math.round(T.contextoBase(20)), 82);
	assert.equal(Math.round(T.contextoBase(100)), 50);
	assert.ok(T.contextoBase(20) - T.contextoBase(40) > T.contextoBase(10) - T.contextoBase(20), 'drops faster after the pivot');
	assert.equal(T.contextoScore(100, 0, false, {}), 50);
	assert.equal(T.contextoScore(100, 2, false, {}), 44);          // 3 points per hint
	assert.equal(T.contextoScore(100000, 0, false, {}), 10);       // floor once solved
	assert.equal(T.contextoScore(5, 0, true, {}), 0);
});

test('Contexto: green adds and red subtracts, up to 10 points; yellow is neutral', () => {
	const base = T.contextoScore(50, 0, false, { green: 10, yellow: 10, red: 10 });
	assert.equal(base, 63.7);                                              // equal green and red cancel
	assert.equal(T.contextoScore(50, 0, false, { green: 0, yellow: 30, red: 0 }), 63.7);   // yellow only: neutral
	assert.equal(T.contextoScore(50, 0, false, { green: 30, yellow: 0, red: 0 }), 73.7);   // all green: +10
	assert.equal(T.contextoScore(50, 0, false, { green: 0, yellow: 0, red: 30 }), 53.7);   // all red: -10
	assert.equal(T.contextoScore(50, 0, false, {}), 63.7);                 // no colour lines: neutral
});

test('Contexto: star needs fewer than 20 guesses and no hints', () => {
	assert.equal(ok('contexto', 'I played contexto.me #1 and got it in 19 guesses.').star, true);
	assert.equal(ok('contexto', 'I played contexto.me #1 and got it in 20 guesses.').star, false);
	assert.equal(ok('contexto', 'I played contexto.me #1 and got it in 5 guesses and 1 hint.').star, false);
	assert.equal(ok('contexto', 'I played contexto.me #1 but I gave up in 3 guesses.').star, false);
});

test('Contexto: numbered form and "tips" wording; bad dates are rejected', () => {
	const r = ok('contexto', 'I played contexto.me #1145 and got it in 54 guesses and 3 tips.');
	assert.deepEqual([r.puzzle, r.date, r.raw], [1145, undefined, '54 guesses + 3 hints']);
	assert.equal(T.parseSlashDate('08/01/2026').key, '2026-08-01');
	assert.equal(T.parseSlashDate('25/12/2026').key, '2026-12-25');
	assert.equal(T.parseSlashDate('02/30/2026'), null);
	assert.match(T.parseGame('contexto', 'I played contexto.me 13/13/2026 and got it in 4 guesses.').error, /date/);
});

test('TimeGuessr: real paste (24,002 / 50,000 = 48), star at 45,000+', () => {
	const r = ok('timeguessr', TIMEGUESSR);
	assert.deepEqual([r.puzzle, r.raw, r.score, r.star], [1235, '24,002/50,000', 48, false]);
	assert.equal(ok('timeguessr', 'TimeGuessr #1 — 45,000/50,000').star, true);
	assert.equal(ok('timeguessr', 'TimeGuessr #1 — 44,999/50,000').star, false);
	assert.equal(ok('timeguessr', 'TimeGuessr #1 — 50,000/50,000').score, 100);
});

test('Krillion: both real attempts (250 → 65, 325 → 78.1); 0, 450 and above', () => {
	assert.equal(ok('krillion', KRILLION_1).score, 65);
	const second = ok('krillion', KRILLION_2);
	assert.deepEqual([second.puzzle, second.raw, second.score], [94, '325 pts', 78.1]);
	assert.deepEqual([0, 150, 250, 350, 450, 600].map(T.krillionScore), [0, 39, 65, 82.5, 100, 100]);
});

test('Krillion: a title with no score is an error, not a guess', () => {
	assert.match(T.parseGame('krillion', 'Krillion #95 🦐\n\n🦑🦑🦑🫧🐟⬛🐟').error, /score/);
});

test('Fermi: real paste with the duplicated title gives exactly one result (11.4× = 64.8)', () => {
	const r = ok('fermi', FERMI);
	assert.deepEqual([r.puzzle, r.raw, r.score, r.detail], [83, '11.4×', 64.8, 'Top 62%']);
	assert.equal(T.parse(FERMI).results.length, 1);
});

test('Fermi: log scale and clamping; comma and zero-padded numbers', () => {
	assert.deepEqual([0.5, 1, 10, 100, 1000, 5000].map(T.fermiScore), [100, 100, 66.7, 33.3, 0, 0]);
	assert.equal(T.fermiScore(0), null);
	const r = ok('fermi', 'Fermi · No. 083\n01  2×\n─────────\n1,234× score · top 99%');
	assert.deepEqual([r.puzzle, r.raw, r.score], [83, '1,234×', 0]);
});

test('Fermi: a bare title with no score is an error', () => {
	assert.match(T.parseGame('fermi', 'Fermi No. 83').error, /score/);
});

test('The Dozen: real paste ignores time and in-game score (1 green of 9 = 11.1)', () => {
	const r = ok('dozen', DOZEN);
	assert.deepEqual([r.puzzle, r.raw, r.score, r.star], [1182, '1/9 correct', 11.1, false]);
});

test('The Dozen: purple (second try) earns half credit', () => {
	assert.equal(T.dozenScore(1, 1, 9), 16.7);
	const r = ok('dozen', 'The Dozen: Daily Trivia\nGame 1183\n\nScore: 9\n🟩🟪🟥\n🟩🟩🟥\n🟥🟥🟥\n3 Correct, Time 01:00');
	assert.deepEqual([r.raw, r.score], ['4/9 correct', 38.9]);   // (3 + 0.5) / 9
	assert.equal(T.dozenScore(9, 0, 9), 100);
});

test('Top 5: real paste (4 coloured squares = 4/5 = 80); order and misses ignored', () => {
	const r = ok('top5', TOP5);
	assert.deepEqual([r.puzzle, r.raw, r.score, r.star], [966, '4/5', 80, false]);
	assert.match(r.detail, /^Top 5 Best television shows of the 21st century/);
	assert.equal(ok('top5', 'Top 5 Best albums (#1)\n🟥🟧🟨🟩🟦').score, 100);
	assert.equal(ok('top5', 'Top 5 Best albums (#2)\n⬜⬜⬜⬜⬜').score, 0);
	assert.equal(ok('top5', 'Top 5 Best albums (#3)\n⬛🟥⬛🟧⬛🟨⬛🟩⬛🟦').score, 100);   // dark-mode misses
});

/* ---------- One game at a time: wrong game, empty, junk ---------- */

test('parseGame: picking the wrong game names the right one', () => {
	assert.match(T.parseGame('wordle', FERMI).error, /looks like a Fermi result, not Wordle/);
	assert.match(T.parseGame('fermi', WORDLE).error, /looks like a Wordle result, not Fermi/);
});

test('parseGame: empty and unrecognised text give friendly errors, never throw', () => {
	assert.match(T.parseGame('wordle', '').error, /Paste your Wordle result first/);
	assert.match(T.parseGame('wordle', '   \n ').error, /Paste your Wordle result first/);
	assert.match(T.parseGame('wordle', 'hello there').error, /could not find a Wordle result/);
	assert.match(T.parseGame('wordle', null).error, /Paste your Wordle result first/);
	assert.match(T.parseGame('nope', WORDLE).error, /not supported/);
});

test('parseGame: CRLF line endings and trailing whitespace are fine', () => {
	assert.equal(ok('wordle', WORDLE.replace(/\n/g, '\r\n') + '\r\n\r\n   ').score, 48);
});

test('parseGame: a Connections paste with no colour rows is an error, not a guess', () => {
	assert.match(T.parseGame('connections', 'Connections\nPuzzle #569\n').error, /colour rows/);
});

test('detect: recognises every real sample', () => {
	const map = { wordle: WORDLE, connections: CONNECTIONS, contexto: CONTEXTO_WIN, timeguessr: TIMEGUESSR, krillion: KRILLION_1, fermi: FERMI, dozen: DOZEN, top5: TOP5 };
	Object.keys(map).forEach((id) => assert.equal(T.detect(map[id]), id, id));
	assert.equal(T.detect('hello'), null);
});

test('multi-game parse still handles a whole blob, in any order', () => {
	const blob = [TOP5, KRILLION_1, TIMEGUESSR, WORDLE, CONNECTIONS, CONTEXTO_WIN, CONTEXTO_GAVE_UP, DOZEN, FERMI].join('\n');
	const { results, problems } = T.parse(blob);
	assert.equal(problems.length, 0, problems.join('; '));
	assert.deepEqual(results.map((r) => r.game).sort(), ['connections', 'contexto', 'contexto', 'dozen', 'fermi', 'krillion', 'timeguessr', 'top5', 'wordle']);
});

/* ---------- Better never scores lower ---------- */

const nonIncreasing = (xs) => xs.every((x, i) => i === 0 || x <= xs[i - 1]);
const nonDecreasing = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

test('monotonic: fewer Wordle guesses, fewer mistakes, fewer Fermi misses all score higher', () => {
	assert.ok(nonIncreasing([1, 2, 3, 4, 5, 6, 'X'].map(T.wordleScore)));
	assert.ok(nonIncreasing([0, 1, 2, 3].map((m) => T.connectionsScore(true, m, 4))));
	assert.ok(nonIncreasing([1, 2, 5, 11.4, 50, 300, 1000, 9000].map(T.fermiScore)));
});

test('monotonic: more TimeGuessr/Krillion/Dozen/Top 5 points score higher', () => {
	assert.ok(nonDecreasing([0, 10000, 24002, 45000, 50000].map((p) => T.timeguessrScore(p, 50000))));
	assert.ok(nonDecreasing([0, 100, 250, 325, 450, 700].map(T.krillionScore)));
	assert.ok(nonDecreasing([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => T.dozenScore(g, 0, 9))));
	assert.ok(nonDecreasing([0, 1, 2, 3, 4, 5].map(T.top5Score)));
});

test('monotonic: more Contexto guesses or hints never score higher; every score is within 0-100', () => {
	const guesses = [1, 2, 5, 10, 19, 20, 21, 40, 100, 300, 1000, 50000];
	const mixed = { green: 5, yellow: 5, red: 5 };
	assert.ok(nonIncreasing(guesses.map((g) => T.contextoScore(g, 0, false, mixed))));
	assert.ok(nonIncreasing([0, 1, 2, 5].map((h) => T.contextoScore(40, h, false, mixed))));
	guesses.forEach((g) => [{}, mixed, { green: 9, yellow: 0, red: 0 }, { green: 0, yellow: 0, red: 9 }].forEach((c) => {
		const s = T.contextoScore(g, 3, false, c);
		assert.ok(s >= 10 && s <= 100, `${g} ${JSON.stringify(c)} -> ${s}`);
	}));
});

/* ---------- Day totals ---------- */

test('summarize: plain average and total with no stars', () => {
	const s = T.summarize({ wordle: { score: 48, star: false }, timeguessr: { score: 48, star: false } });
	assert.deepEqual([s.average, s.total, s.stars, s.games], [48, 96, 0, 2]);
});

test('summarize: a star counts double in the average and adds 10 to the total', () => {
	const s = T.summarize([{ score: 100, star: true }, { score: 50 }, { score: 50 }]);
	assert.equal(s.average, 75);          // (100*2 + 50 + 50) / 4
	assert.equal(s.total, 210);           // 200 + 10 bonus
	assert.equal(s.stars, 1);
	assert.equal(T.summarize([{ score: 100 }, { score: 50 }, { score: 50 }]).average, 66.7);
});

test('summarize: empty day, and unscored results are counted but not averaged', () => {
	assert.deepEqual(T.summarize({}), { average: null, total: 0, stars: 0, games: 0, scored: 0 });
	const s = T.summarize([{ score: null }, { score: 60 }]);
	assert.deepEqual([s.average, s.total, s.games, s.scored], [60, 60, 2, 1]);
});

test('summarize on the real samples: a plausible Saturday', () => {
	const results = [WORDLE, CONNECTIONS, CONTEXTO_WIN, TIMEGUESSR, KRILLION_1, FERMI, DOZEN, TOP5].map((text, i) => {
		const id = ['wordle', 'connections', 'contexto', 'timeguessr', 'krillion', 'fermi', 'dozen', 'top5'][i];
		return ok(id, text);
	});
	const s = T.summarize(results);
	// scores: 48, 100*, 100*, 48, 65, 64.8, 11.1, 80  -> stars: Connections, Contexto
	assert.equal(s.stars, 2);
	assert.equal(s.total, 536.9);         // 516.9 of base scores + 2 stars x 10
	assert.equal(s.average, 71.7);        // (2*100 + 2*100 + 48 + 48 + 65 + 64.8 + 11.1 + 80) / 10
});

test('overall: mean of daily averages, summed totals', () => {
	const o = T.overall([{ average: 75, total: 210, stars: 1, games: 3 }, { average: 50, total: 100, stars: 0, games: 2 }, { average: null, total: 0, stars: 0, games: 0 }]);
	assert.deepEqual(o, { average: 62.5, total: 310, stars: 1, games: 5 });
	assert.equal(T.overall([]).average, null);
});

test('per-game averages count plays, stars and the average base score', () => {
	const days = {
		'2026-10-15': { wordle: { score: 55, star: false }, krillion: { score: null, star: false } },
		'2026-10-16': { wordle: { score: 100, star: true }, timeguessr: { score: 60, star: false } }
	};
	const g = T.gameAverages(days);
	assert.deepEqual([g.wordle.average, g.wordle.played, g.wordle.stars], [77.5, 2, 1]);
	assert.deepEqual([g.krillion.average, g.krillion.played], [null, 1]);
});

/* ---------- Streaks ---------- */

test('streaks: today not logged yet keeps yesterday alive; a missed day breaks it', () => {
	const days = ['2026-10-14', '2026-10-15', '2026-10-16'];
	assert.equal(T.currentStreak(days, '2026-10-17'), 3);
	assert.equal(T.currentStreak(days, '2026-10-16'), 3);
	assert.equal(T.currentStreak(['2026-10-14', '2026-10-15'], '2026-10-17'), 0);
	assert.equal(T.currentStreak([], '2026-10-17'), 0);
});

test('streaks: month, year and leap-day boundaries; best streak', () => {
	assert.equal(T.currentStreak(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01'), 3);
	assert.equal(T.currentStreak(['2025-12-31', '2026-01-01'], '2026-01-01'), 2);
	assert.equal(T.bestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06']), 3);
	assert.equal(T.bestStreak(['2026-10-02', '2026-10-01', '2026-10-01']), 2);
	assert.equal(T.bestStreak([]), 0);
});
