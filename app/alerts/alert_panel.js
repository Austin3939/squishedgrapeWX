// Alerts settings panel — loaded before the bundle, initialised after it.
// Provides per-category filter toggles, vocal alerts, accordion list, and toast popups.

// ── State ─────────────────────────────────────────────────────────────────
var _sgwxVocalEnabled = false;
var _sgwxAnnouncedIds = new Set();
var _sgwxSeedDone     = false; // true once we've silently seeded existing alerts

// NWS watch layer fallback state
var _sgwxWatchCache    = null;
var _sgwxWatchFetching = false;

// Toast queue
var _sgwxToastQueue   = [];
var _sgwxToastBusy    = false;

// Pre-load the alarm tone.
var _sgwxAlarmAudio = new Audio('./audley_fergine-warning-alarm-loop-1-279206.mp3');
_sgwxAlarmAudio.preload = 'auto';

// ── Female voice selection ────────────────────────────────────────────────
var _sgwxFemaleVoice = null;

function _sgwxLoadVoice() {
    if (!window.speechSynthesis) return;
    var voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    var preferred = [
        'Microsoft Aria Online (Natural) - English (United States)',
        'Microsoft Jenny Online (Natural) - English (United States)',
        'Microsoft Ana Online (Natural) - English (United States)',
        'Microsoft Emma Online (Natural) - English (United States)',
        'Microsoft Jane Online (Natural) - English (United Kingdom)',
        'Google UK English Female',
        'Samantha', 'Karen', 'Victoria', 'Fiona',
        'Microsoft Zira Desktop - English (United States)',
        'Microsoft Zira - English (United States)',
        'Microsoft Zira',
        'Google US English',
    ];
    for (var i = 0; i < preferred.length; i++) {
        var match = voices.filter(function(v) { return v.name === preferred[i]; })[0];
        if (match) { _sgwxFemaleVoice = match; return; }
    }
    var neural = voices.filter(function(v) { return /online|natural/i.test(v.name) && /en/i.test(v.lang); })[0];
    if (neural) { _sgwxFemaleVoice = neural; return; }
    var female = voices.filter(function(v) { return /female/i.test(v.name) && /en/i.test(v.lang); })[0];
    if (female) { _sgwxFemaleVoice = female; return; }
    _sgwxFemaleVoice = voices.filter(function(v) { return /en[-_]/i.test(v.lang); })[0] || voices[0] || null;
}

if (window.speechSynthesis) {
    _sgwxLoadVoice();
    window.speechSynthesis.addEventListener('voiceschanged', _sgwxLoadVoice);
}

// ── TTS helpers ───────────────────────────────────────────────────────────
function _sgwxSpeak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    var utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.1; utt.pitch = 1.0; utt.volume = 1;
    if (_sgwxFemaleVoice) utt.voice = _sgwxFemaleVoice;
    window.speechSynthesis.speak(utt);
}

function _sgwxAlarmThenSpeak(text) {
    _sgwxLoadVoice();
    _sgwxAlarmAudio.currentTime = 0;
    var playPromise = _sgwxAlarmAudio.play();
    var doSpeak = function() {
        setTimeout(function() {
            _sgwxAlarmAudio.pause();
            _sgwxAlarmAudio.currentTime = 0;
            _sgwxSpeak(text);
        }, 2100);
    };
    if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(doSpeak).catch(function() { _sgwxSpeak(text); });
    } else { doSpeak(); }
}

// ── Alert category helper ─────────────────────────────────────────────────
function _sgwxAlertCategory(event) {
    var e = (event || '').toLowerCase();
    if (/watch/.test(e))                        return 'watch';
    if (/warning/.test(e))                      return 'warning';
    if (/discussion|mesoscale/.test(e))         return 'discussion';
    if (/statement|advisory|outlook/.test(e))   return 'statement';
    return 'warning';
}

