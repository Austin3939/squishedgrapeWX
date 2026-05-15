// Capture the Mapbox GL JS map instance the moment the bundle creates it.
// This file loads AFTER mapboxgl is available but BEFORE dist/bundle.js.
mapboxgl.Map = new Proxy(mapboxgl.Map, {
    construct: function(target, args) {
        var instance = Reflect.construct(target, args);
        if (args[0] && args[0].container === 'map') {
            window._sgwxMap = instance;
        }
        return instance;
    }
});

var _SPC_URLS = {
    convective: {
        categorical: {
            day1: 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson',
            day2: 'https://www.spc.noaa.gov/products/outlook/day2otlk_cat.lyr.geojson',
            day3: 'https://www.spc.noaa.gov/products/outlook/day3otlk_cat.lyr.geojson'
        },
        tornado: {
            day1: 'https://www.spc.noaa.gov/products/outlook/day1otlk_torn.lyr.geojson',
            day2: 'https://www.spc.noaa.gov/products/outlook/day2otlk_torn.lyr.geojson'
        },
        wind: {
            day1: 'https://www.spc.noaa.gov/products/outlook/day1otlk_wind.lyr.geojson',
            day2: 'https://www.spc.noaa.gov/products/outlook/day2otlk_wind.lyr.geojson'
        },
        hail: {
            day1: 'https://www.spc.noaa.gov/products/outlook/day1otlk_hail.lyr.geojson',
            day2: 'https://www.spc.noaa.gov/products/outlook/day2otlk_hail.lyr.geojson'
        }
    }
};

// Active fetch token — incremented on each new request so stale callbacks no-op.
var _sgwxSpcToken = 0;
// Current fill opacity (0–1). Default 0.5 = slider midpoint.
var _sgwxSpcOpacity = 0.5;
// True when an SPC overlay is currently on the map.
var _sgwxSpcActive = false;

function _sgwxHideSpcLayers() {
    _sgwxSpcActive = false;
    var m = window._sgwxMap;
    if (!m || !m.isStyleLoaded()) return;
    try {
        if (m.getLayer('spc_fill'))    m.removeLayer('spc_fill');
        if (m.getLayer('spc_border'))  m.removeLayer('spc_border');
        if (m.getSource('spc_source')) m.removeSource('spc_source');
    } catch (e) {}
}

// Sync the sidebar icon colour to the current active/panel state.
function _sgwxSpcUpdateSidebarIcon() {
    var keepActive = $('#sgwxSpcKeepActive').is(':checked');
    var shouldHighlight = $('#sgwxSpcPanel').is(':visible') || (_sgwxSpcActive && keepActive);
    var $span = $('#sgwxSpcSidebarBtn span');
    if (shouldHighlight) {
        $span.removeClass('icon-grey icon-blue menu_item_not_selected').addClass('menu_item_selected');
    } else {
        $span.removeClass('menu_item_selected icon-blue').addClass('icon-grey menu_item_not_selected');
    }
}

function _sgwxApplyOpacity() {
    var m = window._sgwxMap;
    if (m && m.getLayer('spc_fill')) {
        m.setPaintProperty('spc_fill', 'fill-opacity', _sgwxSpcOpacity);
    }
}

function _sgwxFlattenGeojson(geojson) {
    geojson.features = geojson.features.flatMap(function(feature) {
        if (feature.geometry.type === 'MultiPolygon') {
            return feature.geometry.coordinates.map(function(coords) {
                return {
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: coords },
                    properties: Object.assign({}, feature.properties)
                };
            });
        }
        return [feature];
    });
    // Use DN (risk level) as sort key so higher-risk areas render on top.
    geojson.features.forEach(function(f) {
        f.properties.zindex = f.properties.DN || 0;
    });
    return geojson;
}

function _sgwxFmtDate(s) {
    if (!s || s.length < 12) return s || '';
    return s.slice(4,6) + '/' + s.slice(6,8) + ' ' + s.slice(8,10) + ':' + s.slice(10,12) + 'Z';
}

