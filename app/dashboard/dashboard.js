// SquishedGrape WX — Weather Dashboard
// Data: Open-Meteo (weather) + NWS point alerts + SPC day 1 outlook

var _sgwxDashLat          = null;
var _sgwxDashLon          = null;
var _sgwxDashRefreshTimer = null;
var _sgwxDashPointAlerts  = [];
var _sgwxDashSearchTimer  = null;
var _sgwxDashForecastGdd  = 0;

// WMO weather codes — fa-cloud-drizzle is FA Pro only, use fa-cloud-rain
var _sgwxWmo = {
    0:  { label: 'Clear Sky',            icon: 'fa-sun',               night: 'fa-moon' },
    1:  { label: 'Mainly Clear',         icon: 'fa-sun',               night: 'fa-moon' },
    2:  { label: 'Partly Cloudy',        icon: 'fa-cloud-sun',         night: 'fa-cloud-moon' },
    3:  { label: 'Overcast',             icon: 'fa-cloud' },
    45: { label: 'Foggy',                icon: 'fa-smog' },
    48: { label: 'Freezing Fog',         icon: 'fa-smog' },
    51: { label: 'Light Drizzle',        icon: 'fa-cloud-rain' },
    53: { label: 'Drizzle',              icon: 'fa-cloud-rain' },
    55: { label: 'Heavy Drizzle',        icon: 'fa-cloud-rain' },
    61: { label: 'Light Rain',           icon: 'fa-cloud-rain' },
    63: { label: 'Rain',                 icon: 'fa-cloud-rain' },
    65: { label: 'Heavy Rain',           icon: 'fa-cloud-showers-heavy' },
    71: { label: 'Light Snow',           icon: 'fa-snowflake' },
    73: { label: 'Snow',                 icon: 'fa-snowflake' },
    75: { label: 'Heavy Snow',           icon: 'fa-snowflake' },
    77: { label: 'Snow Grains',          icon: 'fa-snowflake' },
    80: { label: 'Rain Showers',         icon: 'fa-cloud-showers-heavy' },
    81: { label: 'Rain Showers',         icon: 'fa-cloud-showers-heavy' },
    82: { label: 'Heavy Showers',        icon: 'fa-cloud-showers-heavy' },
    85: { label: 'Snow Showers',         icon: 'fa-snowflake' },
    86: { label: 'Heavy Snow Showers',   icon: 'fa-snowflake' },
    95: { label: 'Thunderstorm',         icon: 'fa-cloud-bolt' },
    96: { label: 'Thunderstorm w/ Hail', icon: 'fa-cloud-bolt' },
    99: { label: 'Severe Thunderstorm',  icon: 'fa-cloud-bolt' }
};

var _sgwxCatRank = { 'TSTM': 1, 'MRGL': 2, 'SLGT': 3, 'ENH': 4, 'MDT': 5, 'HIGH': 6 };

var _sgwxSpcRisk = {
    'TSTM': { name: 'General Thunder', color: '#16a34a' },
    'MRGL': { name: 'Marginal Risk',   color: '#16a34a' },
    'SLGT': { name: 'Slight Risk',     color: '#ca8a04' },
    'ENH':  { name: 'Enhanced Risk',   color: '#ea580c' },
    'MDT':  { name: 'Moderate Risk',   color: '#dc2626' },
    'HIGH': { name: 'High Risk',       color: '#9333ea' }
};

// ── UI helpers ────────────────────────────────────────────────────────
function _sgwxSet(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
}
function _sgwxBarW(id, pct) {
    var el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
}
function _sgwxSetRing(id, pct) {
    var el = document.getElementById(id);
    if (!el) return;
    var circ = 2 * Math.PI * 26;
    el.style.strokeDasharray = (Math.max(0, Math.min(1, pct)) * circ).toFixed(1) + ' ' + circ.toFixed(1);
}
function _sgwxIconColor(icon) {
    if (icon === 'fa-sun' || icon === 'fa-moon' || icon === 'fa-cloud-sun' || icon === 'fa-cloud-moon') return 'var(--sgwx-amber)';
    if (icon === 'fa-cloud-rain' || icon === 'fa-cloud-showers-heavy' || icon === 'fa-cloud-bolt') return 'var(--sgwx-blue)';
    if (icon === 'fa-snowflake') return '#93c5fd';
    return 'var(--sgwx-text-3)';
}

// ── Helpers ───────────────────────────────────────────────────────────
function _sgwxWmoGet(code, night) {
    var w = _sgwxWmo[code] || { label: 'Unknown', icon: 'fa-cloud' };
    return { label: w.label, icon: (night && w.night) ? w.night : w.icon };
}

function _sgwxWindDir(deg) {
    return ['N','NE','E','SE','S','SW','W','NW'][Math.round((deg || 0) / 45) % 8];
}

function _sgwxIsNight(dateObj) {
    var h = (dateObj || new Date()).getHours();
    return h < 6 || h >= 20;
}

function _sgwxHourLabel(isoStr) {
    var h = new Date(isoStr).getHours();
    if (h === 0)  return '12am';
    if (h === 12) return '12pm';
    return h < 12 ? h + 'am' : (h - 12) + 'pm';
}

function _sgwxDayName(isoStr, i) {
    if (i === 0) return 'Today';
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(isoStr + 'T12:00:00').getDay()];
}

