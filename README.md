# Forest Department Land Management System (FD-LMS)
### Cadastral Boundary Portal &bull; Bangladesh Forest Department

A high-performance Full-Stack WebGIS cadastral management portal powered by **FastAPI** and **Supabase Cloud (PostgreSQL / PostGIS)**.

---

## Architecture & Features

1. **Cloud Database (Supabase Free Tier)**:
   - Cadastral plot boundaries and attribute data hosted on Supabase PostgreSQL with PostGIS.
   - Dual-mode backend (`server/db.py`): queries Supabase Cloud directly over HTTPS/PostgreSQL with automatic local fallback.
   - Synchronized cloud state across multiple development and field machines.

2. **Ultra-Fast Vector Rendering**:
   - Single HTML5 canvas vector rendering via Leaflet with zero DOM bloat.
   - Interior label centers precomputed for instant display.
   - In-memory cache delivers entire boundary datasets in under 60ms.

3. **Interactive Parcel Dossier**:
   - Interactive plot selection displaying **Plot Number**, **Area (Acre)**, **Mouza**, **JL No**, and **Beat Name**.
   - Spatial bounding extent and printable dossier cards.

4. **Normalized Search & Export**:
   - Instant autocomplete matching plot numbers and mouza names with relevance ranking.
   - Automatic zoom and boundary fitting to parcel level.
   - Full CSV export of all cadastral parcels.

---

## Quick Start (Setup on Home PC or New Machine)

### 1. Clone the Repository
```bash
git clone <YOUR-GITHUB-REPO-URL>
cd FD-LMS
```

### 2. Create Virtual Environment & Install Dependencies
```bash
python -m venv venv

# Windows PowerShell:
.\venv\Scripts\Activate.ps1

# Windows Command Prompt:
.\venv\Scripts\activate.bat

# Install dependencies:
pip install -r requirements.txt
```

### 3. Configure Environment
Copy the example environment file:
```bash
cp .env.example .env
```
Open `.env` and verify your Supabase Cloud settings:
```env
SUPABASE_URL="https://tbffjjlkmzswcmwdkulh.supabase.co"
SUPABASE_KEY="your-publishable-anon-key"
```

### 4. Launch the Portal
```bash
python run.py
```
The application will start on `http://127.0.0.1:8000` and automatically connect to your Supabase Cloud database!

---

## Project Structure

```
FD-LMS/
├── .agents/skills/              # Supabase Agent Skills
├── data/                        # Local file archive & raw storage
├── scripts/                     # Migration and utility scripts
├── server/
│   ├── db.py                    # Dual-mode Supabase Cloud database layer
│   └── main.py                  # FastAPI REST API & static file router
├── static/
│   ├── css/styles.css           # Modern dark glassmorphic GIS styling
│   ├── js/app.js                # Search, UI coordination, and events
│   ├── js/map.js                # Leaflet canvas WebGIS engine
│   ├── js/dossier.js            # Parcel Identification sidebar component
│   └── index.html               # Single-page dashboard
├── requirements.txt             # Python dependencies
├── run.py                       # Root launcher
├── .env.example                 # Template environment configuration
└── README.md
```
