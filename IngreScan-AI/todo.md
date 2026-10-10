# Smart Food Risk Analyzer - Project TODO

## User Module
- [x] User authentication (login/signup via Manus OAuth)
- [x] User profile page with personal details form
- [x] Personal details: name, age, gender, height, weight, BMI calculation
- [x] Exercise frequency selection
- [x] Diet type selection (veg, non-veg, vegan, keto, other)
- [x] Health history section: medical conditions
- [x] Current medications list
- [x] Past medications list

## Ingredient Scanner
- [x] Text input for manual ingredient entry
- [x] Image upload for ingredient label photos
- [x] OCR processing integration (Google Vision API or Tesseract)
- [x] Ingredient extraction from OCR results
- [x] Display extracted ingredients list

## Risk Analysis Engine
- [x] FSSAI data source integration
- [x] WHO Food Safety data source integration
- [x] Scientific name translation for ingredients
- [x] Health impact analysis (short-term, long-term, side effects)
- [x] Cross-check with user profile for personalized risks
- [x] Risk score calculation
- [x] Data visualization with charts (bar, pie, radar)
- [x] Data visualization with graphs (line, stacked)
- [ ] Regional risk mapping

## Dashboard
- [x] User scan history display
- [x] Saved reports list
- [x] Current scan result display
- [x] Risk score visualization
- [x] Ingredient breakdown view
- [x] Safer alternatives suggestions
- [x] Scientific justification for alternatives
- [x] Source citations (PubMed, WHO, FSSAI)

## AI Chatbot
- [x] Food-only chatbot mode
- [x] Explain ingredient functionality
- [x] Answer health impact questions
- [x] Suggest alternatives based on user context
- [x] Context-aware responses using user profile
- [x] Chat interface with message history

## Backend Infrastructure
- [x] Database schema for users, scans, ingredients, health data
- [x] API endpoints for all features
- [x] File upload handling for images
- [x] OCR service integration
- [x] External API integrations (FSSAI, WHO)
- [x] LLM integration for chatbot

## Frontend UI
- [x] Landing page with app introduction
- [x] Navigation structure
- [x] Responsive design for mobile and desktop
- [x] Loading states and error handling
- [x] Theme and styling consistency


## Bug Fixes
- [x] Fix profile.get query returning undefined instead of null when profile doesn't exist
- [x] Fix Scanner page showing 404 error

## Label Padhega India Campaign Support
- [x] Add educational content about hidden ingredients (sugar, salt, oil, additives)
- [x] Highlight misleading marketing claims detection
- [x] Add special focus on products targeted at children
- [x] Include campaign branding and awareness messaging
- [ ] Add sharing features for consumer awareness
- [x] Fix Page 2 navigation in sidebar showing 404 error
- [x] Add inline chat/question section on scan result page for context-aware queries
- [ ] Fix OAuth authentication causing Google 404 error when logging in with another account

## Pre-Launch Critical Items
- [x] Create Privacy Policy page
- [x] Create Terms of Service page
- [x] Create About page with Label Padhega India information
- [x] Add profile completion prompt on scanner page

## New Features - Barcode Scanner
- [x] Add barcode scanning UI component
- [x] Integrate device camera for barcode capture
- [x] Connect to Open Food Facts API
- [x] Auto-populate product name and ingredients from barcode data
- [x] Add barcode tab to scanner page
- [x] Handle barcode lookup errors gracefully

## Bug Fixes
- [x] Fix barcode scanner DOM element not found error on initialization

## Removal Tasks
- [x] Remove barcode scanner feature from Scanner page
- [x] Remove BarcodeScanner component
- [x] Remove barcode router from backend
- [x] Remove Open Food Facts API integration
- [x] Remove html5-qrcode dependency
- [x] Fix Chat page showing 404 error - check routing configuration
- [x] Fix chatbot input box overlapping with action buttons at bottom of page