// Build a legend from the loaded GeoJSON's actual fill/stroke/label properties.
function _sgwxBuildLegend(geojson) {
    var seen = {};
    var items = [];

    // Sort ascending by DN so legend goes low-to-high risk.
    var sorted = geojson.features.slice().sort(function(a, b) {
        return (a.properties.DN || 0) - (b.properties.DN || 0);
    });

    sorted.forEach(function(f) {
        var p  = f.properties;
        var dn = p.DN || 0;
        // LABEL2 is the descriptive name ("Marginal Risk", "2% Probability…")
        // LABEL  is the short form  ("MRGL", "2%")
        // For display, prefer LABEL2 but truncate; fall back to LABEL.
        var label  = (p.LABEL2 || p.LABEL || '').trim();
        var short  = (p.LABEL  || '').trim();
        var color  = p.fill   || '#888';
        var stroke = p.stroke || color;
        var key    = short || label;

        // Skip blank or duplicate entries.
        if (!label || seen[key]) return;
        seen[key] = true;

        // Detect hatched/significant entries — SPC marks these with specific labels.
        var isHatch = /sig|hatch/i.test(label) || /sig|hatch/i.test(short);

        items.push({ label: label, short: short, color: color, stroke: stroke, dn: dn, isHatch: isHatch });
    });

    if (items.length === 0) return '';

    var html = '';
    items.forEach(function(item) {
        var swatchStyle = 'background:' + item.color + ';border:1.5px solid ' + item.stroke + ';';
        if (item.isHatch) {
            // Overlay diagonal stripes on the fill colour for hatched entries.
            swatchStyle += 'background-image:repeating-linear-gradient(' +
                '45deg,transparent,transparent 3px,rgba(0,0,0,0.55) 3px,rgba(0,0,0,0.55) 5px);';
        }
        html += '<div class="sgwxSpcLegendItem">' +
            '<span class="sgwxSpcLegendSwatch" style="' + swatchStyle + '"></span>' +
            '<span class="sgwxSpcLegendLabel" title="' + item.label + '">' + item.label + '</span>' +
            '</div>';
    });
    return html;
}

function _sgwxClearPanel() {
    ++_sgwxSpcToken;
    _sgwxHideSpcLayers();
    $('.sgwxSpcBtn').removeClass('sgwxSpcBtnActive sgwxSpcBtnLoading');
    $('#sgwxSpcStatus').hide();
    $('#sgwxSpcLegend').hide().empty();
}

function _sgwxLoadSpc(type, cat, day, btn) {
    var map = window._sgwxMap;
    if (!map) return;

    var url = _SPC_URLS[type] && _SPC_URLS[type][cat] && _SPC_URLS[type][cat][day];
    if (!url) return;

    var myToken = ++_sgwxSpcToken;
    $('.sgwxSpcBtn').removeClass('sgwxSpcBtnActive sgwxSpcBtnLoading');
    $(btn).addClass('sgwxSpcBtnLoading');
    $('#sgwxSpcStatus').hide();
    $('#sgwxSpcLegend').hide().empty();

    // Remove existing overlay immediately — no stale layer while the fetch runs.
    _sgwxHideSpcLayers();

    fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(geojson) {
            if (myToken !== _sgwxSpcToken) return; // user already clicked something else

            geojson = _sgwxFlattenGeojson(geojson);
            _sgwxHideSpcLayers();

            function doAdd() {
                map.addSource('spc_source', { type: 'geojson', data: geojson });
                map.addLayer({
                    id: 'spc_fill',
                    type: 'fill',
                    source: 'spc_source',
                    paint: {
                        'fill-color':   ['get', 'fill'],
                        'fill-opacity': _sgwxSpcOpacity
                    },
                    layout: { 'fill-sort-key': ['get', 'zindex'] }
                });
                map.addLayer({
                    id: 'spc_border',
                    type: 'line',
                    source: 'spc_source',
                    paint: {
                        'line-color': ['get', 'stroke'],
                        'line-width': 2
                    },
                    layout: { 'line-sort-key': ['get', 'zindex'] }
                });
            }

            if (map.isStyleLoaded()) { doAdd(); } else { map.once('styledata', doAdd); }

            $(btn).removeClass('sgwxSpcBtnLoading').addClass('sgwxSpcBtnActive');
            _sgwxSpcActive = true;

            // Valid-time status line.
            var issue, expire;
            geojson.features.forEach(function(f) {
                if (f.properties.ISSUE)  issue  = f.properties.ISSUE;
                if (f.properties.EXPIRE) expire = f.properties.EXPIRE;
            });
            if (issue || expire) {
                $('#sgwxSpcStatus')
                    .text('Valid: ' + _sgwxFmtDate(issue) + ' – ' + _sgwxFmtDate(expire))
                    .show();
            }

            // Dynamic legend from the GeoJSON's own colour/label properties.
            var legendHtml = _sgwxBuildLegend(geojson);
            if (legendHtml) {
                $('#sgwxSpcLegend').html(legendHtml).show();
            }
        })
        .catch(function() {
            if (myToken !== _sgwxSpcToken) return;
            $(btn).removeClass('sgwxSpcBtnLoading');
        });
}

