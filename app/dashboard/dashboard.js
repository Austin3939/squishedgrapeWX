// SquishedGrape WX — Weather Dashboard
// Data: Open-Meteo (free, no key) + NWS alerts already in atticData

var _sgwxDashLat = null;
var _sgwxDashLon = null;
var _sgwxDashRefreshTimer = null;

// WMO weather code → label + Font Awesome icon
var _sgwxWmo = {
    0:  { label: 'Clear Sky',             icon: 'fa-sun',                  night: 'fa-moon' },
    1:  { label: 'Mainly Clear',          icon: 'fa-sun',                  night: 'fa-moon' },
    2:  { label: 'Partly Cloudy',         icon: 'fa-cloud-sun',            night: 'fa-cloud-moon' },
    3:  { label: 'Overcast',              icon: 'fa-cloud' },
    45: { label: 'Foggy',                 icon: 'fa-smog' },
    48: { label: 'Freezing Fog',          icon: 'fa-smog' },
    51: { label: 'Light Drizzle',         icon: 'fa-cloud-drizzle' },
    53: { label: 'Drizzle',               icon: 'fa-cloud-drizzle' },
    55: { label: 'Heavy Drizzle',         icon: 'fa-cloud-drizzle' },
    61: { label: 'Light Rain',            icon: 'fa-cloud-rain' },
    63: { label: 'Rain',                  icon: 'fa-cloud-rain' },
    65: { label: 'Heavy Rain',            icon: 'fa-cloud-showers-heavy' },
    71: { label: 'Light Snow',            icon: 'fa-snowflake' },
    73: { label: 'Snow',                  icon: 'fa-snowflake' },
    75: { label: 'Heavy Snow',            icon: 'fa-snowflake' },
    77: { label: 'Snow Grains',           icon: 'fa-snowflake' },
    80: { label: 'Rain Showers',          icon: 'fa-cloud-showers-heavy' },
    81: { label: 'Rain Showers',          icon: 'fa-cloud-showers-heavy' },
    82: { label: 'Heavy Rain Showers',    icon: 'fa-cloud-showers-heavy' },
    85: { label: 'Snow Showers',          icon: 'fa-snowflake' },
    86: { label: 'Heavy Snow Showers',    icon: 'fa-snowflake' },
    95: { label: 'Thunderstorm',          icon: 'fa-cloud-bolt' },
    96: { label: 'Thunderstorm w/ Hail',  icon: 'fa-cloud-bolt' },
    99: { label: 'Severe Thunderstorm',   icon: 'fa-cloud-bolt' }
};

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
    if (i === 1) return 'Tmrw';
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(isoStr + 'T12:00:00').getDay()];
}

// ── View switching ────────────────────────────────────────────────────
function _sgwxShowDashboard() {
    document.getElementById('sgwxDashboard').style.display = 'flex';
    document.getElementById('bodyDiv').style.display       = 'none';
    document.getElementById('sgwxBackToDashBtn').style.display = 'none';
}

function _sgwxShowRadar() {
    document.getElementById('sgwxDashboard').style.display = 'none';
    document.getElementById('bodyDiv').style.display       = 'block';
    document.getElementById('sgwxBackToDashBtn').style.display = 'flex';
    if (window._sgwxMap) setTimeout(function() { window._sgwxMap.resize(); }, 60);
}

// ── Weather fetch ─────────────────────────────────────────────────────
function _sgwxDashFetch(lat, lon) {
    var url = [
        'https://api.open-meteo.com/v1/forecast',
        '?latitude=', lat, '&longitude=', lon,
        '&current=temperature_2m,apparent_temperature,weather_code,',
        'wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility,uv_index',
        '&hourly=temperature_2m,weather_code,precipitation_probability',
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,',
        'precipitation_probability_max,wind_speed_10m_max',
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch',
        '&timezone=auto&forecast_days=7'
    ].join('');

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
            var el = document.getElementById('sgwxDashLocationText');
            if (el && text) el.textContent = text;
        })
        .catch(function() {});
}

// ── Render ────────────────────────────────────────────────────────────
function _sgwxDashRender(data) {
    var c     = data.current;
    var night = _sgwxIsNight();
    var wmo   = _sgwxWmoGet(c.weather_code, night);

    document.getElementById('sgwxDashLoading').style.display = 'none';
    document.getElementById('sgwxDashContent').style.display = 'flex';

    // Current
    document.getElementById('sgwxDashWeatherIcon').className  = 'fa ' + wmo.icon;
    document.getElementById('sgwxDashTemp').textContent        = Math.round(c.temperature_2m) + '°';
    document.getElementById('sgwxDashConditionText').textContent = wmo.label;
    document.getElementById('sgwxDashFeelsLike').textContent   = 'Feels like ' + Math.round(c.apparent_temperature) + '°';

    // Details
    document.getElementById('sgwxDetailWind').textContent =
        Math.round(c.wind_speed_10m) + ' mph ' + _sgwxWindDir(c.wind_direction_10m);
    document.getElementById('sgwxDetailHumidity').textContent = c.relative_humidity_2m + '%';
    document.getElementById('sgwxDetailUv').textContent       = Math.round(c.uv_index || 0);
    var visMi = c.visibility ? (c.visibility / 1609).toFixed(1) : '--';
    document.getElementById('sgwxDetailVisibility').textContent = visMi + ' mi';

    _sgwxDashRenderAlerts();
    _sgwxDashRenderHourly(data.hourly);
    _sgwxDashRenderDaily(data.daily);
}

