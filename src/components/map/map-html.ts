import { VoraColors, type ColorScheme } from '@/constants/theme';
import { DEFAULT_CENTER, mapStyleUrl } from '@/lib/map';
import { carIconSvg } from '@/lib/map-icons';

/**
 * MapLibre (Yarto) dans la WebView.
 * On n'envoie `ready` qu'après le premier `idle` (tuiles + style) et des `resize`
 * pour éviter une carte à moitié vide (WebView souvent 0×0 au 1er frame).
 */
export function mapLibreHtml(scheme: ColorScheme = 'light'): string {
  const c = VoraColors[scheme];
  const style = mapStyleUrl(scheme);
  const lng = DEFAULT_CENTER.longitude;
  const lat = DEFAULT_CENTER.latitude;
  const zoom = DEFAULT_CENTER.zoom;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${c.mapBackground}; }
    .user-dot {
      width: 16px; height: 16px; border-radius: 8px;
      background: ${c.accent}; border: 3px solid ${c.surfaceAlt};
      box-shadow: 0 0 0 8px ${c.accentSoft};
    }
    .driver-pin {
      display: flex; align-items: center; gap: 4px;
      background: ${c.surface}; border: 1px solid ${c.borderStrong};
      border-radius: 14px; padding: 3px 8px; color: ${c.text};
      font: 600 11px/1.1 -apple-system, Roboto, system-ui, sans-serif;
      white-space: nowrap; box-shadow: 0 2px 6px ${c.scrim};
    }
    .driver-pin.selected {
      border-color: ${c.accent}; background: ${c.accentSoft};
    }
    .driver-pin.busy { opacity: 0.62; }
    .driver-pin.demo { border-style: dashed; border-color: ${c.warningBorder}; }
    .driver-pin .glyph { display: flex; align-items: center; }
    .driver-pin .glyph svg { display: block; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    const map = new maplibregl.Map({
      container: 'map',
      style: ${JSON.stringify(style)},
      center: [${lng}, ${lat}],
      zoom: ${zoom},
      attributionControl: true,
      fadeDuration: 0,
    });
    map.dragRotate.disable();
    map.touchPitch.disable();

    // Voiture verte quand le chauffeur est disponible, grise sinon.
    var CAR_AVAILABLE = ${JSON.stringify(carIconSvg(c.accent))};
    var CAR_BUSY = ${JSON.stringify(carIconSvg(c.textMuted))};

    let userMarker = null;
    let destMarker = null;
    const driverMarkers = {};
    let pendingRoute = null;
    let readySent = false;

    function post(payload) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }

    window.__resize = function () {
      try { map.resize(); } catch (e) {}
    };

    function whenStyleReady(fn) {
      if (map.isStyleLoaded()) fn();
      else map.once('idle', fn);
    }

    function setRoute(coords) {
      pendingRoute = coords;
      whenStyleReady(function () {
        const data = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords || [] },
        };
        const src = map.getSource('route');
        if (src) {
          src.setData(data);
          return;
        }
        if (!coords || coords.length < 2) return;
        map.addSource('route', { type: 'geojson', data: data });
        if (!map.getLayer('route-line')) {
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ${JSON.stringify(c.accent)}, 'line-width': 5 },
          });
        }
      });
    }

    function setDrivers(items) {
      const seen = {};
      (items || []).forEach(function (d) {
        seen[d.id] = true;
        let entry = driverMarkers[d.id];
        if (!entry) {
          const el = document.createElement('div');
          el.className = 'driver-pin';
          el.innerHTML = '<span class="glyph"></span><span class="label"></span>';
          entry = {
            el: el,
            marker: new maplibregl.Marker({ element: el }).setLngLat(d.center).addTo(map),
          };
          driverMarkers[d.id] = entry;
        } else {
          entry.marker.setLngLat(d.center);
        }
        entry.el.querySelector('.glyph').innerHTML = d.available ? CAR_AVAILABLE : CAR_BUSY;
        entry.el.querySelector('.label').textContent = d.label;
        entry.el.classList.toggle('selected', !!d.selected);
        entry.el.classList.toggle('busy', !d.available);
        entry.el.classList.toggle('demo', !!d.demo);
      });

      Object.keys(driverMarkers).forEach(function (id) {
        if (seen[id]) return;
        driverMarkers[id].marker.remove();
        delete driverMarkers[id];
      });
    }

    window.__vora = function (msg) {
      if (!msg || !map) return;
      if (msg.type === 'flyTo') {
        map.flyTo({ center: [msg.lng, msg.lat], zoom: msg.zoom, duration: 900 });
      }
      if (msg.type === 'fitRoute' && msg.coords && msg.coords.length) {
        const b = new maplibregl.LngLatBounds(msg.coords[0], msg.coords[0]);
        msg.coords.forEach(function (p) { b.extend(p); });
        map.fitBounds(b, { padding: { top: 96, bottom: 200, left: 48, right: 48 }, duration: 800, maxZoom: 16 });
      }
      if (msg.type === 'user') {
        const ll = [msg.lng, msg.lat];
        if (!userMarker) {
          const el = document.createElement('div');
          el.className = 'user-dot';
          userMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
        } else {
          userMarker.setLngLat(ll);
        }
      }
      if (msg.type === 'destination') {
        if (!msg.center) {
          if (destMarker) { destMarker.remove(); destMarker = null; }
          return;
        }
        if (!destMarker) {
          destMarker = new maplibregl.Marker({ color: ${JSON.stringify(c.accent)} }).setLngLat(msg.center).addTo(map);
        } else {
          destMarker.setLngLat(msg.center);
        }
      }
      if (msg.type === 'route') setRoute(msg.coords);
      if (msg.type === 'drivers') setDrivers(msg.items);
    };

    function markReady() {
      if (readySent) return;
      readySent = true;
      window.__resize();
      if (pendingRoute) setRoute(pendingRoute);
      post({ type: 'ready' });
    }

    map.on('load', function () { window.__resize(); });
    map.on('idle', markReady);
    setTimeout(markReady, 8000);
    setTimeout(window.__resize, 120);
    setTimeout(window.__resize, 400);
    setTimeout(window.__resize, 1200);
  </script>
</body>
</html>`;
}
