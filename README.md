# bhavsetu

## Live Weather

District weather prefers OpenWeather One Call 3.0 for current conditions, hourly forecasts, daily forecasts, and alerts. Add `OPENWEATHER_API_KEY=your_key` to `bhavsetu-backend/.env` and enable the One Call subscription to use it. Without that key, local development falls back to Open-Meteo and shows provider attribution. Open-Meteo's free endpoint is for non-commercial use only; use an OpenWeather or paid Open-Meteo plan for commercial deployment. Restart the backend from `bhavsetu-backend` after changing `.env`. Keep API keys server-side; do not put them in frontend files.