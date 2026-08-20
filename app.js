// ---- Point this at your Spin backend ----
const API_BASE = "http://localhost:5000";

const el = (id) => document.getElementById(id);

const state = {
  tracks: [],
  currentTrack: null,
  isPlaying: false,
};

const audio = el("audioEl");

// ---------------------------------------------------------------- utils --

function fmtTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmtAgo(unixSeconds) {
  if (!unixSeconds) return "Never synced";
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 3600) return `Synced ${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `Synced ${Math.round(diff / 3600)}h ago`;
  return `Synced ${Math.round(diff / 86400)}d ago`;
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- library --

async function loadLibrary(query = "") {
  const q = query ? `?q=${encodeURIComponent(query)}` : "";
  try {
    state.tracks = await api(`/api/library${q}`);
  } catch (e) {
    state.tracks = [];
  }
  renderTracks();
}

function renderTracks() {
  const grid = el("trackGrid");
  const empty = el("emptyState");

  if (state.tracks.length === 0) {
    grid.hidden = true;
    empty.hidden = false;
    return;
  }
  grid.hidden = false;
  empty.hidden = true;

  grid.innerHTML = "";
  for (const t of state.tracks) {
    const card = document.createElement("div");
    card.className = "track-card";
    if (state.currentTrack && state.currentTrack.id === t.id) {
      card.classList.add("is-playing");
    }

    const ready = !!t.file_path;
    card.innerHTML = `
      <div class="track-art">
        <img src="${t.artwork_url || ""}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="track-badge ${ready ? "ready" : ""}" title="${ready ? "Downloaded" : "Pending download"}"></div>
      </div>
      <div class="track-info">
        <div class="track-title">${escapeHtml(t.title)}</div>
        <div class="track-sub">${escapeHtml(t.artist)}</div>
      </div>
    `;

    if (ready) {
      card.addEventListener("click", () => playTrack(t));
    } else {
      card.style.opacity = "0.55";
      card.style.cursor = "default";
    }
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

// ---------------------------------------------------------------- player --

function playTrack(track) {
  state.currentTrack = track;
  audio.src = `${API_BASE}/api/stream/${encodeURIComponent(track.id)}`;
  audio.play();
  el("nowPlaying").hidden = false;
  el("npTitle").textContent = track.title;
  el("npArtist").textContent = track.artist;
  el("npArt").src = track.artwork_url || "";
  renderTracks();
}

function setPlayingUI(playing) {
  state.isPlaying = playing;
  el("iconPlay").hidden = playing;
  el("iconPause").hidden = !playing;
  el("npDisc").classList.toggle("is-spinning", playing);
  el("npTonearm").classList.toggle("is-down", playing);
}

audio.addEventListener("play", () => setPlayingUI(true));
audio.addEventListener("pause", () => setPlayingUI(false));
audio.addEventListener("ended", () => setPlayingUI(false));

audio.addEventListener("timeupdate", () => {
  el("npCurrent").textContent = fmtTime(audio.currentTime);
  el("npDuration").textContent = fmtTime(audio.duration);
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  el("npFill").style.width = `${pct}%`;
});

el("npPlayBtn").addEventListener("click", () => {
  if (!state.currentTrack) return;
  audio.paused ? audio.play() : audio.pause();
});

// ---------------------------------------------------------------- search --

let searchTimer;
el("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadLibrary(e.target.value), 250);
});

// ---------------------------------------------------------------- status --

async function refreshStatus() {
  try {
    const [authStatus, syncStatus] = await Promise.all([
      api("/api/auth/status"),
      api("/api/status"),
    ]);

    const dot = el("connectionDot");
    const label = el("connectionLabel");
    if (authStatus.linked) {
      dot.className = "status-dot ok";
      label.textContent = "Apple Music connected";
      el("connectBtn").textContent = "Reconnect";
    } else {
      dot.className = "status-dot off";
      label.textContent = "Not connected";
      el("connectBtn").textContent = "Connect Apple Music";
    }

    el("trackCounts").textContent =
      `${syncStatus.downloaded_tracks}/${syncStatus.total_tracks} tracks downloaded`;
    el("lastSync").textContent = syncStatus.sync_running
      ? "Sync running…"
      : fmtAgo(syncStatus.last_sync_at);
  } catch (e) {
    el("connectionLabel").textContent = "Can't reach Spin backend";
    el("connectionDot").className = "status-dot off";
  }
}

el("syncBtn").addEventListener("click", async () => {
  try {
    await api("/api/sync", { method: "POST" });
    el("lastSync").textContent = "Sync running…";
  } catch (e) {
    // likely already running
  }
});

// ---------------------------------------------------------------- MusicKit --

let musicKitInstance = null;

async function initMusicKit() {
  try {
    const { token } = await api("/api/auth/developer-token");
    await MusicKit.configure({
      developerToken: token,
      app: { name: "Spin", build: "1.0.0" },
    });
    musicKitInstance = MusicKit.getInstance();
  } catch (e) {
    console.warn("MusicKit init failed — is the backend configured?", e);
  }
}

el("connectBtn").addEventListener("click", async () => {
  if (!musicKitInstance) await initMusicKit();
  if (!musicKitInstance) {
    alert("Couldn't reach the Spin backend to start authorization. Check that it's running and configured.");
    return;
  }
  try {
    const musicUserToken = await musicKitInstance.authorize();
    await api("/api/auth/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicUserToken }),
    });
    refreshStatus();
  } catch (e) {
    alert("Apple Music authorization failed or was cancelled.");
  }
});

// ---------------------------------------------------------------- boot --

initMusicKit();
loadLibrary();
refreshStatus();
setInterval(refreshStatus, 15000);
setInterval(() => loadLibrary(el("searchInput").value), 30000);