// ── Point-in-polygon (ray casting) ───────────────────────────────────
function _sgwxPIP(lat, lon, ring) {
    var x = lon, y = lat, inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

function _sgwxPointInFeature(lat, lon, feature) {
    var g = feature && feature.geometry;
    if (!g) return false;
    var rings = g.type === 'Polygon'      ? [g.coordinates[0]]
              : g.type === 'MultiPolygon' ? g.coordinates.map(function(p) { return p[0]; })
              : [];
    return rings.some(function(r) { return _sgwxPIP(lat, lon, r); });
}

// ── View switching ────────────────────────────────────────────────────
function _sgwxShowDashboard() {
    document.getElementById('sgwxDashboard').style.display = 'flex';
    document.getElementById('bodyDiv').style.display       = 'none';
}
window._sgwxShowDashboard = _sgwxShowDashboard;

function _sgwxShowRadar() {
    document.getElementById('sgwxDashboard').style.display = 'none';
    document.getElementById('bodyDiv').style.display       = 'block';
    if (window._sgwxMap) setTimeout(function() { window._sgwxMap.resize(); }, 60);
}

// ── Data fetching ─────────────────────────────────────────────────────
function _sgwxDashFetch(lat, lon) {
    var url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + lat + '&longitude=' + lon +
        '&current=temperature_2m,apparent_temperature,weather_code,' +
        'wind_speed_10m,wind_direction_10m,relative_humidity_2m,' +
        'visibility,uv_index,dewpoint_2m,pressure_msl' +
        '&hourly=temperature_2m,weather_code,precipitation_probability,' +
        'cape,soil_temperature_0cm,precipitation,pressure_msl' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,' +
        'precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,precipitation_sum' +
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
        '&timezone=auto&forecast_days=7&past_hours=6';

    fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) { _sgwxDashRender(data); })
        .catch(function() {
            document.getElementById('sgwxDashLoading').innerHTML =
                '<i class="fa fa-triangle-exclamation"></i><span>Could not load weather data.</span>';
        });
}

function _sgwxDashFetchCity(lat, lon) {
    fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
          lat + '&longitude=' + lon + '&localityLanguage=en')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var city  = d.city || d.locality || '';
            var state = (d.principalSubdivisionCode || '').replace('US-', '');
            var text  = city + (state ? ', ' + state : '');
            var el = document.getElementById('sgwxDashSearchInput');
            if (el && text) el.value = text;
        })
        .catch(function() {});
}

// ── Location search ───────────────────────────────────────────────────
function _sgwxDashInitSearch() {
    var input  = document.getElementById('sgwxDashSearchInput');
    var gpsBtn = document.getElementById('sgwxDashGpsBtn');
    if (!input || !gpsBtn) return;

    input.addEventListener('input', function() {
        clearTimeout(_sgwxDashSearchTimer);
        var q = this.value.trim();
        if (q.length < 2) { _sgwxDashHideDropdown(); return; }
        _sgwxDashSearchTimer = setTimeout(function() { _sgwxDashGeoSearch(q); }, 300);
    });

    input.addEventListener('blur', function() {
        setTimeout(_sgwxDashHideDropdown, 200);
    });

    gpsBtn.addEventListener('click', function() {
        if (!navigator.geolocation) return;
        gpsBtn.disabled = true;
        input.value = '';
        input.placeholder = 'Locating…';
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                gpsBtn.disabled = false;
                input.placeholder = 'Search city…';
                _sgwxDashLat = pos.coords.latitude;
                _sgwxDashLon = pos.coords.longitude;
                _sgwxDashFetchCity(_sgwxDashLat, _sgwxDashLon);
                _sgwxDashLoadLocation(_sgwxDashLat, _sgwxDashLon);
            },
            function() {
                gpsBtn.disabled = false;
                input.placeholder = 'Search city…';
            },
            { enableHighAccuracy: false, timeout: 12000 }
        );
    });
}

function _sgwxDashGeoSearch(query) {
    fetch('https://geocoding-api.open-meteo.com/v1/search?name=' +
          encodeURIComponent(query) + '&count=8&language=en&format=json')
        .then(function(r) { return r.json(); })
        .then(function(data) { _sgwxDashShowDropdown(data.results || []); })
        .catch(function() { _sgwxDashHideDropdown(); });
}

function _sgwxDashShowDropdown(results) {
    var el = document.getElementById('sgwxDashDropdown');
    if (!el) return;
    if (!results.length) { _sgwxDashHideDropdown(); return; }

    el.innerHTML = results.map(function(r) {
        var label = r.name;
        if (r.admin1) label += ', ' + r.admin1;
        if (r.country_code) label += ', ' + r.country_code;
        return '<div class="sgwxDashDropdownItem" data-lat="' + r.latitude +
               '" data-lon="' + r.longitude +
               '" data-name="' + label.replace(/"/g, '&quot;') + '">' +
               label + '</div>';
    }).join('');
    el.style.display = 'block';

    el.querySelectorAll('.sgwxDashDropdownItem').forEach(function(item) {
        item.addEventListener('mousedown', function() {
            var lat  = parseFloat(this.getAttribute('data-lat'));
            var lon  = parseFloat(this.getAttribute('data-lon'));
            var name = this.getAttribute('data-name');
            _sgwxDashSelectLocation(lat, lon, name);
        });
    });
}

function _sgwxDashHideDropdown() {
    var el = document.getElementById('sgwxDashDropdown');
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
}

function _sgwxDashSelectLocation(lat, lon, name) {
    _sgwxDashHideDropdown();
    var input = document.getElementById('sgwxDashSearchInput');
    if (input) { input.value = name; input.blur(); }
    _sgwxDashLat = lat;
    _sgwxDashLon = lon;
    _sgwxDashLoadLocation(lat, lon);
}

function _sgwxDashLoadLocation(lat, lon) {
    _sgwxDashLat = lat;
    _sgwxDashLon = lon;
    document.getElementById('sgwxDashLoading').style.display = 'flex';
    document.getElementById('sgwxDashContent').style.display = 'none';
    _sgwxDashFetch(lat, lon);
    _sgwxDashFetchPointAlerts(lat, lon);
    _sgwxDashFetchSpc(lat, lon);
    _sgwxDashFetchAqi(lat, lon);
    if (_sgwxDashRefreshTimer) clearInterval(_sgwxDashRefreshTimer);
    _sgwxDashRefreshTimer = setInterval(function() {
        _sgwxDashFetch(_sgwxDashLat, _sgwxDashLon);
        _sgwxDashFetchPointAlerts(_sgwxDashLat, _sgwxDashLon);
        _sgwxDashFetchSpc(_sgwxDashLat, _sgwxDashLon);
    }, 600000);
}

function _sgwxDashFetchPointAlerts(lat, lon) {
    fetch('https://api.weather.gov/alerts/active?point=' + lat + ',' + lon + '&status=actual')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _sgwxDashPointAlerts = (data && data.features) ? data.features : [];
            _sgwxDashRenderAlerts();
        })
        .catch(function() {});
}

