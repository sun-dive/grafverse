<?php
// grafspace — © 2026 sun-dive — Licensed under the Business Source License 1.1 (see LICENSE).
// grafverse.com/w.php?id=<id> — the SHAREABLE, CRAWLABLE landing page for a shared FREE world or solid.
// Renders per-share OG / social-card meta (rendered 1200×630 cover + name + description), then links into
// the game (./?w=<id>). A shared link points here so social crawlers get a proper card; humans click "Enter".
$id  = preg_replace('/[^0-9a-f]/', '', (string)($_GET['id'] ?? ''));
$dir = __DIR__ . '/worlds';
$ok  = ($id !== '' && strlen($id) >= 6 && strlen($id) <= 16 && is_file($dir . '/' . $id . '.bmf'));

// per-share meta {n:name, d:description, t:type 'w'|'s'} written by world.php (legacy .name honoured as a fallback)
$name = ''; $desc = ''; $type = 'w';
$metaF = $ok ? ($dir . '/' . $id . '.meta') : '';
if ($metaF && is_file($metaF)) {
  $m = json_decode((string)@file_get_contents($metaF), true);
  if (is_array($m)) { $name = (string)($m['n'] ?? ''); $desc = (string)($m['d'] ?? ''); $type = (($m['t'] ?? 'w') === 's') ? 's' : 'w'; }
}
if ($name === '' && $ok && is_file($dir . '/' . $id . '.name')) $name = substr(preg_replace('/[\x00-\x1f\x7f]/', '', (string)@file_get_contents($dir . '/' . $id . '.name')), 0, 80);

$thing = ($type === 's') ? 'creation' : 'world';
if ($name === '') $name = ($type === 's') ? 'A grafverse creation' : 'A grafverse world';
if ($desc === '') $desc = ($type === 's')
  ? 'A hand-painted 3D creation you can walk up to, remix, and make your own — made in grafverse, a free first-person browser painting game.'
  : 'Walk it, paint it, remix it, make it yours — a hand-painted 3D world you explore free in your browser, made in grafverse.';

$origin = 'https://' . preg_replace('/[^a-z0-9.\-:]/i', '', ($_SERVER['HTTP_HOST'] ?? 'grafverse.com'));
$url    = $origin . '/w.php?id=' . rawurlencode($id);
$game   = '/grafverse.html?w=' . rawurlencode($id);   // the game now lives at /grafverse.html (root = splash)
$jpg    = $ok ? ($dir . '/' . $id . '.jpg') : '';
$hasImg = ($jpg && is_file($jpg));
$img    = $origin . '/og.php?id=' . rawurlencode($id) . ($hasImg ? ('&v=' . @filemtime($jpg)) : '');   // per-share cover (cache-busted by mtime) · og.php falls back to the brand card
$ttl    = ($type === 's') ? 'A creation' : 'A world';

