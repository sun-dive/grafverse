<?php
// grafspace — © 2026 sun-dive — Licensed under the Business Source License 1.1 (see LICENSE).
// grafverse.com/sitemap.php — a dynamic XML sitemap of the crawlable CONTENT pages, with real lastmod dates
// read from the deployed files' mtimes. Only pages actually deployed (per .cpanel.yml) are listed — never a 404.
// Shared worlds are intentionally NOT listed by default (see the optional block below — a privacy/growth choice).
header('Content-Type: application/xml; charset=utf-8');
header('X-Robots-Tag: noindex');                       // the sitemap file itself shouldn't be indexed

$origin = 'https://grafverse.com';                     // canonical host (matches the <link rel=canonical> tags)
$dir    = __DIR__;

// [ url path, local file for lastmod, changefreq, priority ]
$pages = [
  ['/',               'index.html',     'weekly',  '1.0'],   // splash / landing (the crawlable home)
  ['/grafverse.html', 'grafverse.html', 'weekly',  '0.9'],   // the game itself
  ['/brc226.html',    'brc226.html',    'monthly', '0.6'],   // BRC-226 blueprint (coined-term page)
  ['/battery.html',   'battery.html',   'monthly', '0.6'],   // BRC-226 demo two — the Bitcoin battery (coined-term page)
];

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach ($pages as $p) {
  $f   = $dir . '/' . $p[1];
  $lm  = date('Y-m-d', is_file($f) ? filemtime($f) : time());
  $loc = htmlspecialchars($origin . $p[0], ENT_QUOTES, 'UTF-8');
  echo "  <url>\n    <loc>$loc</loc>\n    <lastmod>$lm</lastmod>\n    <changefreq>$p[2]</changefreq>\n    <priority>$p[3]</priority>\n  </url>\n";
}

// ── OPTIONAL — make shared worlds/solids publicly DISCOVERABLE in search (uncomment when you decide to) ──
// foreach (@glob($dir . '/worlds/*.bmf') ?: [] as $wf) {
//   $id  = basename($wf, '.bmf');
//   $loc = htmlspecialchars($origin . '/w.php?id=' . $id, ENT_QUOTES, 'UTF-8');
//   echo "  <url>\n    <loc>$loc</loc>\n    <lastmod>" . date('Y-m-d', filemtime($wf)) . "</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>\n";
// }

echo '</urlset>' . "\n";
