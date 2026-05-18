// Alerts settings panel — loaded before the bundle, initialised after it.
// Provides per-category filter toggles and a vocal-alert (TTS) feature.

// ── State ─────────────────────────────────────────────────────────────────
var _sgwxVocalEnabled  = false;
var _sgwxAnnouncedIds  = new Set();
var _sgwxVocalInterval = null;

// Pre-load the alarm tone so it plays instantly without fetch latency.
var _sgwxAlarmAudio = new Audio('./audley_fergine-warning-alarm-loop-1-279206.mp3');
_sgwxAlarmAudio.preload = 'auto';

// ── Female voice selection ────────────────────────────────────────────────
var _sgwxFemaleVoice = null;

function _sgwxLoadVoice() {
    if (!window.speechSynthesis) return;
    var voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    // Neural/natural voices first — these sound human. Robotic offline voices last.
    var preferred = [
        // Microsoft neural voices (Edge / Win 11) — best quality
        'Microsoft Aria Online (Natural) - English (United States)',
        'Microsoft Jenny Online (Natural) - English (United States)',
        'Microsoft Ana Online (Natural) - English (United States)',
        'Microsoft Emma Online (Natural) - English (United States)',
        'Microsoft Jane Online (Natural) - English (United Kingdom)',
        // Google neural (Chrome)
        'Google UK English Female',
        // macOS natural voices
        'Samantha',
        'Karen',
        'Victoria',
        'Fiona',
        // Offline fallbacks
        'Microsoft Zira Desktop - English (United States)',
        'Microsoft Zira - English (United States)',
        'Microsoft Zira',
        'Google US English',
    ];
    for (var i = 0; i < preferred.length; i++) {
        var match = voices.filter(function(v) { return v.name === preferred[i]; })[0];
        if (match) { _sgwxFemaleVoice = match; return; }
    }
    // Fallback: any online/natural English voice (neural voices contain "Online" or "Natural")
    var neural = voices.filter(function(v) {
        return /online|natural/i.test(v.name) && /en/i.test(v.lang);
    })[0];
    if (neural) { _sgwxFemaleVoice = neural; return; }
    // Any English female voice
    var female = voices.filter(function(v) {
        return /female/i.test(v.name) && /en/i.test(v.lang);
    })[0];
    if (female) { _sgwxFemaleVoice = female; return; }
    // Last resort: any English voice
    _sgwxFemaleVoice = voices.filter(function(v) { return /en[-_]/i.test(v.lang); })[0] || voices[0] || null;
}

if (window.speechSynthesis) {
    _sgwxLoadVoice();
    window.speechSynthesis.addEventListener('voiceschanged', _sgwxLoadVoice);
}

// ── Text-to-speech helpers ────────────────────────────────────────────────
function _sgwxSpeak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    var utt = new SpeechSynthesisUtterance(text);
    utt.rate   = 1.1;
    utt.pitch  = 1.0;
    utt.volume = 1;
    if (_sgwxFemaleVoice) utt.voice = _sgwxFemaleVoice;
    window.speechSynthesis.speak(utt);
}

// Play the alarm for ~3 beeps (~2.1 seconds), then speak the alert text.
function _sgwxAlarmThenSpeak(text) {
    // Ensure voices are loaded before we need them.
    _sgwxLoadVoice();

    // Reset and play from the start each time.
    _sgwxAlarmAudio.currentTime = 0;
    var playPromise = _sgwxAlarmAudio.play();

    // play() returns a Promise in modern browsers; guard against autoplay blocks.
    var doSpeak = function() {
        setTimeout(function() {
            _sgwxAlarmAudio.pause();
            _sgwxAlarmAudio.currentTime = 0;
            _sgwxSpeak(text);
        }, 2100);
    };

    if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(doSpeak).catch(function() {
            // Autoplay blocked — skip alarm and speak directly.
            _sgwxSpeak(text);
        });
    } else {
        doSpeak();
    }
}

