import React, { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./styles.css";

// Elevation Profile Service
class ElevationProfileService {
  async querySelectedLine(map, point, layerIds = ["all_streams"]) {
    try {
      const features = map.queryRenderedFeatures(point, {
        layers: layerIds,
      });

      if (features.length > 0) {
        const lineFeature = features[0];
        const coordinates = lineFeature.geometry.coordinates;

        if (lineFeature.geometry.type === "MultiLineString") {
          return {
            coordinates: coordinates[0],
            feature: lineFeature,
          };
        }

        return {
          coordinates: coordinates,
          feature: lineFeature,
        };
      }

      return null;
    } catch (error) {
      console.error("line query failed:", error);
      return null;
    }
  }

  haversineDistance(coord1, coord2) {
    const R = 6371000;
    const lat1 = (coord1[1] * Math.PI) / 180;
    const lat2 = (coord2[1] * Math.PI) / 180;
    const deltaLat = ((coord2[1] - coord1[1]) * Math.PI) / 180;
    const deltaLng = ((coord2[0] - coord1[0]) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLng / 2) *
        Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  calculateCumulativeDistances(coordinates) {
    const distances = [0];
    let totalDistance = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const segmentDistance = this.haversineDistance(
        coordinates[i - 1],
        coordinates[i]
      );
      totalDistance += segmentDistance;
      distances.push(totalDistance);
    }

    return distances;
  }

  async getElevationFromMapbox(map, coordinates) {
    try {
      // Skip Mapbox elevation entirely since the API is deprecated
      // and causing 404 errors. Go straight to Open Elevation.
      console.log(
        "Skipping Mapbox elevation API (deprecated/unreliable) - using Open Elevation instead"
      );
      throw new Error("Mapbox elevation API skipped");
    } catch (error) {
      console.log("Mapbox elevation skipped:", error.message);
      throw error;
    }
  }

  // Fallback method using Open Elevation API
  async getElevationFromOpenElevation(coordinates) {
    try {
      const maxPoints = 50; // Increased from 30 since we're not using Mapbox anymore
      const step = Math.max(1, Math.floor(coordinates.length / maxPoints));
      const sampledCoords = coordinates.filter(
        (_, index) => index % step === 0
      );

      console.log(
        `Using Open Elevation for ${sampledCoords.length} points (optimized)`
      );

      const locations = sampledCoords.map((coord) => ({
        latitude: coord[1],
        longitude: coord[0],
      }));

      const response = await fetch(
        "https://api.open-elevation.com/api/v1/lookup",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ locations }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const distances = this.calculateCumulativeDistances(sampledCoords);

      const elevationData = data.results.map((result, index) => ({
        longitude: sampledCoords[index][0],
        latitude: sampledCoords[index][1],
        elevation: result.elevation,
        distance: distances[index],
        distanceKm: distances[index] / 1000,
      }));

      console.log(
        `Successfully retrieved elevation data for ${elevationData.length} points`
      );
      return elevationData;
    } catch (error) {
      console.error("Open-Elevation API failed:", error);
      throw error;
    }
  }

  async getElevationProfile(coordinates, map) {
    if (!coordinates || coordinates.length < 2) {
      throw new Error("Invalid coordinates: need at least 2 points");
    }

    console.log(
      `Getting elevation profile for ${coordinates.length} coordinates`
    );

    let elevationData;

    // Use Open Elevation directly since Mapbox elevation API is deprecated/broken
    try {
      elevationData = await this.getElevationFromOpenElevation(coordinates);
    } catch (error) {
      console.error("Elevation API failed:", error);
      throw new Error("Failed to get elevation data. Please try again.");
    }

    const elevations = elevationData.map((point) => point.elevation);
    const totalDistance = elevationData[elevationData.length - 1].distance;

    console.log(
      "Elevation range:",
      Math.min(...elevations),
      "to",
      Math.max(...elevations),
      "meters"
    );

    return {
      points: elevationData,
      statistics: {
        totalDistanceMeters: totalDistance,
        totalDistanceKm: totalDistance / 1000,
        minElevation: Math.min(...elevations),
        maxElevation: Math.max(...elevations),
        elevationGain: this.calculateElevationGain(elevations),
        elevationLoss: this.calculateElevationLoss(elevations),
        numberOfPoints: elevationData.length,
      },
    };
  }

  calculateElevationGain(elevations) {
    let gain = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) gain += diff;
    }
    return gain;
  }

  calculateElevationLoss(elevations) {
    let loss = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff < 0) loss += Math.abs(diff);
    }
    return loss;
  }
}

