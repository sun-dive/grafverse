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
header('Cache-Control: public, max-age=30');   // computed fresh per request (fast moons) — the heavy part (Horizons) is cached once per UTC day

$today = gmdate('Y-m-d');

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

// ---- the visible planets, as SEEN FROM IAPETUS (≈ from Saturn — the moon's 3.5 Mm offset is nil at interplanetary range) ----
// Every element set + magnitude formula is Schlyter's, ported verbatim from the user's own BlackSunObs ephemeris.
function planet_xyz($el,$d){                                       // heliocentric ecliptic rectangular (x,y,z) + helio distance r
    list($N0,$Nr,$i0,$ir,$w0,$wr,$a0,$ar,$e0,$er,$M0,$Mr) = $el;
    $N=$N0+$Nr*$d; $i=$i0+$ir*$d; $w=$w0+$wr*$d; $a=$a0+$ar*$d; $e=$e0+$er*$d; $M=rev($M0+$Mr*$d);
    $E=EA_iter($M,$e); $x=$a*(cos(deg2rad($E))-$e); $y=$a*sin(deg2rad($E))*sqrt(1-$e*$e);
    $r=sqrt($x*$x+$y*$y); $v=atan2d($x,$y);
    $xh=$r*( cos(deg2rad($N))*cos(deg2rad($v+$w)) - sin(deg2rad($N))*sin(deg2rad($v+$w))*cos(deg2rad($i)) );
    $yh=$r*( sin(deg2rad($N))*cos(deg2rad($v+$w)) + cos(deg2rad($N))*sin(deg2rad($v+$w))*cos(deg2rad($i)) );
    $zh=$r*sin(deg2rad($v+$w))*sin(deg2rad($i));
    return array($xh,$yh,$zh,$r);
}
function sun_rect($d){                                             // geocentric Sun ecliptic rectangular (x,y) + dist → Earth's helio pos is its negative
    $w=282.9404+4.70935E-5*$d; $e=0.016709-1.151E-9*$d; $M=rev(356.0470+0.9856002585*$d);
    $E=EA_iter($M,$e); $xv=cos(deg2rad($E))-$e; $yv=sqrt(1-$e*$e)*sin(deg2rad($E));
    $rs=sqrt($xv*$xv+$yv*$yv); $lon=rev(atan2d($xv,$yv)+$w);
    return array($rs*cos(deg2rad($lon)), $rs*sin(deg2rad($lon)), $rs);
}
function planet_mag($name,$r,$R,$FV){                              // Schlyter apparent-magnitude formulas (r=helio dist, R=obs dist, FV=phase angle°)
    $b = 5*log10($r*$R);
    switch($name){
        case 'Mercury': return -0.36+$b+0.027*$FV+2.2E-13*pow($FV,6);
        case 'Venus':   return -4.34+$b+0.013*$FV+4.2E-7*pow($FV,3);
        case 'Earth':   return -3.99+$b+0.013*$FV;                 // Schlyter has no Earth-from-outside; use Earth's known absolute magnitude H≈−3.99
        case 'Mars':    return -1.51+$b+0.016*$FV;
        case 'Jupiter': return -9.25+$b+0.014*$FV;
        case 'Uranus':  return -7.15+$b+0.001*$FV;
        case 'Neptune': return -6.90+$b+0.001*$FV;
    }
    return 99;
}
//                  N0,        Nr,        i0,      ir,        w0,        wr,         a0,       ar,        e0,       er,        M0,       Mr,             colour
$PLANETS = array(
    'Mercury'=>array(48.3313,3.24587E-5, 7.0047, 5.00E-8,   29.1241, 1.01444E-5,  0.387098, 0,        0.205635, 5.59E-10,  168.6562, 4.0923344368,  '#b9b0a0'),
    'Venus'  =>array(76.6799,2.46590E-5, 3.3946, 2.75E-8,   54.8910, 1.38374E-5,  0.723330, 0,        0.006773,-1.302E-9,   48.0052, 1.6021302244,  '#fff3cf'),
    'Earth'  =>null,                                                              // special-cased below (heliocentric Earth = −geocentric Sun)
    'Mars'   =>array(49.5574,2.11081E-5, 1.8497,-1.78E-8,  286.5016, 2.92961E-5,  1.523688, 0,        0.093405, 2.516E-9,   18.6021, 0.5240207766,  '#e0663a'),
    'Jupiter'=>array(100.4542,2.76854E-5,1.3030,-1.557E-7, 273.8777, 1.64505E-5,  5.20256,  0,        0.048498, 4.469E-9,   19.8950, 0.0830853001,  '#d9b98a'),
    'Uranus' =>array(74.0005,1.3978E-5,  0.7733, 1.9E-8,    96.6612, 3.0565E-5,  19.18171, -1.55E-8,  0.047318, 7.45E-9,   142.5905, 0.011725806,   '#a8d8e0'),
    'Neptune'=>array(131.7806,3.0173E-5, 1.7700,-2.55E-7,  272.8461,-6.027E-6,   30.05826, 3.313E-8,  0.008606, 2.15E-9,   260.2471, 0.005995147,   '#5a7fd6'),
);
function iapetus_planets($PLANETS,$sat,$satr,$d){                  // $sat = Saturn helio xyz (the observer); $satr = Sun→observer distance (AU)
    list($sx,$sy,$sz) = $sat; $out = array();
    foreach($PLANETS as $name=>$el){
        if($name==='Earth'){ list($xs,$ys,$rs)=sun_rect($d); $px=-$xs; $py=-$ys; $pz=0; $r=$rs; $col='#6b93d6'; }
        else { list($px,$py,$pz,$r)=planet_xyz($el,$d); $col=$el[12]; }
        $dx=$px-$sx; $dy=$py-$sy; $dz=$pz-$sz; $R=sqrt($dx*$dx+$dy*$dy+$dz*$dz);   // vector observer→planet, geocentric(≈Iapetus) distance
        $lon=rev(atan2d($dx,$dy)); $lat=asind($dz/$R);
        list($ra,$dec)=ecl2equ($lon,$lat,$d);
        $cosFV=max(-1,min(1,($r*$r+$R*$R-$satr*$satr)/(2*$r*$R))); $FV=rad2deg(acos($cosFV));   // phase angle at the planet
        $mag=planet_mag($name,$r,$R,$FV);
        // elongation from the Sun as seen from the observer (Sun sits opposite Saturn, at −$sat)
        $cosE=max(-1,min(1,(-$sx*$dx-$sy*$dy-$sz*$dz)/($satr*$R))); $elong=rad2deg(acos($cosE));
        $out[]=array('name'=>$name,'ra'=>round($ra,3),'dec'=>round($dec,3),'mag'=>round($mag,2),
                     'elong'=>round($elong,1),'dist_au'=>round($R,3),'color'=>$col);
    }
    return $out;
}

