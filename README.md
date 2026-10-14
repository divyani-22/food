# FoodIQ – Smart Food AI & Freshness Safety Platform

An all-in-one AI-powered food intelligence platform combining **Fresh Produce Inspection** and **Packaged Food Risk Analysis**.

---

## Overview

**FoodIQ** provides a comprehensive 360° food safety suite:
1. **Fresh Produce AI Inspector (FreshGuard)**: Uses Computer Vision (PyTorch EfficientNet-B0) to classify fruit/vegetable types (10 classes), inspect real-time freshness (fresh / normal / rotten), estimate remaining shelf life, and provide optimal storage guidelines.
2. **Packaged Food & Ingredient Scanner (IngreScan-AI)**: Uses OCR and AI analysis to decode nutrition labels, detect harmful additives and allergens, evaluate health risks against WHO/FSSAI data, and recommend safer dietary alternatives.
3. **Smart Fridge Pantry**: Tracks both fresh produce and packaged groceries to minimize food waste and optimize healthy eating.

---

## Features

### Fresh Produce Inspection
- **Instant Spoilage & Freshness Detection**: Snap a photo or upload an image to determine if fresh produce is prime, nearing expiration, or spoiled.
- **Shelf Life Estimation**: Calculates estimated days remaining based on classification status.
- **Scientific Storage Tips**: Detailed temperature, ethylene gas, and packaging recommendations to maximize freshness.
- **Culinary Guidance**: Tailored recipe and usage advice based on ripeness.
- **Supported Produce**: Apples, Bananas, Bell Peppers, Carrots, Cucumbers, Mangoes, Oranges, Potatoes, Strawberries, and Tomatoes.

### Packaged Food & Ingredient Scanner
- **OCR Label Extraction**: Extracts full ingredient lists from food packaging photos.
- **Health Risk Scoring**: Evaluates additives, sodium, hidden sugars, trans fats, and harmful preservatives.
- **Allergen & Diet Matching**: Customized recommendations matching user health profiles and dietary restrictions.
- **Safer Alternatives**: Scientific recommendations for healthier brand substitutions.

### Smart Fridge & Pantry Management
- Manage perishables with automated expiration warnings.
- Keep a complete digital log of all scanned food items.

---

## Tech Stack

### Frontend & Web App
- **React 19** with **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui**
- **Wouter** routing
- **Lucide Icons**

### Backend & Microservices
- **Express 4 & Node.js** (API Gateway, reverse proxy, and web server)
- **Flask (Python 3)** (AI Inference Microservice)
- **tRPC 11** (Type-safe API layer)
- **SQLite** (Fridge inventory and history storage)

### AI & Machine Learning
- **PyTorch** & **Torchvision** (EfficientNet-B0 Multi-task neural network)
- **Tesseract / OCR & LLM Analysis**

---

## Quick Start

### 1. Requirements
- Node.js (v18+)
- Python (3.9+): `pip install -r requirements.txt` (torch, torchvision, flask, flask-cors, pillow)
- MySQL or MariaDB for the IngreScan web app (scans, profile, fridge, chat)

### 2. Run with One Click (Windows)
Double click or execute:
```cmd
start_all.bat
```
This automatically boots:
1. FreshGuard AI service on `http://127.0.0.1:5000`
2. Unified Web Application on `http://localhost:3000`
3. Opens `http://localhost:3000` directly in your default browser.

### 3. Manual Start

**Start AI Service:**
```bash
python app.py
```

**Create the database (first run only):**
```bash
mysql -u root -e "CREATE DATABASE ingrescan; CREATE USER 'ingrescan'@'localhost' IDENTIFIED BY 'devpass'; GRANT ALL ON ingrescan.* TO 'ingrescan'@'localhost';"
cd IngreScan-AI
pnpm install
DATABASE_URL="mysql://ingrescan:devpass@127.0.0.1:3306/ingrescan" pnpm db:push
```

**Start Unified Web Application:**
```bash
cd IngreScan-AI
DATABASE_URL="mysql://ingrescan:devpass@127.0.0.1:3306/ingrescan" JWT_SECRET=change-me pnpm dev
```
In development you are signed in automatically as a local user. Production
(`pnpm build && pnpm start`) requires OAuth settings (`VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID`,
`OAUTH_SERVER_URL`) and an LLM key (`OPENAI_API_KEY`); see `IngreScan-AI/README.md`.

### 4. Tests
```bash
python -m pytest tests -q                 # Flask API + real-model check (needs torch)
cd IngreScan-AI && pnpm check && pnpm test   # type-check + server unit tests
# Full browser journey (both servers running, DB as above):
npx playwright@1.56.1 install chromium && node e2e/full-journey.mjs
```

The FreshGuard page's CSS is prebuilt in `static/css/freshguard.css`; after editing
`templates/index.html`, run `cd tools/freshguard-css && npm install && npm run build`.

Visit **[http://localhost:3000](http://localhost:3000)** to use the application.

---

## License
MIT License - Created by [divyani-22](https://github.com/divyani-22)
