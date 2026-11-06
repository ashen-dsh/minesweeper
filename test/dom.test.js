'use strict';

/**
 * 真实浏览器 DOM 冒烟测试（Chromium headless shell + playwright-core）。
 * 覆盖：页面加载、外链检查、鼠标翻开、右键插旗、重置、难度切换、
 *       键盘操作、手机点按/插旗模式、响应式布局、胜负结算层、计时器。
 * 运行：node --test test/dom.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* 继续找下一个 */ }
  }
  throw new Error('未找到 playwright-core，请先 npm install --no-save playwright-core');
}

const { chromium } = loadPlaywright();

function findChrome() {
  const candidates = [process.env.CHROME_PATH].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const CHROME = findChrome();
const URL = 'file://' + path.join(__dirname, '..', 'index.html');
const ARTIFACTS = path.join(__dirname, 'artifacts');

let browser;

test.before(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const opts = {
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  };
  if (CHROME) opts.executablePath = CHROME;
  browser = await chromium.launch(opts);
});

test.after(async () => {
  if (browser) await browser.close();
});

async function openPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MS__ && document.querySelectorAll('.cell').length > 0);
  // 等首帧 fitBoard 完成，避免读到 CSS 默认格子尺寸造成布局误判。
  await page.waitForTimeout(150);
  return { page, errors };
}

const state = (page) => page.evaluate(() => window.__MS__.getState());
const cellCount = (page) => page.locator('.cell').count();

test('页面加载：标题、81 格、全部内联、无外链、无脚本报错', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await openPage(context);

  assert.match(await page.title(), /扫雷/);
  assert.equal(await cellCount(page), 81);
  assert.equal(await page.locator('.level.active').getAttribute('data-level'), 'beginner');
  assert.equal(await page.locator('#mineCount').innerText(), '010');
  assert.equal(await page.locator('#timer').innerText(), '00:00');

  const external = await page.evaluate(() => ({
    styles: document.querySelectorAll('link[rel="stylesheet"]').length,
    scripts: [...document.scripts].filter((s) => s.src).length,
    imgs: document.querySelectorAll('img').length,
    uses: document.querySelectorAll('use').length,
    externalUse: [...document.querySelectorAll('use')].filter((u) => !(u.getAttribute('href') || '').startsWith('#')).length
  }));
  assert.equal(external.styles, 0);
  assert.equal(external.scripts, 0);
  assert.equal(external.imgs, 0);
  assert.ok(external.uses >= 3, '内联 SVG 图标应正常存在');
  assert.equal(external.externalUse, 0, 'SVG use 只能引用页内 symbol');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('桌面鼠标：首点安全并展开、计时启动、右键插旗/取消、重置', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await openPage(context);

  await page.locator('.cell').nth(40).click();
  let st = await state(page);
  assert.equal(st.status, 'playing');
  assert.equal(st.cells[40].revealed, true);
  assert.equal(st.cells[40].mine, false);
  assert.equal(st.cells.filter((c) => c.mine).length, 10);
  assert.equal(await page.locator('.cell.revealed').count(), st.revealed);
  assert.equal(st.revealed, await page.locator('.cell.revealed').count());

  await page.waitForTimeout(1250);
  const timerText = await page.locator('#timer').innerText();
  assert.notEqual(timerText, '00:00', '首点后计时器应开始走');

  const target = st.cells.findIndex((c) => !c.revealed);
  await page.locator('.cell').nth(target).click({ button: 'right' });
  st = await state(page);
  assert.equal(st.cells[target].flagged, true);
  assert.equal(st.flags, 1);
  assert.equal(await page.locator('#mineCount').innerText(), '009');
  assert.equal(await page.locator('.cell.flagged').count(), 1);

  await page.locator('.cell').nth(target).click({ button: 'right' });
  st = await state(page);
  assert.equal(st.cells[target].flagged, false);
  assert.equal(st.flags, 0);
  assert.equal(await page.locator('#mineCount').innerText(), '010');

  await page.locator('#resetBtn').click();
  st = await state(page);
  assert.equal(st.status, 'ready');
  assert.equal(st.revealed, 0);
  assert.equal(st.flags, 0);
  assert.equal(await page.locator('#timer').innerText(), '00:00');
  assert.equal(await page.locator('.cell.revealed').count(), 0);
  assert.equal(await page.locator('#mineCount').innerText(), '010');
  assert.deepEqual(errors, []);
  await context.close();
});