// ---- Saturn's SATELLITE system, as seen FROM IAPETUS (the observer is moon #8 — you stand on it) ----
// Positions come from JPL Horizons OSCULATING elements (SAT441), J2000 ecliptic, Saturn-centred — fetched once per UTC day
// and cached, then propagated to the EXACT request time (the fast inner moons move degrees per hour). Telescope-accurate;
// falls back to the most recent cache, then to offline, if Horizons is unreachable.
$SAT_R_KM = 60268.0; $AU_KM = 149597870.7;
$SAT_POLE_RA = 40.589; $SAT_POLE_DEC = 83.537;
$MOON_INFO = array(    // name => [ Horizons body-id, absolute mag H=V(1,0), colour ]
    'Mimas'=>array(601,3.3,'#c9c4bd'),  'Enceladus'=>array(602,2.1,'#f2f6ff'), 'Tethys'=>array(603,0.6,'#d8d2c6'),
    'Dione'=>array(604,0.8,'#cfcabf'),  'Rhea'=>array(605,0.1,'#c8c3ba'),      'Titan'=>array(606,-1.3,'#e8a862'),
    'Hyperion'=>array(607,4.6,'#b6a68f'),'Iapetus'=>array(608,1.5,'#9b8f7e'),  // Iapetus = the observer (not drawn as a sky object)
);
function equ2ecl($v,$obl){ $o=deg2rad($obl); return array($v[0], $v[1]*cos($o)+$v[2]*sin($o), -$v[1]*sin($o)+$v[2]*cos($o)); }
function vcross($a,$b){ return array($a[1]*$b[2]-$a[2]*$b[1], $a[2]*$b[0]-$a[0]*$b[2], $a[0]*$b[1]-$a[1]*$b[0]); }
function vdot($a,$b){ return $a[0]*$b[0]+$a[1]*$b[1]+$a[2]*$b[2]; }
function vnorm($a){ $m=sqrt(vdot($a,$a)); return $m>0?array($a[0]/$m,$a[1]/$m,$a[2]/$m):$a; }
function h_fetch($u){ if(!function_exists('curl_init')) return @file_get_contents($u);
    $c=curl_init($u); curl_setopt_array($c,array(CURLOPT_RETURNTRANSFER=>1,CURLOPT_TIMEOUT=>25,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_SSL_VERIFYPEER=>0)); $r=curl_exec($c); curl_close($c); return $r; }
