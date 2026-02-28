/* California Water Quality — app.js */

(function () {
  'use strict';

  // --- State ---
  let systems = [];       // all systems from summary JSON
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

  // --- Format helpers ---
  function fmtPop(n) {
    if (!n) return 'N/A';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return n.toLocaleString();
  }

  function titleCase(s) {
    if (!s) return '';
    return s.replace(/\w\S*/g, function (t) {
      return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase();
    });
  }

  // --- Data loading ---
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
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: {
              id: s.id,
              name: s.name,
              county: s.county,
              pop: s.pop || 0,
              status: s.status,
              n_exceed: s.n_exceed || 0,
              n_tested: s.n_tested || 0,
              color: statusColor(s.status),
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

    // Move legend out of the way when panel is visible on mobile
    var legend = document.getElementById('legend');
    if (window.innerWidth < 768) {
      legend.style.opacity = state === 'closed' ? '1' : '0';
      legend.style.pointerEvents = state === 'closed' ? 'auto' : 'none';
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
  async function showSystem(systemId) {
    // Set panel to peek and show loading
    panelContent.innerHTML = '<div class="spinner"></div>';
    setPanel('peek');

    try {
      var detail = await loadSystemDetail(systemId);
      renderSystemDetail(detail);
      // Auto-open on desktop
      if (window.innerWidth >= 768) setPanel('open');
    } catch (err) {
      panelContent.innerHTML = '<div class="panel-intro"><p>Could not load data for this system.</p></div>';
    }
  }

  function renderSystemDetail(d) {
    var status = d.status || 'Not Assessed';
    var sClass = statusClass(status);

    // Separate contaminants with detections that have MCLs
    var detected = (d.contaminants || []).filter(function (c) { return c.n_detects > 0; });
    var exceeding = detected.filter(function (c) { return c.exceeds_mcl; });
    var regulated = detected.filter(function (c) { return c.mcl && !c.exceeds_mcl; });
    var other = detected.filter(function (c) { return !c.mcl; });

    var exceedCount = exceeding.length;
    var testedCount = d.contaminants ? d.contaminants.length : 0;
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
    html += '<button class="panel-close" onclick="document.getElementById(\'panel\').classList.remove(\'peek\',\'open\')" aria-label="Close">&times;</button>';

    // Header
    html += '<div class="system-header">';
    html += '<h2 class="system-name">' + titleCase(d.system_name) + '</h2>';
    html += '<div class="system-meta">' + titleCase(d.county) + ' County';
    if (d.population) html += ' &middot; Serves ' + fmtPop(d.population) + ' people';
    html += '</div>';
    html += '<div class="status-badge ' + sClass + '"><span class="status-dot"></span>' + statusLabel(status) + '</div>';
    html += '</div>';

    // Summary
    html += '<p class="summary-text">' + summaryText + '</p>';

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
      html += '<div class="section-title">Other Detected (No Limit Set)</div>';
      html += '<div class="detected-list">';
      other.forEach(function (c) {
        html += '<span class="detected-chip" title="Avg: ' + fmtVal(c.avg) + ' ' + c.units + '">' + titleCase(c.name) + '</span>';
      });
      html += '</div>';
    }

    // Footer
    html += '<div class="panel-footer">';
    html += 'System ID: ' + d.system_id + '<br>';
    html += 'Data from <a href="https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/EDTlibrary.html" target="_blank">CA Water Boards</a>. ';
    html += 'Last 2 years of testing results.';
    html += '</div>';

    panelContent.innerHTML = html;
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

    var html = '<div class="contaminant-card' + (exceeds ? ' exceeds' : '') + '">';
    html += '<div class="contaminant-name">' + titleCase(c.name) + '</div>';
    html += '<div class="contaminant-detail">';
    html += 'Average: ' + fmtVal(c.avg) + ' ' + c.units;
    html += ' &middot; Limit: ' + fmtVal(c.mcl) + ' ' + c.units;
    html += ' &middot; ' + c.n_detects + ' of ' + c.n_samples + ' samples';
    html += '</div>';
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
    }).slice(0, 20);

    selectedIdx = -1;

    if (matches.length === 0) {
      searchResults.innerHTML = '<li class="no-results"><span class="result-name">No results found</span></li>';
      searchResults.classList.remove('hidden');
      return;
    }

    searchResults.innerHTML = matches.map(function (s) {
      return '<li data-id="' + s.id + '" data-lat="' + s.lat + '" data-lon="' + s.lon + '">' +
        '<span class="result-name">' + titleCase(s.name) + '</span>' +
        '<span class="result-meta">' + titleCase(s.county) + '</span>' +
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

  // --- Init ---
  async function init() {
    initMap();

    map.on('load', async function () {
      try {
        await loadSystems();
        var geojson = systemsToGeoJSON(systems);
        addSystemsLayer(geojson);
      } catch (err) {
        console.error('Failed to load water system data:', err);
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