test('难度切换与键盘：方向键移动、空格翻开、F 插旗、R 重开', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await openPage(context);

  await page.locator('[data-level="expert"]').click();
  assert.equal(await cellCount(page), 480);
  assert.equal(await page.locator('.level.active').getAttribute('data-level'), 'expert');
  const expertSize = await page.locator('.cell').first().evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(expertSize >= 17, '高级格子在桌面上不应小于 17px，实际 ' + expertSize);

  await page.locator('[data-level="beginner"]').click();
  assert.equal(await cellCount(page), 81);
  await page.locator('#board').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  let st = await state(page);
  assert.equal(st.status, 'playing');
  assert.equal(st.cells[41].revealed, true, '方向键右移一格后空格应翻开 41 号格');

  await page.keyboard.press('r');
  await page.locator('#board').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('f');
  st = await state(page);
  assert.equal(st.cells[41].flagged, true, 'F 应给光标格插旗');
  assert.equal(st.cells[41].revealed, false, '插旗后空格不应翻开');
  await page.keyboard.press('Space');
  st = await state(page);
  assert.equal(st.cells[41].revealed, false);

  await page.keyboard.press('r');
  st = await state(page);
  assert.equal(st.status, 'ready');
  assert.equal(st.flags, 0);
  assert.equal(st.revealed, 0);
  assert.equal(await page.locator('#timer').innerText(), '00:00');
  assert.deepEqual(errors, []);
  await context.close();
});

