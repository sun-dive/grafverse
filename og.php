<?php
// grafspace — © 2026 sun-dive — Licensed under the Business Source License 1.1 (see LICENSE).
// grafverse.com/og.php?id=<id> — serves a shared world/solid's OG social-card image (the 1200×630 JPEG
// re-encoded by world.php). Falls back to the brand card (/og.jpg) when a share has no per-share cover.
header('X-Content-Type-Options: nosniff');
$id = preg_replace('/[^0-9a-f]/', '', (string)($_GET['id'] ?? ''));
$f  = __DIR__ . '/worlds/' . $id . '.jpg';
if ($id !== '' && strlen($id) >= 6 && strlen($id) <= 16 && is_file($f)) {
  header('Content-Type: image/jpeg');
  header('Content-Length: ' . filesize($f));
  header('Cache-Control: public, max-age=86400');   // immutable per (id, mtime); w.php cache-busts with &v=<mtime>
  readfile($f);
  exit;
}
$brand = __DIR__ . '/og.jpg';                         // no per-share cover → the brand card
if (is_file($brand)) {
  header('Content-Type: image/jpeg');
  header('Content-Length: ' . filesize($brand));
  header('Cache-Control: public, max-age=3600');
  readfile($brand);
  exit;
}
http_response_code(404);