function _sgwxAlertCategory(event) {
    var e = (event || '').toLowerCase();
    if (/watch/.test(e))                          return 'watch';
    if (/warning/.test(e))                        return 'warning';
    if (/discussion|mesoscale/.test(e))           return 'discussion';
    if (/statement|advisory|outlook/.test(e))     return 'statement';
    return 'warning'; // default unrecognised alerts to warnings
}

function _sgwxMatchesVocalType(event) {
    var e = (event || '').toLowerCase();
    if (/tornado warning/i.test(event)             && $('#sgwxVocalTornado').is(':checked'))  return true;
    if (/tornado watch/i.test(event)               && $('#sgwxVocalTorWatch').is(':checked')) return true;
    if (/severe thunderstorm warning/i.test(event) && $('#sgwxVocalSVR').is(':checked'))      return true;
    if (/severe thunderstorm watch/i.test(event)   && $('#sgwxVocalSVRWatch').is(':checked')) return true;
    if (/flash flood warning/i.test(event)         && $('#sgwxVocalFFW').is(':checked'))      return true;
    if (/winter storm warning/i.test(event)        && $('#sgwxVocalWinter').is(':checked'))   return true;
    // "All others" catches anything not matched above.
    var isSpecific = /tornado warning|tornado watch|severe thunderstorm warning|severe thunderstorm watch|flash flood warning|winter storm warning/i.test(event);
    if (!isSpecific && $('#sgwxVocalOthers').is(':checked')) return true;
    return false;
}

