# Piano Activity Dashboard

A real-time dashboard that tracks piano activity using MQTT, Node.js, and Vercel Postgres. This project visualizes data from a connected piano setup with sensors that detect player presence and notes played.

## Features

- Real-time monitoring of piano activity
- Statistics on player sessions and usage
- Displays piano notes and frequencies detected
- Multiple visualization options (daily/weekly views)
- Tracks proximity data from ToF sensor

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript, Chart.js
- **Backend**: Serverless API Routes
- **Database**: Vercel Postgres
- **Real-time Communication**: MQTT
- **Deployment**: Vercel

## Local Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a local Postgres database and update the `.env` file:
   ```
   POSTGRES_URL=postgresql://username:password@localhost:5432/piano_dashboard
   MQTT_USER=conndev
   MQTT_PASSWORD=b4s1l!
   ```
4. Build the frontend:
   ```
   npm run build
   ```
5. Run with Vercel CLI for local development:
   ```
   vercel dev
   ```

## Deployment to Vercel

1. Deploy to Vercel:
   ```
   vercel
   ```
2. Once deployed, go to your Vercel dashboard and add a Postgres database:
   - Navigate to the Storage tab
   - Click "Add" and select "Postgres"
   - Follow the setup instructions
   - Vercel automatically adds the connection string as an environment variable

3. Redeploy the application after setting up the database:
   ```
   vercel --prod
   ```

## Database Schema

The application uses two main tables:

1. **readings** - Stores all sensor readings
   - id: SERIAL (primary key)
   - timestamp: TIMESTAMPTZ
   - distance: INTEGER (proximity in mm)
   - volume: INTEGER (sound level)
   - frequency: FLOAT (detected frequency in Hz)
   - note: VARCHAR(3) (detected note, e.g., "A#")
   - octave: INTEGER (note octave number)

2. **player_sessions** - Tracks when players start and end playing
   - id: SERIAL (primary key)
   - start_time: TIMESTAMPTZ
   - end_time: TIMESTAMPTZ
   - duration_seconds: INTEGER

## API Endpoints

- GET `/api/readings?hours=24` - Get sensor readings for the past X hours
- GET `/api/sessions?days=7` - Get player sessions for the past X days
- GET `/api/stats` - Get dashboard statistics
- GET `/api/status` - Server status check

## License

MIT
