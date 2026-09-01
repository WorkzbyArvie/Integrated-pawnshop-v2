import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, MapPin, Locate, X } from 'lucide-react';

// Fix Leaflet default marker icon issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const goldIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationSelect: (lat: number, lng: number) => void;
  onAddressResolve?: (address: string) => void;
  readOnly?: boolean;
}

function ClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyToLocation({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) {
      map.flyTo([lat, lng], 16, { duration: 1.2 });
    }
  }, [lat, lng, map]);
  return null;
}

export function LocationPicker({
  latitude,
  longitude,
  onLocationSelect,
  onAddressResolve,
  readOnly = false,
}: LocationPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Default center: Philippines (general area)
  const defaultCenter: [number, number] = [10.7202, 122.5621]; // Iloilo City
  const center: [number, number] = latitude && longitude ? [latitude, longitude] : defaultCenter;
  const zoom = latitude && longitude ? 16 : 12;

  // Reverse geocode to get address from coordinates
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      if (!onAddressResolve) return;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          { headers: { 'User-Agent': 'PawnGold/1.0' } }
        );
        const data = await res.json();
        if (data.display_name) {
          onAddressResolve(data.display_name);
        }
      } catch {
        // Silently fail reverse geocoding
      }
    },
    [onAddressResolve]
  );

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (readOnly) return;
      onLocationSelect(lat, lng);
      reverseGeocode(lat, lng);
    },
    [readOnly, onLocationSelect, reverseGeocode]
  );

  // Forward geocode (search)
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&countrycodes=ph`,
        { headers: { 'User-Agent': 'PawnGold/1.0' } }
      );
      const data = await res.json();
      setSearchResults(data);
      setShowResults(true);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const selectSearchResult = (result: any) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    onLocationSelect(lat, lng);
    if (onAddressResolve) {
      onAddressResolve(result.display_name);
    }
    setShowResults(false);
    setSearchQuery(result.display_name);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Get user's current location
  const handleLocateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationSelect(pos.coords.latitude, pos.coords.longitude);
        reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        // Silently fail
      },
      { enableHighAccuracy: true }
    );
  };

  return (
    <div className="space-y-3">
      {/* Search Bar */}
      {!readOnly && (
        <div className="relative" ref={searchRef}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A8279]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search address in Philippines..."
                className="w-full pl-10 pr-8 py-2.5 bg-[#1C1C26] border border-[rgba(201,160,92,0.12)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setShowResults(false);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[#222228] rounded"
                >
                  <X className="w-3.5 h-3.5 text-[#8A8279]" />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {searching ? '...' : 'Search'}
            </button>
            <button
              onClick={handleLocateMe}
              title="Use my current location"
              className="px-3 py-2.5 bg-[#1C1C26] border border-[rgba(201,160,92,0.12)] rounded-xl hover:bg-[#222228] transition-colors"
            >
              <Locate className="w-4 h-4 text-[#B8B0A4]" />
            </button>
          </div>

          {/* Search Results Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute z-[1000] mt-1 w-full bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-xl shadow-lg max-h-60 overflow-auto">
              {searchResults.map((result, i) => (
                <button
                  key={i}
                  onClick={() => selectSearchResult(result)}
                  className="w-full text-left px-4 py-3 hover:bg-[#C9A05C]/10 transition-colors border-b last:border-0 border-[rgba(201,160,92,0.08)]"
                >
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-[#8A8279] line-clamp-2">{result.display_name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Map */}
      <div className="rounded-2xl overflow-hidden border border-[rgba(201,160,92,0.12)] shadow-sm" style={{ height: 350 }}>
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {!readOnly && <ClickHandler onLocationSelect={handleMapClick} />}
          {latitude && longitude && (
            <>
              <Marker position={[latitude, longitude]} icon={goldIcon} />
              <FlyToLocation lat={latitude} lng={longitude} />
            </>
          )}
        </MapContainer>
      </div>

      {/* Coordinate Display */}
      {latitude && longitude && (
        <div className="flex items-center gap-2 text-xs text-[#8A8279] font-mono bg-[#1C1C26] px-3 py-2 rounded-lg">
          <MapPin className="w-3.5 h-3.5 text-blue-500" />
          <span>
            {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </span>
        </div>
      )}

      {!readOnly && (
        <p className="text-xs text-[#8A8279]">
          Click on the map, search an address, or use your current location to set the pin.
        </p>
      )}
    </div>
  );
}
