<?php
// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
//
// ══ THE ONE GATE EVERY CHAIN CALL ON THIS SITE PASSES THROUGH ════════════════════════════════════
//
// ⚠⚠⚠ THIS IS THE DELIBERATE EXCEPTION TO PAGE-SCRIPT ISOLATION, and the reason is the whole design
// (sun-dive, 20 Aug):
//
//   "as all calls share the same ip, not sharing the same rate limit funnel would make them all fail
//    at the very time they needed to work."
//
// The isolation rule exists to bound BLAST RADIUS and BLOAT, and it is about a PAGE'S LOGIC. This
// file holds no page's logic. It governs a resource that is ALREADY shared — one server IP, one
// per-IP limit at the far end — and a shared resource cannot be bounded by unshared counters.
// Four endpoints each politely limiting themselves to 90 calls is 360 calls from one IP.
//
// ⇒ EVERY NEW PAGE THAT MAKES CHAIN CALLS USES THIS. That is the standing decision, not a suggestion.
//
// ── ★★ WHY A QUEUE AND NOT A LIMITER — and I had this backwards until he corrected it ────────────
//
//   "it does the opposite, it allows request surges to be handled in an orderly way. Without it,
//    they all hang 60s."
//
// The alternative to queueing is not "everyone is fast". It is everyone firing at once, the IP being
// blocked, and every board on the site failing together for the length of the penalty — at exactly
// the moment traffic proved they were wanted. A queue converts a CLIFF into a LINE.
//
// ── HOW IT WORKS ─────────────────────────────────────────────────────────────────────────────────
//
// PHP requests are separate processes, so the state lives in a file under flock().
//
//   1. PACE      at least MIN_INTERVAL between any two calls made by ANY page
//   2. BUDGET    a rolling per-minute ceiling across the whole site
//   3. PENALTY   one 429 anywhere stops everyone until it expires — a blocked IP must never be
//                hammered into a longer block
//   4. GIVE UP   a caller waits at most MAX_WAIT for its turn, then degrades
//
// ★★ THE SLOT IS RESERVED UNDER THE LOCK AND SLEPT FOR OUTSIDE IT. That is what makes this a queue
// rather than a mutex: concurrent requests each take the NEXT timestamp and then wait for their own
// turn independently. Holding the lock while sleeping would serialise every request behind the
// slowest one, which is the thing that actually would make pages hang.
//
// ⚠ BEING BEHIND IS HARMLESS AND IS ALWAYS THE RIGHT TRADE. Every board on this site DERIVES its
// results and every page can follow the chain itself, so a cache that lags a few seconds costs
// nothing. Getting the site's IP banned costs everything. When in doubt this returns null, and null
// already means "we do not know" to every caller.

// ── the dial settings ────────────────────────────────────────────────────────
const WOC_MIN_INTERVAL = 0.35;   // seconds between ANY two calls, site-wide (the browser queue's floor)
const WOC_WINDOW       = 60.0;   // the rolling budget window, in seconds
const WOC_WINDOW_CALLS = 150;    // calls allowed per window across every page
const WOC_MAX_WAIT     = 2.5;    // longest a request will queue for a slot before degrading
const WOC_PENALTY      = 60.0;   // how long a 429 stops everyone
const WOC_REQ_BUDGET   = 90;     // per-request ceiling, so one cold walk cannot eat a whole window

$WOC_BASE     = 'https://api.whatsonchain.com/v1/bsv/main';
$WOC_GATE     = __DIR__ . '/woc-gate.json';
$WOC_REQ      = 0;               // calls made by THIS request
$WOC_LOCAL    = 0.0;             // fallback pacer, used only if the gate file is unusable

/**
 * Reserve the next slot. Returns the timestamp this caller may fire at, or null to degrade.
 *
 * ⚠ THE STATE FILE IS NOT A CACHE — losing it loses the queue. If it cannot be opened we do NOT
 * fail closed (that would take every board down over a file permission), and we do not fail wide
 * open either. We fall back to pacing THIS request locally, which is what each file did before this
 * existed: degraded, never dead, never unbounded.
 */
