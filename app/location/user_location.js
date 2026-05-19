// Live user location — adds a pulsing blue dot via Mapbox GeolocateControl.
// Auto-triggers on load; user can also tap the button to re-center.

window._sgwxLocationInit = function() {
    // Map may not exist yet (bundle creates it asynchronously).
    if (!window._sgwxMap) {
        var poll = setInterval(function() {
            if (window._sgwxMap) {
                clearInterval(poll);
                _sgwxSetupGeolocate(window._sgwxMap);
            }
        }, 250);
        return;
    }
    _sgwxSetupGeolocate(window._sgwxMap);
};

function _sgwxSetupGeolocate(m) {
    var control = new mapboxgl.GeolocateControl({
        positionOptions:   { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading:   true,
        showAccuracyCircle: true
    });

    m.addControl(control, 'bottom-right');

    var trigger = function() {
        // Small delay so the map tiles have a chance to finish loading.
        setTimeout(function() { control.trigger(); }, 1200);
    };

    if (m.isStyleLoaded()) {
        trigger();
    } else {
        m.once('load', trigger);
    }
}