function _sgwxDashRenderAlerts() {
    var el   = document.getElementById('sgwxDashAlertsContainer');
    var data = window.atticData && window.atticData.alerts_data;
    if (!data || !data.features || !data.features.length) { el.innerHTML = ''; return; }

    el.innerHTML = data.features.slice(0, 4).map(function(f) {
        var p   = f.properties;
        var evt = p.event || 'Alert';
        var area = (p.areaDesc || '').split(';')[0].split(',').slice(0, 3).join(',').trim();
        var cls = /tornado/i.test(evt) ? 'sgwxDashAlert-tornado' :
                  /warning/i.test(evt) ? 'sgwxDashAlert-warning'  : 'sgwxDashAlert-watch';
        return '<div class="sgwxDashAlert ' + cls + '">' +
            '<div class="sgwxDashAlertTitle"><i class="fa fa-triangle-exclamation"></i> ' + evt + '</div>' +
            (area ? '<div class="sgwxDashAlertArea">' + area + '</div>' : '') +
            '</div>';
    }).join('');
}

function _sgwxDashRenderHourly(hourly) {
    var el  = document.getElementById('sgwxDashHourlyScroll');
    var now = Date.now();
    var html = '';
    var shown = 0;

    for (var i = 0; i < hourly.time.length && shown < 25; i++) {
        var t = new Date(hourly.time[i]);
        if (t.getTime() < now - 1800000) continue;
        var isNow  = shown === 0;
        var wmo    = _sgwxWmoGet(hourly.weather_code[i], _sgwxIsNight(t));
        var pop    = hourly.precipitation_probability[i] || 0;
        html += '<div class="sgwxDashHourItem' + (isNow ? ' sgwxDashHourNow' : '') + '">' +
            '<div class="sgwxDashHourTime">' + (isNow ? 'Now' : _sgwxHourLabel(hourly.time[i])) + '</div>' +
            '<i class="fa ' + wmo.icon + ' sgwxDashHourIcon"></i>' +
            '<div class="sgwxDashHourTemp">' + Math.round(hourly.temperature_2m[i]) + '°</div>' +
            '<div class="sgwxDashHourPop">' + (pop >= 10 ? pop + '%' : '') + '</div>' +
            '</div>';
        shown++;
    }
    el.innerHTML = html;
}

function _sgwxDashRenderDaily(daily) {
    var el = document.getElementById('sgwxDashDailyList');
    el.innerHTML = daily.time.map(function(t, i) {
        var wmo = _sgwxWmoGet(daily.weather_code[i], false);
        var pop = daily.precipitation_probability_max[i] || 0;
        return '<div class="sgwxDashDayRow">' +
            '<div class="sgwxDashDayName">' + _sgwxDayName(t, i) + '</div>' +
            '<i class="fa ' + wmo.icon + ' sgwxDashDayIcon"></i>' +
            '<div class="sgwxDashDayPop">' + (pop >= 10 ? pop + '% <i class="fa fa-droplet"></i>' : '') + '</div>' +
            '<div class="sgwxDashDayTemps">' +
                '<span class="sgwxDashDayHigh">' + Math.round(daily.temperature_2m_max[i]) + '°</span>' +
                ' <span class="sgwxDashDayLow">/ ' + Math.round(daily.temperature_2m_min[i]) + '°</span>' +
            '</div>' +
            '</div>';
    }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────
window._sgwxDashInit = function() {
    document.getElementById('sgwxDashRadarBtn').addEventListener('click', _sgwxShowRadar);
    document.getElementById('sgwxBackToDashBtn').addEventListener('click', function() {
        _sgwxShowDashboard();
        // Refresh alerts in case new ones came in while on radar
        _sgwxDashRenderAlerts();
    });

    if (!navigator.geolocation) {
        _sgwxDashFetch(36.83, -98.56);
        document.getElementById('sgwxDashLocationText').textContent = 'Central US';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            _sgwxDashLat = pos.coords.latitude;
            _sgwxDashLon = pos.coords.longitude;
            _sgwxDashFetchCity(_sgwxDashLat, _sgwxDashLon);
            _sgwxDashFetch(_sgwxDashLat, _sgwxDashLon);

            // Refresh weather every 10 minutes
            _sgwxDashRefreshTimer = setInterval(function() {
                _sgwxDashFetch(_sgwxDashLat, _sgwxDashLon);
                _sgwxDashRenderAlerts();
            }, 600000);
        },
        function() {
            // Location denied — fall back to a generic US center
            _sgwxDashFetch(36.83, -98.56);
            document.getElementById('sgwxDashLocationText').textContent = 'Central US';
        },
        { enableHighAccuracy: false, timeout: 12000 }
    );
};
