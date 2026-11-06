'use strict';

/**
 * 核心逻辑测试：从最终 index.html 里抽取 CORE_LOGIC 段执行，测的不是另一份源码。
 * 运行：node --test test/core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

const block = html.match(/CORE_LOGIC_START[\s\S]*?\*\/([\s\S]*?)\/\* =+ CORE_LOGIC_END/);
assert.ok(block, 'index.html 中必须存在 CORE_LOGIC_START/END 标记');
const coreSource = block[1];

const sandbox = { Date, Math, Number, Array, Set, Object, Error, console };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\n;globalThis.__core = MinesweeperCore;', sandbox, {
  filename: 'index.html#core'
});
const Core = sandbox.__core;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function start(level, index, seed) {
  const game = Core.createGame(level);
  Core.reveal(game, index, mulberry32(seed));
  return game;
}

function mineIndexes(game) {
  return game.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0);
}

function assertCounts(game) {
  const { rows, cols } = game;
  for (let i = 0; i < game.cells.length; i++) {
    if (game.cells[i].mine) continue;
    let expected = 0;
    for (const n of Core.neighborIndexes(game, i)) {
      if (game.cells[n].mine) expected++;
    }
    assert.equal(game.cells[i].adjacent, expected, `格子 ${i} 的相邻雷数应正确`);
  }
  assert.equal(mineIndexes(game).length, game.mines, '雷数应精确等于配置');
}

test('三档难度配置正确', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(Core.LEVELS)),
    {
      beginner: { key: 'beginner', name: '初级', rows: 9, cols: 9, mines: 10 },
      intermediate: { key: 'intermediate', name: '中级', rows: 16, cols: 16, mines: 40 },
      expert: { key: 'expert', name: '高级', rows: 16, cols: 30, mines: 99 }
    }
  );
});

test('棋盘生成：雷数精确，邻雷数全量正确（三档 × 多种子）', () => {
  for (const level of ['beginner', 'intermediate', 'expert']) {
    for (let seed = 1; seed <= 8; seed++) {
      const game = start(level, Math.floor((Core.LEVELS[level].rows * Core.LEVELS[level].cols) / 2), seed);
      assert.equal(game.minesPlaced, true);
      assert.equal(game.status, 'playing');
      assertCounts(game);
    }
  }
});

test('首点安全：初级棋盘每一个格子作为首点都不会踩雷', () => {
  for (let index = 0; index < 81; index++) {
    const game = Core.createGame('beginner');
    const res = Core.reveal(game, index, mulberry32(1000 + index));
    assert.equal(res.hitMine, false, `首点 ${index} 不应踩雷`);
    assert.equal(game.cells[index].mine, false);
    assert.equal(game.cells[index].revealed, true);
    assert.equal(game.status !== 'lost', true);
  }
});

test('首点安全：首点九宫格内无雷（角、边、中心）', () => {
  const cases = [
    ['beginner', 0], ['beginner', 8], ['beginner', 40], ['beginner', 80],
    ['intermediate', 0], ['intermediate', 255], ['expert', 0], ['expert', 479], ['expert', 240]
  ];
  for (const [level, index] of cases) {
    for (let seed = 1; seed <= 12; seed++) {
      const game = start(level, index, seed);
      const zone = [index, ...Core.neighborIndexes(game, index)];
      for (const z of zone) {
        assert.equal(game.cells[z].mine, false, `${level} 首点 ${index} 的九宫格 ${z} 不应有雷`);
      }
    }
  }
});

test('首点后尽量展开：存在零格时洪水展开区域与手动 BFS 一致', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60 && checked < 5; seed++) {
    const game = Core.createGame('beginner');
    Core.plantMines(game, 40, mulberry32(seed));
    const zero = game.cells.findIndex((c) => !c.mine && c.adjacent === 0);
    if (zero < 0) continue;

    const expected = new Set();
    const queue = [zero];
    while (queue.length) {
      const i = queue.pop();
      if (expected.has(i)) continue;
      const c = game.cells[i];
      if (c.mine || c.flagged) continue;
      expected.add(i);
      if (c.adjacent === 0) {
        for (const n of Core.neighborIndexes(game, i)) {
          if (!expected.has(n)) queue.push(n);
        }
      }
    }

    const res = Core.reveal(game, zero);
    assert.equal(res.hitMine, false);
    assert.equal(res.changed, expected.size, '展开数量应与 BFS 预期一致');
    for (const i of expected) assert.equal(game.cells[i].revealed, true, `零区格 ${i} 应被展开`);
    checked++;
  }
  assert.ok(checked >= 3, `应至少找到 3 个可验证的零区局面，实际 ${checked}`);
});

test('翻开已翻开/已插旗的格子无效', () => {
  const game = start('beginner', 40, 7);
  const safe = game.cells.findIndex((c, i) => !c.mine && i !== 40);
  const first = Core.reveal(game, safe);
  assert.ok(first.changed >= 0);
  const again = Core.reveal(game, safe);
  assert.equal(again.changed, 0);
  assert.equal(again.reason, 'revealed');

  const hidden = game.cells.findIndex((c) => !c.revealed && !c.mine);
  assert.equal(Core.toggleFlag(game, hidden).changed, true);
  const blocked = Core.reveal(game, hidden);
  assert.equal(blocked.changed, 0);
  assert.equal(blocked.reason, 'flagged');
  assert.equal(game.cells[hidden].revealed, false);
});

test('插旗与取消、旗数上限、已翻开格不可插旗', () => {
  const game = Core.createGame('beginner');
  assert.equal(game.status, 'ready');

  const a = Core.toggleFlag(game, 0);
  assert.deepEqual({ changed: a.changed, flagged: a.flagged, flags: a.flags }, { changed: true, flagged: true, flags: 1 });
  assert.equal(Core.remainingMines(game), 9);
  const b = Core.toggleFlag(game, 0);
  assert.deepEqual({ changed: b.changed, flagged: b.flagged, flags: b.flags }, { changed: true, flagged: false, flags: 0 });
  assert.equal(Core.remainingMines(game), 10);

  for (let i = 0; i < 10; i++) {
    assert.equal(Core.toggleFlag(game, i).changed, true, `第 ${i + 1} 面旗应成功`);
  }
  const over = Core.toggleFlag(game, 10);
  assert.equal(over.changed, false);
  assert.equal(over.reason, 'flag-limit');
  assert.equal(game.flags, 10);

  const fresh = start('beginner', 40, 42);
  const revealedSafe = fresh.cells.findIndex((c) => c.revealed && !c.mine);
  const res = Core.toggleFlag(fresh, revealedSafe);
  assert.equal(res.changed, false);
  assert.equal(res.reason, 'revealed');
});

test('胜负判定：翻开全部安全格即胜利，踩雷即失败', () => {
  const winGame = start('beginner', 40, 2024);
  winGame.cells.forEach((c, i) => {
    if (!c.mine && !c.revealed) Core.reveal(winGame, i);
  });
  assert.equal(winGame.status, 'won');
  assert.equal(winGame.revealed, 81 - 10);
  assert.equal(winGame.flags, 10, '通关后应自动插满雷旗');
  assert.equal(winGame.cells.filter((c) => c.mine).every((c) => c.flagged), true);
  assert.equal(Core.reveal(winGame, 0).changed, 0, '结束后不可继续翻开');
  assert.equal(Core.toggleFlag(winGame, 1).changed, false, '结束后不可插旗');

  const loseGame = start('beginner', 40, 2025);
  const mine = mineIndexes(loseGame)[0];
  const res = Core.reveal(loseGame, mine);
  assert.equal(res.hitMine, true);
  assert.equal(res.status, 'lost');
  assert.equal(loseGame.status, 'lost');
  assert.equal(loseGame.cells[mine].exploded, true);
  assert.equal(mineIndexes(loseGame).every((i) => loseGame.cells[i].revealed || loseGame.cells[i].flagged), true);
});

test('先插错旗再踩雷：错误旗保留，游戏结束', () => {
  const game = start('beginner', 40, 88);
  const safeHidden = game.cells.findIndex((c) => !c.revealed && !c.mine);
  Core.toggleFlag(game, safeHidden);
  const mine = mineIndexes(game)[0];
  Core.reveal(game, mine);
  assert.equal(game.status, 'lost');
  assert.equal(game.cells[safeHidden].flagged, true);
  assert.equal(game.cells[safeHidden].mine, false);
});

test('计时器：启动/累计/停止/重置，注入时钟可测', () => {
  let now = 0;
  const timer = Core.createTimer(() => now);
  assert.equal(timer.running, false);
  assert.equal(timer.elapsed(), 0);

  timer.start();
  now = 2499;
  assert.equal(timer.elapsed(), 2, '2.499s 应计为 2s');
  timer.stop();
  now = 9000;
  assert.equal(timer.elapsed(), 2, '停止后不继续走表');

  timer.start();
  now = 11500;
  assert.equal(timer.elapsed(), 4, '恢复后应累计 2s + 2s');
  timer.stop();
  timer.stop(); // 重复 stop 不应重复累计
  assert.equal(timer.elapsed(), 4);

  timer.reset();
  assert.equal(timer.elapsed(), 0);
  assert.equal(timer.running, false);
  now = 30000;
  timer.start();
  now = 30200;
  assert.equal(timer.elapsed(), 0);
  assert.equal(timer.running, true);
});

test('重新开始：同配置新局状态完全干净', () => {
  const game = start('beginner', 40, 66);
  Core.toggleFlag(game, 0);
  const fresh = Core.createGame(game.levelKey);
  assert.equal(fresh.status, 'ready');
  assert.equal(fresh.flags, 0);
  assert.equal(fresh.revealed, 0);
  assert.equal(fresh.minesPlaced, false);
  assert.equal(fresh.cells.every((c) => !c.mine && !c.revealed && !c.flagged && c.adjacent === 0), true);
});

test('非法配置会抛错，不会静默生成坏棋盘', () => {
  assert.throws(() => Core.createGame('nope'), /未知难度/);
  assert.throws(() => Core.createGame({ rows: 0, cols: 5, mines: 1 }), /尺寸/);
  assert.throws(() => Core.createGame({ rows: 5, cols: 5, mines: 25 }), /雷数过多/);
  assert.throws(() => Core.createGame({ rows: 5, cols: 5, mines: -1 }), /雷数/);
});