// ── Vocal type filter ─────────────────────────────────────────────────────
function _sgwxMatchesVocalType(event) {
    if (/tornado warning/i.test(event)             && $('#sgwxVocalTornado').is(':checked'))  return true;
    if (/tornado watch/i.test(event)               && $('#sgwxVocalTorWatch').is(':checked')) return true;
    if (/severe thunderstorm warning/i.test(event) && $('#sgwxVocalSVR').is(':checked'))      return true;
    if (/severe thunderstorm watch/i.test(event)   && $('#sgwxVocalSVRWatch').is(':checked')) return true;
    if (/flash flood warning/i.test(event)         && $('#sgwxVocalFFW').is(':checked'))      return true;
    if (/winter storm warning/i.test(event)        && $('#sgwxVocalWinter').is(':checked'))   return true;
    var isSpecific = /tornado warning|tornado watch|severe thunderstorm warning|severe thunderstorm watch|flash flood warning|winter storm warning/i.test(event);
    if (!isSpecific && $('#sgwxVocalOthers').is(':checked')) return true;
    return false;
}

// ── Toast popup ───────────────────────────────────────────────────────────
var _sgwxToastTimer = null;

function _sgwxToastColor(cat) {
    if (cat === 'warning')   return { border: '#e83030', bg: '#1a0606' };
    if (cat === 'watch')     return { border: '#e8c030', bg: '#1a1606' };
    if (cat === 'statement') return { border: '#3080e8', bg: '#06101a' };
    return                          { border: '#606080', bg: '#10101a' };
}

