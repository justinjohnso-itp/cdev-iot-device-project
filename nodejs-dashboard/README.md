# Piano Dashboard

A dashboard application that visualizes piano activity data from MQTT messages.

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

## Local Development Setup

### Setting Up PostgreSQL Database

1. **Install PostgreSQL**

   ```bash
   # macOS (using Homebrew)
   brew install postgresql
   brew services start postgresql
   
   # Ubuntu/Debian
   sudo apt update
   sudo apt install postgresql postgresql-contrib
   sudo systemctl start postgresql
   ```

2. **Create a Database**

   ```bash
   # Connect to PostgreSQL
   psql postgres
   
   # Create a new database
   CREATE DATABASE piano_dashboard;
   
   # Create a user (optional)
   CREATE USER pianouser WITH PASSWORD 'yourpassword';
   
   # Grant privileges
   GRANT ALL PRIVILEGES ON DATABASE piano_dashboard TO pianouser;
   
   # Exit postgres console
   \q
   ```

3. **Update Environment Variables**

   Edit the `.env` file to match your database credentials:
   ```
   POSTGRES_URL=postgresql://pianouser:yourpassword@localhost:5432/piano_dashboard
   ```

### Installation and Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Initialize the database**

   ```bash
   npm run setup
   ```

3. **Start the server**

   ```bash
   npm start
   ```

The application will be available at [http://localhost:3000](http://localhost:3000).

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

- `GET /api/readings` - Get sensor readings
- `GET /api/sessions` - Get piano session data
- `GET /api/stats` - Get statistics
- `GET /status` - Get server status

## License

MIT
