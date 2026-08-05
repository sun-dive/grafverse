<?php
// grafspace — © 2026 sun-dive — Licensed under the Business Source License 1.1 (see LICENSE).
// grafspace SHARED WORLDS — a persistent, public store for FREE worlds shared over Web2.
//   POST  base64(.bmf)      → { "id": "<short id>" }        (share a world)
//   GET   ?id=<id>          → the raw .bmf bytes            (open a shared world)
// A world auto-expires 12 months after its LAST VIEW (last view = the file mtime, touched on every GET).
// Free channel only: no accounts, no keys. Owned paint inside a world is still a txid reference — the file
// never carries owned bytes, so sharing here can't pirate paid work (the acquire gate runs in the game/wallet).
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
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

$dir = __DIR__ . '/worlds';
if (!is_dir($dir)) @mkdir($dir, 0755, true);

$TTL = 365 * 24 * 3600; // ~12 months of no view; mtime is "last viewed" (touched on GET)
foreach (@glob($dir . '/*.bmf') ?: [] as $f) { if (@filemtime($f) < time() - $TTL) { @unlink($f); @unlink(substr($f, 0, -4) . '.k'); } } // opportunistic sweep (world + its edit-key hash)

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

  // --- validate the payload: base64 TEXT of a .bmf scene, ≤ 256 KB decoded ---
  $b64 = trim(file_get_contents('php://input'));
  $len = strlen($b64);
  if ($len < 4 || $len > 360000) { http_response_code(413); echo '{"error":"size (max 256 KB)"}'; exit; } // 256 KB ≈ 349526 base64 chars
  if (!preg_match('#^[A-Za-z0-9+/=\s]+$#', $b64)) { http_response_code(400); echo '{"error":"bad payload"}'; exit; }
  $raw = base64_decode($b64, true);
  if ($raw === false || strlen($raw) < 2 || strlen($raw) > 262144) { http_response_code(400); echo '{"error":"bad payload"}'; exit; }
  $v = ord($raw[0]); if ($v !== 3 && $v !== 4) { http_response_code(400); echo '{"error":"not a .bmf scene"}'; exit; } // v3/v4 scene version byte

  // --- UPDATE an existing world (the owner presents the edit token) → same id, same share link ---
  $id = (string)($_GET['id'] ?? '');
  if ($id !== '') {
    if (!preg_match('/^[0-9a-f]{6,16}$/', $id)) { http_response_code(400); echo '{"error":"bad id"}'; exit; }
    $bf = $dir . '/' . $id . '.bmf'; $kf = $dir . '/' . $id . '.k';
    if (!is_file($bf) || !is_file($kf)) { http_response_code(404); echo '{"error":"not found or expired"}'; exit; }
    $edit = (string)($_GET['edit'] ?? '');
    if (!hash_equals(trim((string)@file_get_contents($kf)), hash('sha256', $edit))) { http_response_code(403); echo '{"error":"not authorized to update this world"}'; exit; }
    if (@file_put_contents($bf, $raw, LOCK_EX) === false) { http_response_code(500); echo '{"error":"store"}'; exit; }
    @touch($kf);
    echo json_encode(['id' => $id, 'updated' => true]);
    exit;
  }

  // --- CREATE a new world: random unguessable id + an edit token (returned ONCE). Store only the token's HASH. ---
  $id = ''; $bf = '';
  for ($try = 0; $try < 5; $try++) { $id = substr(bin2hex(random_bytes(8)), 0, 12); $bf = $dir . '/' . $id . '.bmf'; if (!file_exists($bf)) break; }
  $edit = bin2hex(random_bytes(16));
  if (@file_put_contents($bf, $raw, LOCK_EX) === false) { http_response_code(500); echo '{"error":"store"}'; exit; }
  @file_put_contents($dir . '/' . $id . '.k', hash('sha256', $edit), LOCK_EX); // hash only → safe even if this file is fetched
  echo json_encode(['id' => $id, 'edit' => $edit]);
  exit;
}

// --- GET ?id=<id> → the raw .bmf bytes; touch mtime = "last viewed" (resets the 12-month clock) ---
$id = (string)($_GET['id'] ?? '');
if (!preg_match('/^[0-9a-f]{6,16}$/', $id)) { http_response_code(400); echo 'bad id'; exit; }
$f = $dir . '/' . $id . '.bmf';
if (!is_file($f)) { http_response_code(404); echo 'not found or expired'; exit; }
@touch($f);
header('Content-Type: application/octet-stream');
header('Content-Length: ' . filesize($f));
header('Cache-Control: public, max-age=3600');
readfile($f);
