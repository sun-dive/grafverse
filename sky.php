<?php
/* grafverse/sky.php — the daily IAPETUS sky state, as a tiny JSON.
 *
 * Iapetus's sky barely moves during play (it's tidally locked to Saturn; its "day" is 79.3 Earth-days),
 * so the expensive astronomy is computed ONCE PER UTC DATE and cached — every other request serves the
 * cached copy (same pattern as tip.php). One request a day does the maths; everyone else gets ~300 bytes.
 *
 * Astronomy ported faithfully from the user's OWN BlackSunObs ephemeris (2011–2013) — itself a port of
 * Paul Schlyter's planetary-position method (stjarnhimlen.se, accurate to ~1–2 arc-minutes).
 * From Iapetus you sit ~9.5 AU out at Saturn, so the Sun appears ~opposite Saturn's heliocentric longitude.
 *
 * Licence: Open BSV. © sun-dive.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=3600');

$today = gmdate('Y-m-d');
$cache = __DIR__.'/sky-cache-'.$today.'.json';
if (is_file($cache)) { readfile($cache); exit; }

// ---- helpers (Schlyter / BlackSunObs) ----
function rev($x){ $x = $x - floor($x/360)*360; return $x < 0 ? $x + 360 : $x; }
function atan2d($x,$y){ return rev(rad2deg(atan2($y,$x))); }        // ecliptic-style angle of vector (x,y), 0..360
function asind($x){ return rad2deg(asin(max(-1,min(1,$x)))); }
function EA_iter($M,$e){                                            // solve Kepler's equation, degrees
    $E = $M + $e*(180/M_PI)*sin(deg2rad($M))*(1 + $e*cos(deg2rad($M)));
    do { $E0 = $E; $E = $E0 - ($E0 - (180/M_PI)*$e*sin(deg2rad($E0)) - $M) / (1 - $e*cos(deg2rad($E0))); }
    while (abs($E - $E0) > 1e-6);
    return $E;
}
function daynum($dt){                                              // day-count from 2000 Jan 0.0 (Schlyter)
    $p = explode(' ', $dt); $ymd = explode('-', $p[0]); $UT = 0;
    if (isset($p[1])) { $t = explode(':', $p[1]); $UT = $t[0]/24 + $t[1]/1440 + (isset($t[2])?$t[2]:0)/86400; }
    return 367*$ymd[0] - (int)((7*($ymd[0] + (int)(($ymd[1]+9)/12)))/4) + (int)((275*$ymd[1])/9) + $ymd[2] - 730530 + $UT;
}
function zodiac($lon){ $s=['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
    $lon = rev($lon); return round($lon - ((int)($lon/30))*30, 1).'° '.$s[(int)($lon/30)]; }

function sun_ecl_lon($d){                                          // Earth-view Sun ecliptic longitude (cross-check)
    $w = 282.9404 + 4.70935E-5*$d; $e = 0.016709 - 1.151E-9*$d; $M = rev(356.0470 + 0.9856002585*$d);
    $E = EA_iter($M,$e); $x = cos(deg2rad($E)) - $e; $y = sin(deg2rad($E))*sqrt(1-$e*$e);
    return rev(atan2d($x,$y) + $w);
}
function saturn_helio($d){                                         // Saturn heliocentric ecliptic (lon, lat, dist AU)
    $N = 113.6634 + 2.38980E-5*$d; $i = 2.4886 - 1.081E-7*$d; $w = 339.3939 + 2.97661E-5*$d;
    $a = 9.55475; $e = 0.055546 - 9.499E-9*$d; $M = rev(316.9670 + 0.0334442282*$d);
    $E = EA_iter($M,$e); $x = $a*(cos(deg2rad($E)) - $e); $y = $a*sin(deg2rad($E))*sqrt(1-$e*$e);
    $r = sqrt($x*$x+$y*$y); $v = atan2d($x,$y);
    $xh = $r*( cos(deg2rad($N))*cos(deg2rad($v+$w)) - sin(deg2rad($N))*sin(deg2rad($v+$w))*cos(deg2rad($i)) );
    $yh = $r*( sin(deg2rad($N))*cos(deg2rad($v+$w)) + cos(deg2rad($N))*sin(deg2rad($v+$w))*cos(deg2rad($i)) );
    $zh = $r*sin(deg2rad($v+$w))*sin(deg2rad($i));
    $dist = sqrt($xh*$xh+$yh*$yh+$zh*$zh);
    return array(rev(atan2d($xh,$yh)), asind($zh/$dist), $dist);
}
function ecl2equ($lon,$lat,$d){                                    // ecliptic (lon,lat) -> equatorial (RA,Dec)
    $obl = 23.4393 - 3.563E-7*$d;
    $xe = cos(deg2rad($lat))*cos(deg2rad($lon)); $ye = cos(deg2rad($lat))*sin(deg2rad($lon)); $ze = sin(deg2rad($lat));
    $xq = $xe; $yq = $ye*cos(deg2rad($obl)) - $ze*sin(deg2rad($obl)); $zq = $ye*sin(deg2rad($obl)) + $ze*cos(deg2rad($obl));
    return array(rev(atan2d($xq,$yq)), asind($zq));
}

$now = gmdate('Y-m-d H:i:s'); $d = daynum($now);
list($satlon,$satlat,$satr) = saturn_helio($d);
$isun_lon = rev($satlon + 180); $isun_lat = -$satlat;              // Sun as seen from Iapetus ≈ opposite Saturn
list($sra,$sdec) = ecl2equ($isun_lon, $isun_lat, $d);
$obl = 23.4393 - 3.563E-7*$d;

$sky = array(
    'date' => $today, 'computed' => $now.' UTC', 'day_number' => round($d,4), 'obliquity' => round($obl,4),
    'sun' => array(
        'ra' => round($sra,4), 'dec' => round($sdec,4),
        'ecl_lon' => round($isun_lon,4), 'zodiac' => zodiac($isun_lon),
        'dist_au' => round($satr,4), 'ang_arcmin' => round(2*atan(0.00465247/$satr)*180/M_PI*60, 3)
    ),
    'saturn' => array(
        'helio_lon' => round($satlon,4), 'helio_lat' => round($satlat,4),
        'dist_au' => round($satr,4), 'zodiac' => zodiac($satlon)
    ),
    'earth_sun_ecl_lon' => round(sun_ecl_lon($d),4),
    'source' => 'BlackSunObs ephemeris (Schlyter method) via grafverse sky.php'
);

$json = json_encode($sky, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
@file_put_contents($cache, $json);                                // best-effort daily cache (webroot may be read-only → just recompute)
foreach (glob(__DIR__.'/sky-cache-*.json') as $f) { if ($f !== $cache && @filemtime($f) < time()-3*86400) @unlink($f); }  // sweep stale
echo $json;
