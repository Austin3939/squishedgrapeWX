// Weather Models panel — Windy.com embed with model switcher tabs.

var _sgwxModelsLoaded = false;
var _sgwxModelsActive = 'hrrr';

var _sgwxModelsUrls = {
    hrrr:    'https://embed.windy.com/embed2.html?lat=36.83&lon=-98.56&zoom=5&level=surface&overlay=wind&product=hrrr&menu=&message=true&marker=&calendar=now&pressure=true&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1',
    gfs:     'https://embed.windy.com/embed2.html?lat=36.83&lon=-98.56&zoom=5&level=surface&overlay=wind&product=gfs&menu=&message=true&marker=&calendar=now&pressure=true&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1',
    nam:     'https://embed.windy.com/embed2.html?lat=36.83&lon=-98.56&zoom=5&level=surface&overlay=wind&product=nam&menu=&message=true&marker=&calendar=now&pressure=true&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1',
    ecmwf:   'https://embed.windy.com/embed2.html?lat=36.83&lon=-98.56&zoom=5&level=surface&overlay=wind&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=true&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1',
    spcmeso: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=20&parm=stp'
};

window._sgwxModelsInit = function() {
    $('#sgwxModelsPanel').draggable({ handle: '#sgwxModelsHeader', containment: 'window' });

    // Sidebar button: toggle panel open/closed.
    $('#sgwxModelsSidebarBtn').on('click', function() {
        var $panel = $('#sgwxModelsPanel');
        var $span  = $(this).find('span');
        if ($panel.is(':visible')) {
            $panel.hide();
            $span.removeClass('menu_item_selected').addClass('icon-grey menu_item_not_selected');
        } else {
            if (!_sgwxModelsLoaded) {
                document.getElementById('sgwxWindyFrame').src = _sgwxModelsUrls[_sgwxModelsActive];
                _sgwxModelsLoaded = true;
            }
            $panel.show();
            $span.removeClass('icon-grey menu_item_not_selected').addClass('menu_item_selected');
        }
    });

    // Close button.
    $('#sgwxModelsClose').on('click', function() {
        $('#sgwxModelsPanel').hide();
        $('#sgwxModelsSidebarBtn span').removeClass('menu_item_selected').addClass('icon-grey menu_item_not_selected');
    });

    // Model tab switcher.
    $(document).on('click', '.sgwxModelsTab', function() {
        var model = $(this).data('model');
        if (model === _sgwxModelsActive) return;
        _sgwxModelsActive = model;
        _sgwxModelsLoaded = true;
        $('.sgwxModelsTab').removeClass('sgwxModelsTabActive');
        $(this).addClass('sgwxModelsTabActive');
        document.getElementById('sgwxWindyFrame').src = _sgwxModelsUrls[model];
    });
};
