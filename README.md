# frontend-test

Tactical military/space command dashboard with high-frequency public data feeds.

## Run

From the repository root, serve the files with any static server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Included feeds

- OpenSky Network (flights)
- SpaceX Ships (maritime)
- ISS + CelesTrak + NASA NEO (space)
- CoinGecko + Binance WebSocket (market)
- Open-Meteo (weather)
- USGS Earthquakes (seismic)
- GitHub Events (developer activity)
- Wikimedia Recent Changes stream (live edits)

If any source is unavailable or rate-limited, the dashboard switches that channel to a **SIGNAL LOST** state.
