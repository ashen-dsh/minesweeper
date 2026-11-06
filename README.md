# 扫雷 · Minesweeper

一个零依赖的单文件 HTML5 扫雷：现代深色主题、三档难度、首点安全、触屏插旗模式、键盘可玩。

## 直接玩

双击 `index.html` 即可离线运行，CSS / JS / SVG 图标全部内联，不加载任何外部资源。

- 初级：9 × 9，10 雷
- 中级：16 × 16，40 雷
- 高级：16 × 30，99 雷
- 首次点击必安全，并会避开首点九宫格，尽量展开一片
- 桌面：左键翻开、右键插旗
- 手机：点按翻开，点「插旗模式」按钮后点按格子插旗/取消
- 键盘：方向键移动、空格/回车翻开、`F` 插旗、`R` 重开、`1`/`2`/`3` 切难度
- 计时、剩余雷数、最佳纪录（localStorage）
- 胜负结算层与通关彩带

## 本地测试

纯逻辑测试不需要安装任何依赖：

```bash
npm test
# 等价于 node --test test/core.test.js
```

测试会从最终 `index.html` 中抽取 `CORE_LOGIC` 代码块执行，覆盖棋盘生成、首点安全、洪水展开、插旗/取消、旗数上限、胜负判定、计时与重置。

真实浏览器 DOM 冒烟测试（可选，需要 Chromium 与 `playwright-core`）：

```bash
npm install --no-save playwright-core
npx playwright install chromium
npm run test:dom
```

也可以用环境变量指定已有的 Playwright 核心包和 Chromium 可执行文件：

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core \
CHROME_PATH=/path/to/chrome \
node --test test/dom.test.js
```

DOM 测试覆盖真实鼠标翻开、右键插旗、重置、难度切换、键盘操作、390px 手机视口下的点按与插旗模式按钮、横向滚动、胜负结算层，并输出截图到 `test/artifacts/`。
