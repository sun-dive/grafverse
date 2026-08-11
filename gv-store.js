/* grafverse — world store · © 2026 sun-dive — Licensed under the Business Source License 1.1 (see LICENSE).
 *
 * THREE TIERS, deliberately separate:
 *   worlds/  the places   — one record per world (the output of serializeWorld())
 *   covers/  what they look like — one WebP Blob per world (Phase 3; the store is created now so no version bump later)
 *   player/  who you are  — paint inventory + the player-centric items yet to come. NEVER folded into a world:
 *                           a world is a place, the player is who walks into it, and your cans travel with you.
 *
 * WHY IndexedDB: worlds are unbounded (every stroke's dabs) and there is no slot cap any more. localStorage is one
 * ~5 MB bucket for the whole origin, is synchronous (a multi-MB write blocks a frame mid-paint), and stores strings
 * only (binary covers would cost +33% as base64). IndexedDB has none of those limits and stores objects and Blobs
 * natively — no JSON.stringify on the hot path.
 *
 * WHY a localStorage INDEX as well: two boot decisions must run BEFORE anything paints and cannot await —
 * "cold open or returning player?" (grafverse.html) and "show ↩ Resume?" (index.html). The index is a tiny
 * (~80 bytes/world) synchronous mirror that answers them. IndexedDB is ALWAYS the source of truth; if the two
 * ever disagree, IndexedDB wins and the index is rebuilt from it.
 *
 * NOTHING IS EVER DESTROYED HERE. The legacy 9-slot keys are copied, never deleted — a later release removes them.
 */
