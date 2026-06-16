"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Coords = { lat: number; lng: number };

// A self-contained SVG pin via divIcon — avoids Leaflet's default marker images,
// which break under bundlers without extra path wiring.
const pinIcon = L.divIcon({
  className: "",
  html: `<svg width="28" height="28" viewBox="0 0 24 24" fill="#16a34a" stroke="white" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5" fill="white" stroke="none"/></svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28], // tip at bottom-center
});

const DEFAULT_CENTER: [number, number] = [39.5, -98.35]; // continental US, used pre-location
const LOCATED_ZOOM = 11;

/** Keep the map centered on coords when they change from outside (geolocation, search, typing). */
function Recenter({ coords }: { coords: Coords | null }) {
  const map = useMap();
  useEffect(() => {
    if (coords) map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), LOCATED_ZOOM));
  }, [coords, map]);
  return null;
}

/** Drop the pin where the user taps the map. */
function ClickHandler({ onPick }: { onPick: (c: Coords) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function SearchBox({ onPick }: { onPick: (c: Coords) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data = (await res.json()) as { lat: string; lon: string }[];
      if (data[0]) onPick({ lat: Number(data[0].lat), lng: Number(data[0].lon) });
      else setError("No place found.");
    } catch {
      setError("Search failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={search} className="flex gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a place (e.g. Stanley Park)…"
        className="w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
      />
      <button
        type="submit"
        disabled={busy || !query.trim()}
        className="shrink-0 rounded-md border border-green-600 px-3 py-1 text-sm font-medium text-green-700 transition hover:bg-green-50 disabled:opacity-40 dark:text-green-400 dark:hover:bg-green-950/30"
      >
        {busy ? "…" : "Search"}
      </button>
      {error && <span className="self-center text-xs text-amber-600 dark:text-amber-400">{error}</span>}
    </form>
  );
}

interface LocationMapProps {
  coords: Coords | null;
  radiusKm: number;
  onChange: (c: Coords) => void;
}

/** Pick a location by searching, tapping the map, or dragging the pin. The green
 *  circle shows the search radius. Writes the chosen point back via onChange. */
export default function LocationMap({ coords, radiusKm, onChange }: LocationMapProps) {
  // React Strict Mode double-invokes mount effects in dev, which makes Leaflet
  // initialize twice on the same node ("Map container is being reused"). Mounting
  // the map only after a post-mount state flip means MapContainer first appears
  // during a re-render — which Strict Mode does not double-invoke — so Leaflet
  // initializes exactly once.
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time deferral
    setMapReady(true);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <SearchBox onPick={onChange} />
      {mapReady ? (
      <MapContainer
        center={coords ? [coords.lat, coords.lng] : DEFAULT_CENTER}
        zoom={coords ? LOCATED_ZOOM : 3}
        scrollWheelZoom
        className="h-64 w-full rounded-lg border border-black/10 dark:border-white/15"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {coords && (
          <>
            <Marker
              position={[coords.lat, coords.lng]}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend(e) {
                  const ll = (e.target as L.Marker).getLatLng();
                  onChange({ lat: ll.lat, lng: ll.lng });
                },
              }}
            />
            <Circle
              center={[coords.lat, coords.lng]}
              radius={radiusKm * 1000}
              pathOptions={{ color: "#16a34a", weight: 1, fillColor: "#16a34a", fillOpacity: 0.08 }}
            />
          </>
        )}
        <Recenter coords={coords} />
        <ClickHandler onPick={onChange} />
      </MapContainer>
      ) : (
        <div className="h-64 w-full animate-pulse rounded-lg border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/5" />
      )}
      <p className="text-xs opacity-60">Search, tap the map, or drag the pin to set your location.</p>
    </div>
  );
}
