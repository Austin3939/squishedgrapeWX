const display_attic_dialog = require('../menu/attic_dialog');

$('#armrAboutBtn').click(function() {
    const html_content =
`<div style="text-align: center; padding-left: 20px; padding-right: 20px; color: rgb(200, 200, 200)">
<div style="font-size: 20px"><b>SquishedGrape WX</b></div>
A powerful weather toolkit for the browser — NEXRAD radar, weather alerts, METAR stations, and more.

Built on the open-source AtticRadar project by SteepAtticStairs.
<a href="https://github.com/SteepAtticStairs/AtticRadar" style="color: #53a2e0;">Original source on GitHub</a>

</div>
</div>`

    display_attic_dialog({
        'title': 'About',
        'body': html_content,
        'color': 'rgb(120, 120, 120)',
        'textColor': 'black',
    })
})