/* California Water Quality — app.js */

(function () {
  'use strict';

  // --- State ---
  let systems = [];       // all systems from summary JSON
  let contaminantDict = {};  // plain-language contaminant info
  let unitLabels = {};       // raw unit → readable unit
  let meta = null;           // data freshness metadata
  let map = null;
  let activePopup = null;
  let panelState = 'closed';  // closed | peek | open

  // --- Status helpers ---
  const STATUS_COLORS = {
    'In Compliance':      '#1a8c3f',
    'Potentially At-Risk': '#d4a017',
    'At-Risk':            '#d45317',
    'Failing':            '#c62828',
    'Not Assessed':       '#78909c',
  };

  function statusColor(status) {
    return STATUS_COLORS[status] || '#78909c';
  }

  function statusClass(status) {
    if (status === 'In Compliance') return 'status-compliance';
    if (status === 'Failing') return 'status-failing';
    if (status === 'At-Risk' || status === 'Potentially At-Risk') return 'status-at-risk';
    return 'status-unknown';
  }

  function statusLabel(status) {
    if (status === 'In Compliance') return 'Meets safety standards';
    if (status === 'Failing') return 'Failing to meet standards';
    if (status === 'At-Risk') return 'At risk';
    if (status === 'Potentially At-Risk') return 'Potentially at risk';
    return 'Not yet assessed';
  }

  // Derive status from MCL data when SAFER assessment is missing
  function deriveStatus(status, nExceed, nTested) {
    if (status !== 'Not Assessed') return status;
    if (nExceed > 0) return 'Failing';
    if (nTested > 0) return 'In Compliance';
    return 'Not Assessed';
  }

  // --- Format helpers ---
  function fmtPop(n) {
    if (!n) return 'N/A';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return n.toLocaleString();
  }

  // Words that should stay uppercase in system/county names
  var ABBR_KEEP = ['CWD', 'CSD', 'MWC', 'MUD', 'PUD', 'WD', 'WC', 'ID', 'DWP', 'PWD', 'MWD', 'IID', 'IRWD', 'EBMUD', 'SFPUC', 'LADWP', 'HOA', 'LLC', 'LP', 'MHP', 'RV', 'II', 'III', 'IV'];
  var abbrSet = {};
  ABBR_KEEP.forEach(function (a) { abbrSet[a] = true; });

  // Small words that stay lowercase (unless first word)
  var SMALL_WORDS = { 'of': true, 'the': true, 'and': true, 'at': true, 'in': true, 'for': true, 'de': true, 'del': true, 'la': true, 'el': true, 'los': true, 'las': true };

  function titleCase(s) {
    if (!s) return '';
    return s.replace(/\w\S*/g, function (t, offset) {
      var upper = t.toUpperCase();
      if (abbrSet[upper]) return upper;
      var lower = t.toLowerCase();
      if (offset > 0 && SMALL_WORDS[lower]) return lower;
      return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase();
    });
  }

  // --- Contaminant display helpers ---
  function contaminantName(rawName) {
    var entry = contaminantDict[rawName];
    if (entry && entry.display) return entry.display;
    return titleCase(rawName);
  }

  function contaminantInfo(rawName) {
    return contaminantDict[rawName] || null;
  }

  function fmtUnits(rawUnits) {
    return unitLabels[rawUnits] || rawUnits;
  }

  // --- Data loading ---
  async function loadContaminantDict() {
    try {
      var resp = await fetch('data/contaminant_dict.json');
      var data = await resp.json();
      // Separate units from contaminant entries
      unitLabels = data._units || {};
      delete data._units;
      contaminantDict = data;
    } catch (err) {
      console.warn('Contaminant dictionary not loaded:', err);
    }
  }

  function fmtDate(isoStr) {
    if (!isoStr) return '';
    var parts = isoStr.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  async function loadMeta() {
    try {
      var resp = await fetch('data/meta.json');
      meta = await resp.json();
    } catch (err) {
      console.warn('meta.json not loaded:', err);
    }
  }

  async function loadSystems() {
    const resp = await fetch('data/systems_summary.json');
    systems = await resp.json();
    return systems;
  }

  async function loadSystemDetail(id) {
    // id is like CA0110001, file is 0110001.json (strip CA prefix)
    const fileId = id.replace(/^CA/, '');
    const resp = await fetch('data/systems/' + fileId + '.json');
    return resp.json();
  }

  // --- Build GeoJSON from systems ---
  function systemsToGeoJSON(data) {
    return {
      type: 'FeatureCollection',
      features: data
        .filter(function (s) { return s.lat && s.lon; })
        .map(function (s) {
          var status = deriveStatus(s.status, s.n_exceed || 0, s.n_tested || 0);
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: {
              id: s.id,
              name: s.name,
              county: s.county,
              pop: s.pop || 0,
              status: status,
              n_exceed: s.n_exceed || 0,
              n_tested: s.n_tested || 0,
              color: statusColor(status),
            },
          };
        }),
    };
  }

  // --- Map ---
  function initMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          'carto': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
      },
      center: [-119.5, 37.2],
      zoom: 5.5,
      maxZoom: 15,
      minZoom: 4,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    }), 'top-left');

    return map;
  }

  function addSystemsLayer(geojson) {
    map.addSource('systems', { type: 'geojson', data: geojson });

    // Circle layer — radius scales with population
    map.addLayer({
      id: 'systems-circles',
      type: 'circle',
      source: 'systems',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'pop'],
          0, 4,
          1000, 5,
          10000, 7,
          100000, 10,
          1000000, 14,
        ],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });

    // Hover cursor
    map.on('mouseenter', 'systems-circles', function () {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'systems-circles', function () {
      map.getCanvas().style.cursor = '';
    });

    // Click → show system
    map.on('click', 'systems-circles', function (e) {
      if (!e.features.length) return;
      var f = e.features[0];
      var props = f.properties;
      showSystem(props.id);

      // Brief popup
      if (activePopup) activePopup.remove();
      activePopup = new maplibregl.Popup({ closeOnClick: true, offset: 12, maxWidth: '220px' })
        .setLngLat(f.geometry.coordinates)
        .setHTML(
          '<div class="popup-name">' + titleCase(props.name) + '</div>' +
          '<div class="popup-status" style="color:' + props.color + '">' + statusLabel(props.status) + '</div>'
        )
        .addTo(map);
    });
  }

  // --- Panel ---
  var panel = document.getElementById('panel');
  var panelContent = document.getElementById('panel-content');
  var panelDrag = document.getElementById('panel-drag');

  function setPanel(state) {
    panel.classList.remove('peek', 'open');
    if (state === 'peek') panel.classList.add('peek');
    if (state === 'open') panel.classList.add('open');
    panelState = state;

    // Clear URL hash and reset title when panel is closed
    if (state === 'closed') {
      if (location.hash.indexOf('#system/') === 0) {
        history.pushState(null, '', location.pathname + location.search);
      }
      document.title = 'California Water Quality';
    }

    // Hide legend and find button when panel is visible on mobile
    var legend = document.getElementById('legend');
    var findWrap = document.getElementById('find-my-water-wrap');
    if (window.innerWidth < 768) {
      legend.style.opacity = state === 'closed' ? '1' : '0';
      legend.style.pointerEvents = state === 'closed' ? 'auto' : 'none';
    }
    // Hide find button when any system is shown
    if (findWrap) {
      findWrap.classList.toggle('hidden', state !== 'closed');
    }
  }

  // Drag to open/close on mobile
  (function () {
    var startY = 0;
    var dragging = false;

    panelDrag.addEventListener('touchstart', function (e) {
      startY = e.touches[0].clientY;
      dragging = true;
    });

    panelDrag.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var dy = e.touches[0].clientY - startY;
      if (panelState === 'peek' && dy < -40) {
        setPanel('open');
        dragging = false;
      } else if (panelState === 'open' && dy > 40) {
        setPanel('peek');
        dragging = false;
      } else if (panelState === 'peek' && dy > 60) {
        setPanel('closed');
        dragging = false;
      }
    });

    panelDrag.addEventListener('touchend', function () { dragging = false; });

    // Desktop: click handle toggles
    panelDrag.addEventListener('click', function () {
      if (panelState === 'peek') setPanel('open');
      else if (panelState === 'open') setPanel('peek');
    });
  })();

  // --- Show system detail ---
  async function showSystem(systemId, skipHash) {
    // Set panel to peek and show loading
    panelContent.innerHTML = '<div class="spinner"></div>';
    setPanel('peek');

    // Update URL hash for sharing/bookmarking
    if (!skipHash) {
      history.pushState(null, '', '#system/' + systemId);
    }

    try {
      var detail = await loadSystemDetail(systemId);
      renderSystemDetail(detail);
      // Auto-open on desktop
      if (window.innerWidth >= 768) setPanel('open');
    } catch (err) {
      panelContent.innerHTML = '<div class="panel-intro"><p>Could not load data for this system.</p></div>';
    }
  }

  function buildEducationalSection(status, exceedCount) {
    var html = '<details class="edu-section">';
    html += '<summary class="edu-toggle">What does this mean?</summary>';
    html += '<div class="edu-content">';

    // Context-aware action guidance — show first for failing systems
    if (status === 'Failing') {
      html += '<div class="edu-action edu-action-failing">';
      html += '<div class="edu-action-title">What should I do?</div>';
      html += '<ul class="edu-action-list">';
      html += '<li><strong>Don\'t panic.</strong> Water systems that exceed a safety limit are required to notify customers and take corrective action.</li>';
      html += '<li><strong>Check your mail.</strong> Your water provider must send you a notice explaining the violation and what they\'re doing about it.</li>';
      html += '<li><strong>Consider a filter.</strong> A certified point-of-use filter can reduce many contaminants. Look for NSF/ANSI certified filters for the specific contaminant.</li>';
      html += '<li><strong>Contact your water provider</strong> to ask about their corrective action plan and timeline.</li>';
      html += '<li><strong>Get more info</strong> from the <a href="https://www.waterboards.ca.gov/drinking_water/" target="_blank" rel="noopener">CA State Water Board</a> or call the Safe Drinking Water Hotline: <a href="tel:+18004264791">1-800-426-4791</a>.</li>';
      html += '</ul>';
      html += '</div>';
    } else if (status === 'In Compliance') {
      html += '<div class="edu-action edu-action-good">';
      html += '<div class="edu-action-title">Good news</div>';
      html += '<p>All detected contaminants are within California\'s safety limits. Your water provider regularly tests the water and reports results to the state.</p>';
      html += '</div>';
    }

    // What are safety limits?
    html += '<div class="edu-block">';
    html += '<div class="edu-block-title">What are safety limits (MCLs)?</div>';
    html += '<p>A <strong>Maximum Contaminant Level (MCL)</strong> is the highest amount of a contaminant allowed in drinking water. California sets these limits to protect public health, often stricter than federal standards. The bars above show how each contaminant compares to its legal limit.</p>';
    html += '</div>';

    // What do the statuses mean?
    html += '<div class="edu-block">';
    html += '<div class="edu-block-title">What do the statuses mean?</div>';
    html += '<div class="edu-status-list">';
    html += '<div class="edu-status-item"><span class="dot dot-compliance"></span><strong>Meets standards</strong> — All tested contaminants are within California safety limits.</div>';
    html += '<div class="edu-status-item"><span class="dot dot-at-risk"></span><strong>At risk</strong> — The system has risk factors identified by the state that could affect water quality.</div>';
    html += '<div class="edu-status-item"><span class="dot dot-failing"></span><strong>Failing</strong> — One or more contaminants exceed California safety limits in recent testing.</div>';
    html += '<div class="edu-status-item"><span class="dot dot-unknown"></span><strong>Not assessed</strong> — Not enough data to determine compliance status.</div>';
    html += '</div>';
    html += '</div>';

    // What about contaminants with no limit?
    html += '<div class="edu-block">';
    html += '<div class="edu-block-title">What about contaminants with no safety limit?</div>';
    html += '<p>Some detected chemicals don\'t have a legal limit yet. This doesn\'t mean they\'re dangerous — it means California is still studying them or hasn\'t set an enforceable standard. Many are being monitored under the state\'s Unregulated Contaminant Monitoring program.</p>';
    html += '</div>';

    html += '</div>'; // edu-content
    html += '</details>';
    return html;
  }

  function renderSystemDetail(d) {
    var detected = (d.contaminants || []).filter(function (c) { return c.n_detects > 0; });
    var nExceed = detected.filter(function (c) { return c.exceeds_mcl; }).length;
    var nTested = d.contaminants ? d.contaminants.length : 0;
    var status = deriveStatus(d.status || 'Not Assessed', nExceed, nTested);
    var sClass = statusClass(status);

    // Separate contaminants with detections that have MCLs
    var exceeding = detected.filter(function (c) { return c.exceeds_mcl; });
    var regulated = detected.filter(function (c) { return c.mcl && !c.exceeds_mcl; });
    var other = detected.filter(function (c) { return !c.mcl; });

    var exceedCount = exceeding.length;
    var testedCount = nTested;
    var detectedCount = detected.length;

    // Build summary sentence
    var summaryText;
    if (exceedCount === 0) {
      summaryText = 'All ' + detectedCount + ' detected contaminants are within California safety limits.';
    } else if (exceedCount === 1) {
      summaryText = '1 contaminant exceeds California safety limits in recent testing.';
    } else {
      summaryText = exceedCount + ' contaminants exceed California safety limits in recent testing.';
    }

    var html = '';

    // Close button
    html += '<button class="panel-close" id="panel-close-btn" aria-label="Close">&times;</button>';

    // Header
    html += '<div class="system-header">';
    html += '<div class="system-title-row">';
    html += '<h2 class="system-name">' + titleCase(d.system_name) + '</h2>';
    html += '<button class="share-btn" onclick="shareSystem(\'' + d.system_id + '\', \'' + titleCase(d.system_name).replace(/'/g, "\\'") + '\')" aria-label="Share" title="Copy link">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
    html += '</button>';
    html += '</div>';
    html += '<div class="system-meta">' + titleCase(d.county) + ' County';
    if (d.population) html += ' &middot; Serves ' + fmtPop(d.population) + ' people';
    html += '</div>';
    html += '<div class="status-badge ' + sClass + '"><span class="status-dot"></span>' + statusLabel(status) + '</div>';
    html += '</div>';

    // Summary
    html += '<p class="summary-text">' + summaryText + '</p>';

    // Educational "What does this mean?" collapsible
    html += buildEducationalSection(status, exceedCount);

    // Stats
    html += '<div class="stat-row">';
    html += '<div class="stat-card"><div class="stat-value">' + testedCount + '</div><div class="stat-label">Tested</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + detectedCount + '</div><div class="stat-label">Detected</div></div>';
    html += '<div class="stat-card"><div class="stat-value"' + (exceedCount > 0 ? ' style="color:var(--red)"' : '') + '>' + exceedCount + '</div><div class="stat-label">Exceed Limit</div></div>';
    html += '</div>';

    // Exceeding MCL section
    if (exceeding.length > 0) {
      html += '<div class="section-title">Exceeding Safety Limits</div>';
      exceeding.sort(function (a, b) {
        var ra = a.avg / a.mcl;
        var rb = b.avg / b.mcl;
        return rb - ra;
      });
      exceeding.forEach(function (c) {
        html += renderContaminantBar(c, true);
      });
    }

    // Regulated but within limits
    if (regulated.length > 0) {
      html += '<div class="section-title">Within Safety Limits</div>';
      regulated.sort(function (a, b) {
        var ra = a.avg / a.mcl;
        var rb = b.avg / b.mcl;
        return rb - ra;
      });
      regulated.forEach(function (c) {
        html += renderContaminantBar(c, false);
      });
    }

    // Other detected (no MCL)
    if (other.length > 0) {
      html += '<div class="section-title">Detected — No Safety Limit Set</div>';
      html += '<div class="detected-list">';
      other.forEach(function (c) {
        var info = contaminantInfo(c.name);
        var tipParts = ['Avg: ' + fmtVal(c.avg) + ' ' + fmtUnits(c.units)];
        if (info && info.desc) tipParts.push(info.desc);
        html += '<span class="detected-chip" title="' + tipParts.join(' — ') + '">' + contaminantName(c.name) + '</span>';
      });
      html += '</div>';
    }

    // Footer
    html += '<div class="panel-footer">';
    html += 'System ID: ' + d.system_id + '<br>';
    html += 'Data from <a href="https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/EDTlibrary.html" target="_blank">CA Water Boards</a>.';
    if (meta && meta.updated) {
      html += ' Updated ' + fmtDate(meta.updated) + '.';
    } else {
      html += ' Last 2 years of testing results.';
    }
    html += '</div>';

    panelContent.innerHTML = html;

    // Update page title for sharing
    document.title = titleCase(d.system_name) + ' — CA Water Quality';

    var closeBtn = document.getElementById('panel-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () { setPanel('closed'); });
    }
  }

  function fmtVal(v) {
    if (v === null || v === undefined || v === 'NA') return 'ND';
    var n = Number(v);
    if (isNaN(n)) return String(v);
    if (n >= 100) return Math.round(n).toLocaleString();
    if (n >= 1) return n.toFixed(1);
    return n.toFixed(2);
  }

  function renderContaminantBar(c, exceeds) {
    var avg = Number(c.avg);
    var mcl = Number(c.mcl);
    if (isNaN(avg) || isNaN(mcl) || mcl === 0) return '';

    var ratio = avg / mcl;
    var maxBar = Math.max(ratio, 1.1); // bar scale
    var fillPct = Math.min((ratio / maxBar) * 100, 100);
    var mclPct = (1 / maxBar) * 100;

    var barClass = 'safe';
    if (ratio > 1) barClass = 'danger';
    else if (ratio > 0.8) barClass = 'warning';

    var info = contaminantInfo(c.name);
    var units = fmtUnits(c.units);

    var html = '<div class="contaminant-card' + (exceeds ? ' exceeds' : '') + '">';
    html += '<div class="contaminant-name">' + contaminantName(c.name) + '</div>';
    html += '<div class="contaminant-detail">';
    html += 'Average: ' + fmtVal(c.avg) + ' ' + units;
    html += ' &middot; Limit: ' + fmtVal(c.mcl) + ' ' + units;
    html += ' &middot; ' + c.n_detects + ' of ' + c.n_samples + ' samples';
    html += '</div>';

    // Health context from dictionary
    if (info) {
      html += '<div class="contaminant-context">';
      if (info.desc) html += '<span class="contaminant-desc">' + info.desc + '</span>';
      if (info.source) html += '<span class="contaminant-source">Common sources: ' + info.source + '</span>';
      html += '</div>';
    }

    html += '<div class="bar-wrap">';
    html += '<div class="bar-fill ' + barClass + '" style="width:' + fillPct + '%"></div>';
    html += '<div class="bar-mcl" style="left:' + mclPct + '%" title="Safety limit"></div>';
    html += '</div>';
    html += '<div class="bar-labels"><span>' + fmtVal(c.avg) + '</span><span>Limit: ' + fmtVal(c.mcl) + '</span></div>';
    html += '</div>';

    return html;
  }

  // --- Search ---
  var searchInput = document.getElementById('search');
  var searchResults = document.getElementById('search-results');
  var searchClear = document.getElementById('search-clear');
  var searchTimeout = null;
  var selectedIdx = -1;

  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimeout);
    var q = this.value.trim();
    searchClear.classList.toggle('hidden', q.length === 0);
    if (q.length < 2) {
      searchResults.classList.add('hidden');
      return;
    }
    searchTimeout = setTimeout(function () { doSearch(q); }, 150);
  });

  searchInput.addEventListener('keydown', function (e) {
    var items = searchResults.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      updateActiveResult(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      updateActiveResult(items);
    } else if (e.key === 'Enter' && selectedIdx >= 0 && items[selectedIdx]) {
      e.preventDefault();
      items[selectedIdx].click();
    } else if (e.key === 'Escape') {
      searchResults.classList.add('hidden');
      searchInput.blur();
    }
  });

  searchClear.addEventListener('click', function () {
    searchInput.value = '';
    searchResults.classList.add('hidden');
    searchClear.classList.add('hidden');
    searchInput.focus();
  });

  // Close results when clicking outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#search-wrap')) {
      searchResults.classList.add('hidden');
    }
  });

  function updateActiveResult(items) {
    items.forEach(function (li, i) {
      li.classList.toggle('active', i === selectedIdx);
    });
    if (items[selectedIdx]) {
      items[selectedIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  function doSearch(query) {
    var q = query.toLowerCase();
    var matches = systems.filter(function (s) {
      return (s.name && s.name.toLowerCase().indexOf(q) !== -1) ||
             (s.county && s.county.toLowerCase().indexOf(q) !== -1) ||
             (s.id && s.id.toLowerCase().indexOf(q) !== -1);
    }).sort(function (a, b) {
      return (b.pop || 0) - (a.pop || 0);
    }).slice(0, 20);

    selectedIdx = -1;

    if (matches.length === 0) {
      searchResults.innerHTML = '<li class="no-results"><span class="result-name">No results found</span></li>';
      searchResults.classList.remove('hidden');
      return;
    }

    searchResults.innerHTML = matches.map(function (s) {
      var meta = titleCase(s.county);
      if (s.pop) meta += ' · ' + fmtPop(s.pop) + ' served';
      return '<li data-id="' + s.id + '" data-lat="' + s.lat + '" data-lon="' + s.lon + '">' +
        '<span class="result-name">' + titleCase(s.name) + '</span>' +
        '<span class="result-meta">' + meta + '</span>' +
        '</li>';
    }).join('');

    searchResults.querySelectorAll('li').forEach(function (li) {
      li.addEventListener('click', function () {
        var id = this.dataset.id;
        var lat = parseFloat(this.dataset.lat);
        var lon = parseFloat(this.dataset.lon);

        searchResults.classList.add('hidden');
        searchInput.value = titleCase(systems.find(function (s) { return s.id === id; }).name);

        if (lat && lon) {
          map.flyTo({ center: [lon, lat], zoom: 12, duration: 1200 });
        }

        showSystem(id);
      });
    });

    searchResults.classList.remove('hidden');
  }

  // --- Find My Water System (geolocation) ---
  function findNearestSystem(lat, lon) {
    var nearest = null;
    var minDist = Infinity;
    systems.forEach(function (s) {
      if (!s.lat || !s.lon) return;
      // Haversine approximation (good enough for nearest-neighbor)
      var dLat = (s.lat - lat) * Math.PI / 180;
      var dLon = (s.lon - lon) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
      var dist = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 3959; // miles
      if (dist < minDist) {
        minDist = dist;
        nearest = s;
      }
    });
    return { system: nearest, miles: minDist };
  }

  function initFindMyWater() {
    var wrap = document.getElementById('find-my-water-wrap');
    var btn = document.getElementById('find-my-water');
    if (!btn || !wrap) return;

    // Show the button now that data is loaded
    wrap.style.display = '';

    btn.addEventListener('click', function () {
      if (!navigator.geolocation) {
        showToast('Location not supported by your browser');
        return;
      }

      // Set loading state
      btn.disabled = true;
      btn.classList.add('loading');
      var origHTML = btn.innerHTML;
      btn.innerHTML = '<span class="btn-spinner"></span> Locating...';

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var result = findNearestSystem(pos.coords.latitude, pos.coords.longitude);
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.innerHTML = origHTML;

          if (!result.system) {
            showToast('No water systems found nearby');
            return;
          }

          // Fly to the system and show its details
          map.flyTo({ center: [result.system.lon, result.system.lat], zoom: 12, duration: 1200 });
          showSystem(result.system.id);

          // Show a toast with context
          var dist = result.miles < 1 ? 'less than a mile' : Math.round(result.miles) + ' mi';
          showToast(titleCase(result.system.name) + ' · ' + dist + ' away');
        },
        function (err) {
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.innerHTML = origHTML;

          if (err.code === 1) {
            showToast('Location access denied — try searching instead');
          } else {
            showToast('Could not determine your location');
          }
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  // --- Share ---
  window.shareSystem = function (systemId, name) {
    var url = location.origin + location.pathname + '#system/' + systemId;
    if (navigator.share) {
      navigator.share({ title: name + ' — Water Quality', url: url });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        showToast('Link copied!');
      });
    }
  };

  function showToast(msg) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 10);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2000);
  }

  // --- Deep link helpers ---
  function getSystemIdFromHash() {
    var hash = location.hash;
    if (hash.indexOf('#system/') === 0) {
      return hash.substring(8); // strip '#system/'
    }
    return null;
  }

  function openDeepLink() {
    var id = getSystemIdFromHash();
    if (!id) return;

    // Find the system in our data to fly to its location
    var sys = systems.find(function (s) { return s.id === id; });
    if (sys && sys.lat && sys.lon) {
      map.flyTo({ center: [sys.lon, sys.lat], zoom: 12, duration: 1200 });
    }
    showSystem(id, true); // skipHash=true since hash is already set
  }

  // --- Loading overlay ---
  var loadingOverlay = document.getElementById('loading-overlay');

  function hideLoading() {
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
      // Remove from DOM after fade-out
      setTimeout(function () { loadingOverlay.remove(); }, 400);
    }
  }

  function showError() {
    if (loadingOverlay) {
      loadingOverlay.innerHTML =
        '<div class="error-content">' +
        '<div class="error-icon">&#9888;</div>' +
        '<div class="error-title">Unable to load water quality data</div>' +
        '<p class="error-message">This could be a network issue. Check your connection and try again.</p>' +
        '<button class="error-retry" onclick="location.reload()">Try Again</button>' +
        '</div>';
    }
  }

  // --- Data freshness ---
  function showDataFreshness() {
    if (!meta || !meta.updated) return;
    var el = document.getElementById('data-freshness');
    if (el) {
      el.textContent = 'Data updated ' + fmtDate(meta.updated);
      el.classList.remove('hidden');
    }
  }

  // --- Init ---
  async function init() {
    initMap();

    map.on('load', async function () {
      try {
        // Load dictionary, systems, and meta in parallel
        await Promise.all([loadContaminantDict(), loadSystems(), loadMeta()]);
        var geojson = systemsToGeoJSON(systems);
        addSystemsLayer(geojson);

        // Show data freshness in legend
        showDataFreshness();

        // Hide loading overlay
        hideLoading();

        // Initialize "Find My Water" button now that systems are loaded
        initFindMyWater();

        // Check for deep link after data is loaded
        openDeepLink();
      } catch (err) {
        console.error('Failed to load water system data:', err);
        showError();
      }
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', function () {
      var id = getSystemIdFromHash();
      if (id) {
        showSystem(id, true);
      } else {
        setPanel('closed');
      }
    });

    // Close panel when clicking map (mobile)
    map.on('click', function (e) {
      // Only if not clicking a system circle
      var features = map.queryRenderedFeatures(e.point, { layers: ['systems-circles'] });
      if (features.length === 0 && panelState !== 'closed') {
        setPanel('closed');
      }
    });
  }

  init();
})();