function _sgwxFmtExpires(isoStr) {
    if (!isoStr) return null;
    var d = new Date(isoStr);
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

// Takes the full NWS feature object — called only when the alert is brand new.
function _sgwxShowToast(feature) {
    _sgwxToastQueue.push(feature);
    if (!_sgwxToastBusy) _sgwxNextToast();
}

function _sgwxNextToast() {
    if (!_sgwxToastQueue.length) { _sgwxToastBusy = false; return; }
    _sgwxToastBusy = true;
    var f  = _sgwxToastQueue.shift();
    var p  = f.properties || {};
    var el = document.getElementById('sgwxAlertToast');
    if (!el) { _sgwxToastBusy = false; return; }

    var cat     = _sgwxAlertCategory(p.event);
    var cl      = _sgwxToastColor(cat);
    var area    = (p.areaDesc || '').replace(/;/g, '; ');
    var expires = _sgwxFmtExpires(p.expires);
    var sender  = (p.senderName || '').replace(/^National Weather Service\s*/i, 'NWS ');
    var headline = (p.headline || '').replace(/ issued.*$/i, '').trim();
    if (!headline && p.description) {
        headline = p.description.split('\n').filter(function(l) { return l.trim(); })[0] || '';
    }
    if (headline.length > 140) headline = headline.slice(0, 137) + '…';

    var metaParts = [];
    if (expires) metaParts.push('Until ' + expires);
    if (sender)  metaParts.push(sender);

    document.getElementById('sgwxToastInner').innerHTML =
        '<div class="sgwxToastEvent">' + (p.event || 'Alert') + '</div>' +
        (area     ? '<div class="sgwxToastArea">'     + area     + '</div>' : '') +
        (metaParts.length ? '<div class="sgwxToastMeta">' + metaParts.join(' &middot; ') + '</div>' : '') +
        (headline ? '<div class="sgwxToastHeadline">' + headline + '</div>' : '') +
        '<button class="sgwxToastViewBtn" onclick="window._sgwxOpenAlertsList()">&#xf024; View All Alerts</button>';

    el.style.borderLeftColor = cl.border;
    el.style.background      = cl.bg;
    el.classList.add('sgwxToastVisible');

    if (_sgwxToastTimer) clearTimeout(_sgwxToastTimer);
    _sgwxToastTimer = setTimeout(_sgwxDismissToast, 8000);

    document.getElementById('sgwxToastClose').onclick = function() {
        clearTimeout(_sgwxToastTimer);
        _sgwxDismissToast();
    };
}

function _sgwxDismissToast() {
    var el = document.getElementById('sgwxAlertToast');
    if (!el) return;
    el.classList.remove('sgwxToastVisible');
    setTimeout(_sgwxNextToast, 350);
}

// ── New-alert detection ───────────────────────────────────────────────────
function _sgwxCheckNewAlerts() {
    var data = window.atticData && window.atticData.alerts_data;
    if (!data || !data.features || !data.features.length) return;

    // First time we find real data: seed silently, never toast existing alerts.
    if (!_sgwxSeedDone) {
        _sgwxSeedDone = true;
        data.features.forEach(function(f) {
            var p = f.properties;
            _sgwxAnnouncedIds.add(p.id || (p.event + '_' + p.areaDesc));
        });
        return;
    }

    var wantWarnings    = $('#sgwxAlertWarnings').is(':checked');
    var wantWatches     = $('#sgwxAlertWatches').is(':checked');
    var wantStatements  = $('#sgwxAlertStatements').is(':checked');
    var wantDiscussions = $('#sgwxAlertDiscussions').is(':checked');

    data.features.forEach(function(f) {
        var p  = f.properties;
        var id = p.id || (p.event + '_' + p.areaDesc);
        if (_sgwxAnnouncedIds.has(id)) return;
        _sgwxAnnouncedIds.add(id);

        // Show toast with full feature info
        _sgwxShowToast(f);

        // Refresh accordion if already open
        if ($('#sgwxAlertsListPanel').is(':visible')) _sgwxBuildAlertsList();

        // Vocal — only if enabled and category/type match
        if (!_sgwxVocalEnabled) return;
        var cat = _sgwxAlertCategory(p.event);
        if (cat === 'warning'    && !wantWarnings)    return;
        if (cat === 'watch'      && !wantWatches)     return;
        if (cat === 'statement'  && !wantStatements)  return;
        if (cat === 'discussion' && !wantDiscussions) return;
        if (!_sgwxMatchesVocalType(p.event)) return;
        var area = (p.areaDesc || '').split(';')[0].split(',').slice(0, 3).join(',').trim();
        _sgwxAlarmThenSpeak('New ' + (p.event || 'alert') + ' for ' + (area || 'your area') + '.');
    });
}

// ── Accordion alerts list ─────────────────────────────────────────────────
function _sgwxBuildAlertsList() {
    var body = document.getElementById('sgwxAlertsListBody');
    if (!body) return;
    var data     = window.atticData && window.atticData.alerts_data;
    var features = (data && data.features) || [];

    var groups = { warning: [], watch: [], statement: [], discussion: [] };
    features.forEach(function(f) {
        var cat = _sgwxAlertCategory(f.properties.event);
        if (groups[cat]) groups[cat].push(f);
    });

    var sections = [
        { key: 'warning',    label: 'Warnings',    icon: 'fa-triangle-exclamation', color: '#e83030' },
        { key: 'watch',      label: 'Watches',      icon: 'fa-eye',                  color: '#e8c030' },
        { key: 'statement',  label: 'Statements',   icon: 'fa-circle-info',          color: '#3080e8' },
        { key: 'discussion', label: 'Discussions',  icon: 'fa-comment',              color: '#8080a0' }
    ];

    body.innerHTML = sections.map(function(s) {
        var items = groups[s.key];
        var count = items.length;

        var rows = items.map(function(f) {
            var p       = f.properties;
            var area    = (p.areaDesc || '').replace(/;/g, '; ');
            var expires = _sgwxFmtExpires(p.expires);
            var sender  = (p.senderName || '').replace(/^National Weather Service\s*/i, 'NWS ');
            var headline = (p.headline || '').replace(/ issued.*$/i, '').trim();
            if (!headline && p.description) {
                headline = p.description.split('\n').filter(function(l) { return l.trim(); })[0] || '';
            }
            if (headline.length > 160) headline = headline.slice(0, 157) + '…';

            return '<div class="sgwxAccordionItem">' +
                '<div class="sgwxAccordionItemTitle">' + (p.event || 'Alert') + '</div>' +
                (area ? '<div class="sgwxAccordionItemArea">' + area + '</div>' : '') +
                ((expires || sender) ? '<div class="sgwxAccordionItemMeta">' +
                    (expires ? 'Until ' + expires : '') +
                    (expires && sender ? ' &middot; ' : '') +
                    (sender || '') + '</div>' : '') +
                (headline ? '<div class="sgwxAccordionItemHeadline">' + headline + '</div>' : '') +
                '</div>';
        }).join('');

        return '<div class="sgwxAccordionSection" data-open="' + (count > 0) + '">' +
            '<div class="sgwxAccordionHeader">' +
                '<span><i class="fa ' + s.icon + '" style="color:' + s.color + '"></i> ' + s.label + '</span>' +
                '<span class="sgwxAccordionCount' + (count ? ' sgwxAccordionCountBadge" style="background:' + s.color + '"' : '"') + '>' + count + '</span>' +
            '</div>' +
            '<div class="sgwxAccordionBody">' +
                (count ? rows : '<div class="sgwxAccordionEmpty">No active ' + s.label.toLowerCase() + '</div>') +
            '</div></div>';
    }).join('');

    body.querySelectorAll('.sgwxAccordionHeader').forEach(function(h) {
        h.addEventListener('click', function() {
            var sec = this.closest('.sgwxAccordionSection');
            sec.setAttribute('data-open', sec.getAttribute('data-open') === 'true' ? 'false' : 'true');
        });
    });
}

function _sgwxOpenAlertsList() {
    _sgwxBuildAlertsList();
    $('#sgwxAlertsListPanel').show();
    $('#sgwxAlertsListBtn span').removeClass('icon-grey menu_item_not_selected').addClass('menu_item_selected');
}
window._sgwxOpenAlertsList = _sgwxOpenAlertsList;

// ── NWS watch layer (fallback for SPC KMZ) ───────────────────────────────
function _sgwxWatchColor(event) {
    var e = (event || '').toLowerCase();
    if (/tornado/.test(e))             return '#ff0000';
    if (/severe thunderstorm/.test(e)) return '#ffdd00';
    if (/flash flood/.test(e))         return '#00cc44';
    if (/winter/.test(e))              return '#4488ff';
    return '#ff8800';
}

function _sgwxApplyWatchLayer(m, geojson, show) {
    if (!m || !m.isStyleLoaded()) return;
    var vis = show ? 'visible' : 'none';
    var src = 'sgwx_nws_watches';
    try {
        if (m.getSource(src)) {
            m.getSource(src).setData(geojson);
        } else {
            m.addSource(src, { type: 'geojson', data: geojson });
            m.addLayer({ id: 'sgwx_nws_watches_fill', type: 'fill', source: src,
                paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 } });
            m.addLayer({ id: 'sgwx_nws_watches_outline', type: 'line', source: src,
                paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.85 } });
        }
        if (m.getLayer('sgwx_nws_watches_fill'))
            m.setLayoutProperty('sgwx_nws_watches_fill',    'visibility', vis);
        if (m.getLayer('sgwx_nws_watches_outline'))
            m.setLayoutProperty('sgwx_nws_watches_outline', 'visibility', vis);
    } catch (err) {}
}