function h_parse_elem($t){ if(!$t) return null; $L=explode("\n",$t);       // pull EC,IN,OM,W,N,MA,A from the first $$SOE row of a Horizons ELEMENTS CSV
    for($i=0;$i<count($L);$i++){ if(strpos($L[$i],'$$SOE')!==false && isset($L[$i+1])){ $f=array_map('trim',explode(',',$L[$i+1]));
        if(count($f)<12) return null; return array('e'=>(float)$f[2],'i'=>(float)$f[4],'OM'=>(float)$f[5],'W'=>(float)$f[6],
            'N'=>(float)$f[8]*86400.0, 'MA'=>(float)$f[9], 'A'=>(float)$f[11], 'ep'=>(float)$f[0]-2451543.5); } }
    return null; }
function horizons_moons($MOON_INFO){    // → [ name => osculating-element array ] for all bodies, or null if any fetch fails
    $day=gmdate('Y-m-d');
    $base="https://ssd.jpl.nasa.gov/api/horizons.api?format=text&EPHEM_TYPE=%27ELEMENTS%27&CENTER=%27500@699%27&REF_PLANE=%27ECLIPTIC%27"
         ."&OUT_UNITS=%27KM-S%27&CSV_FORMAT=%27YES%27&START_TIME=%27$day%27&STOP_TIME=%27$day%2000:01%27&STEP_SIZE=%271%27";
    $out=array();
    foreach($MOON_INFO as $name=>$mi){ $el=h_parse_elem(h_fetch($base."&COMMAND=%27".$mi[0]."%27")); if(!$el) return null; $out[$name]=$el; }
    return $out;
}
function kepler_ecl_au($el,$d,$AU){     // propagate one osculating ellipse to day-number $d → Saturn-centric ecliptic (AU)
    $M=fmod($el['MA']+$el['N']*($d-$el['ep']),360.0); if($M<0)$M+=360.0; $e=$el['e'];
    $E=EA_iter($M,$e); $xv=$el['A']*(cos(deg2rad($E))-$e); $yv=$el['A']*sqrt(1-$e*$e)*sin(deg2rad($E));
    $r=sqrt($xv*$xv+$yv*$yv); $v=atan2d($xv,$yv);
    $x=$r*( cos(deg2rad($el['OM']))*cos(deg2rad($v+$el['W'])) - sin(deg2rad($el['OM']))*sin(deg2rad($v+$el['W']))*cos(deg2rad($el['i'])) );
    $y=$r*( sin(deg2rad($el['OM']))*cos(deg2rad($v+$el['W'])) + cos(deg2rad($el['OM']))*sin(deg2rad($v+$el['W']))*cos(deg2rad($el['i'])) );
    $z=$r*sin(deg2rad($v+$el['W']))*sin(deg2rad($el['i']));
    return array($x/$AU,$y/$AU,$z/$AU);
}

