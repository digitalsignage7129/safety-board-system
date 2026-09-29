/**
 * 安全掲示板システム — 表示/編集ページのロジック
 *
 * URL:
 *   ?id=xxxxxxxx           → 表示モード(サイネージ/STB用。読み取り専用、全画面)
 *   ?id=xxxxxxxx&key=...   → 編集モード(顧客が内容を更新する。プレビュー付き編集フォーム)
 */
(() => {
  const ROPE_PRESETS = [
    { name: '赤', hex: '#e0272a', text: '#fff' },
    { name: '黄', hex: '#ffd400', text: '#3a2e00' },
    { name: '緑', hex: '#2e9e4f', text: '#fff' },
    { name: '青', hex: '#1f6fd6', text: '#fff' },
    { name: '白', hex: '#ffffff', text: '#1a2230' },
    { name: '黒', hex: '#26282b', text: '#fff' },
    { name: 'オレンジ', hex: '#f4801f', text: '#fff' },
    { name: '紫', hex: '#7b4397', text: '#fff' },
  ];
  const COMMON_ITEMS = [
    { key: 'rope', label: '玉掛けワイヤーロープの点検表' },
    { key: 'cycle', label: '安全施工サイクル' },
    { key: 'rule333', label: '玉掛け作業の基本(3・3・3運動)' },
  ];
  // レイアウト(1つだけ/2分割/4分割)で選択できるコンテンツブロック
  const BLOCK_LABELS = {
    goals: '今月の安全目標',
    record: '無災害記録',
    rope: '玉掛けワイヤーロープの点検色',
    ropeTable: '玉掛けワイヤーロープの点検表',
    cycle: '安全施工サイクル',
    rule333: '玉掛け作業の基本(3・3・3運動)',
    signal: '当作業所のクレーン等の合図法',
    notice: 'お知らせ',
    free: '自由記入欄',
    emergency: '緊急時連絡先',
  };
  const BLOCKS_PER_MODE = { all: 0, single: 1, split2: 2, split4: 4 };

  function hexFor(name) {
    const p = ROPE_PRESETS.find((x) => x.name === name);
    return p ? p.hex : '#9a9a8c';
  }
  function textColorFor(name) {
    const p = ROPE_PRESETS.find((x) => x.name === name);
    return p ? p.text : '#1a2230';
  }
  // 目標時間・現在の時間などを、現場の記録表でよく見る「桁ごとに枠で区切った数字」で表示する
  function digitRowHTML(value, size) {
    const rowCls = size ? `b-digit-row b-digit-row-${size}` : 'b-digit-row';
    const boxCls = size ? `b-digit-box b-digit-box-${size}` : 'b-digit-box';
    return `<div class="${rowCls}">${String(value).split('').map((d) =>
      `<div class="${boxCls}">${esc(d)}</div>`).join('')}</div>`;
  }
  // "2026-09-15" → "9月15日"
  function formatMD(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return '';
    return `${Number(m[2])}月${Number(m[3])}日`;
  }
  // "2026-09-15" → "2026年9月15日"
  function formatYMD(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return '';
    return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
  }
  function formatPeriod(start, end) {
    const s = formatYMD(start);
    const e = formatYMD(end);
    if (s && e) return `${s} ～ ${e}`;
    if (s) return `${s} ～`;
    if (e) return `～ ${e}`;
    return '';
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }
  function showToast(msg, isError) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (el.className = 'toast'), 2600);
  }

  // ---- ボードキャンバス(表示部分)の描画 ---------------------------------

  function sharedImageOrPlaceholder(key, label, sharedStatus, cacheBust) {
    return sharedStatus && sharedStatus[key]
      ? `<img src="/shared/${key}.jpg?v=${cacheBust}" alt="${esc(label)}">`
      : `<div class="b-signal-placeholder">${esc(label)}<br>(未設定)</div>`;
  }

  // コンテンツブロックごとのタイトル・本文HTMLを組み立てる。
  // 「全表示」レイアウトと「1/2/4分割」レイアウトの両方から共通で利用する。
  function renderBlockBody(key, ctx) {
    const { board, c, sharedStatus, cacheBust } = ctx;
    switch (key) {
      case 'goals': {
        const goals = (board.safetyGoals && board.safetyGoals.length ? board.safetyGoals : ['', '']);
        return {
          title: '今月の安全目標',
          body: `<div class="b-goal-line">${esc(goals[0] || '（未設定）')}</div>
                 <div class="b-goal-line">${esc(goals[1] || '')}</div>`,
        };
      }
      case 'record': {
        const periodText = formatPeriod(board.constructionPeriodStart, board.constructionPeriodEnd);
        const hoursAsOfLabel = board.currentHoursAsOfDate ? `${formatMD(board.currentHoursAsOfDate)}現在` : '現在';
        const hasHours = (Number(board.targetHours) || 0) > 0 || (Number(board.currentHours) || 0) > 0;
        return {
          title: '無災害記録',
          body: `${hasHours ? `<div class="b-record-hours">
                   <div class="b-hours-line"><span class="b-hours-label">目標時間</span>${digitRowHTML(board.targetHours || 0)}<span class="b-hours-unit">時間</span></div>
                   <div class="b-hours-line"><span class="b-hours-label">${esc(hoursAsOfLabel)}</span>${digitRowHTML(board.currentHours || 0)}<span class="b-hours-unit">時間</span></div>
                 </div>` : `<div class="b-record-label">目標時間・現在の時間は編集用URLから設定できます</div>`}
                 ${periodText ? `<div class="b-record-period">工期　${esc(periodText)}</div>` : ''}`,
        };
      }
      case 'rope': {
        return {
          title: '玉掛けワイヤーロープの点検色',
          body: `<div class="b-rope-current">
                   <div class="b-rope-current-text">今月の点検色は<span class="b-rope-current-badge" style="background:${hexFor(c.currentRopeColor)}">${esc(c.currentRopeColor)}</span>です<small>4ヶ月周期で自動切替</small></div>
                 </div>`,
        };
      }
      case 'ropeTable':
        return {
          title: '玉掛けワイヤーロープの点検表',
          body: `<div class="b-signal-img-wrap">${sharedImageOrPlaceholder('rope', '玉掛けワイヤーロープの点検表', sharedStatus, cacheBust)}</div>`,
        };
      case 'cycle':
        return {
          title: '安全施工サイクル',
          body: `<div class="b-signal-img-wrap">${sharedImageOrPlaceholder('cycle', '安全施工サイクル', sharedStatus, cacheBust)}</div>`,
        };
      case 'rule333':
        return {
          title: '玉掛け作業の基本(3・3・3運動)',
          body: `<div class="b-signal-img-wrap">${sharedImageOrPlaceholder('rule333', '3・3・3運動', sharedStatus, cacheBust)}</div>`,
        };
      case 'signal': {
        const signalBody = board.hasCustomSignalImage
          ? `<img src="/uploads/${board.id}.jpg?v=${cacheBust}" alt="当作業所のクレーン等の合図法">`
          : sharedImageOrPlaceholder('signal', '当作業所のクレーン等の合図法', sharedStatus, cacheBust);
        return { title: '当作業所のクレーン等の合図法', body: `<div class="b-signal-img-wrap">${signalBody}</div>` };
      }
      case 'notice': {
        const sizeCls = ['s', 'm', 'l', 'xl'].includes(board.noticeFontSize) ? board.noticeFontSize : 'm';
        return {
          title: 'お知らせ',
          body: `<div class="b-notice-text b-notice-size-${sizeCls}">${esc(board.noticeText || '')}</div>`,
        };
      }
      case 'free': {
        const items = (board.freeBlocks || []).filter((b) => b.label || b.content);
        const body = items.length
          ? `<div class="b-free-list">${items.map((b) => `
              <div class="b-free-item">
                <div class="b-free-item-label">${esc(b.label || '（無題）')}</div>
                <div class="b-free-content">${esc(b.content)}</div>
              </div>`).join('')}</div>`
          : `<div class="b-signal-placeholder">自由記入欄(未設定)</div>`;
        return { title: '自由記入欄', body };
      }
      case 'emergency': {
        const items = (board.emergencyContacts || []).filter((e) => e.label || e.name || e.phone);
        // 件数が少ないほど1行あたりの文字を大きくして、余白ができないようにする
        // (基準は既定プリセットの7件=倍率1。行の高さ自体はgrid-template-rowsの1frが
        //  常に画面の余っている高さいっぱいに広がるため、文字の倍率はやや控えめにして
        //  電話番号などが横にはみ出さないようにしている)
        const tier = items.length ? Math.min(1.6, Math.max(0.6, 7 / items.length)) : 1;
        const listStyle = items.length
          ? ` style="grid-template-rows: repeat(${items.length}, 1fr); --emg-tier: ${tier.toFixed(2)};"`
          : '';
        const body = items.length
          ? `<div class="b-emg-list"${listStyle}>${items.map((e) => `
              <div class="b-emg-row">
                <div class="b-emg-label">${esc(e.label || '（項目）')}</div>
                <div class="b-emg-name">${esc(e.name || '')}</div>
                <div class="b-emg-phone">${esc(e.phone || '')}</div>
              </div>`).join('')}</div>`
          : `<div class="b-signal-placeholder">緊急時連絡先(未設定)</div>`;
        return { title: '☎ 緊急時連絡先', body };
      }
      default:
        return { title: '', body: '' };
    }
  }

  // 中央寄せ表示にしたいブロック(数字を大きく見せたいもの)
  const CENTERED_BLOCKS = ['record'];

  function paneCardHTML(key, ctx) {
    const { title, body } = renderBlockBody(key, ctx);
    const centerClass = CENTERED_BLOCKS.includes(key) ? ' b-pane-center' : '';
    return `<div class="b-card${centerClass}">
      <div class="b-card-title">${esc(title)}</div>
      <div class="b-card-body">${body}</div>
    </div>`;
  }

  function buildAllModeHTML(ctx) {
    const { board, sharedStatus, cacheBust } = ctx;
    const commonHTML = COMMON_ITEMS.map((item) => `
      <div class="b-common-item">
        <div class="b-common-item-label">${esc(item.label)}</div>
        <div class="b-common-item-img">${sharedImageOrPlaceholder(item.key, item.label, sharedStatus, cacheBust)}</div>
      </div>`).join('');

    const goalsCard = renderBlockBody('goals', ctx);
    const ropeCard = renderBlockBody('rope', ctx);
    const signalCard = renderBlockBody('signal', ctx);
    const recordCard = renderBlockBody('record', ctx);
    const noticeCard = renderBlockBody('notice', ctx);
    const emergencyCard = renderBlockBody('emergency', ctx);
    const freeItems = (board.freeBlocks || []).filter((b) => b.label || b.content);
    const freeBlocksHTML = freeItems.map((b) => `
      <div class="b-card">
        <div class="b-card-title">${esc(b.label || '（無題）')}</div>
        <div class="b-card-body"><div class="b-free-content">${esc(b.content)}</div></div>
      </div>`).join('');

    return `
      <div class="b-card b-goals">
        <div class="b-card-title">${esc(goalsCard.title)}</div>
        <div class="b-card-body">${goalsCard.body}</div>
      </div>

      <div class="b-col-inspect">
        <div class="b-card b-rope">
          <div class="b-card-title">${esc(ropeCard.title)}</div>
          <div class="b-card-body">${ropeCard.body}</div>
        </div>
        <div class="b-card b-cycle">
          <div class="b-card-body">${commonHTML}</div>
        </div>
      </div>

      <div class="b-card b-signal">
        <div class="b-card-title">${esc(signalCard.title)}</div>
        <div class="b-card-body">${signalCard.body}</div>
      </div>

      <div class="b-card b-record">
        <div class="b-card-title">${esc(recordCard.title)}</div>
        <div class="b-card-body">${recordCard.body}</div>
      </div>

      <div class="b-card b-emergency">
        <div class="b-card-title">${esc(emergencyCard.title)}</div>
        <div class="b-card-body">${emergencyCard.body}</div>
      </div>

      <div class="b-notice-row">
        <div class="b-card">
          <div class="b-card-title">${esc(noticeCard.title)}</div>
          <div class="b-card-body">${noticeCard.body}</div>
        </div>
        ${freeBlocksHTML}
      </div>
    `;
  }

  function buildPaneModeHTML(mode, ctx) {
    const count = BLOCKS_PER_MODE[mode] || 1;
    const blocks = (ctx.board.layout && ctx.board.layout.blocks) || [];
    let panes = '';
    for (let i = 0; i < count; i++) {
      const key = blocks[i] || Object.keys(BLOCK_LABELS)[i] || 'notice';
      panes += `<div class="b-pane b-pane${i + 1}">${paneCardHTML(key, ctx)}</div>`;
    }
    return panes;
  }

  function buildStageHTML(board, sharedStatus, cacheBust) {
    const c = board.computed;
    const today = c.todayYmd || '';
    const mode = (board.layout && board.layout.mode) || 'all';
    const ctx = { board, c, sharedStatus, cacheBust };

    const headerHTML = `
      <div class="b-header">
        <div class="b-cross"></div>
        <div class="b-title">安全掲示板</div>
        <div class="b-header-sub">${esc(board.customerName || '')}　${esc(today)}</div>
      </div>`;

    const bodyHTML = mode === 'all' ? buildAllModeHTML(ctx) : buildPaneModeHTML(mode, ctx);
    return { mode, html: headerHTML + bodyHTML };
  }

  function renderStage(container, board, sharedStatus) {
    let stage = container.querySelector('.stage');
    if (!stage) {
      container.innerHTML = '<div class="stage"></div>';
      stage = container.querySelector('.stage');
    }
    const { mode, html } = buildStageHTML(board, sharedStatus, Date.now());
    stage.className = 'stage mode-' + mode;
    stage.innerHTML = html;
  }

  // ---- 表示モード ---------------------------------------------------------

  async function runViewMode(id) {
    document.body.className = 'board-page';
    const app = document.getElementById('app');
    app.innerHTML = '<div class="stage"></div>';

    async function load() {
      try {
        const [boardRes, sharedRes] = await Promise.all([
          fetch(`/api/boards/${id}`), fetch('/api/shared'),
        ]);
        if (!boardRes.ok) {
          app.innerHTML = '<div class="msg-center" style="color:#fff">指定された掲示板が見つかりません。IDを確認してください。</div>';
          return;
        }
        const board = await boardRes.json();
        const sharedStatus = sharedRes.ok ? await sharedRes.json() : {};
        renderStage(app, board, sharedStatus);
      } catch (e) {
        // 通信エラー時は前回の表示を維持する(サイネージが一瞬でも真っ黒にならないように)
      }
    }
    await load();
    // 日付をまたぐ(月が変われば点検色が変わる)可能性があるため定期的に再取得
    setInterval(load, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  // ---- 編集モード ---------------------------------------------------------

  async function runEditMode(id, key) {
    document.body.className = 'edit-page';
    const app = document.getElementById('app');
    app.innerHTML = '<div class="msg-center">読み込み中…</div>';

    const res = await fetch(`/api/boards/${id}`);
    if (!res.ok) {
      app.innerHTML = '<div class="msg-center">指定された掲示板が見つかりません。</div>';
      return;
    }
    let board = await res.json();
    let sharedStatus = {};
    try { sharedStatus = await (await fetch('/api/shared')).json(); } catch (e) {}

    app.innerHTML = `
      <div class="edit-wrap">
        <div class="edit-header">
          <div>
            <h1>安全掲示板の編集 — ${esc(board.customerName || '現場')}</h1>
            <p>内容を変更すると、この現場のサイネージ表示にすぐに反映されます。</p>
          </div>
        </div>

        <div class="preview-box">
          <div id="preview" class="board-page preview-mode"><div class="stage"></div></div>
        </div>

        <div class="form-grid">
          <div class="card">
            <label>現場・顧客名</label>
            <input id="f-customerName" type="text" maxlength="100">
            <p class="hint">サイネージ画面の右上に小さく表示されます。</p>
          </div>

          <div class="card">
            <label>今月の安全目標</label>
            <input id="f-goal0" type="text" maxlength="60" style="margin-bottom:8px">
            <input id="f-goal1" type="text" maxlength="60">
          </div>

          <div class="card">
            <label>玉掛けワイヤーロープの点検色(4ヶ月で1周し、以降は自動で繰り返されます)</label>
            <div id="rope-slots"></div>
            <label style="margin-top:6px">サイクル開始月(この月に1色目になります)</label>
            <input id="f-ropeStart" type="month">
          </div>

          <div class="card">
            <label>無災害記録(稼働時間) — 任意。目標時間・現在の時間の両方が0の場合は表示されません</label>
            <div class="field-row">
              <div>
                <label>目標時間</label>
                <input id="f-targetHours" type="number" min="0" step="1">
              </div>
            </div>
            <div class="field-row" style="margin-top:8px">
              <div>
                <label>現在の時間</label>
                <input id="f-currentHours" type="number" min="0" step="1">
              </div>
              <div>
                <label>この時間の基準日(何月何日現在)</label>
                <input id="f-hoursDate" type="date">
              </div>
            </div>
          </div>

          <div class="card">
            <label>工期(任意)</label>
            <div class="field-row">
              <div>
                <label>開始日</label>
                <input id="f-periodStart" type="date">
              </div>
              <div>
                <label>終了日</label>
                <input id="f-periodEnd" type="date">
              </div>
            </div>
          </div>

          <div class="card">
            <label>お知らせ</label>
            <textarea id="f-notice" rows="5" maxlength="600"></textarea>
            <label style="margin-top:8px">文字サイズ</label>
            <select id="f-notice-size">
              <option value="s">小さめ</option>
              <option value="m">標準</option>
              <option value="l">大きめ</option>
              <option value="xl">特大</option>
            </select>
          </div>

          <div class="card">
            <label>当作業所のクレーン等の合図法(現場ごとに差し替え可能)</label>
            <div class="img-row">
              <img id="signal-preview" class="img-preview" alt="現在の画像">
              <div style="display:flex;flex-direction:column;gap:6px">
                <input id="f-signal-file" type="file" accept="image/*">
                <button id="btn-signal-remove" class="btn-ghost" type="button">既定の内容に戻す</button>
              </div>
            </div>
            <p class="hint">JPG/PNG画像をアップロードすると、共通の内容の代わりにこの現場専用の画像が表示されます。</p>
          </div>

          <div class="card" style="grid-column:1/-1">
            <label>緊急時連絡先(よくある項目を用意しています。担当者名と電話番号を入力してください。項目名も変更・追加・削除できます)</label>
            <div id="emergency-list"></div>
            <button id="btn-add-emg" class="btn-ghost" type="button">＋ 連絡先を追加</button>
          </div>

          <div class="card" style="grid-column:1/-1">
            <label>自由記入欄(必要に応じて追加できます)</label>
            <div id="free-blocks"></div>
            <button id="btn-add-block" class="btn-ghost" type="button">＋ 項目を追加</button>
          </div>
        </div>

        <div class="save-bar">
          <button id="btn-save" class="btn-primary" type="button">保存する</button>
        </div>
      </div>
    `;

    // ---- rope slots ----
    const ropeSlotsEl = document.getElementById('rope-slots');
    function renderRopeSlots() {
      const colors = board.ropeColors && board.ropeColors.length === 4 ? board.ropeColors : ['赤', '黄', '緑', '白'];
      ropeSlotsEl.innerHTML = colors.map((c, i) => `
        <div class="rope-slot">
          <span>${i + 1}ヶ月目</span>
          <span class="swatch-dot" style="background:${hexFor(c)}"></span>
          <select data-idx="${i}" class="rope-select">
            ${ROPE_PRESETS.map(p => `<option value="${esc(p.name)}" ${p.name === c ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>`).join('');
      ropeSlotsEl.querySelectorAll('.rope-select').forEach((sel) => {
        sel.addEventListener('change', () => {
          const idx = +sel.dataset.idx;
          if (!board.ropeColors || board.ropeColors.length !== 4) board.ropeColors = ['赤', '黄', '緑', '白'];
          board.ropeColors[idx] = sel.value;
          renderRopeSlots();
          updatePreview();
        });
      });
    }

    // ---- free blocks ----
    const freeBlocksEl = document.getElementById('free-blocks');
    function renderFreeBlocks() {
      const blocks = board.freeBlocks || [];
      freeBlocksEl.innerHTML = blocks.map((b, i) => `
        <div class="free-block" data-idx="${i}">
          <div class="free-block-head">
            <input type="text" class="fb-label" placeholder="見出し(例: 作業所ルール)" maxlength="40" value="${esc(b.label || '')}" style="max-width:60%">
            <button class="btn-danger fb-remove" type="button">削除</button>
          </div>
          <textarea class="fb-content" rows="3" maxlength="300" placeholder="内容を入力してください">${esc(b.content || '')}</textarea>
        </div>`).join('') || '<p class="hint">まだ項目がありません。</p>';
      freeBlocksEl.querySelectorAll('.free-block').forEach((el) => {
        const idx = +el.dataset.idx;
        el.querySelector('.fb-label').addEventListener('input', (e) => { board.freeBlocks[idx].label = e.target.value; updatePreview(); });
        el.querySelector('.fb-content').addEventListener('input', (e) => { board.freeBlocks[idx].content = e.target.value; updatePreview(); });
        el.querySelector('.fb-remove').addEventListener('click', () => { board.freeBlocks.splice(idx, 1); renderFreeBlocks(); updatePreview(); });
      });
    }
    document.getElementById('btn-add-block').addEventListener('click', () => {
      board.freeBlocks = board.freeBlocks || [];
      if (board.freeBlocks.length >= 12) { showToast('これ以上追加できません', true); return; }
      board.freeBlocks.push({ label: '', content: '' });
      renderFreeBlocks();
      updatePreview();
    });

    // ---- emergency contacts ----
    const emergencyListEl = document.getElementById('emergency-list');
    function renderEmergencyList() {
      const items = board.emergencyContacts || [];
      emergencyListEl.innerHTML = items.map((e, i) => `
        <div class="free-block" data-idx="${i}">
          <div class="free-block-head">
            <input type="text" class="emg-label" placeholder="項目名(例: 電気)" maxlength="20" value="${esc(e.label || '')}" style="max-width:30%">
            <button class="btn-danger emg-remove" type="button">削除</button>
          </div>
          <div class="field-row">
            <input type="text" class="emg-name" placeholder="担当者名" maxlength="40" value="${esc(e.name || '')}">
            <input type="text" class="emg-phone" placeholder="電話番号" maxlength="20" value="${esc(e.phone || '')}">
          </div>
        </div>`).join('') || '<p class="hint">まだ項目がありません。</p>';
      emergencyListEl.querySelectorAll('.free-block').forEach((el) => {
        const idx = +el.dataset.idx;
        el.querySelector('.emg-label').addEventListener('input', (e) => { board.emergencyContacts[idx].label = e.target.value; updatePreview(); });
        el.querySelector('.emg-name').addEventListener('input', (e) => { board.emergencyContacts[idx].name = e.target.value; updatePreview(); });
        el.querySelector('.emg-phone').addEventListener('input', (e) => { board.emergencyContacts[idx].phone = e.target.value; updatePreview(); });
        el.querySelector('.emg-remove').addEventListener('click', () => { board.emergencyContacts.splice(idx, 1); renderEmergencyList(); updatePreview(); });
      });
    }
    document.getElementById('btn-add-emg').addEventListener('click', () => {
      board.emergencyContacts = board.emergencyContacts || [];
      if (board.emergencyContacts.length >= 12) { showToast('これ以上追加できません', true); return; }
      board.emergencyContacts.push({ label: '', name: '', phone: '' });
      renderEmergencyList();
      updatePreview();
    });

    // ---- basic fields ----
    const fCustomerName = document.getElementById('f-customerName');
    const fGoal0 = document.getElementById('f-goal0');
    const fGoal1 = document.getElementById('f-goal1');
    const fRopeStart = document.getElementById('f-ropeStart');
    const fTargetHours = document.getElementById('f-targetHours');
    const fCurrentHours = document.getElementById('f-currentHours');
    const fHoursDate = document.getElementById('f-hoursDate');
    const fPeriodStart = document.getElementById('f-periodStart');
    const fPeriodEnd = document.getElementById('f-periodEnd');
    const fNotice = document.getElementById('f-notice');
    const fNoticeSize = document.getElementById('f-notice-size');

    function fillForm() {
      fCustomerName.value = board.customerName || '';
      fGoal0.value = (board.safetyGoals && board.safetyGoals[0]) || '';
      fGoal1.value = (board.safetyGoals && board.safetyGoals[1]) || '';
      fRopeStart.value = board.ropeCycleStartMonth || '';
      fTargetHours.value = board.targetHours || 0;
      fCurrentHours.value = board.currentHours || 0;
      fHoursDate.value = board.currentHoursAsOfDate || '';
      fPeriodStart.value = board.constructionPeriodStart || '';
      fPeriodEnd.value = board.constructionPeriodEnd || '';
      fNotice.value = board.noticeText || '';
      fNoticeSize.value = board.noticeFontSize || 'm';
      renderRopeSlots();
      renderFreeBlocks();
      renderEmergencyList();
      updateSignalPreview();
    }

    [fCustomerName, fGoal0, fGoal1, fRopeStart,
     fTargetHours, fCurrentHours, fHoursDate, fPeriodStart, fPeriodEnd, fNotice, fNoticeSize].forEach((el) => {
      el.addEventListener('input', () => {
        board.customerName = fCustomerName.value;
        board.safetyGoals = [fGoal0.value, fGoal1.value];
        board.ropeCycleStartMonth = fRopeStart.value;
        board.targetHours = Number(fTargetHours.value) || 0;
        board.currentHours = Number(fCurrentHours.value) || 0;
        board.currentHoursAsOfDate = fHoursDate.value;
        board.constructionPeriodStart = fPeriodStart.value;
        board.constructionPeriodEnd = fPeriodEnd.value;
        board.noticeText = fNotice.value;
        board.noticeFontSize = fNoticeSize.value;
        updatePreview();
      });
    });

    // ---- signal image ----
    const signalPreviewImg = document.getElementById('signal-preview');
    function updateSignalPreview() {
      if (board.hasCustomSignalImage) {
        signalPreviewImg.src = `/uploads/${board.id}.jpg?v=${Date.now()}`;
      } else if (sharedStatus.signal) {
        signalPreviewImg.src = `/shared/signal.jpg?v=${Date.now()}`;
      } else {
        signalPreviewImg.removeAttribute('src');
      }
    }
    document.getElementById('f-signal-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const blob = await compressImage(file, 1400, 0.82);
        const fd = new FormData();
        fd.append('image', blob, 'signal.jpg');
        const r = await fetch(`/api/boards/${id}/image?key=${encodeURIComponent(key)}`, { method: 'POST', body: fd });
        if (!r.ok) throw new Error();
        board.hasCustomSignalImage = true;
        updateSignalPreview();
        updatePreview();
        showToast('画像を更新しました');
      } catch (err) {
        showToast('画像のアップロードに失敗しました', true);
      }
    });
    document.getElementById('btn-signal-remove').addEventListener('click', async () => {
      try {
        const r = await fetch(`/api/boards/${id}/image?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
        if (!r.ok) throw new Error();
        board.hasCustomSignalImage = false;
        updateSignalPreview();
        updatePreview();
        showToast('既定の内容に戻しました');
      } catch (err) {
        showToast('操作に失敗しました', true);
      }
    });

    // ---- preview + save ----
    const previewEl = document.getElementById('preview');
    function computeLocalPreview() {
      // サーバーの計算ロジックと同じ内容をその場で再現(保存前のプレビュー用)
      const today = new Date();
      const y = today.getFullYear(), m = today.getMonth() + 1;
      const colors = board.ropeColors && board.ropeColors.length === 4 ? board.ropeColors : ['赤', '黄', '緑', '白'];
      const [sy, sm] = (board.ropeCycleStartMonth || `${y}-${String(m).padStart(2, '0')}`).split('-').map(Number);
      const monthsDiff = (y - sy) * 12 + (m - sm);
      const idx = ((monthsDiff % 4) + 4) % 4;
      return {
        todayYmd: `${y}-${String(m).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
        currentRopeColor: colors[idx],
        currentRopeColorIndex: idx,
      };
    }
    function updatePreview() {
      const withComputed = { ...board, computed: computeLocalPreview() };
      renderStage(previewEl, withComputed, sharedStatus);
    }

    document.getElementById('btn-save').addEventListener('click', async () => {
      const payload = {
        customerName: board.customerName,
        ropeColors: board.ropeColors,
        ropeCycleStartMonth: board.ropeCycleStartMonth,
        targetHours: board.targetHours,
        currentHours: board.currentHours,
        currentHoursAsOfDate: board.currentHoursAsOfDate,
        constructionPeriodStart: board.constructionPeriodStart,
        constructionPeriodEnd: board.constructionPeriodEnd,
        safetyGoals: board.safetyGoals,
        noticeText: board.noticeText,
        noticeFontSize: board.noticeFontSize,
        freeBlocks: board.freeBlocks,
        emergencyContacts: board.emergencyContacts,
      };
      try {
        const r = await fetch(`/api/boards/${id}?key=${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r.status === 403) { showToast('編集リンクが正しくないため保存できません', true); return; }
        if (!r.ok) throw new Error();
        showToast('保存しました');
      } catch (e) {
        showToast('保存に失敗しました。通信環境をご確認のうえ再度お試しください。', true);
      }
    });

    fillForm();
    updatePreview();
  }

  // 画像をキャンバスでリサイズ・圧縮してJPEGのBlobにする(アップロードを軽量化するため)
  function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('encode failed')), 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ---- entry point ----
  const id = qs('id');
  const key = qs('key');
  if (!id) {
    document.body.className = 'edit-page';
    document.getElementById('app').innerHTML =
      '<div class="msg-center">掲示板IDが指定されていません。管理画面(admin.html)から現場を作成し、発行されたURLをお使いください。</div>';
  } else if (key) {
    runEditMode(id, key);
  } else {
    runViewMode(id);
  }
})();