// Elevation Chart Component
const ElevationChart = ({ profile }) => {
  if (!profile || !profile.points.length) {
    console.log("No profile data for chart");
    return null;
  }

  const { points, statistics } = profile;
  console.log("Rendering chart with", points.length, "points");
  console.log(
    "Elevation range:",
    statistics.minElevation,
    "to",
    statistics.maxElevation
  );

  const width = 800;
  const height = 150;
  const margin = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const maxDistance = Math.max(...points.map((p) => p.distance));
  const minElevation = statistics.minElevation;
  const maxElevation = statistics.maxElevation;
  const elevationRange = maxElevation - minElevation;

  // Handle case where all elevations are the same
  const effectiveRange = elevationRange > 0 ? elevationRange : 100;

  const xScale = (distance) => (distance / maxDistance) * chartWidth;
  const yScale = (elevation) => {
    if (elevationRange === 0) {
      return chartHeight / 2; // Center line if no elevation change
    }
    return (
      chartHeight - ((elevation - minElevation) / elevationRange) * chartHeight
    );
  };

  const pathData = points
    .map((point, index) => {
      const x = xScale(point.distance);
      const y = yScale(point.elevation);
      console.log(
        `Point ${index}: distance=${point.distance}, elevation=${point.elevation}, x=${x}, y=${y}`
      );
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(" ");

  const areaData = `${pathData} L ${xScale(
    maxDistance
  )} ${chartHeight} L 0 ${chartHeight} Z`;

  console.log("SVG path data:", pathData);

  return (
    <div className="chart-container">
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={`grid-y-${ratio}`}
              x1="0"
              y1={ratio * chartHeight}
              x2={chartWidth}
              y2={ratio * chartHeight}
              className="chart-axis"
              opacity="0.3"
            />
          ))}

          <path
            d={areaData}
            className="chart-area"
            transform={`translate(0, 0)`}
          />
          <path d={pathData} className="chart-line" />

          <line
            x1="0"
            y1={chartHeight}
            x2={chartWidth}
            y2={chartHeight}
            className="chart-axis"
          />
          <line x1="0" y1="0" x2="0" y2={chartHeight} className="chart-axis" />

          <text x="-10" y="5" className="chart-text" textAnchor="end">
            {Math.round(maxElevation)} ft
          </text>
          <text
            x="-10"
            y={chartHeight + 5}
            className="chart-text"
            textAnchor="end"
          >
            {Math.round(minElevation)} ft
          </text>

          <text
            x="0"
            y={chartHeight + 20}
            className="chart-text"
            textAnchor="start"
          >
            0
          </text>
          <text
            x={chartWidth}
            y={chartHeight + 20}
            className="chart-text"
            textAnchor="end"
          >
            {(maxDistance / 1000).toFixed(1)} miles
          </text>
        </g>
      </svg>
    </div>
  );
};

