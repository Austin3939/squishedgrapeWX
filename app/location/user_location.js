// Live user location — native Mapbox GeolocateControl.
// User clicks the button to grant permission and show the blue dot.

window._sgwxLocationInit = function() {
    var setup = function(m) {
        m.addControl(new mapboxgl.GeolocateControl({
            positionOptions:    { enableHighAccuracy: true },
            trackUserLocation:  true,
            showUserHeading:    true,
            showAccuracyCircle: true
        }), 'bottom-right');
    };

    if (window._sgwxMap) {
        setup(window._sgwxMap);
    } else {
        var poll = setInterval(function() {
            if (window._sgwxMap) { clearInterval(poll); setup(window._sgwxMap); }
        }, 250);
    }
};
