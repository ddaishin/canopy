# Task Diary — Active

> Session learnings are appended here by `/task-diary`.
> When entries exceed 20, GC promotes insights to `~/.claude/knowledge/` and archives the rest.
>
> Entry format:
> ---
> ### YYYY-MM-DD HH:MM — [brief title]
>
> **Attempted:** ...
> **Succeeded:** ...
> **Failed:** ...
> **Insight:** ...
> **Category:** tooling | debugging | workflow | testing | security | other
> **Suggestion:** local:claude_md | local:skill | global:skill | global:scaffold
>
> Category and Suggestion are optional. Entries without them are archived as-is during GC.

<!-- Entries will be appended below this line. -->

---
### 2026-04-13 16:30 — Chromium WebView2のIME候補ウィンドウはCSS位置ではなくキャレット内部座標に従う

**Attempted:** xterm.js v6 + Tauri WebView2 環境で、IME候補ウィンドウが入力中に左にドリフトする問題を修正。
**Succeeded:** CSS `letter-spacing: -1em` でテキストエリア内の文字幅をゼロに潰し、キャレットの移動を完全に停止。`left: 0px !important` で左端に固定。composition-view を `opacity: 0` で非表示（display:none はIMEパイプラインを壊す）。compositionstart で top を CSS 変数にロックして縦方向のジャンプも防止。
**Failed:** MutationObserver（非同期で遅い）、CSSStyleDeclaration.prototype.setProperty パッチ（xterm.js は直接代入 style.left="..."）、Object.defineProperty（Chromium のネイティブ IDL バインディングが JS プロパティ記述子を迂回）、CompositionHelper.updateCompositionElements モンキーパッチ（内部プロパティ名がビルドで変化、compositionstart のリスナー登録順序問題）。
**Insight:** Chromium WebView2 では、IME候補ウィンドウの位置は要素のCSS座標ではなく、テキストエリア内部のキャレット境界矩形（caret bounds）に基づく。style.left/top の変更は無意味。キャレット自体を動かさないようにする（letter-spacing: -1em、font-size: 1px）のが唯一の確実なアプローチ。また xterm.js は composition-view という別要素でプレエディットテキストを描画するため、textarea だけでなくこちらも制御が必要。
**Category:** debugging
**Suggestion:** global:custom_instructions

---
### 2026-04-13 16:30 — xterm.js の内部プロパティ探索は名前ではなくメソッド存在チェックで行う

**Attempted:** xterm.js v6 の CompositionHelper をモンキーパッチするため `_core._compositionHelper` にアクセス。
**Succeeded:** `Object.getOwnPropertyNames(core)` でキーを列挙し、`"updateCompositionElements" in val` で CompositionHelper を特定する動的探索パターンで、ビルド間の名前変化に対応できた。
**Failed:** ハードコードされたプロパティ名 `_compositionHelper` はビルドバージョンで存在しなかった。DOMからの `_xterm._core` パスも不正確だった。
**Insight:** xterm.js 等のバンドル済みライブラリの内部オブジェクトにアクセスする場合、プロパティ名のハードコードは脆弱。`Object.getOwnPropertyNames` + 特徴的なメソッド存在チェック（duck typing）で探索すると、バージョン間の内部名変更に耐性がある。
**Category:** debugging
**Suggestion:** global:custom_instructions

---
### 2026-04-13 16:30 — Fork リポジトリのブランチ運用戦略

**Attempted:** upstream リポジトリの fork で、自分用の変更と upstream への PR を整理するブランチ戦略を確立。
**Succeeded:** main（upstream同期専用、自分の変更をコミットしない）、develop（fork固有の設定・ドキュメント）、fix/xxx・feat/xxx（upstream PR用、マージ後削除）の3層構成。PR送信時は該当修正のファイルだけを選択的にコミット。
**Failed:** 最初はmainにfork固有の変更をコミットしようとしたが、upstream更新との競合リスクを指摘された。
**Insight:** fork のブランチ運用は main を upstream 同期専用にして汚さないことが鍵。自分用の変更は develop 等の別ブランチに集約し、PR 用ブランチは main から切る。upstream の更新は `git pull upstream main` → `git rebase main` で取り込む。
**Category:** workflow
**Suggestion:** global:custom_instructions
