# IngreScan-AI

**Smart Food Risk Analyzer** - AI-powered food ingredient analysis platform supporting the Label Padhega India movement.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://reactjs.org/)

## Overview

IngreScan-AI empowers Indian consumers to make informed, healthy food choices by analyzing packaged food ingredients using AI technology. The platform combines cutting-edge technology with trusted health data from WHO and FSSAI to provide personalized risk assessments and safer alternatives.

**Supporting the Label Padhega India Movement** - Promoting food literacy and consumer awareness across India.

![LinkSnap Preview](IngreScan-AI.png)
## Features

### Smart Ingredient Scanner
- **Text Input**: Manually enter ingredient lists
- **Image Upload with OCR**: Take photos of ingredient labels for automatic extraction
- **AI-Powered Analysis**: Comprehensive health risk assessment using LLM technology

### Risk Analysis Engine
- **Personalized Health Scores**: Based on user profile, medical conditions, and dietary preferences
- **Scientific Backing**: Data from WHO, FSSAI, and PubMed
- **Detailed Insights**: Short-term, long-term health impacts, and side effects
- **Misleading Claims Detection**: Identifies hidden sugars, salts, oils, and harmful additives

### Personal Health Profile
- Track medical conditions and medications
- BMI calculation and exercise frequency
- Diet type preferences (veg, non-veg, vegan, keto, etc.)
- Personalized risk assessments

### AI Chatbot
- Food-focused conversational AI
- Context-aware responses based on scan results
- Ingredient explanations and health impact Q&A
- Safer alternative suggestions

### Visual Analytics
- Interactive charts (bar, pie, radar)
- Ingredient breakdown visualization
- Risk level indicators
- Historical trend tracking

### Scan History & Reports
- Access all previous scans
- Saved analysis reports
- Track food choices over time

## Tech Stack

### Frontend
- **React 19** - Modern UI library
- **TypeScript** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling
- **Wouter** - Lightweight routing
- **tRPC** - End-to-end type-safe APIs
- **shadcn/ui** - Beautiful component library

### Backend
- **Node.js** - Runtime environment
- **Express 4** - Web framework
- **tRPC 11** - Type-safe API layer
- **Drizzle ORM** - Database toolkit
- **SQLite (embedded, default) or MySQL/MariaDB** - Database, chosen by `DATABASE_URL` (see `docs/database.md` in the repository root)

### AI & Services
- **LLM Integration** - AI-powered analysis and chatbot
- **OCR** - Ingredient label text extracted by a vision-capable LLM
- **File storage** - Local `uploads/` directory, or the Forge storage proxy when `BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY` are set

## Installation

### Prerequisites
- Node.js 22.x or higher
- pnpm package manager
- Optional: a MySQL/MariaDB database (without `DATABASE_URL` the app uses an embedded SQLite file)

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/shivrajpatare/IngreScan-AI.git
cd IngreScan-AI
```

2. **Install dependencies**
```bash
pnpm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Run database migrations (MySQL only)**
```bash
DATABASE_URL=mysql://user:pass@127.0.0.1:3306/ingrescan pnpm db:push
```
Skip this step for the embedded SQLite default: its migrations are applied automatically on server start.

5. **Start development server**
```bash
pnpm dev
```

The application will be available at `http://localhost:3000`

## Authentication & AI configuration

- **Local development** (`NODE_ENV` not `production`): with no OAuth portal configured, requests run as a local dev user, and the sign-in buttons simply open `/dashboard`.
- **Production** requires `VITE_OAUTH_PORTAL_URL` and `VITE_APP_ID` (sessions are rejected if their `appId` differs from `VITE_APP_ID`), plus `JWT_SECRET`. Without them there is no login flow and anonymous requests are rejected.
- **AI**: set `OPENAI_API_KEY` (or the Forge key). If the configured API fails, requests now error instead of returning canned analysis. Without any key the built-in keyword engine is used only outside production, unless `ALLOW_LOCAL_LLM_FALLBACK=true`. `LLM_TIMEOUT_MS` (default 60000) sets the request timeout.
- **FreshGuard proxy** (`/api/freshguard/*`) requires a signed-in user and is rate limited to 60 requests/minute per IP.

## Project Structure

```
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── pages/         # Page components
│   │   ├── components/    # Reusable UI components
│   │   ├── lib/           # Utilities and tRPC client
│   │   └── index.css      # Global styles
│   └── public/            # Static assets
├── server/                # Backend Express + tRPC
│   ├── routers.ts         # API endpoints
│   ├── db.ts              # Database queries
│   └── _core/             # Core server functionality
├── drizzle/               # Database schema and migrations
│   └── schema.ts          # Database models
└── shared/                # Shared types and constants
```

## Key Features Implementation

### Ingredient Analysis
The platform uses AI to analyze ingredients against:
- WHO food safety guidelines
- FSSAI regulations
- Scientific research from PubMed
- User's personal health profile

### Label Padhega India Support
- Educational content about hidden ingredients
- Misleading marketing claims detection
- Special focus on children's products
- Consumer awareness messaging

### Personalization
- Risk scores adjusted for individual health conditions
- Dietary preference considerations
- Medication interaction warnings
- Age and BMI-based recommendations

## Privacy & Security

- Secure authentication with Manus OAuth
- HTTPS encryption for all data transmission
- User data stored securely in database
- No sharing of personal health information
- GDPR-style user rights and data control

## License

This project is licensed under the MIT License - see the `license` field in `package.json` (MIT).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Contact

**Project Maintainer**: Shivraj Patare
- GitHub: [@shivrajpatare](https://github.com/shivrajpatare)

## Acknowledgments

- **Label Padhega India Movement** - Inspiring consumer awareness
- **Revant Himatsingka (@foodpharmer)** - Food literacy advocacy
- **WHO & FSSAI** - Trusted health data sources
- **Open Source Community** - Amazing tools and libraries

## Links

- **Live Demo**: https://foodriskanaly-yjkguatc.manus.space/
- **Documentation**: the `docs/` folder in the repository root
- **Label Padhega India**: Learn more about the movement

---

**Made with love for a healthier India**

*"Know What You Eat - Make Informed Choices"*
