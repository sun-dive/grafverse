<?php
// grafspace — © 2026 sun-dive — Licensed under the Business Source License 1.1 (see LICENSE).
// grafspace SHARED WORLDS — a persistent, public store for FREE worlds + solids shared over Web2.
//   POST  base64(.bmf)                         → { "id", "edit" }   (legacy: raw base64 text body)
//   POST  {bmf, cover?, name?, desc?, type?}   → { "id", "edit" }   (JSON envelope, sent as text/plain → no CORS preflight)
//   GET   ?id=<id>                             → the raw .bmf bytes  (touch mtime = "last viewed")
// A share auto-expires 12 months after its LAST VIEW (mtime, touched on GET). Free channel only: no accounts, no keys.
// Owned paint stays a txid REFERENCE inside the .bmf — the file never carries owned bytes, so sharing can't pirate paid work.
// The OG cover is RE-ENCODED server-side via GD to a clean 1200×630 JPEG — only real raster images survive (any payload is
// stripped), so a share card is bounded to "what someone painted" (a valid scene + an image), never an arbitrary upload.
header('X-Content-Type-Options: nosniff');

$ALLOW = [
  'https://grafverse.com', 'https://grafspace.com',
  'https://wallet.grafverse.com', 'https://wallet.grafspace.com',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $ALLOW, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Expose-Headers: X-World-Name');   // so a cross-origin game can read the world name on load
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

$dir = __DIR__ . '/worlds';
if (!is_dir($dir)) @mkdir($dir, 0755, true);

$TTL = 365 * 24 * 3600; // ~12 months of no view; mtime is "last viewed" (touched on GET)
foreach (@glob($dir . '/*.bmf') ?: [] as $f) {  // opportunistic sweep: world + its edit-key hash + OG cover + meta
  if (@filemtime($f) < time() - $TTL) { $b = substr($f, 0, -4); @unlink($f); @unlink($b . '.k'); @unlink($b . '.jpg'); @unlink($b . '.meta'); }
}

// ── OG cover: re-encode to a clean, fixed 1200×630 JPEG. Only decodable raster images pass; the output is freshly
//    re-encoded so no embedded payload survives. A header-only size probe first guards against decompression bombs. ──
function gv_store_cover($path, $b64) {
  $b64 = trim((string)$b64); if ($b64 === '') return false;
  $raw = base64_decode($b64, true);
  if ($raw === false || strlen($raw) < 100 || strlen($raw) > 600000) return false;   // ≤ ~600 KB of image data
  if (function_exists('imagecreatefromstring') && function_exists('getimagesizefromstring')) {
    $info = @getimagesizefromstring($raw);                                            // reads dimensions from the header only
    if ($info === false || $info[0] < 8 || $info[1] < 8 || $info[0] > 5000 || $info[1] > 5000) return false;
    $im = @imagecreatefromstring($raw); if ($im === false) return false;              // non-image → reject
    $W = 1200; $H = 630; $sw = imagesx($im); $sh = imagesy($im);
    $ar = $W / $H; $sar = $sw / max(1, $sh);                                          // cover-crop to 1.91:1, centred
    if ($sar > $ar) { $ch = $sh; $cw = (int)round($sh * $ar); } else { $cw = $sw; $ch = (int)round($sw / $ar); }
    $cx = (int)(($sw - $cw) / 2); $cy = (int)(($sh - $ch) / 2);
    $out = imagecreatetruecolor($W, $H);
    imagecopyresampled($out, $im, 0, 0, $cx, $cy, $W, $H, max(1, $cw), max(1, $ch));
    imagedestroy($im);
    $ok = @imagejpeg($out, $path, 85); imagedestroy($out); return $ok;
  }
  if (substr($raw, 0, 3) !== "\xFF\xD8\xFF") return false;                            // no GD → require JPEG magic, store as-is
  return @file_put_contents($path, $raw, LOCK_EX) !== false;
}
function gv_clean($s, $n) { $s = preg_replace('/[\x00-\x1f\x7f]/', '', (string)$s); return function_exists('mb_substr') ? mb_substr($s, 0, $n) : substr($s, 0, $n); }
function gv_store_meta($path, $name, $desc, $type) {
  @file_put_contents($path, json_encode(['n' => gv_clean($name, 80), 'd' => gv_clean($desc, 200), 't' => $type === 's' ? 's' : 'w']), LOCK_EX);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
  header('Content-Type: application/json; charset=utf-8');

  // --- per-IP rate limit: max 30 shares / hour ---
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  $rlDir = $dir . '/.rl';
  if (!is_dir($rlDir)) @mkdir($rlDir, 0755, true);
  $rlFile = $rlDir . '/' . substr(hash('sha256', $ip), 0, 24);
  $now = time(); $win = 3600; $max = 30;
  $hits = is_file($rlFile)
    ? array_values(array_filter(array_map('intval', explode(',', (string)@file_get_contents($rlFile))), function ($t) use ($now, $win) { return $t > $now - $win; }))
    : [];
  if (count($hits) >= $max) { http_response_code(429); echo '{"error":"rate limit — try again shortly"}'; exit; }
  $hits[] = $now; @file_put_contents($rlFile, implode(',', $hits), LOCK_EX);

  // --- read body: a JSON envelope {bmf, cover, name, desc, type}, or (legacy) a raw base64(.bmf) string ---
  $input = file_get_contents('php://input');
  if (strlen($input) > 1400000) { http_response_code(413); echo '{"error":"too large"}'; exit; }   // total-body guard
  $env = json_decode($input, true);
  $isEnv = is_array($env) && isset($env['bmf']);
  if ($isEnv) { $b64 = trim((string)$env['bmf']); $coverB64 = (string)($env['cover'] ?? ''); $name = (string)($env['name'] ?? ''); $desc = (string)($env['desc'] ?? ''); $type = (($env['type'] ?? 'w') === 's') ? 's' : 'w'; }
  else        { $b64 = trim($input); $coverB64 = ''; $name = ''; $desc = ''; $type = 'w'; }

  // --- validate the .bmf: base64 of a v3/v4 scene, ≤ 256 KB decoded ---
  $len = strlen($b64);
  if ($len < 4 || $len > 360000) { http_response_code(413); echo '{"error":"size (max 256 KB)"}'; exit; } // 256 KB ≈ 349526 base64 chars
  if (!preg_match('#^[A-Za-z0-9+/=\s]+$#', $b64)) { http_response_code(400); echo '{"error":"bad payload"}'; exit; }
  $raw = base64_decode($b64, true);
  if ($raw === false || strlen($raw) < 2 || strlen($raw) > 262144) { http_response_code(400); echo '{"error":"bad payload"}'; exit; }
  $v = ord($raw[0]); if ($v !== 3 && $v !== 4) { http_response_code(400); echo '{"error":"not a .bmf scene"}'; exit; } // v3/v4 scene version byte

  // --- UPDATE an existing share (the owner presents the edit token) → same id, same share link ---
  $id = (string)($_GET['id'] ?? '');
  if ($id !== '') {
    if (!preg_match('/^[0-9a-f]{6,16}$/', $id)) { http_response_code(400); echo '{"error":"bad id"}'; exit; }
    $bf = $dir . '/' . $id . '.bmf'; $kf = $dir . '/' . $id . '.k';
    if (!is_file($bf) || !is_file($kf)) { http_response_code(404); echo '{"error":"not found or expired"}'; exit; }
    $edit = (string)($_GET['edit'] ?? '');
    if (!hash_equals(trim((string)@file_get_contents($kf)), hash('sha256', $edit))) { http_response_code(403); echo '{"error":"not authorized to update this world"}'; exit; }
    if (@file_put_contents($bf, $raw, LOCK_EX) === false) { http_response_code(500); echo '{"error":"store"}'; exit; }
    @touch($kf);
    if ($isEnv) { if ($coverB64 !== '') gv_store_cover($dir . '/' . $id . '.jpg', $coverB64); gv_store_meta($dir . '/' . $id . '.meta', $name, $desc, $type); }  // keep the old cover if none sent
    echo json_encode(['id' => $id, 'updated' => true]);
    exit;
  }

  // --- CREATE a new share: random unguessable id + an edit token (returned ONCE). Store only the token's HASH. ---
  $id = ''; $bf = '';
  for ($try = 0; $try < 5; $try++) { $id = substr(bin2hex(random_bytes(8)), 0, 12); $bf = $dir . '/' . $id . '.bmf'; if (!file_exists($bf)) break; }
  $edit = bin2hex(random_bytes(16));
  if (@file_put_contents($bf, $raw, LOCK_EX) === false) { http_response_code(500); echo '{"error":"store"}'; exit; }
  @file_put_contents($dir . '/' . $id . '.k', hash('sha256', $edit), LOCK_EX); // hash only → safe even if this file is fetched
  if ($isEnv) { if ($coverB64 !== '') gv_store_cover($dir . '/' . $id . '.jpg', $coverB64); gv_store_meta($dir . '/' . $id . '.meta', $name, $desc, $type); }
  echo json_encode(['id' => $id, 'edit' => $edit]);
  exit;
}

// --- GET ?id=<id> → the raw .bmf bytes; touch mtime = "last viewed" (resets the 12-month clock) ---
$id = (string)($_GET['id'] ?? '');
if (!preg_match('/^[0-9a-f]{6,16}$/', $id)) { http_response_code(400); echo 'bad id'; exit; }
$f = $dir . '/' . $id . '.bmf';
if (!is_file($f)) { http_response_code(404); echo 'not found or expired'; exit; }
@touch($f);
$mf = $dir . '/' . $id . '.meta';                                   // hand the world's NAME back so the game can restore it on load (round-trip)
if (is_file($mf)) { $m = json_decode((string)@file_get_contents($mf), true); if (is_array($m) && !empty($m['n'])) header('X-World-Name: ' . rawurlencode((string)$m['n'])); }
header('Content-Type: application/octet-stream');
header('Content-Length: ' . filesize($f));
header('Cache-Control: public, max-age=3600');
readfile($f);
