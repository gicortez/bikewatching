// Import Mapbox and D3 as ES modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

// My Mapbox public token
mapboxgl.accessToken =
  'pk.eyJ1IjoiZ2ljb3J0ZXoiLCJhIjoiY213ZHpsMmExMDl5eTJ4b3RwbzkzZ3k5cyJ9.wvj1c5qxEukt87FPZvyctA';

// Make the map (longitude first, then latitude)
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Style for the bike lanes, shared between Boston and Cambridge
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.4,
};

// Global variables so the helper functions can use them
let stations = [];
let circles;
let timeFilter = -1;

// scales
const radiusScale = d3.scaleSqrt();
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// 1440 minutes in a day, so one bucket for each minute (makes the slider fast)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Turn a station's lon/lat into pixel coordinates on the map
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Turn minutes since midnight into something like "4:30 PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Get the trips within 60 minutes of the chosen minute (wraps around midnight)
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Count arrivals, departures, and total traffic for each station
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    station = { ...station };
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Move the circles to the right spot (runs whenever the map moves)
function updatePositions() {
  if (!circles) return;
  circles
    .attr('cx', (d) => getCoords(d).cx)
    .attr('cy', (d) => getCoords(d).cy);
}

// Redraw the circles for the current time filter
function updateScatterPlot(timeFilter) {
  const filteredStations = computeStationTraffic(stations, timeFilter);

  // bigger circles when filtering, since there are fewer trips
  timeFilter === -1
    ? radiusScale.range([0, 25])
    : radiusScale.range([3, 50]);

  const svg = d3.select('#map').select('svg');

  circles = svg
    .selectAll('circle')
    .data(filteredStations, (d) => d.short_name)
    .join('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5),
    )
    .each(function (d) {
      // tooltip text, make the <title> if it isn't there yet
      let title = d3.select(this).select('title');
      if (title.empty()) {
        title = d3.select(this).append('title');
      }
      title.text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
    });

  updatePositions();
}

// Slider stuff
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  if (circles) {
    updateScatterPlot(timeFilter);
  }
}

map.on('load', async () => {
  // Bike lanes: Boston
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Bike lanes: Cambridge
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Stations
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
    stations = jsonData.data.stations;
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  // Trips (about 260,000 of them)
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      // turn the date strings into Date objects
      trip.started_at = new Date(trip.started_at.replace(' ', 'T'));
      trip.ended_at = new Date(trip.ended_at.replace(' ', 'T'));

      // put each trip in its minute bucket
      departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);

      return trip;
    },
  );
  console.log('Loaded trips:', trips.length);

  // Add traffic info to every station and set up the radius scale
  stations = computeStationTraffic(stations);
  radiusScale
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Draw the circles for the first time, then hook up the slider
  updateScatterPlot(-1);
  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();

  // Keep the circles lined up with the map
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);
});
