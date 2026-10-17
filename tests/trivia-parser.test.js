// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../docs/assets/js/trivia-parser.js');

// Real share-texts, exactly as the games produce them.
const TOP5 = `Top 5 Best television shows of the 21st century (per New York Times) (#966)
⬜🟨⬜🟧⬜🟩⬜🟥⬜
https://topfivetrivia.com/?utm_medium=share`;

const KRILLION = `Krillion #94 🦐
250

🦑🦑🦑🫧🐟⬛🐟`;

const TIMEGUESSR = `TimeGuessr #1235 — 24,002/50,000

1️⃣ 🏆2512 - 📅8y - 🌍6247.6 mi
2️⃣ 🏆1497 - 📅20y - 🌍3116.3 mi
3️⃣ 🏆5131 - 📅16y - 🌍229.4 mi
4️⃣ 🏆7766 - 📅6y - 🌍83.3 mi
5️⃣ 🏆7096 - 📅4y - 🌍874.4 mi

https://timeguessr.com`;

const WORDLE = `Wordle 1,946 5/6

⬛⬛⬛⬛🟩
⬛⬛⬛🟨🟩
⬛⬛⬛🟨🟩
🟩⬛🟨⬛🟩
🟩🟩🟩🟩🟩`;

const CONNECTIONS = `Connections
Puzzle #567
🟨🟨🟨🟨
🟩🟩🟦🟩
🟩🟩🟩🟩
🟦🟦🟦🟦
🟪🟪🟪🟪`;

const only = (text) => {
	const { results, problems } = T.parse(text);
	assert.equal(problems.length, 0, problems.join('; '));
	assert.equal(results.length, 1);
	return results[0];
};

test('Wordle: puzzle number with a comma, 5/6', () => {
	const r = only(WORDLE);
	assert.deepEqual([r.game, r.puzzle, r.raw, r.score], ['wordle', 1946, '5/6', 40]);
});

test('Wordle: a miss scores 0, a first-guess solve scores 100, hard-mode star is fine', () => {
	assert.equal(only('Wordle 1,947 X/6\n\n⬛⬛⬛⬛⬛').score, 0);
	assert.equal(only('Wordle 1,948 1/6*\n\n🟩🟩🟩🟩🟩').score, 100);
});

test('TimeGuessr: points over 50,000', () => {
	const r = only(TIMEGUESSR);
	assert.deepEqual([r.game, r.puzzle, r.raw, r.score], ['timeguessr', 1235, '24,002/50,000', 48]);
});

test('Krillion: puzzle number and points, not scored yet', () => {
	const r = only(KRILLION);
	assert.deepEqual([r.game, r.puzzle, r.raw, r.score], ['krillion', 94, '250 pts', null]);
});

test('Top 5: puzzle number and title, not scored yet', () => {
	const r = only(TOP5);
	assert.equal(r.game, 'top5');
	assert.equal(r.puzzle, 966);
	assert.equal(r.score, null);
	assert.match(r.detail, /^Top 5 Best television shows of the 21st century/);
});

test('Connections: one mistake, all four groups found', () => {
	const r = only(CONNECTIONS);
	assert.deepEqual([r.game, r.puzzle, r.score], ['connections', 567, 80]);
	assert.equal(r.raw, '1 mistake');
});

test('Connections: unsolved scores 10 per group found', () => {
	const r = only('Connections\nPuzzle #568\n🟨🟨🟨🟨\n🟩🟦🟩🟩\n🟦🟪🟦🟦\n🟪🟩🟪🟪\n🟩🟦🟪🟨');
	assert.equal(r.score, 10);
	assert.equal(r.raw, '1/4 groups');
});

test('several results pasted together are all found, in order', () => {
	const { results, problems } = T.parse([WORDLE, TIMEGUESSR, KRILLION, TOP5, CONNECTIONS].join('\n\n'));
	assert.equal(problems.length, 0);
	assert.deepEqual(results.map((r) => r.game), ['wordle', 'timeguessr', 'krillion', 'top5', 'connections']);
});

test('Krillion points are not confused with the next game', () => {
	const { results } = T.parse(KRILLION + '\n\n' + WORDLE);
	assert.equal(results[0].raw, '250 pts');
	assert.equal(results[1].game, 'wordle');
});

test('CRLF line endings and extra whitespace still parse', () => {
	const r = only(WORDLE.replace(/\n/g, '\r\n') + '\r\n\r\n   ');
	assert.equal(r.score, 40);
});

test('unrecognised text returns nothing, and does not throw', () => {
	assert.deepEqual(T.parse('hello world').results, []);
	assert.deepEqual(T.parse('').results, []);
	assert.deepEqual(T.parse(null).results, []);
});

test('a Connections paste with no colour rows is reported, not guessed', () => {
	const { results, problems } = T.parse('Connections\nPuzzle #569\n');
	assert.equal(results.length, 0);
	assert.equal(problems.length, 1);
});

test('daily score averages only the scored games', () => {
	const day = {
		wordle: { score: 40 }, timeguessr: { score: 48 },
		krillion: { score: null }, top5: { score: null }
	};
	assert.equal(T.dailyScore(day), 44);
	assert.equal(T.dailyScore({ krillion: { score: null } }), null);
	assert.equal(T.dailyScore({}), null);
});

test('streaks: today not logged yet keeps yesterday\'s streak alive', () => {
	const days = ['2026-10-14', '2026-10-15', '2026-10-16'];
	assert.equal(T.currentStreak(days, '2026-10-17'), 3);
	assert.equal(T.currentStreak(days, '2026-10-16'), 3);
});

test('streaks: a missed whole day breaks it', () => {
	assert.equal(T.currentStreak(['2026-10-14', '2026-10-15'], '2026-10-17'), 0);
	assert.equal(T.currentStreak([], '2026-10-17'), 0);
});