function _sgwxSpcBestMatch(key, features, lat, lon) {
    var best = null, bestScore = -1;
    for (var i = 0; i < features.length; i++) {
        var f = features[i];
        if (!_sgwxPointInFeature(lat, lon, f)) continue;
        var label = f.properties.LABEL || f.properties.label || '';
        var rawScore = parseFloat(label) || 0;
        var score = key === 'cat' ? (_sgwxCatRank[label] || 0) :
                    (rawScore > 1 ? rawScore : rawScore * 100);
        if (score > bestScore) { bestScore = score; best = f.properties; }
    }
    return best;
}

function _sgwxDashFetchSpc(lat, lon) {
    var types = ['cat', 'torn', 'wind', 'hail'];
    var urls  = {
        cat:  'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson',
        torn: 'https://www.spc.noaa.gov/products/outlook/day1otlk_torn.lyr.geojson',
        wind: 'https://www.spc.noaa.gov/products/outlook/day1otlk_wind.lyr.geojson',
        hail: 'https://www.spc.noaa.gov/products/outlook/day1otlk_hail.lyr.geojson'
    };
    var results = {};
    var done = 0;

    types.forEach(function(key) {
        fetch(urls[key])
            .then(function(r) { return r.json(); })
            .then(function(gj) {
                results[key] = (gj && gj.features)
                    ? _sgwxSpcBestMatch(key, gj.features, lat, lon)
                    : null;
            })
            .catch(function() { results[key] = null; })
            .then(function() {
                done++;
                if (done === types.length) _sgwxDashRenderSpc(results);
            });
    });
}

function _sgwxDashFetchAqi(lat, lon) {
    fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat +
          '&longitude=' + lon + '&current=us_aqi')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var aqi = (d && d.current) ? (d.current.us_aqi || 0) : 0;
            _sgwxSetRing('sgwxAqiRingFill', aqi / 300);
            _sgwxSet('sgwxAqiValue', aqi);
            _sgwxSet('sgwxAqiLabel',
                aqi <= 50  ? 'Good' :
                aqi <= 100 ? 'Moderate' :
                aqi <= 150 ? 'Sensitive groups' :
                aqi <= 200 ? 'Unhealthy' :
                aqi <= 300 ? 'Very Unhealthy' : 'Hazardous');
        })
        .catch(function() {});
}

// ── Narrative ─────────────────────────────────────────────────────────
function _sgwxDashNarrative(hourly) {
    var now = Date.now();
    var ci = -1;
    for (var i = 0; i < hourly.time.length; i++) {
        if (new Date(hourly.time[i]).getTime() >= now - 1800000) { ci = i; break; }
    }
    if (ci < 0) return '';

    var RAIN = { 51:1, 53:1, 55:1, 61:1, 63:1, 65:1, 80:1, 81:1, 82:1, 95:1, 96:1, 99:1 };
    var SNOW = { 71:1, 73:1, 75:1, 77:1, 85:1, 86:1 };
    function isRain(c) { return !!RAIN[c]; }
    function isSnow(c) { return !!SNOW[c]; }

    var curCode = hourly.weather_code[ci];
    var curPop  = hourly.precipitation_probability[ci] || 0;

    if (isRain(curCode)) {
        for (var j = ci + 1; j < Math.min(ci + 12, hourly.time.length); j++) {
            if (!isRain(hourly.weather_code[j])) {
                var h = j - ci;
                return h === 1 ? 'Rain tapering off within the hour.' :
                    'Rain expected to continue for about ' + h + ' more hours.';
            }
        }
        return 'Rain is ongoing — expect it to continue for several more hours.';
    }
    if (isSnow(curCode)) {
        for (var k = ci + 1; k < Math.min(ci + 12, hourly.time.length); k++) {
            if (!isSnow(hourly.weather_code[k])) {
                var h2 = k - ci;
                return 'Snow continuing for about ' + h2 + ' more hour' + (h2 > 1 ? 's' : '') + '.';
            }
        }
        return 'Snow ongoing — dress warmly.';
    }
    if (curPop >= 50) {
        for (var m = ci + 1; m < Math.min(ci + 8, hourly.time.length); m++) {
            if (isRain(hourly.weather_code[m])) {
                var mins = Math.round((new Date(hourly.time[m]) - now) / 60000);
                if (mins <= 90) return 'Rain likely to begin in about ' + mins + ' minutes.';
                return 'Rain expected in about ' + Math.round(mins / 60) + ' hours.';
            }
        }
        return 'Rain likely later — ' + curPop + '% chance this hour.';
    }
    for (var n = ci + 1; n < Math.min(ci + 6, hourly.time.length); n++) {
        if (isRain(hourly.weather_code[n]) || (hourly.precipitation_probability[n] || 0) >= 60) {
            var mins2 = Math.round((new Date(hourly.time[n]) - now) / 60000);
            return 'Currently clear, but rain possible in about ' + mins2 + ' minutes.';
        }
    }
    var wmo = _sgwxWmoGet(curCode, _sgwxIsNight());
    return wmo.label + (curPop >= 20 ? ' — ' + curPop + '% chance of rain.' :
        ' conditions expected to hold through the next several hours.');
}

