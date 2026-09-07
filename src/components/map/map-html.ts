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
    .sim-car {
      display: flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; border-radius: 17px;
      background: ${c.surfaceAlt}; border: 2px solid ${c.accent};
      box-shadow: 0 0 0 6px ${c.accentSoft};
    }
    .sim-car svg { display: block; }
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

    /**
     * Vue 3D : caméra inclinée, bâtiments extrudés et suivi orienté dans le sens
     * de la marche — la lecture d'itinéraire à laquelle Google Maps a habitué
     * tout le monde.
     */
    var PITCH_3D = 58;
    var FOLLOW_ZOOM = 17;
    var BUILDING_LAYER = 'vora-buildings-3d';
    var viewMode = '2d';
    var following = false;
    var lastUser = null;

    // Voiture verte quand le chauffeur est disponible, grise sinon.
    var CAR_AVAILABLE = ${JSON.stringify(carIconSvg(c.accent))};
    var CAR_BUSY = ${JSON.stringify(carIconSvg(c.textMuted))};
    var BUILDING_COLOR = ${JSON.stringify(c.surfaceStrong)};

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

    /** Cap de A vers B, en degrés depuis le nord. */
    function bearingTo(a, b) {
      var toRad = Math.PI / 180;
      var lat1 = a[1] * toRad;
      var lat2 = b[1] * toRad;
      var dLng = (b[0] - a[0]) * toRad;
      var y = Math.sin(dLng) * Math.cos(lat2);
      var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }

    /**
     * Orientation de la caméra : le tronçon d'itinéraire qui suit le point le
     * plus proche de l'utilisateur. Sans itinéraire, on garde le cap courant.
     */
    function routeBearing(ll) {
      if (!pendingRoute || pendingRoute.length < 2) return null;
      var best = 0;
      var bestD = Infinity;
      for (var i = 0; i < pendingRoute.length; i++) {
        var dx = pendingRoute[i][0] - ll[0];
        var dy = pendingRoute[i][1] - ll[1];
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      // Trois points plus loin : assez pour lisser les zigzags du tracé.
      var next = Math.min(best + 3, pendingRoute.length - 1);
      return next === best ? null : bearingTo(pendingRoute[best], pendingRoute[next]);
    }

    /**
     * Source vectorielle qui porte les bâtiments dans le style courant.
     *
     * Repérée par sa couche plutôt que codée en dur : styles clair et sombre ne
     * la nomment pas forcément pareil, et les tuiles de démonstration n'en ont
     * pas — auquel cas la 3D reste inclinée, simplement sans bâtiments.
     */
    function buildingSource() {
      var style = map.getStyle();
      var layers = (style && style.layers) || [];
      for (var i = 0; i < layers.length; i++) {
        if (layers[i]['source-layer'] === 'building' && layers[i].source) return layers[i].source;
      }
      return null;
    }

    /** Première couche de texte : les bâtiments se glissent dessous. */
    function firstSymbolLayer() {
      var style = map.getStyle();
      var layers = (style && style.layers) || [];
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].type === 'symbol') return layers[i].id;
      }
      return undefined;
    }

    function setBuildings(on) {
      whenStyleReady(function () {
        var existing = map.getLayer(BUILDING_LAYER);
        if (!on) {
          if (existing) map.removeLayer(BUILDING_LAYER);
          return;
        }
        if (existing) return;

        var src = buildingSource();
        if (!src) return;

        map.addLayer({
          id: BUILDING_LAYER,
          source: src,
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': BUILDING_COLOR,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
            'fill-extrusion-opacity': 0.9,
          },
        }, firstSymbolLayer());
      });
    }

    function setFollowing(on) {
      if (following === on) return;
      following = on;
      post({ type: 'follow', on: on });
    }

    /** Recadre la caméra sur l'utilisateur, dans le sens de la marche. */
    function follow(animate) {
      // Une simulation en cours tient la caméra : on ne la lui dispute pas.
      if (sim) return;
      if (!following || viewMode !== '3d' || !lastUser) return;
      var bearing = routeBearing(lastUser);
      map.easeTo({
        center: lastUser,
        zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
        pitch: PITCH_3D,
        bearing: bearing === null ? map.getBearing() : bearing,
        duration: animate ? 900 : 0,
      });
    }

    /* --- Simulation de trajet -------------------------------------------
     * Le profil de vitesse — virages, arrêts aux carrefours — est calculé côté
     * application ('src/lib/route-sim.ts') et envoyé ici sous forme d'images
     * horodatées. Cette WebView ne fait que les lire : c'est ce qui permet à la
     * carte native et à la carte web de partager exactement la même physique.
     */
    var simMarker = null;
    var sim = null;

    /** Interpolation entre les deux images qui encadrent 'elapsed'. */
    function simSample(elapsed) {
      var frames = sim.frames;
      var last = frames[frames.length - 1];
      if (elapsed >= sim.durationS) {
        return {
          lng: last.lng, lat: last.lat, bearing: last.bearing, i: last.i,
          progress: 1, remainingS: 0, done: true,
        };
      }

      var low = 0;
      var high = frames.length - 1;
      while (low < high - 1) {
        var mid = (low + high) >> 1;
        if (frames[mid].t <= elapsed) low = mid;
        else high = mid;
      }

      var from = frames[low];
      var to = frames[low + 1] || from;
      var span = to.t - from.t;
      var ratio = span > 0 ? (elapsed - from.t) / span : 0;
      // Cap interpolé par le plus court chemin : 350 degrés vers 10 passe par 0.
      var delta = ((to.bearing - from.bearing + 540) % 360) - 180;

      return {
        lng: from.lng + (to.lng - from.lng) * ratio,
        lat: from.lat + (to.lat - from.lat) * ratio,
        bearing: (from.bearing + delta * ratio + 360) % 360,
        i: from.i,
        progress: sim.durationS > 0 ? elapsed / sim.durationS : 1,
        remainingS: Math.max(0, sim.durationS - elapsed),
        done: false,
      };
    }

    /**
     * N'affiche que ce qu'il reste à parcourir : la portion déjà faite
     * disparaît derrière le véhicule, comme sur les applications de course.
     */
    function drawRemaining(s) {
      var src = map.getSource('route');
      if (!src) return;

      var rest = sim.points.slice(s.i + 1);
      rest.unshift([s.lng, s.lat]);
      src.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: rest },
      });
    }

    function simRender(s) {
      simMarker.setLngLat([s.lng, s.lat]);
      simMarker.setRotation(s.bearing);
      drawRemaining(s);

      // 'jumpTo' et non 'easeTo' : à 60 images par seconde, une animation par
      // image se battrait avec la précédente et donnerait une caméra molle.
      map.jumpTo({
        center: [s.lng, s.lat],
        bearing: s.bearing,
        pitch: viewMode === '3d' ? PITCH_3D : 0,
        zoom: sim.zoom,
      });
    }

    function simPost(state, s) {
      post({ type: 'sim', state: state, progress: s.progress, remainingS: s.remainingS });
    }

    function simStep(ts) {
      if (!sim || sim.paused) return;
      var s = simSample((ts - sim.startedAt) / 1000);
      simRender(s);

      // Deux comptes rendus par seconde suffisent à l'affichage du restant.
      if (ts - sim.lastPost > 500) {
        sim.lastPost = ts;
        simPost('running', s);
      }

      if (s.done) {
        clearSimulation(true);
        return;
      }
      sim.raf = requestAnimationFrame(simStep);
    }

    /** Fige le véhicule sans rien oublier de son avancement. */
    function pauseSimulation() {
      if (!sim || sim.paused) return;
      if (sim.raf) cancelAnimationFrame(sim.raf);

      sim.raf = 0;
      sim.elapsed = (performance.now() - sim.startedAt) / 1000;
      sim.paused = true;
      simPost('paused', simSample(sim.elapsed));
    }

    /** Reprend là où on s'était arrêté, jamais depuis le départ. */
    function resumeSimulation() {
      if (!sim || !sim.paused) return;

      sim.paused = false;
      // L'origine des temps est reculée de ce qui a déjà été parcouru : la
      // lecture retombe exactement sur l'image où la pause l'avait laissée.
      sim.startedAt = performance.now() - sim.elapsed * 1000;
      sim.raf = requestAnimationFrame(simStep);
    }

    /** Range tout et rend son tracé complet à l'itinéraire. */
    function clearSimulation(finished) {
      // Rien en cours : un arrêt à vide ne doit pas bouger la caméra, l'écran
      // en envoie un à chaque nouvel itinéraire.
      if (!sim) return;

      if (sim.raf) cancelAnimationFrame(sim.raf);
      var full = sim.fullRoute;
      sim = null;

      if (simMarker) { simMarker.remove(); simMarker = null; }
      setRoute(full);
      // La caméra tournée dans le sens de la marche n'a plus lieu d'être.
      if (viewMode === '2d') map.easeTo({ bearing: 0, pitch: 0, duration: 500 });

      post({ type: 'sim', state: 'idle', progress: finished ? 1 : 0, remainingS: 0 });
    }

    function startSimulation(frames, points, durationS) {
      if (sim) clearSimulation(false);
      if (!frames || frames.length < 2 || !points || points.length < 2) return;

      // Le suivi de la position réelle et la simulation viseraient la même
      // caméra : on coupe le premier le temps du second.
      setFollowing(false);

      var el = document.createElement('div');
      el.className = 'sim-car';
      el.innerHTML = CAR_AVAILABLE;
      simMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
        .setLngLat([frames[0].lng, frames[0].lat])
        .addTo(map);

      sim = {
        frames: frames,
        points: points,
        durationS: durationS,
        // Le tracé d'origine, rendu tel quel à la fin de la simulation.
        fullRoute: pendingRoute,
        startedAt: performance.now(),
        elapsed: 0,
        lastPost: 0,
        paused: false,
        zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
        raf: 0,
      };

      // Le tracé planifié remplace celui qui est affiché : sans cela, les
      // indices des images ne désigneraient pas les mêmes sommets.
      setRoute(points);
      sim.raf = requestAnimationFrame(simStep);
    }

    function setViewMode(mode) {
      if (mode === viewMode) return;
      viewMode = mode;

      if (mode === '3d') {
        map.dragRotate.enable();
        map.touchPitch.enable();
        setBuildings(true);
        setFollowing(true);
        if (lastUser) follow(true);
        else map.easeTo({ pitch: PITCH_3D, duration: 700 });
        return;
      }

      map.dragRotate.disable();
      map.touchPitch.disable();
      setBuildings(false);
      setFollowing(false);
      map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
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
        map.flyTo({
          center: [msg.lng, msg.lat],
          zoom: msg.zoom,
          pitch: viewMode === '3d' ? PITCH_3D : 0,
          duration: 900,
        });
      }
      if (msg.type === 'fitRoute' && msg.coords && msg.coords.length) {
        // Cadrer tout le trajet et rester incliné se contredisent : on repasse
        // à plat le temps de la vue d'ensemble.
        setFollowing(false);
        const b = new maplibregl.LngLatBounds(msg.coords[0], msg.coords[0]);
        msg.coords.forEach(function (p) { b.extend(p); });
        map.fitBounds(b, { padding: { top: 96, bottom: 200, left: 48, right: 48 }, duration: 800, maxZoom: 16, pitch: 0 });
      }
      if (msg.type === 'view') setViewMode(msg.mode);
      if (msg.type === 'recenter') { setFollowing(true); follow(true); }
      if (msg.type === 'simulate') {
        if (msg.action === 'start') startSimulation(msg.frames, msg.points, msg.durationS);
        else if (msg.action === 'pause') pauseSimulation();
        else if (msg.action === 'resume') resumeSimulation();
        else clearSimulation(false);
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
        lastUser = ll;
        follow(true);
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

    // Prendre la carte en main coupe le suivi : la caméra ne doit pas se battre
    // avec le doigt. Le bouton de l'application le relance.
    map.on('dragstart', function () { setFollowing(false); });

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
