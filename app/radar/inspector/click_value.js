/*
 * Click / tap a point on the radar to read the data value at that point in a
 * small tooltip-style popup. Reuses the same WebGL framebuffer read as the
 * crosshair color inspector (get_value.js), but anchored to the clicked
 * location instead of the map center.
 */

const map = require('../../core/map/map');
const turf = require('@turf/turf');
const format_value = require('./format_value');

function readPixels(gl, x, y) {
    var data = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
}

// Beam height (ft ARL) — same formula as the crosshair inspector.
function beam_height(distance_km, elevation_meters, elevation_angle) {
    var height = 0; // ARL, not MSL
    var range = distance_km;
    var earthRadius = 6374; // km
    var radians = Math.PI / 180;

    var beamHeightARL = Math.sqrt(
        Math.pow(range, 2)
        + Math.pow((4 / 3) * earthRadius + height, 2)
        + (2 * range) * ((4 / 3) * earthRadius + height) * Math.sin(elevation_angle * radians)
    ) - (4 / 3) * earthRadius;

    return beamHeightARL * 3280.8; // km -> ft
}

function valueAtPoint(point) {
    if (window.atticData.fb == undefined || window.atticData.cmin == undefined) return null;

    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (!gl) return null;

    const canvasWidth = parseFloat(canvas.style.width, 10);
    const canvasHeight = parseFloat(canvas.style.height, 10);
    const bufferX = (gl.drawingBufferWidth / canvasWidth * point.x).toFixed(0);
    const bufferY = (gl.drawingBufferHeight / canvasHeight * (canvasHeight - point.y)).toFixed(0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, window.atticData.fb);
    var data = readPixels(gl, bufferX, bufferY);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var [value] = format_value.decode_and_format(data, window.atticData.cmin, window.atticData.cmax);
    return value;
}

map.on('click', function(e) {
    // Defer to other handlers when tapping a radar station marker or anywhere
    // inside an alert polygon — the station marker and the alert layers have
    // their own click behavior. The alert fill (alertsLayerFill) covers the
    // whole box, so a tap inside an alert opens the alert popup instead of
    // reading the radar value; alertsLayer is kept for the border edge.
    var deferLayers = ['stationSymbolLayer', 'alertsLayer', 'alertsLayerFill'].filter(function(id) {
        return map.getLayer(id);
    });
    if (deferLayers.length) {
        var hits = map.queryRenderedFeatures(e.point, { layers: deferLayers });
        if (hits && hits.length) return;
    }

    var value = valueAtPoint(e.point);
    if (value == null) return; // no radar data at this point

    var html = '<div class="radarValuePopupValue">' + value + '</div>';

    const radar_location = window.atticData.current_nexrad_location;
    const elevation_angle = window.atticData.current_elevation_angle;
    if (radar_location != undefined && elevation_angle != undefined) {
        const clicked = turf.point([e.lngLat.lng, e.lngLat.lat]);
        const radar = turf.point([radar_location[1], radar_location[0]]);
        const distance_km = turf.distance(clicked, radar, { units: 'kilometers' });
        const bh = beam_height(distance_km, radar_location[2], elevation_angle);
        html += '<div class="radarValuePopupBeam">' + bh.toFixed(0) + ' ft ARL</div>';
    }

    new mapboxgl.Popup({ className: 'radarValuePopup', closeButton: false, closeOnClick: true })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
});