(function(){
  "use strict";

  var DB='grafverse', DBV=1;
  var S_WORLDS='worlds', S_COVERS='covers', S_PLAYER='player';

  var IDX_KEY  = 'grafverse-index';        // [{id,name,updated,shapes,bytes}] — the sync mirror
  var CUR_KEY  = 'grafverse-cur-id';       // id of the world currently open
  var PEND_KEY = 'grafverse-idb-pending';  // [{id,legacy}] — legacy payloads not yet copied into IndexedDB
  var MIG_KEY  = 'grafverse-migrated';     // '1' once every pending payload landed

  // the 9 fixed slots we are migrating away from (slot 0 kept the original key)
  var LEGACY = ['grafverse-world-v1','grafverse-world-s1','grafverse-world-s2','grafverse-world-s3','grafverse-world-s4',
                'grafverse-world-s5','grafverse-world-s6','grafverse-world-s7','grafverse-world-s8'];
  var LEGACY_CUR = 'grafverse-cur';        // old slot NUMBER (0..8) — left in place, never written
  var LEGACY_INV = 'grafverse-inv-v1';     // old global inventory key

  var BOOT_MS = 2500;                      // never let a wedged IndexedDB stop the game booting

  // ---------- tiny localStorage helpers (never throw) ----------
  function lsGet(k, dflt){ try{ var s=localStorage.getItem(k); return s==null ? dflt : JSON.parse(s); }catch(e){ return dflt; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  function lsRaw(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

  // ---------- IndexedDB (same 3-call shape the wallet uses; resolves null on failure, never rejects) ----------
  var _db=null, idbOK=true;
  function idbOpen(){
    if(_db) return Promise.resolve(_db);
    return new Promise(function(res, rej){
      var r; try{ r=indexedDB.open(DB, DBV); }catch(e){ return rej(e); }
      r.onupgradeneeded=function(){ var d=r.result;
        if(!d.objectStoreNames.contains(S_WORLDS)) d.createObjectStore(S_WORLDS);
        if(!d.objectStoreNames.contains(S_COVERS)) d.createObjectStore(S_COVERS);
        if(!d.objectStoreNames.contains(S_PLAYER)) d.createObjectStore(S_PLAYER); };
      r.onsuccess=function(){ _db=r.result; res(_db); };
      r.onerror=function(){ rej(r.error); };
    });
  }
  function idbGet(store, k){
    return idbOpen().then(function(db){ return new Promise(function(res){
      var q=db.transaction(store).objectStore(store).get(k);
      q.onsuccess=function(){ res(q.result==null?null:q.result); }; q.onerror=function(){ res(null); };
    }); }).catch(function(){ idbOK=false; return null; });
  }
  function idbPut(store, k, v){
    return idbOpen().then(function(db){ return new Promise(function(res, rej){
      var t=db.transaction(store,'readwrite'); t.objectStore(store).put(v, k);
      t.oncomplete=function(){ res(true); }; t.onerror=function(){ rej(t.error); }; t.onabort=function(){ rej(t.error); };
    }); });
  }
  function idbDel(store, k){
    return idbOpen().then(function(db){ return new Promise(function(res){
      var t=db.transaction(store,'readwrite'); t.objectStore(store).delete(k);
      t.oncomplete=function(){ res(true); }; t.onerror=function(){ res(false); };
    }); }).catch(function(){ return false; });
  }

  // ---------- fallback: IndexedDB unavailable (private mode / ancient browser) → keep playing on localStorage ----------
  function fbKey(id){ return 'grafverse-w-'+id; }
  function putWorld(id, rec){ return idbPut(S_WORLDS, id, rec).catch(function(e){
      idbOK=false; if(!lsSet(fbKey(id), rec)) throw e; return true; }); }
  function getWorld(id){
    return idbGet(S_WORLDS, id).then(function(v){ return v!=null ? v : lsGet(fbKey(id), null); });
  }

  // ---------- world records ----------
  function filled(d){ return !!(d && ((d.shapes && d.shapes.length) || (d.ground && d.ground.length))); }
  var _idN=0;
  function newId(){ return 'w_'+Date.now().toString(36)+'_'+(_idN++).toString(36)+Math.random().toString(36).slice(2,5); }

  // ---------- the index (synchronous mirror) ----------
  function idx(){ var a=lsGet(IDX_KEY, null); return Array.isArray(a)?a:[]; }
  function idxSet(a){ lsSet(IDX_KEY, a); }
  function idxFind(a, id){ for(var i=0;i<a.length;i++) if(a[i] && a[i].id===id) return i; return -1; }
  function idxWrite(id, rec, bytes){
    var a=idx(), i=idxFind(a, id);
    var e={ id:id, name:(rec&&rec.name)||'', updated:(rec&&rec.updated)||Date.now(),
            shapes:(rec&&rec.shapes&&rec.shapes.length)||0 };
    if(bytes!=null) e.bytes=bytes; else if(i>=0 && a[i].bytes!=null) e.bytes=a[i].bytes;   // keep the last measurement
    if(i>=0) a[i]=e; else a.push(e);
    idxSet(a); return e;
  }
  function idxDrop(id){ var a=idx(), i=idxFind(a,id); if(i>=0){ a.splice(i,1); idxSet(a); } }

  // ---------- migration: 9 fixed slots → ids. Step 1 is SYNCHRONOUS (legacy keys are still right there), so the
  //            boot decisions have an index immediately; step 2 copies payloads into IndexedDB in the background. ----------
  function ensureIndexSync(){
    if(lsRaw(IDX_KEY)!=null) return;                                  // already migrated (or a fresh install below)
    var a=[], pend=[], curId='', legacyCur=parseInt(lsRaw(LEGACY_CUR),10);
    if(!(legacyCur>=0 && legacyCur<LEGACY.length)) legacyCur=0;
    for(var n=0;n<LEGACY.length;n++){
      var raw=lsRaw(LEGACY[n]); if(raw==null) continue;
      var d=null; try{ d=JSON.parse(raw); }catch(e){ d=null; }
      if(!filled(d)) continue;                                        // empty slots carry nothing — don't manufacture blank worlds
      var id=newId();
      a.push({ id:id, name:d.name||'', updated:d.updated||Date.now(), shapes:(d.shapes&&d.shapes.length)||0, bytes:raw.length });
      pend.push({ id:id, legacy:LEGACY[n] });
      if(n===legacyCur) curId=id;                                     // the slot they were last in stays the slot they're in
    }
    idxSet(a); lsSet(PEND_KEY, pend);
    // Their current slot was empty (or this is a fresh install): open a brand-new world. It enters the index the
    // moment it has content — so the shelf never shows a blank card, and a never-painted world costs nothing.
    if(!curId) curId=newId();
    lsSet(CUR_KEY, curId);
    if(!pend.length) lsSet(MIG_KEY, 1);
  }
  function migratePayloads(){                                          // step 2 — background, idempotent, non-destructive
    var pend=lsGet(PEND_KEY, []); if(!Array.isArray(pend) || !pend.length){ lsSet(MIG_KEY,1); return Promise.resolve(); }
    var left=pend.slice();
    return pend.reduce(function(p, ent){
      return p.then(function(){
        var d=lsGet(ent.legacy, null); if(!filled(d)) { left=left.filter(function(x){ return x.id!==ent.id; }); return; }
        return putWorld(ent.id, d).then(function(){
          left=left.filter(function(x){ return x.id!==ent.id; }); lsSet(PEND_KEY, left);   // checkpoint each one
        });
      }).catch(function(){ /* leave it pending — the legacy key is still there, so nothing is lost */ });
    }, Promise.resolve()).then(function(){
      if(!left.length){ lsSet(MIG_KEY,1); }
      else if(GVStore.onError) GVStore.onError('migrate', left.length+' world(s) still to copy');
    });
  }
  function pendingLegacyKey(id){
    var pend=lsGet(PEND_KEY, []); if(!Array.isArray(pend)) return null;
    for(var i=0;i<pend.length;i++) if(pend[i] && pend[i].id===id) return pend[i].legacy;
    return null;
  }

  // ---------- preloaded state (so the game's own load path stays synchronous) ----------
  var _curId='', _cur=null, _player={}, _booted=false;

  /* ONE place decides which world opens. The intent comes from the entry URL (?go=new / ?go=resume) and is resolved
     against the index — which only ever contains worlds that HAVE CONTENT. That makes Resume mean "the world as you
     left it" rather than "whatever a pointer happens to say", so no navigation accident can strand your work. */
  function resolveIntent(intent){
    if(intent==='new'){                                             // ▶ Click to Begin is ALWAYS a genuine new world.
      _curId=newId(); lsSet(CUR_KEY,_curId);                        // No conditions, no index lookup: an empty world costs
      return;                                                       // nothing (it is never stored or listed until painted).
    }
    if(intent==='resume'){
      var a = GVStore.index();                                      // newest-first, CONTENT ONLY (see save())
      if(idxFind(idx(), _curId) < 0 && a.length){ _curId=a[0].id; lsSet(CUR_KEY,_curId); }   // pointer points at nothing → your latest real work
    }
  }

  function boot(opts){
    ensureIndexSync();
    _curId = lsGet(CUR_KEY, '') || '';
    if(!_curId){ _curId=newId(); lsSet(CUR_KEY, _curId); }
    try{ resolveIntent(opts && opts.intent); }catch(e){}
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}   // ask the browser not to evict us

    var work = Promise.all([
      getWorld(_curId).then(function(w){
        if(w) { _cur=w; return; }
        var lk=pendingLegacyKey(_curId);                               // first boot: the payload may still only be in localStorage
        if(lk) _cur=lsGet(lk, null);
      }).catch(function(){ _cur=null; }),
      idbGet(S_PLAYER, 'inventory').then(function(v){
        _player.inventory = Array.isArray(v) ? v : (lsGet(LEGACY_INV, []) || []);   // migrate the global inventory key across
      }).catch(function(){ _player.inventory = lsGet(LEGACY_INV, []) || []; })
    ]).then(function(){ _booted=true; migratePayloads(); });

    // A wedged IndexedDB must never stop the game booting — fall back to whatever localStorage still holds.
    return Promise.race([ work, new Promise(function(res){ setTimeout(res, BOOT_MS); }) ]).then(function(){
      if(!_booted){
        idbOK=false;
        if(!_cur){ var lk=pendingLegacyKey(_curId); if(lk) _cur=lsGet(lk,null); if(!_cur) _cur=lsGet(fbKey(_curId), null); }
        if(!_player.inventory) _player.inventory = lsGet(LEGACY_INV, []) || [];
        if(GVStore.onError) GVStore.onError('boot','storage was slow — running on the local copy');
      }
      return true;
    });
  }

  // ---------- the API the game uses ----------
  var _saveSeq=0;
  var GVStore = {
    onError: null,                       // set by the game → surfaces a visible hint. Storage failures are NEVER silent.

    boot: boot,
    ok: function(){ return idbOK; },

    currentId: function(){ return _curId; },
    current: function(){ return _cur; },                                  // SYNC — the preloaded world record (or null)
    currentHasContent: function(){ return filled(_cur); },

    index: function(){ return idx().slice().sort(function(a,b){ return (b.updated||0)-(a.updated||0); }); },
    hasAnyWorld: function(){ return idx().length>0; },

    setCurrent: function(id){ _curId=id; lsSet(CUR_KEY, id); _cur=null; },
    newWorld: function(){ var id=newId(); GVStore.setCurrent(id); return id; },   // no slot cap: a new world is always genuinely new

    /* Save the open world. The synchronous half (in-memory record + index) lands immediately so every sync reader
       stays correct; only the IndexedDB write is async. Fire-and-forget by design — call sites need no await. */
    save: function(rec, opts){
      if(!rec) return Promise.resolve(false);
      _cur=rec;
      var bytes=null;
      if(opts && opts.measure){ try{ bytes=JSON.stringify(rec).length; }catch(e){} }   // only on the exit save — a full stringify is not a hot-path cost
      /* THE INDEX LISTS ONLY WORLDS THAT ARE REAL — i.e. that have paint. "Paint to make it real" is a storage law,
         not just a tagline: an unpainted world is a ghost, and must never appear in the library, be offered by
         ↩ Resume, or be mistaken for work in progress. */
      var wasReal = idxFind(idx(), _curId) >= 0;
      if(filled(rec)) idxWrite(_curId, rec, bytes);
      else idxDrop(_curId);
      // A never-painted world is not written at all — ▶ Begin can then be pressed all day without littering storage.
      // One that HAD content still writes when emptied, so deleting every shape actually persists.
      if(!filled(rec) && !wasReal) return Promise.resolve(true);
      var seq=++_saveSeq;
      return putWorld(_curId, rec).then(function(){ return true; }).catch(function(e){
        if(seq===_saveSeq && GVStore.onError) GVStore.onError('save', (e && e.name==='QuotaExceededError') ? 'storage is full' : 'could not save your world');
        return false;
      });
    },
    load: function(id){ return getWorld(id); },                            // async — for the library (Phase 3)
    remove: function(id){ idxDrop(id); return Promise.all([ idbDel(S_WORLDS,id), idbDel(S_COVERS,id) ]).then(function(){
        try{ localStorage.removeItem(fbKey(id)); }catch(e){} return true; }); },

    cover: function(id){ return idbGet(S_COVERS, id); },                   // Phase 3
    setCover: function(id, blob){ return idbPut(S_COVERS, id, blob).catch(function(){ return false; }); },

    /* player tier — travels with the player, never stored in a world */
    player: function(k){ return _player[k]; },                             // SYNC (preloaded)
    setPlayer: function(k, v){ _player[k]=v; return idbPut(S_PLAYER, k, v).catch(function(){ return false; }); }
  };

  window.GVStore = GVStore;
})();