test('streaks: month and year boundaries, leap day, and best streak', () => {
	assert.equal(T.currentStreak(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01'), 3);
	assert.equal(T.currentStreak(['2025-12-31', '2026-01-01'], '2026-01-01'), 2);
	assert.equal(T.bestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06']), 3);
	assert.equal(T.bestStreak(['2026-10-02', '2026-10-01', '2026-10-01']), 2);
	assert.equal(T.bestStreak([]), 0);
});

test('per-game averages and overall average', () => {
	const days = {
		'2026-10-15': { wordle: { score: 55 }, krillion: { score: null } },
		'2026-10-16': { wordle: { score: 25 }, timeguessr: { score: 60 } }
	};
	const g = T.gameAverages(days);
	assert.equal(g.wordle.average, 40);
	assert.equal(g.wordle.played, 2);
	assert.equal(g.krillion.average, null);
	assert.equal(g.krillion.played, 1);
	assert.equal(T.overallAverage(days), 48.8);   // (55 + 42.5) / 2 = 48.75, shown to one decimal
});

/* ---- Real pastes: Connections (real), Contexto (two variants), The Dozen ---- */

const REAL_CONNECTIONS = `Connections
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

test('Connections: the real paste (a perfect run) scores 100', () => {
	const r = only(REAL_CONNECTIONS);
	assert.deepEqual([r.game, r.puzzle, r.raw, r.score], ['connections', 1224, 'perfect', 100]);
});

test('Contexto: a one-guess win; date becomes the puzzle id and the filing day', () => {
	const r = only(CONTEXTO_WIN);
	assert.equal(r.game, 'contexto');
	assert.equal(r.score, 100);
	assert.equal(r.raw, '1 guess');
	assert.equal(r.date, '2026-08-01');
	assert.equal(r.puzzle, 20260801);
	assert.equal(r.label, '08/01/2026');
});

test('Contexto: giving up scores 0 and still counts as played', () => {
	const r = only(CONTEXTO_GAVE_UP);
	assert.deepEqual([r.score, r.raw, r.date], [0, 'gave up', '2026-08-02']);
});

test('Contexto: log-scale scoring and hint penalty', () => {
	assert.equal(T.contextoScore(10, 0, false), 75);
	assert.equal(T.contextoScore(100, 0, false), 50);
	assert.equal(T.contextoScore(100, 2, false), 44);
	assert.equal(T.contextoScore(100000, 0, false), 10);   // floor once solved
	assert.equal(T.contextoScore(5, 0, true), 0);
});

test('Contexto: numbered form and "tips" wording are also understood', () => {
	const r = only('I played contexto.me #1145 and got it in 54 guesses and 3 tips.');
	assert.deepEqual([r.puzzle, r.date, r.raw], [1145, undefined, '54 guesses + 3 hints']);
});

test('Contexto dates: US order by default, day-first when unambiguous, bad dates rejected', () => {
	assert.equal(T.parseSlashDate('08/01/2026').key, '2026-08-01');
	assert.equal(T.parseSlashDate('25/12/2026').key, '2026-12-25');
	assert.equal(T.parseSlashDate('13/13/2026'), null);
	assert.equal(T.parseSlashDate('02/30/2026'), null);
	const { results, problems } = T.parse('I played contexto.me 13/13/2026 and got it in 4 guesses.');
	assert.equal(results.length, 0);
	assert.equal(problems.length, 1);
});

test('The Dozen: game number, grid score, and detail line', () => {
	const r = only(DOZEN);
	assert.equal(r.game, 'dozen');
	assert.equal(r.puzzle, 1182);
	assert.equal(r.raw, '1/9 correct');
	assert.equal(r.score, 11.1);
	assert.equal(r.detail, 'Score 5, 03:04');
});

test('The Dozen: purple (correct after a double dip) earns half credit', () => {
	assert.equal(T.dozenScore(1, 1, 9), 16.7);
	const r = only('The Dozen: Daily Trivia\nGame 1183\n\nScore: 9\n🟩🟪🟥\n🟩🟩🟥\n🟥🟥🟥\n3 Correct, Time 01:00');
	assert.equal(r.raw, '4/9 correct');
	assert.equal(r.score, 38.9);   // (3 + 0.5) / 9
});

test('The Dozen: no squares is reported, not guessed', () => {
	const { results, problems } = T.parse('The Dozen: Daily Trivia\nGame 1184\nScore: 0');
	assert.equal(results.length, 0);
	assert.equal(problems.length, 1);
});

test('everything pasted at once, exactly as sent, parses into the right games', () => {
	const blob = [REAL_CONNECTIONS, CONTEXTO_WIN, CONTEXTO_GAVE_UP, DOZEN].join('\n');   // no blank lines between games
	const { results, problems } = T.parse(blob);
	assert.equal(problems.length, 0, problems.join('; '));
	assert.deepEqual(results.map((r) => r.game), ['connections', 'contexto', 'contexto', 'dozen']);
	assert.deepEqual(results.map((r) => r.score), [100, 100, 0, 11.1]);
});

test('all nine real samples together', () => {
	const all = [TOP5, KRILLION, TIMEGUESSR, WORDLE, REAL_CONNECTIONS, CONTEXTO_WIN, CONTEXTO_GAVE_UP, DOZEN].join('\n\n');
	const { results, problems } = T.parse(all);
	assert.equal(problems.length, 0, problems.join('; '));
	assert.equal(results.length, 8);
	assert.deepEqual(results.map((r) => r.game).sort(), ['connections', 'contexto', 'contexto', 'dozen', 'krillion', 'timeguessr', 'top5', 'wordle']);
});