function _sgwxUpdateNwsWatches() {
    var m = window._sgwxMap;
    if (!m || !m.isStyleLoaded()) return;
    var show = $('#sgwxAlertWatches').is(':checked');

    if (_sgwxWatchCache && (Date.now() - _sgwxWatchCache.ts < 60000)) {
        _sgwxApplyWatchLayer(m, _sgwxWatchCache.geojson, show);
        return;
    }
    if (_sgwxWatchFetching) return;

    var data = window.atticData && window.atticData.alerts_data;
    if (!data || !data.features) return;

    var watches = data.features.filter(function(f) { return /watch/i.test(f.properties.event); });

    if (watches.length === 0) {
        var empty = { type: 'FeatureCollection', features: [] };
        _sgwxWatchCache = { geojson: empty, ts: Date.now() };
        _sgwxApplyWatchLayer(m, empty, show);
        return;
    }

    var withGeom = watches.filter(function(f) { return f.geometry !== null; });
    if (withGeom.length > 0) {
        var gj = { type: 'FeatureCollection', features: withGeom.map(function(f) {
            return { type: 'Feature', geometry: f.geometry,
                properties: { event: f.properties.event, color: _sgwxWatchColor(f.properties.event) } };
        })};
        _sgwxWatchCache = { geojson: gj, ts: Date.now() };
        _sgwxApplyWatchLayer(m, gj, show);
        return;
    }

    var zoneMap = {};
    watches.forEach(function(w) {
        (w.properties.affectedZones || []).forEach(function(url) {
            if (!zoneMap[url]) zoneMap[url] = w.properties.event;
        });
    });
    var entries = Object.keys(zoneMap).map(function(u) { return { url: u, event: zoneMap[u] }; });
    if (!entries.length) return;
    if (entries.length > 60) entries = entries.slice(0, 60);

    _sgwxWatchFetching = true;
    var features = [], done = 0, total = entries.length;

    entries.forEach(function(z) {
        var finish = function() {
            done++;
            if (done < total) return;
            _sgwxWatchFetching = false;
            var gj2 = { type: 'FeatureCollection', features: features };
            _sgwxWatchCache = { geojson: gj2, ts: Date.now() };
            var mp = window._sgwxMap;
            if (mp) _sgwxApplyWatchLayer(mp, gj2, $('#sgwxAlertWatches').is(':checked'));
        };
        fetch(z.url)
            .then(function(r) { return r.json(); })
            .then(function(zone) {
                if (zone && zone.geometry)
                    features.push({ type: 'Feature', geometry: zone.geometry,
                        properties: { event: z.event, color: _sgwxWatchColor(z.event) } });
                finish();
            }, finish);
    });
}

