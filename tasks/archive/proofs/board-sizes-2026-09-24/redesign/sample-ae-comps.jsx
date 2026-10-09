// Board Sizes · Score: Touchdown
// 28 comps, one per distinct canvas this content needs (×N = placed N times on that board), in a new project folder.
// Frame rates follow the venue guide where it states one; otherwise 59.94.
// Duration 8 s (from Colosseum’s deliverables sheet). Run from File › Scripts › Run Script File.
(function () {
  if (!app.project) app.newProject();
  app.beginUndoGroup("Board Sizes: Score: Touchdown");
  var folder = app.project.items.addFolder("Score: Touchdown · boards");
  var specs = [["KC | Centerhung Main | 1104x624",1104,624,59.94,8],["KC | Main 16:9 feed | 1920x1080",1920,1080,59.94,8],["KC | 360 Fascia – Sideline Extended-East / West (×2) | 11472x72",11472,72,59.94,8],["KC | Centerhung Top Ring – Corner-NW / NE / SW / SE (×4) | 240x240",240,240,59.94,8],["KC | Centerhung Top Ring – Sponsor-North / East / South / West (×4) | 1056x72",1056,72,59.94,8],["KC | Centerhung Top Ring – Fullscreen | 5184x240",5184,240,59.94,8],["KC | Scorer’s Table | 2016x126",2016,126,59.94,8],["KC | Baseline Table | 840x126",840,126,59.94,8],["KC | Stanchion | 240x120",240,120,59.94,8],["KC | 300 Level & Tunnels – Tunnel-SE / NE / NW / SW (×4) | 288x72",288,72,59.94,8],["KC | 300 Level & Tunnels – Corner-Fullscreen-SE / NE / NW / SW (×4) | 800x64",800,64,59.94,8],["KC | 300 Level & Tunnels – Corner-Left-SE, Corner-Right-SE, Corner-Left-NE, Corner-Right-NE, Corner-Left-NW, Corner-Right-NW, Corner-Left-SW, Corner-Right-SW (×8) | 165x64",165,64,59.94,8],["CR | North Board – Main Video | 3096x1440",3096,1440,60,8],["CR | North Board – Fullscreen | 5760x1440",5760,1440,60,8],["CR | North Board – Wing Short-Left / Right (×2) | 612x1030",612,1030,60,8],["CR | North Board – Frame-Left / Right (×2) | 1332x1440",1332,1440,60,8],["CR | North Board HD feed | 1920x1080",1920,1080,59.94,8],["CR | West Fascia – Ad-Left West / Right West (×2) | 5000x108",5000,108,60,8],["CR | East Fascia – Ad-Left East / Right East (×2) | 5000x108",5000,108,60,8],["CR | Kellner – Main Video | 1152x540",1152,540,60,8],["CR | Kellner – Wing-Left / Right (×2) | 270x540",270,540,60,8],["CR | South Upper Fascia – Fullscreen-Left | 1725x60",1725,60,60,8],["CR | South Upper Fascia – Fullscreen-Right | 2550x60",2550,60,60,8],["CR | South Lower Fascia – Ad-Left / Right (×2) | 1300x60",1300,60,60,8],["CR | Section A – Main Video | 336x184",336,184,60,8],["FH | Main | 672x384",672,384,59.94,8],["FH | Top Ring – Ring-Fullscreen | 3456x96",3456,96,59.94,8],["FH | Table – Fullscreen | 1728x96",1728,96,59.94,8]];
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    var comp = app.project.items.addComp(s[0], s[1], s[2], 1, s[4], s[3]);
    comp.parentFolder = folder;
  }
  app.endUndoGroup();
  alert(specs.length + " comps created in " + folder.name + ".");
})();