function _sgwxAnnounceNew() {
    if (!_sgwxVocalEnabled) return;
    var data = window.atticData && window.atticData.alerts_data;
    if (!data || !data.features) return;

    var wantWarnings    = $('#sgwxAlertWarnings').is(':checked');
    var wantWatches     = $('#sgwxAlertWatches').is(':checked');
    var wantStatements  = $('#sgwxAlertStatements').is(':checked');
    var wantDiscussions = $('#sgwxAlertDiscussions').is(':checked');

    data.features.forEach(function(f) {
        var p   = f.properties;
        var id  = p.id || (p.event + '_' + p.areaDesc);
        if (_sgwxAnnouncedIds.has(id)) return;
        _sgwxAnnouncedIds.add(id);

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

// ── Alert ticker ──────────────────────────────────────────────────────────
var _sgwxTickerRaf      = null;
var _sgwxTickerPos      = 0;
var _sgwxTickerLastHash = '';
var _sgwxTickerCatOrder = { warning: 0, watch: 1, advisory: 2 };

function _sgwxTickerCategory(event) {
    var e = (event || '').toLowerCase();
    if (/watch/.test(e))   return 'watch';
    if (/warning/.test(e)) return 'warning';
    return 'advisory';
}

function _sgwxBuildTicker() {
    var data   = window.atticData && window.atticData.alerts_data;
    var ticker = document.getElementById('sgwxTicker');
    var track  = document.getElementById('sgwxTickerTrack');
    if (!ticker || !track) return;

    if (!data || !data.features || !data.features.length) {
        ticker.style.display = 'none';
        if (_sgwxTickerRaf) { cancelAnimationFrame(_sgwxTickerRaf); _sgwxTickerRaf = null; }
        _sgwxTickerLastHash = '';
        return;
    }

    // Only rebuild when the alert set actually changes.
    var hash = data.features.map(function(f) {
        return f.properties.id || (f.properties.event + '_' + f.properties.areaDesc);
    }).join('|');
    if (hash === _sgwxTickerLastHash) return;
    _sgwxTickerLastHash = hash;

    // Group: warnings first, then watches, then advisories.
    var sorted = data.features.slice().sort(function(a, b) {
        var oa = _sgwxTickerCatOrder[_sgwxTickerCategory(a.properties.event)] || 0;
        var ob = _sgwxTickerCatOrder[_sgwxTickerCategory(b.properties.event)] || 0;
        return oa - ob;
    });

    var html = '';
    sorted.forEach(function(f) {
        var p    = f.properties;
        var evt  = p.event || 'Alert';
        var area = (p.areaDesc || '').split(';')[0].split(',').slice(0, 2).join(',').trim();
        var cat  = _sgwxTickerCategory(evt);
        var cls  = cat === 'warning' ? 'sgwxTickerWarn' :
                   cat === 'watch'   ? 'sgwxTickerWatch' : 'sgwxTickerAdvisory';
        var icon = cat === 'warning' ? 'fa-triangle-exclamation' :
                   cat === 'watch'   ? 'fa-eye' : 'fa-circle-info';
        html += '<span class="sgwxTickerItem ' + cls + '">' +
                '<i class="fa ' + icon + '"></i>' +
                evt + (area ? ' — ' + area : '') +
                '</span>';
    });

    track.innerHTML = html;
    ticker.style.display = 'flex';

    // Stop current loop and restart from the right edge.
    if (_sgwxTickerRaf) { cancelAnimationFrame(_sgwxTickerRaf); _sgwxTickerRaf = null; }
    _sgwxTickerPos = ticker.offsetWidth;
    _sgwxTickerScroll();
}

function _sgwxTickerScroll() {
    var ticker = document.getElementById('sgwxTicker');
    var track  = document.getElementById('sgwxTickerTrack');
    if (!ticker || !track) { _sgwxTickerRaf = null; return; }

    // Read scrollWidth live every frame — skips frames before layout is ready.
    var contentWidth = track.scrollWidth;
    if (contentWidth === 0) {
        _sgwxTickerRaf = requestAnimationFrame(_sgwxTickerScroll);
        return;
    }

    _sgwxTickerPos -= 1.2;

    // Only reset once the very last item has fully cleared the left edge.
    if (_sgwxTickerPos < -contentWidth) {
        _sgwxTickerPos = ticker.offsetWidth;
    }

    track.style.transform = 'translateX(' + _sgwxTickerPos + 'px)';
    _sgwxTickerRaf = requestAnimationFrame(_sgwxTickerScroll);
}

// ── Filter sync ───────────────────────────────────────────────────────────
// Writes my panel's checkbox states to the bundle's hidden checkboxes and
// fires the bundle's re-filter handler.
function _sgwxSyncFilter() {
    // Bundle positive logic: checked = show, unchecked = hide.
    $('#armrWarningsBtnSwitchElem').prop('checked',    $('#sgwxAlertWarnings').is(':checked'));
    $('#armrWatchesBtnSwitchElem').prop('checked',     $('#sgwxAlertWatches').is(':checked'));
    $('#armrStatementsBtnSwitchElem').prop('checked',  $('#sgwxAlertStatements').is(':checked'));
    $('#armrDiscussionsBtnSwitchElem').prop('checked', $('#sgwxAlertDiscussions').is(':checked'));

    // triggerHandler fires the bundle's click handler without toggling checkbox state.
    var $btn = $('.alert_options_btn');
    if ($btn.length) $btn.first().triggerHandler('click');

    // Watches and discussions visibility are managed outside filter_alerts.
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
}

// ── Initialise ────────────────────────────────────────────────────────────
window._sgwxAlertsInit = function() {
    // Bundle positive logic: checked = show. Start all checked so everything shows by default.
    $('#armrWarningsBtnSwitchElem, #armrWatchesBtnSwitchElem, '  +
      '#armrStatementsBtnSwitchElem, #armrDiscussionsBtnSwitchElem')
        .prop('checked', true);

    // Make the panel draggable / resizable via jQuery UI.
    $('#sgwxAlertsPanel')
        .draggable({ handle: '#sgwxAlertsHeader', containment: 'window' })
        .resizable({ handles: 'all', minWidth: 200, minHeight: 150 });

    // ── Ticker initialisation ─────────────────────────────────────────────
    _sgwxBuildTicker();
    setInterval(_sgwxBuildTicker, 30000);

    // ── Layer visibility sync ─────────────────────────────────────────────
    // The bundle shows/hides watches and discussions based on its own state
    // machine. Sync our toggle states every few seconds so the layers stay
    // in step with the panel controls even if the bundle's timing misses.
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
    }, 3000);

    // ── Sidebar alert button: open / close panel in sync with alerts toggle ──
    $('#alertMenuItemDiv').on('click', function() {
        // The bundle's icon-click handler has already fired by the time we get
        // here (bubbling), so the 'menu_item_selected' class reflects the new
        // state.
        if ($('#alertMenuItemIcon').hasClass('menu_item_selected')) {
            $('#sgwxAlertsPanel').show();
            $('#alertMenuItemIcon').removeClass('icon-grey menu_item_not_selected');
        } else {
            $('#sgwxAlertsPanel').hide();
            $('#alertMenuItemIcon').removeClass('icon-blue').addClass('icon-grey menu_item_not_selected');
        }
    });

    // ── Panel close button ────────────────────────────────────────────────
    // If keep-active is on: just hide the panel; alerts stay on and icon stays highlighted.
    $('#sgwxAlertsClose').on('click', function() {
        $('#sgwxAlertsPanel').hide();
        if ($('#sgwxAlertsKeepActive').is(':checked')) {
            $('#alertMenuItemIcon').removeClass('icon-grey menu_item_not_selected');
        } else {
            if ($('#alertMenuItemIcon').hasClass('menu_item_selected')) {
                $('#alertMenuItemIcon').trigger('click');
            }
        }
    });

    // ── Sidebar icon intercept (capture phase) ────────────────────────────
    // When keep-active is on and alerts are already active, clicking the sidebar
    // should only toggle the panel open/closed, not turn off the alerts overlay.
    document.getElementById('alertMenuItemDiv').addEventListener('click', function(e) {
        if ($('#sgwxAlertsKeepActive').is(':checked') &&
            $('#alertMenuItemIcon').hasClass('menu_item_selected')) {
            e.stopImmediatePropagation();
            var $panel = $('#sgwxAlertsPanel');
            if ($panel.is(':visible')) {
                $panel.hide();
            } else {
                $panel.show();
            }
            $('#alertMenuItemIcon').removeClass('icon-grey menu_item_not_selected');
        }
    }, true);

    // ── Filter toggles ────────────────────────────────────────────────────
    $('#sgwxAlertWarnings, #sgwxAlertWatches, #sgwxAlertStatements, #sgwxAlertDiscussions')
        .on('change', function() {
            _sgwxSyncFilter();
        });

    // ── Vocal alerts toggle ───────────────────────────────────────────────
    $('#sgwxVocalAlertsOn').on('change', function() {
        _sgwxVocalEnabled = $(this).is(':checked');
        if (_sgwxVocalEnabled) {
            // Start polling every 15 s (same cadence as AlertUpdater).
            if (_sgwxVocalInterval) clearInterval(_sgwxVocalInterval);
            _sgwxVocalInterval = setInterval(_sgwxAnnounceNew, 15000);
            // Seed announced set with whatever is already on the map so we
            // don't read out everything the moment the feature is enabled.
            var data = window.atticData && window.atticData.alerts_data;
            if (data && data.features) {
                data.features.forEach(function(f) {
                    var p  = f.properties;
                    var id = p.id || (p.event + '_' + p.areaDesc);
                    _sgwxAnnouncedIds.add(id);
                });
            }
        } else {
            if (_sgwxVocalInterval) clearInterval(_sgwxVocalInterval);
            window.speechSynthesis && window.speechSynthesis.cancel();
        }
    });

    // ── Test vocal alert button ───────────────────────────────────────────
    $('#sgwxVocalTestBtn').on('click', function() {
        _sgwxAlarmThenSpeak(
            'Test alert from SquishedGrape WX. ' +
            'Tornado Warning issued for Jefferson County and surrounding areas. ' +
            'Take shelter in a sturdy building immediately. ' +
            'This was a test of the vocal alert system.'
        );
    });
};
