<?php
// grafspace atom handoff — a transient bridge between the GAME (packs a binary BMF atom and POSTs it here)
// and the WALLET (fetches it by id to mint). One short-lived blob per id; no chain, no keys, no accounts.
// Mirrors nft.gift/save.php. The wallet may live on a SUBDOMAIN (key isolation), so cross-origin GET is
// allowed for an allow-listed set of wallet origins.
header('X-Content-Type-Options: nosniff');

$ALLOW = [
  'https://wallet.grafverse.com', 'https://wallet.grafspace.com',
  'https://grafverse.com', 'https://grafspace.com',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $ALLOW, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

$TTL = 3600; // handoffs live one hour, then get swept
$dir = __DIR__ . '/atoms';
if (!is_dir($dir)) @mkdir($dir, 0755, true);
foreach (@glob($dir . '/*.json') ?: [] as $f) { if (@filemtime($f) < time() - $TTL) @unlink($f); } // opportunistic cleanup

header('Content-Type: application/json; charset=utf-8');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
  // Body = BASE64 of the packed BMF bytes (base64 TEXT, not raw binary — raw-binary POSTs trip shared-host
  // WAFs / ModSecurity with a 403). Optional ?name= is a suggested title (the wallet can override it).
  $b64 = trim(file_get_contents('php://input'));
  $len = strlen($b64);
  if ($len < 4 || $len > 3000000) { http_response_code(413); echo '{"error":"size"}'; exit; } // base64 ≈ 1.33× bytes
  if (!preg_match('#^[A-Za-z0-9+/=\s]+$#', $b64) || base64_decode($b64, true) === false) { http_response_code(400); echo '{"error":"bad payload"}'; exit; }
  $name = isset($_GET['name']) ? substr(preg_replace('/[\x00-\x1f\x7f]/', '', (string)$_GET['name']), 0, 80) : '';
  $id = substr(bin2hex(random_bytes(8)), 0, 12);
  $rec = json_encode(['name' => $name, 'b64' => $b64, 'ts' => time()]);
  if (@file_put_contents($dir . '/' . $id . '.json', $rec, LOCK_EX) === false) { http_response_code(500); echo '{"error":"store"}'; exit; }
  echo json_encode(['id' => $id]);
  exit;
}

// GET ?id=<id>  →  { "bytes":[…], "name":"…" }  (the byte array the wallet expects)
$id = (string)($_GET['id'] ?? '');
if (!preg_match('/^[0-9a-f]{6,16}$/', $id)) { http_response_code(400); echo '{"error":"bad id"}'; exit; }
$f = $dir . '/' . $id . '.json';
if (!is_file($f) || @filemtime($f) < time() - $TTL) { http_response_code(404); echo '{"error":"not found or expired"}'; exit; }
$rec = json_decode(@file_get_contents($f), true);
if (!is_array($rec) || !isset($rec['b64'])) { http_response_code(500); echo '{"error":"corrupt"}'; exit; }
$raw = base64_decode($rec['b64'], true);
if ($raw === false || $raw === '') { http_response_code(500); echo '{"error":"decode"}'; exit; }
echo json_encode(['bytes' => array_values(unpack('C*', $raw)), 'name' => $rec['name'] ?? '']);