window._sgwxSpcInit = function() {
    var map = window._sgwxMap;
    if (!map) { console.warn('SPC panel: map not captured'); return; }

    // Draggable by header; jQuery UI resizable from all sides.
    $('#sgwxSpcPanel').draggable({ handle: '#sgwxSpcHeader', containment: 'window' });
    $('#sgwxSpcPanel').resizable({ handles: 'all', minWidth: 210, minHeight: 140 });

    // Opacity slider.
    $('#sgwxSpcOpacity').on('input', function() {
        _sgwxSpcOpacity = parseInt($(this).val(), 10) / 100;
        _sgwxApplyOpacity();
    });

    // Sidebar tornado button: show/hide panel.
    // If keep-active is on and an overlay is loaded, hiding the panel keeps the overlay.
    $('#sgwxSpcSidebarBtn').on('click', function() {
        var $panel = $('#sgwxSpcPanel');
        if ($panel.is(':visible')) {
            $panel.hide();
            if (!($('#sgwxSpcKeepActive').is(':checked') && _sgwxSpcActive)) {
                _sgwxClearPanel();
            }
            _sgwxSpcUpdateSidebarIcon();
        } else {
            $panel.show();
            $(this).find('span').removeClass('icon-grey icon-blue menu_item_not_selected').addClass('menu_item_selected');
        }
    });

    // Panel close button.
    // If keep-active is on and an overlay is loaded, only hide the panel — overlay stays.
    $('#sgwxSpcClose').on('click', function() {
        if ($('#sgwxSpcKeepActive').is(':checked') && _sgwxSpcActive) {
            $('#sgwxSpcPanel').hide();
        } else {
            _sgwxClearPanel();
            $('#sgwxSpcPanel').hide();
        }
        _sgwxSpcUpdateSidebarIcon();
    });

    // Overlay buttons — radio behaviour with toggle-off on re-click.
    $(document).on('click', '.sgwxSpcBtn', function() {
        if ($(this).hasClass('sgwxSpcBtnLoading')) return;

        if ($(this).hasClass('sgwxSpcBtnActive')) {
            // Re-clicking the active button turns it off.
            _sgwxHideSpcLayers();
            ++_sgwxSpcToken;
            $(this).removeClass('sgwxSpcBtnActive');
            $('#sgwxSpcStatus').hide();
            $('#sgwxSpcLegend').hide().empty();
            _sgwxSpcUpdateSidebarIcon();
            return;
        }

        _sgwxLoadSpc(
            $(this).data('type'),
            $(this).data('cat'),
            $(this).data('day'),
            this
        );
    });
};