$now = gmdate('Y-m-d H:i:s'); $d = daynum($now);
list($satlon,$satlat,$satr) = saturn_helio($d);
$isun_lon = rev($satlon + 180); $isun_lat = -$satlat;              // Sun as seen from Iapetus ≈ opposite Saturn
list($sra,$sdec) = ecl2equ($isun_lon, $isun_lat, $d);
$obl = 23.4393 - 3.563E-7*$d;

// Saturn's heliocentric rectangular position = the observer (Iapetus) for the planet sightlines
$sat_xyz = array($satr*cos(deg2rad($satlat))*cos(deg2rad($satlon)),
                 $satr*cos(deg2rad($satlat))*sin(deg2rad($satlon)),
                 $satr*sin(deg2rad($satlat)));
$planets = iapetus_planets($PLANETS, $sat_xyz, $satr, $d);

// --- Saturn's satellite system, as seen FROM IAPETUS — Horizons osculating elements (daily-cached), propagated to now ---
$pole_eq = array(cos(deg2rad($SAT_POLE_DEC))*cos(deg2rad($SAT_POLE_RA)),
                 cos(deg2rad($SAT_POLE_DEC))*sin(deg2rad($SAT_POLE_RA)),
                 sin(deg2rad($SAT_POLE_DEC)));
$Pn = vnorm(equ2ecl($pole_eq, $obl));                            // Saturn's north (ring-plane normal) in ecliptic — for the ring-opening angle
$elemCache = __DIR__."/sky-elements-$today.json";
$sys = is_file($elemCache) ? json_decode(file_get_contents($elemCache), true) : null;
if(!$sys){ $sys = horizons_moons($MOON_INFO);                    // once per UTC day: fetch + cache the osculating elements
    if($sys){ @file_put_contents($elemCache, json_encode($sys));
        foreach(glob(__DIR__.'/sky-elements-*.json') as $f){ if($f!==$elemCache && @filemtime($f)<time()-4*86400) @unlink($f); } } }
if(!$sys){ $prev=glob(__DIR__.'/sky-elements-*.json');           // Horizons unreachable → newest cached day as a fallback
    if($prev){ usort($prev,function($a,$b){ return @filemtime($b)-@filemtime($a); }); $sys=json_decode(file_get_contents($prev[0]),true); } }
$moon_src = $sys ? 'JPL Horizons (SAT441 osculating elements, daily-cached; propagated to the request time)' : 'unavailable (Horizons offline, no cache)';

$sun_sc = array(-$sat_xyz[0],-$sat_xyz[1],-$sat_xyz[2]);          // the Sun, Saturn-centric ecliptic AU (opposite Saturn's heliocentric pos)
$sd_lon=rev(atan2d($sun_sc[0],$sun_sc[1])); $sd_lat=asind($sun_sc[2]/sqrt(vdot($sun_sc,$sun_sc)));
list($sun_dir_ra,$sun_dir_dec)=ecl2equ($sd_lon,$sd_lat,$d);       // Saturn→Sun celestial direction → aims Saturn's phase terminator

