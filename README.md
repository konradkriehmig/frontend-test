# frontend-test

Minimal monochrome command dashboard with dense live public data feeds.

## Run

From the repository root, serve the files with any static server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

NASA NEO is queried with `DEMO_KEY` and polled at a safer interval to avoid rate-limit lockouts.

## Included feeds

- OpenSky Network (flights)
- ISS position (space)
- NASA NEO feed (space objects)
- NOAA solar wind (space weather)
- Binance WebSocket (crypto)
- Blockchain + mempool WebSockets (transaction flow)
- USGS Earthquakes (seismic)
- GitHub Events (developer activity)
- Open-Meteo Air Quality (environment)
- Live clocks and estimated global counters
If a polled source is unavailable or rate-limited, the dashboard keeps the last known value and shows a subtle age indicator or **SIGNAL LOST** state.
