/**
 * 管理画面 — 現場(ボード)の一覧・新規作成・共通コンテンツの差し替え
 */
(() => {
  const SHARED_ITEMS = [
    { key: 'rope', label: '玉掛けワイヤーロープの点検表' },
    { key: 'cycle', label: '安全施工サイクル' },
    { key: 'rule333', label: '玉掛け作業の基本(3・3・3運動)' },
    { key: 'signal', label: '当作業所のクレーン等の合図法(既定)' },
  ];
  const BLOCK_LABELS = {
    goals: '今月の安全目標',
    record: '無災害記録',
    rope: '玉掛けロープの点検色',
    ropeTable: '玉掛けロープの点検表(画像)',
    cycle: '安全施工サイクル(画像)',
    rule333: '3・3・3運動(画像)',
    signal: '当作業所の合図法(画像)',
    notice: 'お知らせ',
    free: '自由記入欄',
    emergency: '緊急時連絡先',
  };
  const LAYOUT_MODES = [
    { value: 'all', label: 'すべて表示(小さめの画面には不向き)' },
    { value: 'split4', label: '4分割' },
    { value: 'split2', label: '2分割' },
    { value: 'single', label: '1つだけ表示' },
  ];
  const BLOCKS_PER_MODE = { all: 0, single: 1, split2: 2, split4: 4 };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function showToast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (el.className = 'toast'), 2600);
  }

  let adminPassword = sessionStorage.getItem('sb_admin_password') || '';

  async function api(path, opts = {}) {
    opts.headers = Object.assign({}, opts.headers, { 'X-Admin-Password': adminPassword });
    const r = await fetch(path, opts);
    if (r.status === 403) throw { authFailed: true };
    return r;
  }

  function baseUrl() {
    // 拡張子なしのURL(/board)を使う。Cloudflare Pages・Node(Express)どちらで
    // 動かしても、この形でboard.htmlが表示されるようにしている(server.js側は
    // express.static の extensions オプション、Cloudflare Pages 側は静的アセット配信の
    // 既定動作でそれぞれ解決される)。
    return location.origin + '/board';
  }

  async function renderApp() {
    const app = document.getElementById('app');
    if (!adminPassword) {
      renderLogin(app);
      return;
    }
    app.innerHTML = '<div class="wrap"><p>読み込み中…</p></div>';
    try {
      const [boardsRes, sharedRes] = await Promise.all([
        api('/api/boards'), api('/api/shared'),
      ]);
      if (!boardsRes.ok || !sharedRes.ok) throw new Error('load failed');
      const boards = await boardsRes.json();
      const sharedStatus = await sharedRes.json();
      renderMain(app, boards, sharedStatus);
    } catch (e) {
      if (e && e.authFailed) {
        sessionStorage.removeItem('sb_admin_password');
        adminPassword = '';
        renderLogin(app, '管理者パスワードが正しくありません。');
      } else {
        app.innerHTML = '<div class="wrap"><p>読み込みに失敗しました。ページを再読み込みしてください。</p></div>';
      }
    }
  }

  function renderLogin(app, errorMsg) {
    app.innerHTML = `
      <div id="login-screen" class="card">
        <h1 style="margin:0;font-size:18px">安全掲示板 管理画面</h1>
        <p style="color:var(--ink-soft);font-size:13px;margin:0">管理者パスワードを入力してください。</p>
        ${errorMsg ? `<p style="color:#c53b2e;font-size:13px;margin:0">${esc(errorMsg)}</p>` : ''}
        <input id="pw" type="password" placeholder="管理者パスワード">
        <button id="pw-submit" class="btn-primary">ログイン</button>
      </div>`;
    const submit = () => {
      adminPassword = document.getElementById('pw').value;
      sessionStorage.setItem('sb_admin_password', adminPassword);
      renderApp();
    };
    document.getElementById('pw-submit').addEventListener('click', submit);
    document.getElementById('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  function renderMain(app, boards, sharedStatus) {
    app.innerHTML = `
      <div class="wrap">
        <header class="top">
          <div>
            <h1>安全掲示板 管理画面</h1>
            <p>現場ごとに「表示用URL」をled-cloud.comのWebページ表示設定に登録し、「編集用URL」を顧客に共有してください。</p>
          </div>
          <button id="btn-logout" class="btn-ghost">ログアウト</button>
        </header>

        <div class="card">
          <h2 style="margin-top:0;font-size:15px">新しい現場を追加</h2>
          <div class="new-form">
            <div>
              <label>現場・顧客名</label>
              <input id="new-name" type="text" placeholder="例: 〇〇建設 △△現場" maxlength="100">
            </div>
            <button id="btn-create" class="btn-primary">追加してURLを発行</button>
          </div>
        </div>

        <div class="card">
          <h2 style="margin-top:0;font-size:15px">現場一覧(${boards.length}件)</h2>
          <div style="overflow-x:auto">
            <table>
              <thead><tr><th>現場・顧客名</th><th>URL</th><th>作成日</th><th></th><th></th></tr></thead>
              <tbody id="board-rows"></tbody>
            </table>
          </div>
          ${boards.length === 0 ? '<p class="hint">まだ現場が登録されていません。</p>' : ''}
        </div>

        <div class="card">
          <h2 style="margin-top:0;font-size:15px">共通コンテンツ(全現場で共通の画像)</h2>
          <p class="hint" style="margin-top:0">ここでアップロードした画像は、個別に画像が設定されていないすべての現場の掲示板に表示されます。</p>
          <div class="shared-grid" id="shared-grid"></div>
        </div>
      </div>`;

    document.getElementById('btn-logout').addEventListener('click', () => {
      sessionStorage.removeItem('sb_admin_password');
      adminPassword = '';
      renderApp();
    });

    document.getElementById('btn-create').addEventListener('click', async () => {
      const nameInput = document.getElementById('new-name');
      const name = nameInput.value.trim();
      try {
        const r = await api('/api/boards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerName: name }),
        });
        if (!r.ok) throw new Error();
        showToast('現場を追加しました');
        renderApp();
      } catch (e) {
        showToast('追加に失敗しました', true);
      }
    });

    const rows = document.getElementById('board-rows');
    rows.innerHTML = boards.map((b) => {
      const viewUrl = `${baseUrl()}?id=${b.id}`;
      const editUrl = `${baseUrl()}?id=${b.id}&key=${b.editKey}`;
      const created = b.createdAt ? new Date(b.createdAt).toLocaleDateString('ja-JP') : '';
      return `
        <tr>
          <td>${esc(b.customerName || '(名称未設定)')}</td>
          <td>
            <div class="url-cell">
              <div class="url-row"><span style="font-size:11px;color:var(--ink-soft);width:70px">表示用</span><code>${esc(viewUrl)}</code><button class="btn-ghost copy-btn" data-url="${esc(viewUrl)}">コピー</button></div>
              <div class="url-row"><span style="font-size:11px;color:var(--ink-soft);width:70px">編集用</span><code>${esc(editUrl)}</code><button class="btn-ghost copy-btn" data-url="${esc(editUrl)}">コピー</button></div>
            </div>
          </td>
          <td>${esc(created)}</td>
          <td><button class="btn-ghost layout-toggle-btn" data-id="${b.id}">表示レイアウト</button></td>
          <td><button class="btn-danger del-btn" data-id="${b.id}">削除</button></td>
        </tr>
        <tr class="layout-row" data-id="${b.id}" hidden><td colspan="5"></td></tr>`;
    }).join('');

    rows.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(btn.dataset.url); showToast('コピーしました'); }
        catch (e) { showToast('コピーできませんでした。手動で選択してください。', true); }
      });
    });
    rows.querySelectorAll('.del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('この現場の掲示板データを削除します。よろしいですか?(元に戻せません)')) return;
        try {
          const r = await api(`/api/boards/${btn.dataset.id}`, { method: 'DELETE' });
          if (!r.ok) throw new Error();
          showToast('削除しました');
          renderApp();
        } catch (e) { showToast('削除に失敗しました', true); }
      });
    });
    rows.querySelectorAll('.layout-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const board = boards.find((x) => x.id === id);
        const row = rows.querySelector(`.layout-row[data-id="${id}"]`);
        if (!row.hidden) { row.hidden = true; return; }
        rows.querySelectorAll('.layout-row').forEach((r) => (r.hidden = true));
        row.querySelector('td').innerHTML = layoutPanelHTML(board);
        wireLayoutPanel(row, board);
        row.hidden = false;
      });
    });

    const sharedGrid = document.getElementById('shared-grid');
    sharedGrid.innerHTML = SHARED_ITEMS.map((item) => `
      <div class="shared-item">
        <h3>${esc(item.label)}</h3>
        ${sharedStatus[item.key]
          ? `<img src="/shared/${item.key}.jpg?v=${Date.now()}" alt="${esc(item.label)}">`
          : `<div class="ph">未設定</div>`}
        <input type="file" accept="image/*" class="shared-file" data-key="${item.key}">
        ${sharedStatus[item.key] ? `<button class="btn-ghost shared-remove" data-key="${item.key}">削除</button>` : ''}
      </div>`).join('');

    sharedGrid.querySelectorAll('.shared-file').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const blob = await compressImage(file, 1400, 0.82);
          const fd = new FormData();
          fd.append('image', blob, 'img.jpg');
          const r = await api(`/api/shared/${input.dataset.key}/image`, { method: 'POST', body: fd });
          if (!r.ok) throw new Error();
          showToast('更新しました');
          renderApp();
        } catch (err) { showToast('アップロードに失敗しました', true); }
      });
    });
    sharedGrid.querySelectorAll('.shared-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const r = await api(`/api/shared/${btn.dataset.key}/image`, { method: 'DELETE' });
          if (!r.ok) throw new Error();
          showToast('削除しました');
          renderApp();
        } catch (e) { showToast('削除に失敗しました', true); }
      });
    });
  }

  function layoutPanelHTML(board) {
    const layout = board.layout || { mode: 'all', blocks: [] };
    return `
      <div class="card" style="margin:0">
        <p class="hint" style="margin-top:0">設置するサイネージのサイズ・ピッチによっては、一度に多くの項目を表示すると文字が小さくなり読みにくくなります。画面に表示する項目数を絞り込めます。</p>
        <div class="new-form" style="margin-bottom:10px">
          <div>
            <label>設置ディスプレイのメモ(任意)</label>
            <input class="lp-displayInfo" type="text" maxlength="200" placeholder="例: 75インチ ピッチ3.3" value="${esc(board.displayInfo || '')}">
          </div>
          <div>
            <label>表示レイアウト</label>
            <select class="lp-mode">
              ${LAYOUT_MODES.map((m) => `<option value="${m.value}" ${m.value === layout.mode ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="lp-blocks"></div>
        <div style="margin-top:10px"><button class="btn-primary lp-save">レイアウトを保存</button></div>
      </div>`;
  }

  function blockSelectsHTML(mode, blocks) {
    const count = BLOCKS_PER_MODE[mode] || 0;
    if (count === 0) return '<p class="hint">「すべて表示」では画面全体に全項目が表示されます。</p>';
    const keys = Object.keys(BLOCK_LABELS);
    let html = '<div class="field-row" style="flex-wrap:wrap">';
    for (let i = 0; i < count; i++) {
      const current = blocks[i] || keys[i % keys.length];
      html += `<div style="min-width:180px">
        <label>${mode === 'single' ? '表示する項目' : 'パネル' + (i + 1)}</label>
        <select class="lp-block" data-idx="${i}">
          ${keys.map((k) => `<option value="${k}" ${k === current ? 'selected' : ''}>${esc(BLOCK_LABELS[k])}</option>`).join('')}
        </select>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  function wireLayoutPanel(row, board) {
    const layout = board.layout || { mode: 'all', blocks: [] };
    const blocksEl = row.querySelector('.lp-blocks');
    const modeSel = row.querySelector('.lp-mode');
    let currentBlocks = (layout.blocks || []).slice();

    function renderBlocks() {
      blocksEl.innerHTML = blockSelectsHTML(modeSel.value, currentBlocks);
      blocksEl.querySelectorAll('.lp-block').forEach((sel) => {
        sel.addEventListener('change', () => {
          currentBlocks[+sel.dataset.idx] = sel.value;
        });
      });
    }
    modeSel.addEventListener('change', renderBlocks);
    renderBlocks();

    row.querySelector('.lp-save').addEventListener('click', async () => {
      const displayInfo = row.querySelector('.lp-displayInfo').value;
      const mode = modeSel.value;
      const count = BLOCKS_PER_MODE[mode] || 0;
      const blocks = currentBlocks.slice(0, count);
      try {
        const r = await api(`/api/boards/${board.id}/layout`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayInfo, layout: { mode, blocks } }),
        });
        if (!r.ok) throw new Error();
        showToast('レイアウトを保存しました');
        board.displayInfo = displayInfo;
        board.layout = { mode, blocks };
      } catch (e) {
        showToast('保存に失敗しました', true);
      }
    });
  }

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

  renderApp();
})();