// ── Filter sync ───────────────────────────────────────────────────────────
function _sgwxSyncFilter() {
    $('#armrWarningsBtnSwitchElem').prop('checked',    $('#sgwxAlertWarnings').is(':checked'));
    $('#armrWatchesBtnSwitchElem').prop('checked',     $('#sgwxAlertWatches').is(':checked'));
    $('#armrStatementsBtnSwitchElem').prop('checked',  $('#sgwxAlertStatements').is(':checked'));
    $('#armrDiscussionsBtnSwitchElem').prop('checked', $('#sgwxAlertDiscussions').is(':checked'));

    var $btn = $('.alert_options_btn');
    if ($btn.length) $btn.first().triggerHandler('click');

    var m = window._sgwxMap;
    if (m) {
        var showWatches = $('#sgwxAlertWatches').is(':checked');
        ['watches_layer', 'watches_layer_fill'].forEach(function(id) {
            if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', showWatches ? 'visible' : 'none');
        });
        var showDisc = $('#sgwxAlertDiscussions').is(':checked');
        ['discussions_layer', 'discussions_layer_fill'].forEach(function(id) {
            if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', showDisc ? 'visible' : 'none');
        });
    }
    _sgwxUpdateNwsWatches();
}

// ── Initialise ────────────────────────────────────────────────────────────
window._sgwxAlertsInit = function() {
    $('#armrWarningsBtnSwitchElem, #armrWatchesBtnSwitchElem, ' +
      '#armrStatementsBtnSwitchElem, #armrDiscussionsBtnSwitchElem')
        .prop('checked', true);

    $('#sgwxAlertsPanel')
        .draggable({ handle: '#sgwxAlertsHeader', containment: 'window' })
        .resizable({ handles: 'all', minWidth: 200, minHeight: 150 });

    // Always poll for new alerts (first run seeds silently, subsequent runs toast)
    setInterval(_sgwxCheckNewAlerts, 15000);

    // Layer visibility sync
    setInterval(function() {
        var m = window._sgwxMap;
        if (!m) return;
        var showWatches = $('#sgwxAlertWatches').is(':checked');
        var showDisc    = $('#sgwxAlertDiscussions').is(':checked');
        ['watches_layer', 'watches_layer_fill'].forEach(function(id) {
            if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', showWatches ? 'visible' : 'none');
        });
        ['discussions_layer', 'discussions_layer_fill'].forEach(function(id) {
            if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', showDisc ? 'visible' : 'none');
        });
        _sgwxUpdateNwsWatches();
    }, 3000);

    // ── Sidebar alert button ──────────────────────────────────────────────
    $('#alertMenuItemDiv').on('click', function() {
        if ($('#alertMenuItemIcon').hasClass('menu_item_selected')) {
            $('#sgwxAlertsPanel').show();
            $('#alertMenuItemIcon').removeClass('icon-grey menu_item_not_selected');
        } else {
            $('#sgwxAlertsPanel').hide();
            $('#alertMenuItemIcon').removeClass('icon-blue').addClass('icon-grey menu_item_not_selected');
        }
    });

    document.getElementById('alertMenuItemDiv').addEventListener('click', function(e) {
        if ($('#sgwxAlertsKeepActive').is(':checked') &&
            $('#alertMenuItemIcon').hasClass('menu_item_selected')) {
            e.stopImmediatePropagation();
            var $panel = $('#sgwxAlertsPanel');
            $panel.is(':visible') ? $panel.hide() : $panel.show();
            $('#alertMenuItemIcon').removeClass('icon-grey menu_item_not_selected');
        }
    }, true);

    $('#sgwxAlertsClose').on('click', function() {
        $('#sgwxAlertsPanel').hide();
        if ($('#sgwxAlertsKeepActive').is(':checked')) {
            $('#alertMenuItemIcon').removeClass('icon-grey menu_item_not_selected');
        } else {
            if ($('#alertMenuItemIcon').hasClass('menu_item_selected'))
                $('#alertMenuItemIcon').trigger('click');
        }
    });

    // ── Alerts List accordion button ──────────────────────────────────────
    $('#sgwxAlertsListBtn').on('click', function() {
        var $panel = $('#sgwxAlertsListPanel');
        var $span  = $(this).find('span');
        if ($panel.is(':visible')) {
            $panel.hide();
            $span.removeClass('menu_item_selected').addClass('icon-grey menu_item_not_selected');
        } else {
            _sgwxBuildAlertsList();
            $panel.show();
            $span.removeClass('icon-grey menu_item_not_selected').addClass('menu_item_selected');
        }
    });

    $('#sgwxAlertsListClose').on('click', function() {
        $('#sgwxAlertsListPanel').hide();
        $('#sgwxAlertsListBtn span').removeClass('menu_item_selected').addClass('icon-grey menu_item_not_selected');
    });

    // ── Filter toggles ────────────────────────────────────────────────────
    $('#sgwxAlertWarnings, #sgwxAlertWatches, #sgwxAlertStatements, #sgwxAlertDiscussions')
        .on('change', function() { _sgwxSyncFilter(); });

    // ── Vocal alerts ──────────────────────────────────────────────────────
    $('#sgwxVocalAlertsOn').on('change', function() {
        _sgwxVocalEnabled = $(this).is(':checked');
        if (!_sgwxVocalEnabled) window.speechSynthesis && window.speechSynthesis.cancel();
    });

    $('#sgwxVocalTestBtn').on('click', function() {
        _sgwxAlarmThenSpeak(
            'Test alert from SquishedGrape WX. ' +
            'Tornado Warning issued for Jefferson County and surrounding areas. ' +
            'Take shelter in a sturdy building immediately. ' +
            'This was a test of the vocal alert system.'
        );
    });
};
