// Live user location — pulsing blue dot on the map.
// Activated by the sidebar button; uses navigator.geolocation directly.

var _sgwxLocateWatchId  = null;
var _sgwxLocateMarker   = null;
var _sgwxLocateActive   = false;

// Approximate a circle polygon (used for accuracy ring)
function _sgwxCirclePolygon(lat, lng, radiusM) {
    var pts = [];
    var km  = radiusM / 1000;
    var dx  = km / (111.320 * Math.cos(lat * Math.PI / 180));
    var dy  = km / 110.574;
    for (var i = 0; i <= 64; i++) {
        var a = (i / 64) * 2 * Math.PI;
        pts.push([lng + dx * Math.cos(a), lat + dy * Math.sin(a)]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
}

function _sgwxLocateUpdate(lat, lng, accuracy) {
    var m = window._sgwxMap;
    if (!m) return;

    // Create or move the pulsing dot marker
    var lngLat = [lng, lat];
    if (!_sgwxLocateMarker) {
        var el = document.createElement('div');
        el.className = 'sgwx-user-dot';
        _sgwxLocateMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat(lngLat)
            .addTo(m);
    } else {
        _sgwxLocateMarker.setLngLat(lngLat);
    }

    // Accuracy ring
    var circle = _sgwxCirclePolygon(lat, lng, accuracy || 30);
    var src = 'sgwx_user_accuracy';
    if (m.getSource(src)) {
        m.getSource(src).setData(circle);
    } else if (m.isStyleLoaded()) {
        try {
            m.addSource(src, { type: 'geojson', data: circle });
            m.addLayer({
                id: 'sgwx_user_accuracy_fill', type: 'fill', source: src,
                paint: { 'fill-color': '#4285f4', 'fill-opacity': 0.12 }
            });
            m.addLayer({
                id: 'sgwx_user_accuracy_outline', type: 'line', source: src,
                paint: { 'line-color': '#4285f4', 'line-width': 1.5, 'line-opacity': 0.5 }
            });
        } catch (e) {}
    }
}

function _sgwxLocateStart() {
    if (_sgwxLocateActive) {
        // Already tracking — fly to current position
        if (_sgwxLocateMarker && window._sgwxMap) {
            window._sgwxMap.flyTo({ center: _sgwxLocateMarker.getLngLat(), zoom: 10 });
        }
        return;
    }

    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }

    // Set button to loading state
    var $btn = $('#sgwxLocateBtn i');
    $btn.removeClass('fa-location-crosshairs').addClass('fa-spinner fa-spin');

    _sgwxLocateWatchId = navigator.geolocation.watchPosition(
        function(pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            var acc = pos.coords.accuracy;

            if (!_sgwxLocateActive) {
                _sgwxLocateActive = true;
                // Fly to user on first fix
                if (window._sgwxMap) {
                    window._sgwxMap.flyTo({ center: [lng, lat], zoom: 9, duration: 1500 });
                }
                // Update button to active state
                $btn.removeClass('fa-spinner fa-spin').addClass('fa-location-crosshairs');
                $('#sgwxLocateBtn').addClass('sgwxLocateActive');
            }

            _sgwxLocateUpdate(lat, lng, acc);
        },
        function(err) {
            $btn.removeClass('fa-spinner fa-spin').addClass('fa-location-crosshairs');
            if (err.code === err.PERMISSION_DENIED) {
                alert('Location access was denied.\n\nIn Edge: click the lock icon in the address bar → Location → Allow, then try again.');
            }
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
    );
}

window._sgwxLocationInit = function() {
    $('#sgwxLocateBtn').on('click', _sgwxLocateStart);
};