$moons_out=array(); $saturn_sky=null; $isun_sky=null;
if($sys){
    $iap  = kepler_ecl_au($sys['Iapetus'],$d,$AU_KM);            // the observer's Saturn-centric position
    $vsat = array(-$iap[0],-$iap[1],-$iap[2]); $Rsat_obs=sqrt(vdot($vsat,$vsat));   // Iapetus→Saturn
    list($sat_ra,$sat_dec)=ecl2equ(rev(atan2d($vsat[0],$vsat[1])), asind($vsat[2]/$Rsat_obs), $d);
    $sat_ang_arcmin=2*atan($SAT_R_KM/($Rsat_obs*$AU_KM))*180/M_PI*60;
    foreach($MOON_INFO as $name=>$mi){ if($name==='Iapetus') continue;
        $m=kepler_ecl_au($sys[$name],$d,$AU_KM);
        $v=array($m[0]-$iap[0],$m[1]-$iap[1],$m[2]-$iap[2]); $R=sqrt(vdot($v,$v));   // Iapetus→moon (AU)
        list($mra,$mdec)=ecl2equ(rev(atan2d($v[0],$v[1])), asind($v[2]/$R), $d);
        $sep=rad2deg(acos(max(-1,min(1,vdot(vnorm($v),vnorm($vsat))))));
        $mag=$mi[1]+5*log10($satr*$R);                                              // H + 5·log10(r_sun·R_obs)
        $behind=($R>$Rsat_obs)&&($sep<($sat_ang_arcmin/120.0));                     // behind Saturn's disc → occulted
        $moons_out[]=array('name'=>$name,'ra'=>round($mra,3),'dec'=>round($mdec,3),
            'sep'=>round($sep,3),'mag'=>round($mag,2),'dist_km'=>round($R*$AU_KM),'color'=>$mi[2],'behind'=>$behind);
    }
    $vsun=array($sun_sc[0]-$iap[0],$sun_sc[1]-$iap[1],$sun_sc[2]-$iap[2]); $Rsun=sqrt(vdot($vsun,$vsun));
    list($isun_ra,$isun_dec)=ecl2equ(rev(atan2d($vsun[0],$vsun[1])), asind($vsun[2]/$Rsun), $d);  // exact Sun sky-position from Iapetus
    $isun_sky=array($isun_ra,$isun_dec);
    $sun_saturn_sep=rad2deg(acos(max(-1,min(1,vdot(vnorm($vsun),vnorm($vsat))))));
    $phase_ang=rad2deg(acos(max(-1,min(1,vdot(vnorm($iap),vnorm($sun_sc))))));       // Sun–Saturn–Iapetus → illuminated fraction
    $illum=(1+cos(deg2rad($phase_ang)))/2;
    $ring_open=asind(vdot(vnorm($iap),$Pn));
    $saturn_sky=array('ra'=>round($sat_ra,3),'dec'=>round($sat_dec,3),'ang_arcmin'=>round($sat_ang_arcmin,2),
        'dist_km'=>round($Rsat_obs*$AU_KM),'sun_sep'=>round($sun_saturn_sep,3),
        'pole_ra'=>$SAT_POLE_RA,'pole_dec'=>$SAT_POLE_DEC,'ring_open'=>round($ring_open,2),
        'sun_dir_ra'=>round($sun_dir_ra,3),'sun_dir_dec'=>round($sun_dir_dec,3),
        'phase_ang'=>round($phase_ang,1),'illum'=>round($illum,3));
}

$sky = array(
    'date' => $today, 'computed' => $now.' UTC', 'day_number' => round($d,4), 'obliquity' => round($obl,4),
    'sun' => array(
        'ra' => round($isun_sky?$isun_sky[0]:$sra,4), 'dec' => round($isun_sky?$isun_sky[1]:$sdec,4),   // exact from Iapetus (Horizons) if available
        'ecl_lon' => round($isun_lon,4), 'zodiac' => zodiac($isun_lon),
        'dist_au' => round($satr,4), 'ang_arcmin' => round(2*atan(0.00465247/$satr)*180/M_PI*60, 3)
    ),
    'saturn' => array(
        'helio_lon' => round($satlon,4), 'helio_lat' => round($satlat,4),
        'dist_au' => round($satr,4), 'zodiac' => zodiac($satlon)
    ),
    'earth_sun_ecl_lon' => round(sun_ecl_lon($d),4),
    'planets' => $planets,
    'saturn_sky' => $saturn_sky,                                    // Saturn from Iapetus (Horizons) — null if unavailable; the render guards on it
    'moons' => $moons_out,
    'sat_fidelity' => $moon_src,
    'source' => 'JPL Horizons (Saturn system) + BlackSunObs Schlyter (planets/Sun) via grafverse sky.php'
);

echo json_encode($sky, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);  // computed fresh per request (moons move); Horizons elements are the daily-cached layer