test('手机触屏：点按翻开、插旗模式按钮、响应式不横向溢出', async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const { page, errors } = await openPage(context);

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  const layout = await page.evaluate(() => {
    const board = document.getElementById('board').getBoundingClientRect();
    const wrap = document.getElementById('boardWrap');
    return { board: board.width, wrap: wrap.clientWidth, overflow: wrap.scrollWidth > wrap.clientWidth };
  });
  assert.ok(layout.board <= layout.wrap + 1, '初级棋盘应完整放进手机宽度');
  assert.equal(layout.overflow, false);

  await page.locator('.cell').nth(40).tap();
  let st = await state(page);
  assert.equal(st.status, 'playing');
  assert.equal(st.cells[40].revealed, true);

  // 插旗模式按钮：开启后点按插旗，再点取消；关闭后点按恢复翻开。
  st = await state(page);
  const target = st.cells.findIndex((c) => !c.revealed && !c.flagged);
  await page.locator('#flagBtn').click();
  assert.equal(await page.locator('#flagBtn').getAttribute('aria-pressed'), 'true', '按钮应进入插旗模式');
  await page.locator('.cell').nth(target).tap();
  st = await state(page);
  assert.equal(st.cells[target].flagged, true, '插旗模式下点按应插旗');
  assert.equal(st.cells[target].revealed, false, '插旗模式下不应翻开');
  assert.equal(st.flags, 1);
  assert.equal(await page.locator('#mineCount').innerText(), '009');

  await page.locator('.cell').nth(target).tap();
  st = await state(page);
  assert.equal(st.cells[target].flagged, false, '再点应取消插旗');
  await page.locator('#flagBtn').click();
  assert.equal(await page.locator('#flagBtn').getAttribute('aria-pressed'), 'false', '按钮应退出插旗模式');

  const safe = st.cells.findIndex((c) => !c.mine && !c.revealed && !c.flagged);
  if (safe >= 0) {
    await page.locator('.cell').nth(safe).tap();
    st = await state(page);
    assert.equal(st.cells[safe].revealed, true, '关闭插旗模式后点按应翻开');
  }

  await page.locator('[data-level="expert"]').click();
  assert.equal(await cellCount(page), 480);
  const mobileExpert = await page.evaluate(() => {
    const wrap = document.getElementById('boardWrap');
    const cell = document.querySelector('.cell').getBoundingClientRect();
    return {
      cell: cell.width,
      scrollable: wrap.scrollWidth > wrap.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  assert.ok(mobileExpert.cell >= 17, '手机高级格子不小于 17px');
  assert.equal(mobileExpert.scrollable, true, '高级棋盘在手机上应可横向滚动');
  assert.equal(mobileExpert.pageOverflow, false, '滚动应限制在棋盘容器内，不撑破页面');

  assert.deepEqual(errors, []);
  await context.close();
});

test('结算层：踩雷失败 / 全清胜利 / 再来一局', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await openPage(context);

  let st = await state(page);
  // 先首点开局，再点雷。
  await page.locator('.cell').nth(40).click();
  st = await state(page);
  const mine = st.cells.findIndex((c) => c.mine);
  await page.evaluate((i) => window.__MS__.revealAt(i), mine);
  await page.waitForTimeout(1000);
  await page.locator('#overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#overlay').isVisible(), true);
  assert.match(await page.locator('#resultTitle').innerText(), /踩雷/);
  assert.equal(await page.locator('.cell.exploded').count(), 1);
  assert.equal(await page.locator('.cell.wrong').count(), 0);

  await page.locator('#playAgain').click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#overlay').isVisible(), false);
  st = await state(page);
  assert.equal(st.status, 'ready');
  assert.equal(await page.locator('#timer').innerText(), '00:00');

  // 全清：逐个翻开安全格（零区会自动洪水展开）。
  const winStatus = await page.evaluate(() => {
    window.__MS__.newGame('beginner');
    window.__MS__.revealAt(40); // 先落雷，再按真实雷位清场
    const s = window.__MS__.getState();
    for (let i = 0; i < s.cells.length; i++) {
      if (!s.cells[i].mine && !s.cells[i].revealed) window.__MS__.revealAt(i);
    }
    return window.__MS__.getState().status;
  });
  assert.equal(winStatus, 'won');
  await page.waitForTimeout(750);
  await page.locator('#overlay').waitFor({ state: 'visible' });
  assert.match(await page.locator('#resultTitle').innerText(), /通关/);
  assert.ok(await page.locator('#confetti span').count() > 0, '胜利应有彩带');
  assert.equal(await page.locator('.cell.revealed').count(), 71);
  assert.equal(await page.locator('.cell.flagged').count(), 10);

  await page.screenshot({ path: path.join(ARTIFACTS, 'desktop-result.png') });
  assert.deepEqual(errors, []);
  await context.close();
});

test('截图：桌面 / 手机实战画面', async () => {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const d = await openPage(desktop);
  await d.page.locator('.cell').nth(40).click();
  const ds = await state(d.page);
  const flags = ds.cells.map((c, i) => (!c.revealed ? i : -1)).filter((i) => i >= 0).slice(0, 2);
  for (const i of flags) await d.page.locator('.cell').nth(i).click({ button: 'right' });
  await d.page.waitForTimeout(260);
  await d.page.screenshot({ path: path.join(ARTIFACTS, 'desktop.png') });
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const m = await openPage(mobile);
  await m.page.locator('.cell').nth(40).tap();
  await m.page.waitForTimeout(200);
  await m.page.screenshot({ path: path.join(ARTIFACTS, 'mobile.png') });
  await mobile.close();

  assert.equal(fs.existsSync(path.join(ARTIFACTS, 'desktop.png')), true);
  assert.equal(fs.existsSync(path.join(ARTIFACTS, 'mobile.png')), true);
});