function woc_slot() {
  global $WOC_GATE, $WOC_REQ, $WOC_LOCAL;

  if ($WOC_REQ >= WOC_REQ_BUDGET) return null;      // this request has had its share

  $now = microtime(true);
  $fh  = @fopen($WOC_GATE, 'c+');
  if (!$fh || !@flock($fh, LOCK_EX)) {
    if ($fh) @fclose($fh);
    /* ⚠ degraded: no cross-process queue, but still paced within this request */
    $wait = WOC_MIN_INTERVAL - ($now - $WOC_LOCAL);
    if ($wait > WOC_MAX_WAIT) return null;
    if ($wait > 0) usleep((int)($wait * 1000000));
    $WOC_LOCAL = microtime(true); $WOC_REQ++;
    return $WOC_LOCAL;
  }

  $raw = stream_get_contents($fh);
  $s   = $raw ? json_decode($raw, true) : null;
  if (!is_array($s)) $s = [];
  $last    = (float)($s['last'] ?? 0);
  $wStart  = (float)($s['window_start'] ?? 0);
  $wCalls  = (int)  ($s['window_calls'] ?? 0);
  $blocked = (float)($s['blocked_until'] ?? 0);

  $slot = null;
  if ($now < $blocked) {
    /* ⚠ EVERYONE degrades together, and they degrade FAST rather than queueing behind a block. */
    $slot = null;
  } else {
    if ($now - $wStart >= WOC_WINDOW) { $wStart = $now; $wCalls = 0; }   // roll the window
    if ($wCalls < WOC_WINDOW_CALLS) {
      /* ★ TAKE THE NEXT TICKET. Whoever holds the lock claims the next timestamp, so two requests
         arriving together get t and t+0.35 rather than both firing at t. */
      $t = max($now, $last + WOC_MIN_INTERVAL);
      if ($t - $now <= WOC_MAX_WAIT) {
        $slot = $t; $last = $t; $wCalls++;
      }
    }
  }

  $s = ['last' => $last, 'window_start' => $wStart, 'window_calls' => $wCalls, 'blocked_until' => $blocked];
  @ftruncate($fh, 0); @rewind($fh); @fwrite($fh, json_encode($s)); @fflush($fh);
  @flock($fh, LOCK_UN); @fclose($fh);

  if ($slot === null) return null;

  /* ★ THE WAIT HAPPENS AFTER THE LOCK IS RELEASED — see the note at the top. */
  $sleep = $slot - microtime(true);
  if ($sleep > 0) usleep((int)($sleep * 1000000));
  $WOC_REQ++;
  return $slot;
}

/** A relay said no. Stop the WHOLE SITE for the penalty, not just this request. */
function woc_penalise() {
  global $WOC_GATE;
  $fh = @fopen($WOC_GATE, 'c+'); if (!$fh) return;
  if (@flock($fh, LOCK_EX)) {
    $raw = stream_get_contents($fh); $s = $raw ? json_decode($raw, true) : null;
    if (!is_array($s)) $s = [];
    $s['blocked_until'] = microtime(true) + WOC_PENALTY;
    @ftruncate($fh, 0); @rewind($fh); @fwrite($fh, json_encode($s)); @fflush($fh);
    @flock($fh, LOCK_UN);
  }
  @fclose($fh);
}

/**
 * GET a path under the WoC base. Returns [$code, $body] — or [null, null] if the gate refused.
 * ⚠ CALLERS MUST TREAT null AS "WE DO NOT KNOW", never as an answer. A throttled 404-check is not
 * an "unspent"; a throttled history is not "the chain ends here". That mistake reported a one-race
 * leaderboard as complete on 20 Aug, and being throttled looked exactly like being finished.
 */
function woc_raw($path, $ua = 'grafverse/1', $json = true) {
  global $WOC_BASE;
  if (woc_slot() === null) return [null, null];
  $ch = curl_init($WOC_BASE . $path);
  $opt = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_USERAGENT => $ua];
  if ($json) $opt[CURLOPT_HTTPHEADER] = ['Accept: application/json'];
  curl_setopt_array($ch, $opt);
  $out  = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($code === 429 || $code === 403) { woc_penalise(); return [$code, null]; }
  return [$code, $out === false ? null : $out];
}

/** the common case: decoded JSON, or null for anything that is not a clean 200 */
function woc_json($path, $ua = 'grafverse/1') {
  [$code, $out] = woc_raw($path, $ua, true);
  if ($code !== 200 || $out === null) return null;
  $j = json_decode($out, true);
  return is_array($j) ? $j : null;
}

/** the status-code case (a /spent check is answered by 404 vs 200). null = we do not know. */
function woc_status($path, $ua = 'grafverse/1') {
  [$code, ] = woc_raw($path, $ua, false);
  return $code === null ? null : (int)$code;
}

/** true once a relay has rate-limited us — callers can stop walking rather than keep asking. */
function woc_blocked() {
  global $WOC_GATE;
  $raw = @file_get_contents($WOC_GATE); if (!$raw) return false;
  $s = json_decode($raw, true);
  return is_array($s) && microtime(true) < (float)($s['blocked_until'] ?? 0);
}
