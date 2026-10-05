/* Dünya alanı görünümü. Kale ve fetih verileri mevcut Socket.IO durumundan gelir. */
let worldViewZoom = 1;
let worldViewPage = null;
let worldViewFocus = 'mine';
let worldViewScroll = null;
let worldViewZoomPending = false;

const WORLD_PLOTS = [
    [163, 143], [405, 112], [765, 124], [950, 136],
    [205, 363], [352, 326], [878, 323], [1090, 353],
    [266, 574], [419, 625], [783, 598], [1042, 605]
];
const WORLD_DECOR = [
    ['forest', 285, 210, '🌲🌲🌲'], ['forest', 530, 98, '🌲🌲🌲'],
    ['forest', 931, 205, '🌲🌲🌲'], ['forest', 102, 186, '🌲🌲🌲'],
    ['forest', 64, 561, '🌲🌲🌲'], ['forest', 576, 618, '🌲🌲🌲'],
    ['forest', 985, 504, '🌲🌲🌲'], ['forest', 1126, 700, '🌲🌲🌲'],
    ['farm', 293, 471, '🌾🌾🌾'], ['farm', 1014, 432, '🌾🌾🌾'],
    ['farm', 726, 661, '🌾🌾🌾'], ['farm', 65, 672, '🌾🌾🌾'],
    ['rock', 463, 229, '🪨'], ['rock', 858, 511, '🪨'],
    ['scout', 743, 239, '🐎'], ['scout', 324, 672, '🐎'],
    ['shrine', 232, 353, '⚜️'], ['shrine', 935, 649, '⚜️']
];

function worldRememberViewport() {
    const viewport = document.querySelector('.world-map-viewport');
    if (viewport && worldViewPage === worldMapState?.page) {
        worldViewScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
    }
}

function worldSelectCastle(id) {
    worldRememberViewport();
    selectedWorldCastle = String(id);
    if (activeTab === 'world') renderPanelContent();
}

function worldFocusCastle(id) {
    selectedWorldCastle = String(id);
    worldViewFocus = selectedWorldCastle;
    if (activeTab === 'world') renderPanelContent();
}

function worldFocusMine() {
    if (!worldMapState?.success) return;
    const mine = String(worldMapState.myCastle?.id || 'main');
    selectedWorldCastle = mine;
    worldViewFocus = mine;
    if (worldMapState.page === worldMapState.myPage) renderPanelContent();
    else requestWorldMap(worldMapState.myPage);
}

function worldGoToPage(page) {
    if (!worldMapState?.success || page < 1 || page > worldMapState.pages) return;
    selectedWorldCastle = 'main';
    worldViewFocus = 'main';
    requestWorldMap(page);
}

function worldSetZoom(delta) {
    const viewport = document.querySelector('.world-map-viewport');
    const prior = worldViewZoom;
    const next = Math.max(.75, Math.min(1.5, Math.round((prior + delta) * 4) / 4));
    if (next === prior) return;
    const center = viewport ? {
        x: (viewport.scrollLeft + viewport.clientWidth / 2) / prior,
        y: (viewport.scrollTop + viewport.clientHeight / 2) / prior
    } : { x: 600, y: 370 };
    worldViewZoom = next;
    worldViewFocus = null;
    worldViewScroll = viewport ? {
        left: center.x * next - viewport.clientWidth / 2,
        top: center.y * next - viewport.clientHeight / 2
    } : null;
    worldViewZoomPending = true;
    renderPanelContent();
}

function worldUpdateCoordinates(viewport) {
    const label = document.getElementById('worldCoordinate');
    if (!label || !viewport) return;
    const x = Math.round((viewport.scrollLeft + viewport.clientWidth / 2) / worldViewZoom);
    const y = Math.round((viewport.scrollTop + viewport.clientHeight / 2) / worldViewZoom);
    label.textContent = `X: ${x}  Y: ${y}`;
}

function worldAttachPan(viewport) {
    let drag = null;
    viewport.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button')) return;
        drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.classList.add('dragging');
        viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
        if (!drag) return;
        viewport.scrollLeft = drag.left + drag.x - event.clientX;
        viewport.scrollTop = drag.top + drag.y - event.clientY;
    });
    const end = () => { drag = null; viewport.classList.remove('dragging'); };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('lostpointercapture', end);
    viewport.addEventListener('scroll', () => worldUpdateCoordinates(viewport), { passive: true });
}