if (!$ok) http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
$h = function ($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); };
?><!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $h($name) ?> — grafverse</title>
<meta name="description" content="<?= $h($desc) ?>">
<link rel="canonical" href="<?= $h($url) ?>">
<meta property="og:type" content="website">
<meta property="og:site_name" content="grafverse">
<meta property="og:title" content="<?= $h($name) ?> — a grafverse <?= $h($thing) ?>">
<meta property="og:description" content="<?= $h($desc) ?>">
<meta property="og:image" content="<?= $h($img) ?>">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="<?= $h($url) ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= $h($name) ?> — a grafverse <?= $h($thing) ?>">
<meta name="twitter:description" content="<?= $h($desc) ?>">
<meta name="twitter:image" content="<?= $h($img) ?>">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27><text y=%27.9em%27 font-size=%2790%27>🎨</text></svg>">
<?php if ($ok):
  // Rich result for this specific shared world/solid: a CreativeWork that is part of the grafverse WebSite, made in grafverse.
  $ld = [
    '@context'    => 'https://schema.org',
    '@type'       => 'CreativeWork',
    'name'        => $name,
    'description' => $desc,
    'url'         => $url,
    'image'       => $img,
    'inLanguage'  => 'en',
    'creator'     => ['@type' => 'Organization', '@id' => 'https://grafverse.com/#org', 'name' => 'grafverse'],
    'isPartOf'    => ['@type' => 'WebSite', '@id' => 'https://grafverse.com/#website', 'name' => 'grafverse', 'url' => 'https://grafverse.com/'],
  ];
  echo '<script type="application/ld+json">' . json_encode($ld, JSON_HEX_TAG | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "</script>\n";
endif; ?>
<style>
  *{margin:0;box-sizing:border-box}
  body{background:radial-gradient(ellipse at 50% -10%, #10203c 0%, #0a1020 55%, #06090f 100%);
       color:#eaf2ff;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 20px;}
  main{max-width:640px;text-align:center;}
  .tag{font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#5f7bb0;margin-bottom:18px;}
  .shot{max-width:100%;width:520px;aspect-ratio:1200/630;object-fit:cover;border-radius:14px;margin:0 auto 26px;
        box-shadow:0 18px 60px rgba(0,0,0,.5),0 0 0 1px rgba(120,170,255,.16);display:block;}
  h1{font-size:clamp(30px,7vw,56px);font-weight:800;letter-spacing:-.02em;line-height:1.05;
     background:linear-gradient(180deg,#eaf2ff,#6fb6ff);-webkit-background-clip:text;background-clip:text;color:transparent;text-wrap:balance;}
  .lede{color:#a9bcdd;font-size:16px;margin:16px auto 28px;max-width:34em;}
  .enter{display:inline-block;font-size:15px;font-weight:700;letter-spacing:.04em;text-decoration:none;
         color:#04121f;background:linear-gradient(180deg,#5fe3ff,#2ec3ff);padding:15px 34px;border-radius:32px;
         box-shadow:0 10px 40px rgba(56,225,255,.28);transition:transform .12s, box-shadow .12s;}
  .enter:hover{transform:translateY(-2px);box-shadow:0 14px 52px rgba(56,225,255,.42);}
  .hint{color:#7f97bf;font-size:13px;margin-top:16px;}
  .foot{margin-top:40px;padding-top:20px;border-top:1px solid rgba(120,170,255,.14);color:#6f86ad;font-size:12.5px;line-height:1.7;}
  .foot b{color:#9fc0ff;} .foot a,.lede a{color:#38e1ff;text-decoration:none;} .foot a:hover{text-decoration:underline;}
  .creed{margin-top:26px;font-size:10.5px;letter-spacing:.3em;text-transform:uppercase;color:#3f5a86;}
</style>
</head><body>
<main>
  <div class="tag">grafverse · a free browser painting game</div>
<?php if ($ok && $hasImg): ?>
  <img class="shot" src="<?= $h($img) ?>" width="1200" height="630" alt="<?= $h($name) ?> — a hand-painted grafverse <?= $h($thing) ?>">
<?php endif; ?>
  <h1><?= $h($name) ?></h1>
  <p class="lede"><?= $h($desc) ?></p>
<?php if ($ok): ?>
  <a class="enter" href="<?= $h($game) ?>">▶ Enter this <?= $h($thing) ?></a>
  <p class="hint">Free to explore in your browser — no install, no download. Paint on it, and what you paint is <b>yours</b>.</p>
<?php else: ?>
  <p class="hint">This <?= $h($thing) ?> isn’t here — the link may be mistyped, or it expired (shares are kept for 12 months after their last view).</p>
  <a class="enter" href="/grafverse.html">Open grafverse</a>
<?php endif; ?>
  <div class="foot"><?= $h($ttl) ?> made in <b>grafverse</b> — a hand-painted 3D scene you can walk into free in your browser, then paint and make your own. <a href="/grafverse.html">Make your own →</a></div>
  <div class="creed">paint a moon to life</div>
</main>
</body></html>