// ── Pressure sparkline ─────────────────────────────────────────────────
function _sgwxDashRenderPressureSparkline(hourly) {
    var el = document.getElementById('sgwxPressureSparkline');
    if (!el || !hourly.pressure_msl) return;

    var now = Date.now();
    var sixHrAgo = now - 6 * 3600000;
    var pressures = [];

    for (var i = 0; i < hourly.time.length; i++) {
        var t = new Date(hourly.time[i]).getTime();
        if (t >= sixHrAgo && t <= now + 1800000 && hourly.pressure_msl[i]) {
            pressures.push(hourly.pressure_msl[i]);
        }
    }
    if (pressures.length < 2) return;

    var first = pressures[0], last = pressures[pressures.length - 1];
    var diff = last - first;
    var trend, clr;
    if      (diff >  3)  { trend = '↑ Rising rapidly';  clr = 'var(--sgwx-teal)'; }
    else if (diff >  1)  { trend = '↑ Rising slowly';   clr = 'var(--sgwx-teal)'; }
    else if (diff < -3)  { trend = '↓ Falling rapidly'; clr = 'var(--sgwx-coral)'; }
    else if (diff < -1)  { trend = '↓ Falling slowly';  clr = 'var(--sgwx-coral)'; }
    else                 { trend = '→ Steady';           clr = 'var(--sgwx-text-3)'; }

    var min = Math.min.apply(null, pressures);
    var max = Math.max.apply(null, pressures);
    var rng = max - min || 0.1;
    var W = 100, H = 28, n = pressures.length;

    var pts = pressures.map(function(p, i) {
        var x = n > 1 ? (i / (n - 1)) * W : W / 2;
        var y = H - ((p - min) / rng) * (H - 6) - 3;
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
        'style="width:100%;height:' + H + 'px;display:block;overflow:visible">' +
        '<polyline points="' + pts + '" fill="none" stroke="' + clr + '" stroke-width="1.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    _sgwxSet('sgwxPressureTrend', trend);
}

// ── CAPE sparkline ─────────────────────────────────────────────────────
function _sgwxDashRenderCapeSparkline(hourly) {
    var el = document.getElementById('sgwxCapeSparkline');
    if (!el || !hourly.cape) return;

    var now = Date.now();
    var sixHrAgo = now - 6 * 3600000;
    var capes = [];

    for (var i = 0; i < hourly.time.length; i++) {
        var t = new Date(hourly.time[i]).getTime();
        if (t >= sixHrAgo && t <= now + 1800000 && hourly.cape[i] != null) {
            capes.push(hourly.cape[i]);
        }
    }
    if (capes.length < 2) return;

    var first = capes[0], last = capes[capes.length - 1];
    var diff = last - first;
    // Rising instability is the "watch" direction (coral); easing is teal.
    var trend, clr;
    if      (diff >  200) { trend = '↑ Building rapidly'; clr = 'var(--sgwx-coral)'; }
    else if (diff >  50)  { trend = '↑ Building';         clr = 'var(--sgwx-coral)'; }
    else if (diff < -200) { trend = '↓ Easing rapidly';  clr = 'var(--sgwx-teal)'; }
    else if (diff < -50)  { trend = '↓ Easing';          clr = 'var(--sgwx-teal)'; }
    else                  { trend = '→ Steady';           clr = 'var(--sgwx-text-3)'; }

    var min = Math.min.apply(null, capes);
    var max = Math.max.apply(null, capes);
    var rng = max - min || 0.1;
    var W = 100, H = 28, n = capes.length;

    var pts = capes.map(function(p, i) {
        var x = n > 1 ? (i / (n - 1)) * W : W / 2;
        var y = H - ((p - min) / rng) * (H - 6) - 3;
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
        'style="width:100%;height:' + H + 'px;display:block;overflow:visible">' +
        '<polyline points="' + pts + '" fill="none" stroke="' + clr + '" stroke-width="1.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    _sgwxSet('sgwxCapeTrend', trend);
}

// ── Gardening panel ────────────────────────────────────────────────────
function _sgwxDashRenderGarden(daily, hourly) {
    var now = Date.now();

    // Frost risk: first day with min <= 32°F in 7-day
    var frostDay = null;
    for (var i = 0; i < daily.time.length; i++) {
        if (daily.temperature_2m_min[i] <= 32) {
            frostDay = i === 0 ? 'Tonight' : i === 1 ? 'Tomorrow night' :
                _sgwxDayName(daily.time[i], i) + ' night';
            break;
        }
    }
    _sgwxSet('sgwxGardenFrost', frostDay || 'None in 7-day outlook');

    // Soil temperature (0cm, comes in °F with temperature_unit=fahrenheit)
    for (var j = 0; j < hourly.time.length; j++) {
        if (new Date(hourly.time[j]).getTime() >= now - 1800000 && hourly.soil_temperature_0cm) {
            var st = hourly.soil_temperature_0cm[j];
            if (st != null) {
                _sgwxSet('sgwxGardenSoil', Math.round(st) + '°F');
                _sgwxSet('sgwxGardenSoilDesc',
                    st < 40 ? 'Too cold to plant' :
                    st < 50 ? 'Cold — warm-season seeds won\'t germinate' :
                    st < 60 ? 'Cool — good for cool-season crops' :
                    st < 70 ? 'Ideal for most vegetables' :
                    st < 80 ? 'Warm — great for warm-season crops' :
                    'Hot — stress risk for shallow roots');
            }
            break;
        }
    }

    // Growing degree days — store forecast GDD for season-to-date calc in _sgwxDashFetchGdd
    var gdd = 0;
    for (var k = 0; k < daily.time.length; k++) {
        gdd += Math.max(0, (daily.temperature_2m_max[k] + daily.temperature_2m_min[k]) / 2 - 50);
    }
    _sgwxDashForecastGdd = gdd;
    _sgwxSet('sgwxGardenGdd', Math.round(gdd) + ' GDD');

    // Watering reminder from 7-day precipitation_sum
    if (daily.precipitation_sum) {
        var rain = 0;
        for (var m = 0; m < daily.precipitation_sum.length; m++) {
            rain += daily.precipitation_sum[m] || 0;
        }
        _sgwxSet('sgwxGardenRain', rain.toFixed(2) + '"');
        _sgwxSet('sgwxGardenWater',
            rain >= 1.0 ? 'Good rainfall — no supplemental watering needed' :
            rain >= 0.5 ? 'Light rainfall — water mid-week if no more rain' :
            'Dry week — plan to water every 2–3 days');
    }
}

// ── Rendering ─────────────────────────────────────────────────────────
function _sgwxDashRender(data) {
    var c     = data.current;
    var night = _sgwxIsNight();

    // Use the current-hour code from the hourly series for the hero icon and
    // condition label so they agree with the narrative and the hourly strip
    // (Open-Meteo's current.weather_code can disagree with the hourly value,
    // which made the icon/label look inconsistent — e.g. "Mainly Clear" sun
    // over a "Partly Cloudy" hourly icon).
    var heroCode = c.weather_code;
    if (data.hourly && data.hourly.weather_code) {
        var heroNow = Date.now();
        for (var hci = 0; hci < data.hourly.time.length; hci++) {
            if (new Date(data.hourly.time[hci]).getTime() >= heroNow - 1800000) {
                if (data.hourly.weather_code[hci] != null) heroCode = data.hourly.weather_code[hci];
                break;
            }
        }
    }
    var wmo = _sgwxWmoGet(heroCode, night);

    document.getElementById('sgwxDashLoading').style.display = 'none';
    document.getElementById('sgwxDashContent').style.display = 'flex';

    var iconEl = document.getElementById('sgwxDashWeatherIcon');
    if (iconEl) iconEl.className = 'fa ' + wmo.icon;

    _sgwxSet('sgwxDashTemp',          Math.round(c.temperature_2m) + '°');
    _sgwxSet('sgwxDashConditionText', wmo.label);
    _sgwxSet('sgwxDashFeelsLike',     'Feels like ' + Math.round(c.apparent_temperature) + '°');
    _sgwxSet('sgwxDashNarrative',     _sgwxDashNarrative(data.hourly));

    var hum  = c.relative_humidity_2m;
    var spd  = Math.round(c.wind_speed_10m);
    var dir  = _sgwxWindDir(c.wind_direction_10m);
    var visMi = c.visibility ? c.visibility / 1609 : 0;
    var pHg   = c.pressure_msl ? c.pressure_msl * 0.02953 : 0;
    var dp    = Math.round(c.dewpoint_2m || 0);
    var uv    = Math.round(c.uv_index || 0);

    // Hero inline stats
    _sgwxSet('sgwxHeroHumidity', hum + '%');
    _sgwxSet('sgwxHeroWind',     spd + ' mph');

    var rainPct = 0;
    var nowMs = Date.now();
    for (var i = 0; i < data.hourly.time.length; i++) {
        if (new Date(data.hourly.time[i]).getTime() >= nowMs - 1800000) {
            rainPct = data.hourly.precipitation_probability[i] || 0;
            break;
        }
    }
    _sgwxSet('sgwxHeroRain', rainPct + '%');

    // Stat tiles
    _sgwxSet('sgwxDetailHumidity',   hum + '%');
    _sgwxSet('sgwxDetailWind',       spd + ' mph ' + dir);
    _sgwxSet('sgwxDetailVisibility', visMi ? visMi.toFixed(1) + ' mi' : '--');
    _sgwxSet('sgwxDetailPressure',   pHg ? pHg.toFixed(2) + ' inHg' : '--');

    _sgwxSet('sgwxStatHumidityDesc', 'Dew point ' + dp + '°F');
    _sgwxSet('sgwxStatWindDesc',     dir + ' ' + spd + ' mph');
    _sgwxSet('sgwxStatVisDesc',      visMi >= 5 ? 'Excellent' : visMi >= 2 ? 'Good' : visMi >= 0.5 ? 'Moderate' : 'Poor');
    _sgwxSet('sgwxStatPressDesc',    pHg > 30.2 ? 'High pressure' : pHg < 29.8 ? 'Low pressure' : 'Normal');

    _sgwxBarW('sgwxStatHumidityBar', hum);
    _sgwxBarW('sgwxStatWindBar',     Math.min(100, spd / 60 * 100));
    _sgwxBarW('sgwxStatVisBar',      Math.min(100, visMi / 10 * 100));

    // UV ring
    _sgwxSet('sgwxDetailUv',  uv);
    _sgwxSetRing('sgwxUvRingFill', uv / 14);
    _sgwxSet('sgwxUvLabel',
        uv <= 2  ? 'Low' :
        uv <= 5  ? 'Moderate' :
        uv <= 7  ? 'High — wear SPF' :
        uv <= 10 ? 'Very High' : 'Extreme');

    // CAPE ring
    var cape = 0;
    for (var ci2 = 0; ci2 < data.hourly.time.length; ci2++) {
        if (new Date(data.hourly.time[ci2]).getTime() >= nowMs - 1800000) {
            cape = (data.hourly.cape && data.hourly.cape[ci2]) || 0;
            break;
        }
    }
    _sgwxSetRing('sgwxCapeRingFill', Math.min(1, cape / 3000));
    _sgwxSet('sgwxCapeValue', Math.round(cape));
    _sgwxSet('sgwxCapeLabel',
        cape < 300  ? 'Stable' :
        cape < 1000 ? 'Weak instability' :
        cape < 2000 ? 'Moderate' :
        cape < 3000 ? 'Large' : 'Extreme');

    _sgwxDashRenderHourly(data.hourly);
    _sgwxDashRenderDaily(data.daily);
    _sgwxDashRenderSun(data.daily);
    _sgwxDashRenderPressureSparkline(data.hourly);
    _sgwxDashRenderCapeSparkline(data.hourly);
    _sgwxDashRenderGarden(data.daily, data.hourly);
    _sgwxDashFetchGdd(_sgwxDashLat, _sgwxDashLon);
}

function _sgwxDashFmtAlertExpires(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d)) return '';
    var diff = d - Date.now();
    if (diff < 0) return 'Expired';
    var hrs  = Math.floor(diff / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    if (hrs > 0) return 'Expires in ' + hrs + 'h ' + mins + 'm';
    return 'Expires in ' + mins + 'm';
}

function _sgwxDashRenderAlerts() {
    var el = document.getElementById('sgwxDashAlertsContainer');
    if (!_sgwxDashPointAlerts.length) { el.innerHTML = ''; return; }

    el.innerHTML = _sgwxDashPointAlerts.slice(0, 3).map(function(f) {
        var p       = f.properties;
        var evt     = p.event || 'Alert';
        var area    = (p.areaDesc || '').split(';')[0].split(',').slice(0, 4).join(',').trim();
        var office  = (p.senderName || '').replace(/^National Weather Service\s*/i, 'NWS ');
        var expires = _sgwxDashFmtAlertExpires(p.expires || p.ends);
        var desc    = (p.description || '').replace(/\*/g, '').replace(/\n+/g, ' ').trim();
        if (desc.length > 180) desc = desc.slice(0, 177) + '…';
        var cls = /tornado/i.test(evt) ? 'sgwx-alert-tornado' :
                  /warning/i.test(evt) ? 'sgwx-alert-warning'  : 'sgwx-alert-watch';
        return '<div class="sgwx-alert-banner ' + cls + '">' +
            '<div class="sgwx-alert-head"><i class="fa fa-triangle-exclamation"></i>' +
            '<div class="sgwx-alert-title">' + evt + '</div></div>' +
            (area   ? '<div class="sgwx-alert-area">' + area + '</div>' : '') +
            '<div class="sgwx-alert-meta">' +
                (office  ? '<span>' + office + '</span>' : '') +
                (expires ? '<span class="sgwx-alert-exp">' + expires + '</span>' : '') +
            '</div>' +
            (desc ? '<div class="sgwx-alert-desc">' + desc + '</div>' : '') +
        '</div>';
    }).join('');
}

function _sgwxDashRenderSpc(results) {
    var el = document.getElementById('sgwxDashSpcContainer');
    if (!el) return;
    var cat = results.cat;
    if (!cat) { el.innerHTML = ''; return; }

    var label = cat.LABEL || cat.label2 || 'TSTM';
    var risk  = _sgwxSpcRisk[label] || _sgwxSpcRisk['TSTM'];
    var circ  = 2 * Math.PI * 18;

    function probRing(match, name, icon, color) {
        if (!match) return '';
        var lbl    = match.LABEL || match.label || '0';
        var isSig  = (match.LABEL2 === 'SIGN' || match.label2 === 'SIGN');
        var raw    = parseFloat(lbl) || 0;
        var pct    = raw > 1 ? Math.round(raw) : Math.round(raw * 100);
        if (pct === 0 && !isSig) return '';
        var fill   = Math.min(1, pct / 60) * circ;
        return '<div class="sgwx-spc-ring">' +
            '<svg viewBox="0 0 48 48" class="sgwx-spc-ring-svg">' +
                '<circle class="sgwx-spc-ring-track" cx="24" cy="24" r="18"/>' +
                '<circle class="sgwx-spc-ring-fill" cx="24" cy="24" r="18" ' +
                    'style="stroke:' + color + ';stroke-dasharray:' + fill.toFixed(1) + ' ' + circ.toFixed(1) + '"/>' +
            '</svg>' +
            '<div class="sgwx-spc-ring-info">' +
                '<div class="sgwx-spc-ring-pct">' + pct + '%' +
                    (isSig ? ' <span class="sgwx-sig">SIG</span>' : '') + '</div>' +
                '<div class="sgwx-spc-ring-name"><i class="fa ' + icon + '"></i> ' + name + '</div>' +
            '</div>' +
        '</div>';
    }

    var torn = probRing(results.torn, 'Tornado', 'fa-tornado', '#ef4444');
    var wind = probRing(results.wind, 'Wind',    'fa-wind',    '#3b82f6');
    var hail = probRing(results.hail, 'Hail',    'fa-cloud',   '#14b8a6');

    el.innerHTML =
        '<div class="sgwx-card sgwx-spc-card" style="border-left:3px solid ' + risk.color + '">' +
            '<div class="sgwx-spc-header">' +
                '<span class="sgwx-section-label" style="margin:0">SPC Day 1 Outlook</span>' +
                '<span class="sgwx-spc-badge" style="background:' + risk.color + '22;color:' + risk.color + '">' + risk.name + '</span>' +
            '</div>' +
            ((torn || wind || hail) ?
                '<div class="sgwx-spc-rings">' + torn + wind + hail + '</div>' : '') +
        '</div>';
}

function _sgwxDashRenderHourly(hourly) {
    var el  = document.getElementById('sgwxDashHourlyScroll');
    if (!el) return;
    var now = Date.now();
    var html = '', shown = 0;

    for (var i = 0; i < hourly.time.length && shown < 6; i++) {
        var t = new Date(hourly.time[i]);
        if (t.getTime() < now - 1800000) continue;
        var isNow = shown === 0;
        var wmo   = _sgwxWmoGet(hourly.weather_code[i], _sgwxIsNight(t));
        var pop   = hourly.precipitation_probability[i] || 0;
        var clr   = _sgwxIconColor(wmo.icon);
        html += '<div class="sgwx-h-slot' + (isNow ? ' sgwx-h-now' : '') + '">' +
            '<div class="sgwx-h-time">' + (isNow ? 'Now' : _sgwxHourLabel(hourly.time[i])) + '</div>' +
            '<i class="fa ' + wmo.icon + ' sgwx-h-icon" style="color:' + clr + '"></i>' +
            '<div class="sgwx-h-temp">' + Math.round(hourly.temperature_2m[i]) + '°</div>' +
            '<div class="sgwx-h-bar-track"><div class="sgwx-h-bar-fill" style="width:' + pop + '%"></div></div>' +
        '</div>';
        shown++;
    }
    el.innerHTML = html;
}

function _sgwxDashRenderDaily(daily) {
    var el = document.getElementById('sgwxDashDailyList');
    if (!el) return;
    el.innerHTML = daily.time.map(function(t, i) {
        var wmo  = _sgwxWmoGet(daily.weather_code[i], false);
        var pop  = daily.precipitation_probability_max[i] || 0;
        var high = Math.round(daily.temperature_2m_max[i]);
        var low  = Math.round(daily.temperature_2m_min[i]);
        var clr  = _sgwxIconColor(wmo.icon);
        return '<div class="sgwx-week-card' + (i === 0 ? ' sgwx-week-today' : '') + '">' +
            '<div class="sgwx-week-day">' + _sgwxDayName(t, i) + '</div>' +
            '<i class="fa ' + wmo.icon + ' sgwx-week-icon" style="color:' + clr + '"></i>' +
            '<div class="sgwx-week-high">' + high + '°</div>' +
            '<div class="sgwx-week-low">' + low + '°</div>' +
            '<div class="sgwx-week-bar-track"><div class="sgwx-week-bar-fill" style="height:' + pop + '%"></div></div>' +
        '</div>';
    }).join('');
}

// ── Moon phase ────────────────────────────────────────────────────────
function _sgwxMoonPhase() {
    var ref   = new Date(Date.UTC(2000, 0, 6, 18, 14, 0)); // known new moon
    var cycle = 29.530588853;
    var phase = (((Date.now() - ref) / 86400000) % cycle + cycle) % cycle;
    var illum = Math.round((1 - Math.cos(2 * Math.PI * phase / cycle)) / 2 * 100);
    var name  = phase < 1.85  ? 'New Moon'        :
                phase < 7.38  ? 'Waxing Crescent'  :
                phase < 9.22  ? 'First Quarter'    :
                phase < 14.77 ? 'Waxing Gibbous'   :
                phase < 16.61 ? 'Full Moon'         :
                phase < 22.15 ? 'Waning Gibbous'   :
                phase < 23.99 ? 'Last Quarter'      : 'Waning Crescent';
    return { name: name, illum: illum };
}

// ── Season-to-date GDD ─────────────────────────────────────────────────
function _sgwxDashFetchGdd(lat, lon) {
    var now       = new Date();
    var year      = now.getFullYear();
    var yesterday = new Date(now - 86400000);
    var pad       = function(n) { return n < 10 ? '0' + n : '' + n; };
    var endDate   = yesterday.getFullYear() + '-' + pad(yesterday.getMonth() + 1) + '-' + pad(yesterday.getDate());

    fetch('https://archive-api.open-meteo.com/v1/archive' +
          '?latitude=' + lat + '&longitude=' + lon +
          '&start_date=' + year + '-01-01&end_date=' + endDate +
          '&daily=temperature_2m_max,temperature_2m_min' +
          '&temperature_unit=fahrenheit&timezone=auto')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.daily) return;
            var gdd = _sgwxDashForecastGdd;
            var d   = data.daily;
            for (var i = 0; i < d.time.length; i++) {
                gdd += Math.max(0, (d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2 - 50);
            }
            _sgwxSet('sgwxGardenGdd',     Math.round(gdd) + ' GDD');
            _sgwxSet('sgwxGardenGddDesc', 'Season-to-date (Jan 1, base 50°F)');
        })
        .catch(function() {
            _sgwxSet('sgwxGardenGddDesc', '7-day forecast only (base 50°F)');
        });
}

function _sgwxDashRenderSun(daily) {
    if (!daily.sunrise || !daily.sunrise[0]) return;
    var sunrise = new Date(daily.sunrise[0]);
    var sunset  = new Date(daily.sunset[0]);
    var now     = new Date();

    function fmt(d) {
        var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'pm' : 'am';
        h = h % 12 || 12;
        return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
    }

    function setIcon(id, cls, color) {
        var el = document.getElementById(id);
        if (el) { el.className = 'fa ' + cls; el.style.color = color; }
    }

    var isNight = now >= sunset || now < sunrise;
    var R = 100, cx = 150, cy = 125;
    var pathD = 'M 50,125 A ' + R + ',' + R + ' 0 0 1 250,125';
    var totalLen = Math.PI * R;
    var svgEl = document.getElementById('sgwxSunArc');
    if (!svgEl) return;

    if (isNight) {
        // Determine arc endpoints:
        //   Evening (now >= sunset): sunset today → sunrise tomorrow
        //   Early morning (now < sunrise): ~yesterday's sunset → sunrise today
        var arcStart, arcEnd;
        if (now >= sunset) {
            arcStart = sunset;
            arcEnd   = daily.sunrise[1] ? new Date(daily.sunrise[1]) :
                       new Date(sunrise.getTime() + 86400000);
        } else {
            // Approximate yesterday's sunset as today's sunset minus 24h
            arcStart = new Date(sunset.getTime() - 86400000);
            arcEnd   = sunrise;
        }

        var nightLen = arcEnd - arcStart;
        var elapsed  = now - arcStart;
        var prog     = Math.min(1, Math.max(0, elapsed / nightLen));
        var progLen  = (prog * totalLen).toFixed(1);
        var theta    = Math.PI * (1 - prog);
        var dotX     = (cx + R * Math.cos(theta)).toFixed(1);
        var dotY     = (cy - R * Math.sin(theta)).toFixed(1);

        var moon = _sgwxMoonPhase();
        var minsLeft = Math.round((arcEnd - now) / 60000);
        var hrsLeft  = Math.floor(minsLeft / 60);
        var minRem   = minsLeft % 60;

        setIcon('sgwxSunIconL', 'fa-arrow-down', 'var(--sgwx-text-3)');
        setIcon('sgwxSunIconR', 'fa-arrow-up',   'var(--sgwx-amber)');
        _sgwxSet('sgwxSunLblL',   'Sunset');
        _sgwxSet('sgwxSunLblR',   'Sunrise');
        _sgwxSet('sgwxSunMidLbl', 'Until sunrise');
        _sgwxSet('sgwxSunrise',   fmt(arcStart));
        _sgwxSet('sgwxSunset',    fmt(arcEnd));
        _sgwxSet('sgwxDaylight',  hrsLeft + 'h ' + minRem + 'm');
        _sgwxSet('sgwxGoldenHour', moon.name + ' · ' + moon.illum + '% illuminated');

        svgEl.innerHTML =
            '<line x1="50" y1="125" x2="250" y2="125" stroke="var(--sgwx-border)" stroke-width="1.5"/>' +
            '<path d="' + pathD + '" fill="none" stroke="var(--sgwx-border)" stroke-width="2" stroke-dasharray="5 5"/>' +
            (prog > 0 ? '<path d="' + pathD + '" fill="none" stroke="var(--sgwx-purple)" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + progLen + ' 1000"/>' : '') +
            (prog > 0 && prog < 1 ?
                '<circle cx="' + dotX + '" cy="' + dotY + '" r="10" fill="var(--sgwx-purple)" opacity="0.15"/>' +
                '<circle cx="' + dotX + '" cy="' + dotY + '" r="5" fill="var(--sgwx-purple)"/>' : '') +
            '<circle cx="50"  cy="125" r="4" fill="var(--sgwx-text-3)" opacity="0.5"/>' +
            '<circle cx="250" cy="125" r="4" fill="var(--sgwx-amber)" opacity="0.5"/>';
        return;
    }

    // Day mode
    setIcon('sgwxSunIconL', 'fa-arrow-up',   'var(--sgwx-amber)');
    setIcon('sgwxSunIconR', 'fa-arrow-down', 'var(--sgwx-text-3)');
    _sgwxSet('sgwxSunLblL',   'Sunrise');
    _sgwxSet('sgwxSunLblR',   'Sunset');
    _sgwxSet('sgwxSunMidLbl', 'Daylight');
    _sgwxSet('sgwxSunrise',   fmt(sunrise));
    _sgwxSet('sgwxSunset',    fmt(sunset));
    _sgwxSet('sgwxDaylight',  ((sunset - sunrise) / 3600000).toFixed(1) + ' hrs');
    _sgwxSet('sgwxGoldenHour', 'Golden hour ~' + fmt(new Date(sunset.getTime() - 30 * 60000)));

    var totalMs  = sunset - sunrise;
    var progress = now > sunrise ? (now - sunrise) / totalMs : 0;
    var pLen     = (Math.min(1, progress) * totalLen).toFixed(1);
    var thet     = Math.PI * (1 - Math.min(1, progress));
    var dotX2    = (cx + R * Math.cos(thet)).toFixed(1);
    var dotY2    = (cy - R * Math.sin(thet)).toFixed(1);

    svgEl.innerHTML =
        '<line x1="50" y1="125" x2="250" y2="125" stroke="var(--sgwx-border)" stroke-width="1.5"/>' +
        '<path d="' + pathD + '" fill="none" stroke="var(--sgwx-border)" stroke-width="2" stroke-dasharray="5 5"/>' +
        (progress > 0 ? '<path d="' + pathD + '" fill="none" stroke="var(--sgwx-amber)" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + pLen + ' 1000"/>' : '') +
        (progress > 0 && progress < 1 ?
            '<circle cx="' + dotX2 + '" cy="' + dotY2 + '" r="10" fill="var(--sgwx-amber)" opacity="0.2"/>' +
            '<circle cx="' + dotX2 + '" cy="' + dotY2 + '" r="5" fill="var(--sgwx-amber)"/>' : '') +
        '<circle cx="50"  cy="125" r="4" fill="var(--sgwx-amber)" opacity="0.5"/>' +
        '<circle cx="250" cy="125" r="4" fill="var(--sgwx-text-3)" opacity="0.5"/>';
}

// ── Init ──────────────────────────────────────────────────────────────
window._sgwxDashInit = function() {
    document.getElementById('sgwxDashRadarBtn').addEventListener('click', _sgwxShowRadar);

    _sgwxDashInitSearch();

    if (!navigator.geolocation) {
        var inp = document.getElementById('sgwxDashSearchInput');
        if (inp) inp.value = 'Central US';
        _sgwxDashLoadLocation(36.83, -98.56);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            _sgwxDashLat = pos.coords.latitude;
            _sgwxDashLon = pos.coords.longitude;
            _sgwxDashFetchCity(_sgwxDashLat, _sgwxDashLon);
            _sgwxDashLoadLocation(_sgwxDashLat, _sgwxDashLon);
        },
        function() {
            var inp = document.getElementById('sgwxDashSearchInput');
            if (inp) inp.value = 'Central US';
            _sgwxDashLoadLocation(36.83, -98.56);
        },
        { enableHighAccuracy: false, timeout: 12000 }
    );
};