function renderWorldMap(body) {
    const state = worldMapState;
    if (!state) {
        body.innerHTML = '<div class="world-realm-header">🌍 Dünya haritası yükleniyor...</div>';
        return;
    }
    if (!state.success) {
        body.innerHTML = `<div class="world-realm-header">${escapeHTML(String(state.message || 'Harita yüklenemedi.'))} <button type="button" onclick="requestWorldMap()">Yeniden Dene</button></div>`;
        return;
    }

    const priorViewport = body.querySelector('.world-map-viewport');
    if (priorViewport && worldViewPage === state.page && !worldViewFocus && !worldViewZoomPending) {
        worldViewScroll = { left: priorViewport.scrollLeft, top: priorViewport.scrollTop };
    }
    worldViewZoomPending = false;
    const pageChanged = worldViewPage !== state.page;
    if (pageChanged && !worldViewFocus) worldViewFocus = 'main';
    if (worldViewPage === null) worldViewFocus = 'mine';
    worldViewPage = state.page;

    const main = state.mainCastle || {};
    const castles = Array.isArray(state.castles) ? state.castles.slice(0, WORLD_PLOTS.length) : [];
    const mine = state.myCastle || {};
    const selected = castles.find(castle => castle.id === selectedWorldCastle)
        || (mine.id && mine.id === selectedWorldCastle ? mine : null);
    const mainSelected = !selected;
    const remaining = Math.max(0, Number(main.dailyAttacksRemaining) || 0);
    const limit = Math.max(1, Number(main.dailyAttackLimit) || 5);
    const owner = escapeHTML(String(main.ownerName || 'Saray Muhafızları'));
    const decor = WORLD_DECOR.map(([kind, x, y, label]) =>
        `<span class="world-decor ${kind}" style="left:${x}px;top:${y}px" aria-hidden="true"><span>${label}</span></span>`
    ).join('');
    const plots = castles.map((castle, index) => {
        const [x, y] = WORLD_PLOTS[index];
        const isMine = castle.id === mine.id;
        const name = escapeHTML(String(castle.username || 'Hükümdar'));
        const id = escapeHTML(String(castle.id));
        const level = Math.max(1, Number(castle.level) || 1);
        return `<button type="button" class="world-map-marker ${isMine ? 'mine' : ''} ${selectedWorldCastle === castle.id ? 'selected' : ''}"
            style="--x:${x}px;--y:${y}px" data-world-castle="${id}"
            onclick="worldSelectCastle('${id}')" aria-label="${name} kalesi, seviye ${level}${isMine ? ', senin kalen' : ''}" aria-pressed="${selectedWorldCastle === castle.id}">
            <span class="world-fort-art" aria-hidden="true"></span>
            <span class="world-fort-name">${isMine ? '◆ ' : ''}${name}</span>
            <span class="world-fort-level">${isMine ? 'KENDİ KALEM · ' : ''}SV ${level}</span>
        </button>`;
    }).join('');

    body.innerHTML = `
        <section class="world-realm" aria-label="Dünya alanı">
            <header class="world-realm-header">
                <div><h2>🌍 Dünya Alanı</h2><p>Kaleni bul, diğer hükümdarları gör ve Ana Kale için sefere çık.</p></div>
                <div class="world-realm-count">🏰 ${Number(state.total || 0).toLocaleString('tr-TR')} oyuncu kalesi</div>
            </header>
            <div class="world-map-frame">
                <div class="world-map-viewport" role="group" aria-label="Bölge ${state.page} dünya haritası; kaydırarak gez">
                    <div class="world-map-sizer" style="--world-zoom:${worldViewZoom};width:${Math.round(1200 * worldViewZoom)}px;height:${Math.round(760 * worldViewZoom)}px">
                        <div class="world-map-stage">
                            <span class="world-capital-ring" aria-hidden="true"></span>
                            ${decor}
                            <button type="button" class="world-map-marker capital ${mainSelected ? 'selected' : ''}"
                                data-world-castle="main" onclick="worldSelectCastle('main')"
                                aria-label="Ana Kale, sahibi ${owner}" aria-pressed="${mainSelected}">
                                <span class="world-fort-art" aria-hidden="true"></span>
                                <span class="world-fort-name">ANA KALE</span>
                                <span class="world-fort-level">👑 ${owner}</span>
                            </button>
                            ${plots}
                        </div>
                    </div>
                </div>
                <span class="world-map-overlay region">BÖLGE ${state.page} / ${state.pages}</span>
                <span class="world-map-overlay compass" aria-hidden="true">✦ K</span>
                <nav class="world-map-toolbar" aria-label="Dünya haritası kontrolleri">
                    <button type="button" onclick="worldGoToPage(${state.page - 1})" ${state.page <= 1 ? 'disabled' : ''} aria-label="Önceki bölge">◀</button>
                    <button type="button" onclick="worldGoToPage(${state.page + 1})" ${state.page >= state.pages ? 'disabled' : ''} aria-label="Sonraki bölge">▶</button>
                    <button type="button" onclick="worldFocusMine()">📍 Kalem</button>
                    <button type="button" onclick="worldFocusCastle('main')">👑 Ana Kale</button>
                    <button type="button" onclick="worldSetZoom(-.25)" ${worldViewZoom <= .75 ? 'disabled' : ''} aria-label="Haritayı uzaklaştır">−</button>
                    <span class="world-zoom-label">${Math.round(worldViewZoom * 100)}%</span>
                    <button type="button" onclick="worldSetZoom(.25)" ${worldViewZoom >= 1.5 ? 'disabled' : ''} aria-label="Haritayı yakınlaştır">+</button>
                    <span id="worldCoordinate" class="world-coordinate" aria-live="off"></span>
                </nav>
            </div>
            <aside class="world-castle-detail" aria-live="polite">
                ${mainSelected ? `
                    <div><h3>👑 Ana Kale</h3>
                        <p>Sahibi: <strong>${owner}</strong> · Savunma gücü: ${Number(main.defensePower || 0).toLocaleString('tr-TR')}</p>
                        <p>Bugün kalan kuşatma hakkın: ${remaining}/${limit}. Fetih, Taht Savaşı kurallarıyla sonuçlanır.</p>
                    </div>
                    <button type="button" class="world-siege-button" onclick="openMainCastleSiege()">${main.isOwner ? '🛡️ Savunmayı Yönet' : '⚔️ Ana Kaleyi Kuşat'}</button>
                ` : `
                    <div><h3>${selected.id === mine.id ? '◆ Senin Kalen' : '🏰 Oyuncu Kalesi'} · ${escapeHTML(String(selected.username || 'Hükümdar'))}</h3>
                        <p>Seviye ${Math.max(1, Number(selected.level) || 1)} · Ana Kale fethi: ${Number(selected.victories) || 0}</p>
                        <p>${selected.id === mine.id ? 'Bu kale hesabına aittir; Ana Kale el değiştirse de burada kalır.' : 'Bu hükümdarın dünya üzerindeki kalesi.'}</p>
                    </div>
                    <button type="button" onclick="worldFocusCastle('main')">👑 Ana Kaleye Git</button>
                `}
            </aside>
        </section>`;

    const viewport = body.querySelector('.world-map-viewport');
    worldAttachPan(viewport);
    const focus = worldViewFocus;
    const saved = worldViewScroll;
    worldViewFocus = null;
    requestAnimationFrame(() => {
        if (!viewport.isConnected) return;
        if (focus) {
            const target = Array.from(viewport.querySelectorAll('[data-world-castle]'))
                .find(node => node.dataset.worldCastle === focus);
            if (target) {
                viewport.scrollLeft = target.offsetLeft * worldViewZoom - viewport.clientWidth / 2;
                viewport.scrollTop = target.offsetTop * worldViewZoom - viewport.clientHeight / 2;
            }
        } else if (saved) {
            viewport.scrollLeft = saved.left;
            viewport.scrollTop = saved.top;
        }
        worldUpdateCoordinates(viewport);
        worldViewScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
    });
}