// Main App Component
const App = () => {
  const [map, setMap] = useState(null);
  const [elevationProfile, setElevationProfile] = useState(null);
  const [selectedStreamFeature, setSelectedStreamFeature] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showInstructions, setShowInstructions] = useState(true);
  const mapContainer = useRef(null);
  const elevationService = useRef(new ElevationProfileService()).current;

  // Function to highlight selected stream
  const highlightSelectedStream = (map, feature) => {
    // Remove existing highlighted stream
    if (map.getSource("highlighted-stream")) {
      map.removeLayer("highlighted-stream");
      map.removeSource("highlighted-stream");
    }

    if (feature) {
      // Add source for highlighted stream
      map.addSource("highlighted-stream", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: feature.geometry,
          properties: feature.properties,
        },
      });

      // Add layer for highlighted stream
      map.addLayer({
        id: "highlighted-stream",
        type: "line",
        source: "highlighted-stream",
        paint: {
          "line-color": "#ff6b35",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            4,
            12,
            6,
            16,
            8,
          ],
          "line-opacity": 0.9,
        },
      });
    }
  };

  // Function to clear selection
  const clearSelection = () => {
    setElevationProfile(null);
    setSelectedStreamFeature(null);

    if (map && map.getSource("highlighted-stream")) {
      map.removeLayer("highlighted-stream");
      map.removeSource("highlighted-stream");
    }
  };

  useEffect(() => {
    // Replace with your Mapbox token
    mapboxgl.accessToken =
      "pk.eyJ1IjoiamNoaWxsIiwiYSI6ImNrZGl0cGlpbzA4ZmEzMm8wZHdkYmJiNDMifQ.C941o-cDXISu58gsmm8sIw";

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [-110.0, 41],
      zoom: 10,
    });

    const handleMapClick = async (event) => {
      if (!mapInstance) return;

      setLoading(true);
      setError(null);

      try {
        const result = await elevationService.querySelectedLine(
          mapInstance,
          [event.point.x, event.point.y],
          ["all_streams"]
        );

        if (result && result.coordinates) {
          const profile = await elevationService.getElevationProfile(
            result.coordinates,
            mapInstance
          );

          setElevationProfile(profile);
          setSelectedStreamFeature(result.feature);
          setShowInstructions(false);

          // Highlight the selected stream
          highlightSelectedStream(mapInstance, result.feature);
        } else {
          setError(
            "No trout stream found. Please click on a blue stream line."
          );
        }
      } catch (err) {
        console.error("Failed to get elevation profile:", err);
        setError("Failed to get elevation data. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    // Handle clicks on the map background to clear selection
    const handleBackgroundClick = (event) => {
      // Check if click was on a stream
      const features = mapInstance.queryRenderedFeatures(event.point, {
        layers: ["all_streams"],
      });

      // If no stream was clicked, clear the selection
      if (features.length === 0) {
        clearSelection();
      }
    };

    mapInstance.on("load", () => {
      // Enable terrain (3D elevation)
      mapInstance.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      mapInstance.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

      // Add USGS NHD Flowlines using GeoJSON from ArcGIS REST API
      mapInstance.addSource("nhd_flowlines", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [], // Start empty, will be populated when map moves
        },
        cluster: false,
        lineMetrics: true,
      });

      // Add all streams layer
      mapInstance.addLayer({
        id: "all_streams",
        type: "line",
        source: "nhd_flowlines",
        paint: {
          "line-color": "#4A90E2",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            1,
            12,
            2,
            16,
            3,
          ],
          "line-opacity": 0.7,
        },
        filter: ["!=", ["get", "FTYPE"], 336], // Exclude canals/ditches
      });

      // Function to load streams for current view
      const loadStreamsForView = async () => {
        const bounds = mapInstance.getBounds();
        const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

        try {
          const url =
            `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/4/query?` +
            `where=1=1&` +
            `outFields=*&` +
            `geometry=${bbox}&` +
            `geometryType=esriGeometryEnvelope&` +
            `inSR=4326&` +
            `spatialRel=esriSpatialRelIntersects&` +
            `outSR=4326&` +
            `f=geojson&` +
            `maxRecordCount=1000`;

          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();

            // Update the source with new data
            mapInstance.getSource("nhd_flowlines").setData(data);
          }
        } catch (error) {
          console.warn("Failed to load stream data:", error);
        }
      };

      // Load initial data
      loadStreamsForView();

      // Reload data when map finishes moving
      mapInstance.on("moveend", () => {
        if (mapInstance.getZoom() >= 8) {
          // Only load at sufficient zoom level
          loadStreamsForView();
        }
      });

      // Add click handler for stream layer
      mapInstance.on("click", "all_streams", handleMapClick);

      // Add click handler for map background
      mapInstance.on("click", handleBackgroundClick);

      // Change cursor on hover
      mapInstance.on("mouseenter", "all_streams", () => {
        mapInstance.getCanvas().style.cursor = "pointer";
      });
      mapInstance.on("mouseleave", "all_streams", () => {
        mapInstance.getCanvas().style.cursor = "";
      });
    });

    setMap(mapInstance);

    return () => mapInstance.remove();
  }, []);

  const formatDistance = (meters) => {
    return meters > 1000
      ? `${(meters / 1000).toFixed(1)} miles`
      : `${Math.round(meters)} m`;
  };

  const formatElevation = (elevation) => {
    return `${Math.round(elevation)} ft`;
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Stream Elevation Profile</h1>
        <p>USGS National Hydrography Dataset and Open Elevation Data</p>
      </header>

      <div className="map-container">
        <div ref={mapContainer} className="map" />

        {loading && (
          <div className="loading-overlay">🔄 Loading elevation data...</div>
        )}

        {error && (
          <div className="error-overlay">
            ⚠️ {error}
            <button className="close-button" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}
      </div>

      {elevationProfile && (
        <div className="elevation-panel">
          <div className="elevation-header">
            <h3>Elevation Profile</h3>
            <button
              className="clear-selection-button"
              onClick={clearSelection}
              title="Clear selection"
            >
              ×
            </button>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-label">Distance (Updated)</div>
                <div className="stat-value">
                  {formatDistance(
                    elevationProfile.statistics.totalDistanceMeters
                  )}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Min Elevation</div>
                <div className="stat-value">
                  {formatElevation(elevationProfile.statistics.minElevation)}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Max Elevation</div>
                <div className="stat-value">
                  {formatElevation(elevationProfile.statistics.maxElevation)}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Elevation Gain</div>
                <div className="stat-value">
                  {formatElevation(elevationProfile.statistics.elevationGain)}
                </div>
              </div>
            </div>
          </div>
          <div className="elevation-chart">
            <ElevationChart profile={elevationProfile} />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
